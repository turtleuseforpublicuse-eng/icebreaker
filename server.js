const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const DisasterManager = require('./lib/disasterManager');
const RoleManager = require('./lib/roleManager');
const ShelterManager = require('./lib/shelterManager');
const ItemManager = require('./lib/itemManager');
const QuizManager = require('./lib/quizManager');
const RequestManager = require('./lib/requestManager');

app.use(express.static(__dirname));

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const events = config.events;

const GRAVITY = 1.3;
const JUMP_SPEED = 15;
const MOVE_SPEED = 6;
const TICK_MS = 50;

let players = {};
let socketToRole = {};
let roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
let gameStarted = false;
let currentRound = 0;
let totalRounds = config.gameSettings?.totalRounds || 10;
let roles = config.roles.map(r => ({ ...r, takenBy: null }));
let gameOver = false;

const shelterManager = new ShelterManager({
  furnitureConfig: config.furniture,
  io,
  getPlayers: () => players,
  getGameStarted: () => gameStarted
});

const itemManager = new ItemManager({
  itemsConfig: config.items,
  scavengeSpots: config.scavengeSpots,
  io,
  getPlayers: () => players
});

const disasterManager = new DisasterManager({
  events,
  io,
  getPlayers: () => players,
  getGameStarted: () => gameStarted,
  shelterManager,
  itemManager,
  onDisasterEnd: (ev) => {
    currentRound++;
    io.emit('roundUpdate', { current: currentRound, total: totalRounds });

    if (currentRound >= totalRounds) {
      _checkWinner();
    }
    _checkAllDead();
  }
});

const roleManager = new RoleManager({
  getRoles: () => roles,
  getPlayers: () => players,
  getSocketToRole: () => socketToRole,
  io
});

const quizManager = new QuizManager({
  quizQuestions: config.quizQuestions,
  essayQuestions: config.essayQuestions,
  io,
  getPlayers: () => players,
  getGameStarted: () => gameStarted
});

const requestManager = new RequestManager({
  io,
  getPlayers: () => players
});

function _checkWinner() {
  if (gameOver) return;
  const alive = Object.entries(players).filter(([_, p]) => p.isAlive);
  if (alive.length <= 1 || currentRound >= totalRounds) {
    gameOver = true;
    disasterManager.stopAutoSchedule();

    let winner = null;
    let bestScore = -1;

    for (const [rid, p] of alive) {
      const score = p.health + p.hunger;
      if (score > bestScore) {
        bestScore = score;
        winner = rid;
      }
    }

    if (!winner && alive.length === 0) {
      const allPlayers = Object.entries(players);
      let lastDead = null;
      for (const [rid, p] of allPlayers) {
        if (!lastDead || p.health > lastDead.health) {
          lastDead = p;
          winner = rid;
        }
      }
    }

    if (winner && players[winner]) {
      io.emit('gameOver', {
        winnerId: winner,
        winnerName: players[winner].name,
        winnerIcon: players[winner].roleIcon,
        reason: currentRound >= totalRounds ? 'Time\'s up!' : 'Last survivor!'
      });
    }
  }
}

function _checkAllDead() {
  if (gameOver) return;
  const alive = Object.values(players).filter(p => p.isAlive);
  if (alive.length === 1) {
    const last = Object.entries(players).find(([_, p]) => p.isAlive);
    if (last) {
      gameOver = true;
      disasterManager.stopAutoSchedule();
      io.emit('gameOver', {
        winnerId: last[0],
        winnerName: last[1].name,
        winnerIcon: last[1].roleIcon,
        reason: 'Last survivor!'
      });
    }
  } else if (alive.length === 0) {
    gameOver = true;
    disasterManager.stopAutoSchedule();
    io.emit('gameOver', {
      winnerId: null,
      winnerName: 'Nobody',
      winnerIcon: '💀',
      reason: 'Everyone perished!'
    });
  }
}

