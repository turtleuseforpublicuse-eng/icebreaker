const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(__dirname));
app.use('/config', express.static(path.join(__dirname, 'config.json')));

const ShelterManager = require('./lib/shelterManager');
const DisasterManager = require('./lib/disasterManager');
const RoleManager = require('./lib/roleManager');
const ItemManager = require('./lib/itemManager');
const RequestManager = require('./lib/requestManager');
const QuizManager = require('./lib/quizManager');

const games = new Map();

class Game {
  constructor(hostId, roomCode, gameSettings) {
    this.hostId = hostId;
    this.roomCode = roomCode;
    this.players = {};
    this.isGameStarted = false;
    this.isGameFinished = false;
    this.currentRound = 0;
    this.maxRounds = gameSettings.totalRounds || 10;
    this.currentEvent = null;
    this.currentEventName = null;
    this.eventTimer = null;
    this.quizzes = [];
    this.currentQuiz = null;
    this.quizCooldown = false;
    this.shelter = new ShelterManager(config);
    this.disasterManager = new DisasterManager(this);
    this.roleManager = new RoleManager(this);
    this.itemManager = new ItemManager(this);
    this.requestManager = new RequestManager(this);
    this.quizManager = new QuizManager(this);
    this.config = config;
    this.io = io;
    this.hungerDecayTimer = null;
    this.dayNightTimer = null;
    this.dayNightState = 'day';
    this.timeRemaining = config.gameSettings.dayNightCycleMs;
    this.usedQuizzes = [];
    this.usedEssays = [];
    this.totalPoints = 0;
    this.eventScores = {};
    this.eventPoints = {};
  }

  addPlayer(id, name, icon) {
    this.players[id] = {
      id: id,
      name: name,
      icon: icon,
      role: null,
      health: 100,
      hunger: 100,
      inventory: [],
      hiding: false,
      hidingIn: null,
      currentEvent: null,
      safeFromCurrentDisaster: false,
      isDead: false,
      deathCause: null,
      isSpectator: false,
      rolePowerUsed: false,
      rolePowerUsedThisEvent: false,
      requestsSent: 0,
      requestsReceived: 0,
      totalPoints: 0,
      eventPoints: 0,
      medicRequestCount: 0
    };
  }

  assignRoles() {
    const roles = [...config.roles];
    const playerIds = Object.keys(this.players);
    for (const id of playerIds) {
      const idx = Math.floor(Math.random() * roles.length);
      this.players[id].role = roles[idx];
      roles.splice(idx, 1);
    }
  }

  sendGameState() {
    const state = {
      hostId: this.hostId,
      roomCode: this.roomCode,
      isGameStarted: this.isGameStarted,
      isGameFinished: this.isGameFinished,
      currentRound: this.currentRound,
      maxRounds: this.maxRounds,
      currentEvent: this.currentEventName,
      shelter: this.shelter.getState(),
      players: {}
    };

    for (const [id, p] of Object.entries(this.players)) {
      state.players[id] = {
        id: p.id,
        name: p.name,
        icon: p.icon,
        role: p.role,
        health: p.health,
        hunger: p.hunger,
        inventory: p.inventory,
        hiding: p.hiding,
        hidingIn: p.hidingIn,
        currentEvent: p.currentEvent,
        safeFromCurrentDisaster: p.safeFromCurrentDisaster,
        isDead: p.isDead,
        deathCause: p.deathCause,
        isSpectator: p.isSpectator,
        totalPoints: p.totalPoints,
        eventPoints: p.eventPoints,
        medicRequestCount: p.medicRequestCount
      };
    }

    io.to(this.hostId).emit('gameState', state);
    for (const id of Object.keys(this.players)) {
      if (id !== this.hostId) {
        io.to(id).emit('gameState', state);
      }
    }
  }

  sendPlayerUpdates() {
    for (const [id, p] of Object.entries(this.players)) {
      io.to(id).emit('playerUpdate', {
        id: p.id,
        name: p.name,
        icon: p.icon,
        role: p.role,
        health: p.health,
        hunger: p.hunger,
        inventory: p.inventory,
        hiding: p.hiding,
        hidingIn: p.hidingIn,
        currentEvent: p.currentEvent,
        safeFromCurrentDisaster: p.safeFromCurrentDisaster,
        isDead: p.isDead,
        deathCause: p.deathCause,
        isSpectator: p.isSpectator,
        totalPoints: p.totalPoints,
        eventPoints: p.eventPoints,
        medicRequestCount: p.medicRequestCount
      });
    }
  }

