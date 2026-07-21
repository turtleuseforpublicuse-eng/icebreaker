const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const DisasterManager = require('./lib/disasterManager');
const RoleManager = require('./lib/roleManager');

app.use(express.static(__dirname));

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const events = config.events;

const GRAVITY = 1.3;
const JUMP_SPEED = 15;
const MOVE_SPEED = 6;
const TICK_MS = 50;

// --- Game State ---
let players = {};
let socketToRole = {};
let roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
let gameStarted = false;
let currentRound = 0;
let roles = config.roles.map(r => ({ ...r, takenBy: null }));

// Future-ready placeholders (v1.2+)
let shelterIntegrity = 100;
let pendingRequests = [];

const disasterManager = new DisasterManager({
  events,
  io,
  getPlayers: () => players,
  getGameStarted: () => gameStarted,
  onDisasterEnd: () => {
    currentRound++;
    io.emit('roundUpdate', { current: currentRound, total: config.gameSettings?.totalRounds || 10 });
  }
});

const roleManager = new RoleManager({
  getRoles: () => roles,
  getPlayers: () => players,
  getSocketToRole: () => socketToRole,
  io
});

function resetGame() {
  players = {};
  socketToRole = {};
  roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  gameStarted = false;
  currentRound = 0;
  shelterIntegrity = 100;
  pendingRequests = [];
  roles = config.roles.map(r => ({ ...r, takenBy: null }));
  disasterManager.reset();
  roleManager.reset();
}

function makeFreshPlayer(roleDef, data) {
  return {
    name: (data.name || '').trim().slice(0, 12),
    roleName: roleDef.name,
    roleIcon: roleDef.icon,
    roleId: roleDef.id,
    color: data.color || '#43e97b',
    x: Math.floor(Math.random() * 550) + 120,
    offsetY: 0,
    vy: 0,
    moving: { left: false, right: false },
    health: 100,
    hunger: 100,
    isAlive: true,
    connected: true,
    socketId: null,
    inventory: []
  };
}

function attachSocket(player, socketId) {
  if (player) player.socketId = socketId;
}

function broadcastGameState() {
  io.emit('updatePlayers', players);
  io.emit('updateRoles', roles);
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // --- HOST ---
  socket.on('requestHostData', () => {
    socket.emit('hostData', {
      roomCode,
      gameStarted,
      currentRound,
      totalRounds: config.gameSettings?.totalRounds || 10,
      shelterIntegrity
    });
    socket.emit('updatePlayers', players);
    socket.emit('updateRoles', roles);
  });

  socket.on('startGame', () => {
    if (Object.keys(players).length === 0) return;
    gameStarted = true;
    currentRound = 1;
    io.emit('gameStarted');
    io.emit('roundUpdate', { current: currentRound, total: config.gameSettings?.totalRounds || 10 });
    disasterManager.startAutoSchedule();
  });

  socket.on('resetGame', () => {
    disasterManager.stopAutoSchedule();
    resetGame();
    io.emit('gameReset');
  });

  // --- PLAYER: verify room code ---
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

  // --- Movement ---
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

  // --- Lookout: detect incoming disaster during early window ---
  socket.on('detectDisaster', () => {
    const roleId = socketToRole[socket.id];
    const p = players[roleId];
    if (!p || p.roleName !== 'Lookout') return;
    if (disasterManager.markDetected()) {
      socket.emit('detectSuccess', { message: 'Disaster detected! Team gets a calm heads-up.' });
    }
  });

  // --- Role swap ---
  socket.on('requestRoleSwap', (targetRoleId) => {
    const fromRoleId = socketToRole[socket.id];
    if (!fromRoleId || !gameStarted) return;

    const result = roleManager.requestSwap(fromRoleId, targetRoleId);
    if (!result.ok) {
      return socket.emit('swapError', result.error);
    }

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
    if (!result.ok) {
      return socket.emit('swapError', result.error);
    }

    if (result.accepted && result.swapped) {
      broadcastGameState();
      result.swapped.forEach(({ roleId, player }) => {
        if (player.socketId) {
          io.to(player.socketId).emit('roleSwapped', player);
        }
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

  socket.on('disconnect', () => {
    const roleId = socketToRole[socket.id];
    delete socketToRole[socket.id];

    if (roleId && players[roleId]) {
      roleManager.cancelSwapFor(roleId);
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

// --- Physics tick ---
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
      if (p.offsetY <= 0) { p.offsetY = 0; p.vy = 0; }
      changed = true;
    }
  }
  if (changed) io.emit('updatePlayers', players);
}, TICK_MS);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`DRRR Safe House server running on port ${PORT}`);
});