function resetGame() {
  players = {};
  socketToRole = {};
  roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  gameStarted = false;
  currentRound = 0;
  gameOver = false;
  roles = config.roles.map(r => ({ ...r, takenBy: null }));
  disasterManager.reset();
  roleManager.reset();
  shelterManager.reset();
  itemManager.reset();
  quizManager.reset();
  requestManager.reset();
}

function makeFreshPlayer(roleDef, data) {
  return {
    name: (data.name || '').trim().slice(0, 12),
    roleName: roleDef.name,
    roleIcon: roleDef.icon,
    roleId: roleDef.id,
    color: data.color || '#43e97b',
    x: Math.floor(Math.random() * 550) + 120,
    floor: 1,
    offsetY: 0,
    vy: 0,
    moving: { left: false, right: false },
    health: 100,
    hunger: 100,
    isAlive: true,
    connected: true,
    socketId: null,
    inventory: [],
    essayImmunity: false
  };
}

function attachSocket(player, socketId) {
  if (player) player.socketId = socketId;
}

function broadcastGameState() {
  io.emit('updatePlayers', players);
  io.emit('updateRoles', roles);
  io.emit('shelterUpdate', shelterManager.getState());
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  socket.on('requestHostData', () => {
    socket.emit('hostData', {
      roomCode,
      gameStarted,
      currentRound,
      totalRounds,
      shelterIntegrity: shelterManager.shelterIntegrity
    });
    socket.emit('updatePlayers', players);
    socket.emit('updateRoles', roles);
    socket.emit('shelterUpdate', shelterManager.getState());
    socket.emit('furnitureState', shelterManager.furniture);
  });

  socket.on('startGame', () => {
    if (Object.keys(players).length === 0) return;
    gameStarted = true;
    currentRound = 1;
    gameOver = false;
    io.emit('gameStarted');
    io.emit('roundUpdate', { current: currentRound, total: totalRounds });
    io.emit('shelterUpdate', shelterManager.getState());
    io.emit('furnitureState', shelterManager.furniture);
    disasterManager.startAutoSchedule();
  });

  socket.on('resetGame', () => {
    disasterManager.stopAutoSchedule();
    resetGame();
    io.emit('gameReset');
  });

  socket.on('verifyRoom', (code) => {
    if ((code || '').toUpperCase() !== roomCode) {
      return socket.emit('joinError', 'Invalid room code — check the projector screen!');
    }
    if (!gameStarted) {
      return socket.emit('roomVerified', { rejoin: false, roles });
    }
    const options = Object.values(players)
      .filter(p => !p.connected)
      .map(p => ({ roleId: p.roleId, name: p.name, roleIcon: p.roleIcon, roleName: p.roleName }));
    if (options.length === 0) {
      return socket.emit('joinError', 'The game already started and every seat is taken!');
    }
    socket.emit('roomVerified', { rejoin: true, options });
  });

  socket.on('reclaimSeat', (data) => {
    const p = players[data.roleId];
    if (!p || p.connected) {
      return socket.emit('joinError', 'That seat is no longer available.');
    }
    p.connected = true;
    attachSocket(p, socket.id);
    socketToRole[socket.id] = data.roleId;
    socket.emit('rejoinSuccess', p);
    io.emit('updatePlayers', players);
  });

  socket.on('joinGame', (data) => {
    if (gameStarted) {
      return socket.emit('joinError', 'The game has already started!');
    }
    const name = (data.name || '').trim().slice(0, 12);
    if (!name) return socket.emit('joinError', 'Please enter a name!');
    const roleIndex = roles.findIndex(r => r.id === data.roleId);
    if (roleIndex === -1 || roles[roleIndex].takenBy) {
      return socket.emit('joinError', 'That role was just taken — pick another!');
    }
    roles[roleIndex].takenBy = name;
    const player = makeFreshPlayer(roles[roleIndex], data);
    attachSocket(player, socket.id);
    players[data.roleId] = player;
    socketToRole[socket.id] = data.roleId;
    io.emit('updateRoles', roles);
    io.emit('updatePlayers', players);
    socket.emit('joinSuccess', player);
  });

  socket.on('moveStart', (direction) => {
    const p = players[socketToRole[socket.id]];
    if (!gameStarted || !p || !p.isAlive) return;
    if (direction === 'left' || direction === 'right') p.moving[direction] = true;
  });

  socket.on('moveStop', (direction) => {
    const p = players[socketToRole[socket.id]];
    if (!p) return;
    if (direction === 'left' || direction === 'right') p.moving[direction] = false;
  });

  socket.on('jump', () => {
    const p = players[socketToRole[socket.id]];
    if (!gameStarted || !p || !p.isAlive) return;
    if (p.offsetY === 0) p.vy = JUMP_SPEED;
  });

  socket.on('useStairs', (direction) => {
    const p = players[socketToRole[socket.id]];
    if (!gameStarted || !p || !p.isAlive) return;
    if (direction === 'up' && p.floor === 1 && p.x > 370 && p.x < 430) {
      p.floor = 2;
      p.offsetY = 200;
    } else if (direction === 'down' && p.floor === 2 && p.x > 370 && p.x < 430) {
      p.floor = 1;
      p.offsetY = 0;
    }
    io.emit('updatePlayers', players);
  });

  socket.on('detectDisaster', () => {
    const roleId = socketToRole[socket.id];
    const p = players[roleId];
    if (!p || p.roleName !== 'Lookout') return;
    if (disasterManager.markDetected()) {
      socket.emit('detectSuccess', { message: 'Disaster detected! Team gets a calm heads-up.' });
    }
  });

  socket.on('requestRoleSwap', (targetRoleId) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId || !gameStarted) return;
    const result = roleManager.requestSwap(fromRoleId, targetRoleId);
    if (!result.ok) return socket.emit('swapError', result.error);
    socket.emit('swapRequestSent', { targetName: result.targetName });
    const target = players[targetRoleId];
    if (target && target.socketId) {
      io.to(target.socketId).emit('roleSwapRequest', {
        fromRoleId,
        fromName: players[fromRoleId].name,
        fromRoleName: players[fromRoleId].roleName,
        fromRoleIcon: players[fromRoleId].roleIcon
      });
    }
  });

  socket.on('respondRoleSwap', (data) => {
    const toRoleId = socketToRole[socket.id];
    if (!toRoleId) return;
    const result = roleManager.respondSwap(toRoleId, !!data.accept);
    if (!result.ok) return socket.emit('swapError', result.error);
    if (result.accepted && result.swapped) {
      broadcastGameState();
      result.swapped.forEach(({ roleId, player }) => {
        if (player.socketId) io.to(player.socketId).emit('roleSwapped', player);
      });
      io.emit('swapComplete', {
        message: `${result.swapped[0].player.name} and ${result.swapped[1].player.name} swapped roles!`
      });
    } else if (!result.accepted) {
      const from = players[result.fromRoleId];
      if (from && from.socketId) {
        io.to(from.socketId).emit('swapDeclined', { byName: players[toRoleId].name });
      }
    }
  });

  socket.on('medicHeal', (targetRoleId) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = roleManager.heal(fromRoleId, targetRoleId);
    if (!result.ok) return socket.emit('actionError', result.error);
    socket.emit('actionSuccess', { message: `Healed ${result.healed}!` });
  });

  socket.on('caretakerRepair', (furnitureId) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = roleManager.caretakerRepair(fromRoleId, shelterManager, furnitureId);
    if (!result.ok) return socket.emit('actionError', result.error);
    socket.emit('actionSuccess', { message: result.repaired ? `Repaired ${result.repaired}!` : 'Shelter repaired!' });
  });

  socket.on('scavenge', (spotId) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = roleManager.scavenge(fromRoleId, spotId, itemManager);
    if (!result.ok) return socket.emit('actionError', result.error);
    socket.emit('actionSuccess', { message: `Found ${result.item.name}!` });
  });

  socket.on('useItem', (inventoryIndex) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = itemManager.useItem(fromRoleId, inventoryIndex);
    if (!result.ok) return socket.emit('actionError', result.error);
    socket.emit('actionSuccess', { message: `${result.item}: ${result.effects.join(', ')}` });
  });

  socket.on('shareFood', (targetRoleId, inventoryIndex) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = itemManager.shareFood(fromRoleId, targetRoleId, inventoryIndex);
    if (!result.ok) return socket.emit('actionError', result.error);
    socket.emit('actionSuccess', { message: `Shared food! (+${result.amount} Food)` });
  });

  socket.on('useRepairKit', (inventoryIndex) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = itemManager.useRepairKit(fromRoleId, inventoryIndex, shelterManager);
    if (!result.ok) return socket.emit('actionError', result.error);
    socket.emit('actionSuccess', { message: `Repaired shelter +${result.repaired}!` });
  });

  socket.on('initializeConstruction', () => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = shelterManager.initializeConstruction(fromRoleId);
    if (!result.ok) return socket.emit('actionError', result.error);
    io.emit('constructionInitialized', { by: players[fromRoleId].name });
  });

  socket.on('startConstruction', () => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = shelterManager.startConstruction(fromRoleId);
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('throwQuiz', () => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = quizManager.throwQuiz();
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('submitQuizAnswer', (answerIndex) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = quizManager.submitQuizAnswer(fromRoleId, answerIndex);
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('throwEssay', () => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = quizManager.throwEssay();
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('submitEssay', (text) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = quizManager.submitEssay(fromRoleId, text);
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('voteEssay', (targetRoleId) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = quizManager.voteEssay(fromRoleId, targetRoleId);
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('createRequest', (type, targetRoleId) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = requestManager.createRequest(type, fromRoleId, targetRoleId);
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('respondRequest', (requestId, accept) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId) return;
    const result = requestManager.respondRequest(requestId, fromRoleId, accept);
    if (!result.ok) return socket.emit('actionError', result.error);
  });

  socket.on('disconnect', () => {
    const roleId = socketToRole[socket.id];
    delete socketToRole[socket.id];
    if (roleId && players[roleId]) {
      roleManager.cancelSwapFor(roleId);
      requestManager.cancelRequestsFrom(roleId);
      players[roleId].socketId = null;
      if (gameStarted) {
        players[roleId].connected = false;
        players[roleId].moving = { left: false, right: false };
      } else {
        const roleIndex = roles.findIndex(r => r.id === roleId);
        if (roleIndex !== -1) roles[roleIndex].takenBy = null;
        delete players[roleId];
        io.emit('updateRoles', roles);
      }
      io.emit('updatePlayers', players);
    }
    console.log('Disconnected:', socket.id);
  });
});

setInterval(() => {
  if (!gameStarted) return;
  let changed = false;
  for (const rid in players) {
    const p = players[rid];
    if (!p.connected || !p.isAlive) continue;

    if (p.moving.left) { p.x = Math.max(60, p.x - MOVE_SPEED); changed = true; }
    if (p.moving.right) { p.x = Math.min(740, p.x + MOVE_SPEED); changed = true; }

    if (p.vy !== 0 || p.offsetY > 0) {
      p.offsetY += p.vy;
      p.vy -= GRAVITY;
      const groundY = p.floor === 2 ? 200 : 0;
      if (p.offsetY <= groundY) { p.offsetY = groundY; p.vy = 0; }
      changed = true;
    }

    if (!gameOver && p.isAlive) {
      p.hunger = Math.max(0, p.hunger - 0.02);
      if (p.hunger <= 0) {
        p.health = Math.max(0, p.health - 0.1);
        if (p.health <= 0) {
          p.isAlive = false;
          itemManager.dropItems(rid);
        }
      }
    }
  }
  if (changed) io.emit('updatePlayers', players);
}, TICK_MS);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`DRRR Safe House server running on port ${PORT}`);
});