  emitTimeUpdate() {
    const timeData = {
      dayNightState: this.dayNightState,
      timeRemaining: this.timeRemaining,
      currentRound: this.currentRound,
      maxRounds: this.maxRounds,
      eventActive: !!this.currentEvent,
      eventName: this.currentEventName
    };
    io.to(this.hostId).emit('timeUpdate', timeData);
    for (const id of Object.keys(this.players)) {
      if (id !== this.hostId) {
        io.to(id).emit('timeUpdate', timeData);
      }
    }
  }

  markDetected(event) {
    this.currentEventName = event.name;

    for (const [id, p] of Object.entries(this.players)) {
      p.currentEvent = event.id;
      p.hiding = false;
      p.hidingIn = null;
      p.safeFromCurrentDisaster = false;
      p.rolePowerUsedThisEvent = false;
    }

    io.to(this.hostId).emit('disasterDetected', {
      eventId: event.id,
      eventName: event.name,
      eventIcon: event.icon,
      hint: event.hint
    });

    for (const [id, p] of Object.entries(this.players)) {
      if (id !== this.hostId) {
        io.to(id).emit('disasterDetected', {
          eventId: event.id,
          eventName: event.name,
          eventIcon: event.icon,
          hint: event.hint
        });
      }
    }

    this.emitTimeUpdate();
    this.sendGameState();
  }

  startHungerDecay() {
    if (this.hungerDecayTimer) clearInterval(this.hungerDecayTimer);
    this.hungerDecayTimer = setInterval(() => {
      for (const [id, p] of Object.entries(this.players)) {
        if (p.isDead || p.isSpectator) continue;
        p.hunger = Math.max(0, p.hunger - config.gameSettings.hungerDecayRate);
        if (p.hunger <= 0) {
          p.health = Math.max(0, p.health - config.gameSettings.hungerDamageRate);
          if (p.health <= 0) {
            p.health = 0;
            p.isDead = true;
            p.deathCause = 'Starvation';
          }
        }
      }
      this.sendPlayerUpdates();
    }, 5000);
  }

  stopHungerDecay() {
    if (this.hungerDecayTimer) {
      clearInterval(this.hungerDecayTimer);
      this.hungerDecayTimer = null;
    }
  }

  startDayNightCycle() {
    if (this.dayNightTimer) clearInterval(this.dayNightTimer);
    this.dayNightTimer = setInterval(() => {
      this.timeRemaining -= 1000;
      if (this.timeRemaining <= 0) {
        this.dayNightState = this.dayNightState === 'day' ? 'night' : 'day';
        this.timeRemaining = config.gameSettings.dayNightCycleMs;
        io.emit('dayNightChange', {
          state: this.dayNightState,
          timeRemaining: this.timeRemaining
        });
      }
      this.emitTimeUpdate();
    }, 1000);
  }

  stopDayNightCycle() {
    if (this.dayNightTimer) {
      clearInterval(this.dayNightTimer);
      this.dayNightTimer = null;
    }
  }

  startGame() {
    this.isGameStarted = true;
    this.assignRoles();
    this.startHungerDecay();
    this.startDayNightCycle();
    this.shelter.startConstructorRepair(io);
    this.sendGameState();
    this.sendPlayerUpdates();

    for (const [id, p] of Object.entries(this.players)) {
      io.to(id).emit('gameStarted', {
        role: p.role,
        player: {
          id: p.id,
          name: p.name,
          icon: p.icon,
          health: p.health,
          hunger: p.hunger,
          inventory: p.inventory
        }
      });
    }

    setTimeout(() => {
      this.disasterManager.startDisasterCycle(io);
    }, 5000);
  }

  endGame(reason) {
    this.isGameFinished = true;
    this.disasterManager.cancel();
    this.stopHungerDecay();
    this.stopDayNightCycle();
    this.shelter.stopConstructorRepair();

    const rankings = Object.values(this.players)
      .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
      .map((p, i) => ({
        rank: i + 1,
        name: p.name,
        icon: p.icon,
        role: p.role ? p.role.name : 'Unknown',
        totalPoints: p.totalPoints || 0,
        isDead: p.isDead,
        deathCause: p.deathCause
      }));

    io.emit('gameOver', {
      reason: reason,
      rankings: rankings,
      shelter: this.shelter.getState()
    });
  }
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  socket.on('createGame', (data) => {
    const roomCode = Math.random().toString(36).substr(2, 6).toUpperCase();
    const game = new Game(socket.id, roomCode, config.gameSettings);
    games.set(roomCode, game);
    game.addPlayer(socket.id, data.hostName || 'Host', data.hostIcon || '🏠');
    socket.join(roomCode);
    socket.gameRoom = roomCode;
    socket.emit('gameCreated', { roomCode: roomCode, hostId: socket.id });
    game.sendGameState();
  });

  socket.on('joinGame', (data) => {
    const roomCode = data.roomCode;
    const game = games.get(roomCode);
    if (!game) {
      socket.emit('error', { message: 'Room not found.' });
      return;
    }
    if (game.isGameStarted) {
      socket.emit('error', { message: 'Game already started.' });
      return;
    }

    game.addPlayer(socket.id, data.playerName, data.playerIcon);
    socket.join(roomCode);
    socket.gameRoom = roomCode;
    socket.emit('gameJoined', { roomCode: roomCode, playerId: socket.id });
    game.sendGameState();
  });

  socket.on('startGame', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game || game.hostId !== socket.id) return;
    game.startGame();
  });

  socket.on('playerMove', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || player.isDead || player.isSpectator) return;

    const PLAYER_MIN_X = 20;
    const PLAYER_MAX_X = 780;
    const clampedX = Math.max(PLAYER_MIN_X, Math.min(PLAYER_MAX_X, data.x));

    io.to(roomCode).emit('playerMoved', {
      id: socket.id,
      x: clampedX,
      y: data.y,
      direction: data.direction
    });
  });

  socket.on('playerMoveStart', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || player.isDead || player.isSpectator) return;

    io.to(roomCode).emit('playerMoveStart', {
      id: socket.id,
      direction: data.direction
    });
  });

  socket.on('playerMoveStop', (data) => {
    const roomCode = socket.gameRoom;
    io.to(roomCode).emit('playerMoveStop', { id: socket.id });
  });

  socket.on('playerRespawn', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || !player.isDead) return;

    player.isDead = false;
    player.health = 100;
    player.hunger = 100;
    player.deathCause = null;
    player.isSpectator = true;
    player.inventory = [];

    game.sendPlayerUpdates();
    game.sendGameState();

    io.to(socket.id).emit('respawnComplete', {
      playerId: socket.id,
      isSpectator: true
    });
  });

  socket.on('chooseScavengeSpot', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || player.isDead || player.isSpectator) return;

    if (!player.role || (player.role.id !== 'scv1' && player.role.id !== 'scv2')) {
      socket.emit('error', { message: 'Only Scavengers can scavenge.' });
      return;
    }

    if (game.currentEvent) {
      socket.emit('error', { message: 'Cannot scavenge during an event.' });
      return;
    }

    if (player.rolePowerUsedThisEvent) {
      socket.emit('error', { message: 'You can only scavenge once per event.' });
      return;
    }

    const spot = config.scavengeSpots.find(s => s.id === data.spotId);
    if (!spot) {
      socket.emit('error', { message: 'Invalid scavenge spot.' });
      return;
    }

    const result = game.itemManager.scavenge(socket.id, spot.id);
    if (result.success) {
      player.rolePowerUsedThisEvent = true;
      socket.emit('scavengeResult', {
        items: result.items,
        message: result.message
      });
      game.sendPlayerUpdates();
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  socket.on('useItem', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const result = game.itemManager.useItem(socket.id, data.itemId, io);
    if (result.success) {
      game.sendPlayerUpdates();
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  socket.on('hideInFurniture', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || player.isDead || player.isSpectator) return;

    if (!game.currentEvent) {
      socket.emit('error', { message: 'No active event to hide from.' });
      return;
    }

    const result = game.shelter.hideInFurniture(player, data.furnitureId);
    if (result.success) {
      game.sendPlayerUpdates();
      io.to(roomCode).emit('playerHidden', {
        playerId: socket.id,
        furnitureId: data.furnitureId,
        furnitureName: result.furniture.name
      });
    } else {
      socket.emit('error', { message: result.reason });
    }
  });

  socket.on('unhide', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || player.isDead || player.isSpectator) return;

    const result = game.shelter.unhide(player);
    if (result.success) {
      game.sendPlayerUpdates();
      io.to(roomCode).emit('playerUnhidden', {
        playerId: socket.id
      });
    }
  });

  socket.on('eject', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || player.isDead || player.isSpectator) return;

    if (player.hiding) {
      game.shelter.unhide(player);
      game.sendPlayerUpdates();
      io.to(roomCode).emit('playerUnhidden', { playerId: socket.id });
      socket.emit('ejectSuccess', { message: 'You jumped out!' });
    }
  });

  socket.on('triggerDisaster', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game || game.hostId !== socket.id) return;

    if (game.quizManager.quizActive) {
      game.disasterManager.pause();
      socket.emit('disasterPaused', { message: 'Disaster paused for quiz.' });
    }

    game.disasterManager.startEvent(io);
  });

  socket.on('forceTrigger', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game || game.hostId !== socket.id) return;

    game.disasterManager.cancel();
    game.disasterManager.startEvent(io);
  });

  socket.on('throwQuiz', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game || game.hostId !== socket.id) return;

    if (game.disasterManager.activeEvent) {
      game.disasterManager.pause();
      socket.emit('disasterPaused', { message: 'Disaster paused for quiz.' });
    }

    game.quizManager.startQuiz(io, game.currentRound);
  });

  socket.on('submitQuizAnswer', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    game.quizManager.submitQuizAnswer(socket.id, data.answer, io);
  });

  socket.on('submitEssay', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    game.quizManager.submitEssay(socket.id, data.text, io);
  });

  socket.on('voteEssay', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    game.quizManager.voteEssay(socket.id, data.essayId, io);
  });

  socket.on('quizComplete', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game || game.hostId !== socket.id) return;

    if (game.disasterManager.paused) {
      game.disasterManager.resume(io);
      socket.emit('disasterResumed', { message: 'Disaster resumed.' });
    }
  });

  socket.on('essayComplete', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game || game.hostId !== socket.id) return;

    if (game.disasterManager.paused) {
      game.disasterManager.resume(io);
      socket.emit('disasterResumed', { message: 'Disaster resumed.' });
    }
  });

  socket.on('medicHeal', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const result = game.roleManager.heal(socket.id, data.targetId, io);
    if (result.success) {
      game.sendPlayerUpdates();
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  socket.on('caretakerRestore', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    if (game.currentEvent) {
      socket.emit('error', { message: 'Cannot restore during an event.' });
      return;
    }

    const result = game.shelter.applyCaretakerRepair(data.furnitureId);
    if (result) {
      game.sendGameState();
      io.to(roomCode).emit('furnitureRestored', {
        furnitureId: data.furnitureId,
        restoredBy: socket.id
      });
    } else {
      socket.emit('error', { message: 'Failed to restore furniture.' });
    }
  });

  socket.on('engineerConstruct', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const player = game.players[socket.id];
    if (!player || !player.role || player.role.id !== 'eng1') {
      socket.emit('error', { message: 'Only Engineers can initialize construction.' });
      return;
    }

    if (game.currentEvent) {
      socket.emit('error', { message: 'Cannot construct during an event.' });
      return;
    }

    if (player.rolePowerUsed) {
      socket.emit('error', { message: 'Construction already initialized.' });
      return;
    }

    const result = game.shelter.startConstruction(socket.id, io);
    if (result.success) {
      player.rolePowerUsed = true;
      game.sendGameState();
      io.to(roomCode).emit('constructionStarted', {
        amount: result.amount,
        startedBy: socket.id
      });
    } else {
      socket.emit('error', { message: 'Failed to start construction.' });
    }
  });

  socket.on('sendRequest', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const result = game.requestManager.createRequest(
      socket.id,
      data.targetId,
      data.type,
      data.payload,
      io
    );

    if (!result.success) {
      socket.emit('error', { message: result.reason });
    }
  });

  socket.on('respondToRequest', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    game.requestManager.respondToRequest(data.requestId, data.accepted, socket.id, io);
  });

  socket.on('acceptFoodFromInventory', (data) => {
    const roomCode = socket.gameRoom;
    const game = games.get(roomCode);
    if (!game) return;

    const result = game.requestManager.acceptFoodFromInventory(
      data.requestId,
      socket.id,
      data.selectedItemId,
      io
    );

    if (result.success) {
      game.sendPlayerUpdates();
    } else {
      socket.emit('error', { message: result.reason });
    }
  });

  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    const roomCode = socket.gameRoom;
    if (!roomCode) return;

    const game = games.get(roomCode);
    if (!game) return;

    if (game.hostId === socket.id) {
      io.to(roomCode).emit('hostDisconnected', { message: 'Host has disconnected. Game over.' });
      game.endGame('Host disconnected');
      games.delete(roomCode);
    } else {
      const player = game.players[socket.id];
      if (player) {
        io.to(roomCode).emit('playerDisconnected', {
          playerId: socket.id,
          playerName: player.name
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`DRRR Safe House Server running on port ${PORT}`);
});
