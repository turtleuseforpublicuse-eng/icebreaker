const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(__dirname));

// Load roles + events from config.json so they're easy to tweak
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const events = config.events;

const GRAVITY = 1.3;
const JUMP_SPEED = 15;
const MOVE_SPEED = 6;
const TICK_MS = 50; // 20fps physics/broadcast tick

// --- Game State ---
// players is keyed by roleId (STABLE across reconnects) instead of socket.id
let players = {};
let socketToRole = {}; // socket.id -> roleId, only for currently-connected sockets
let roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
let gameStarted = false;
let activeEvent = null;
let roles = config.roles.map(r => ({ ...r, takenBy: null }));

function resetGame() {
  players = {};
  socketToRole = {};
  roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  gameStarted = false;
  activeEvent = null;
  roles = config.roles.map(r => ({ ...r, takenBy: null }));
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
    connected: true
  };
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // --- HOST ---
  socket.on('requestHostData', () => {
    socket.emit('hostData', { roomCode, gameStarted });
    socket.emit('updatePlayers', players);
    socket.emit('updateRoles', roles);
  });

  socket.on('startGame', () => {
    if (Object.keys(players).length === 0) return;
    gameStarted = true;
    io.emit('gameStarted');
  });

  socket.on('resetGame', () => {
    resetGame();
    io.emit('gameReset');
  });

  // --- PLAYER: Step 1, verify room code ---
  socket.on('verifyRoom', (code) => {
    if ((code || '').toUpperCase() !== roomCode) {
      return socket.emit('joinError', 'Invalid room code — check the projector screen!');
    }

    if (!gameStarted) {
      return socket.emit('roomVerified', { rejoin: false, roles });
    }

    // Game already running — only allow reclaiming a seat that got disconnected
    const options = Object.values(players)
      .filter(p => !p.connected)
      .map(p => ({ roleId: p.roleId, name: p.name, roleIcon: p.roleIcon, roleName: p.roleName }));

    if (options.length === 0) {
      return socket.emit('joinError', 'The game already started and every seat is taken!');
    }
    socket.emit('roomVerified', { rejoin: true, options });
  });

  // --- PLAYER: reclaim a seat after being disconnected mid-game ---
  socket.on('reclaimSeat', (data) => {
    const p = players[data.roleId];
    if (!p || p.connected) {
      return socket.emit('joinError', 'That seat is no longer available.');
    }
    p.connected = true;
    socketToRole[socket.id] = data.roleId;
    socket.emit('rejoinSuccess', p);
    io.emit('updatePlayers', players);
  });

  // --- PLAYER: Step 2, finalize a fresh join (lobby only) ---
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
    players[data.roleId] = player;
    socketToRole[socket.id] = data.roleId;

    io.emit('updateRoles', roles);
    io.emit('updatePlayers', players);
    socket.emit('joinSuccess', player);
  });

  // --- PLAYER: movement (only works once game has started) ---
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
    if (p.offsetY === 0) p.vy = JUMP_SPEED; // only jump while grounded
  });

  // --- HOST: trigger one of the 4 disaster events ---
  socket.on('triggerEvent', (eventId) => {
    if (!gameStarted || activeEvent) return;
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;

    activeEvent = ev.id;
    io.emit('eventStart', ev);

    const TICKS = 5;
    let tick = 0;
    const tickMs = ev.duration / TICKS;

    const interval = setInterval(() => {
      tick++;
      for (const rid in players) {
        const p = players[rid];
        if (!p.isAlive) continue;
        const dmg = Math.floor(Math.random() * (ev.damage[1] - ev.damage[0] + 1)) + ev.damage[0];
        p.health = Math.max(0, p.health - Math.round(dmg / TICKS));
        p.hunger = Math.max(0, p.hunger - 3);
        if (p.health <= 0) p.isAlive = false;
      }
      io.emit('updatePlayers', players);
      if (tick >= TICKS) clearInterval(interval);
    }, tickMs);

    setTimeout(() => {
      activeEvent = null;
      io.emit('eventEnd');
    }, ev.duration);
  });

  socket.on('disconnect', () => {
    const roleId = socketToRole[socket.id];
    delete socketToRole[socket.id];

    if (roleId && players[roleId]) {
      if (gameStarted) {
        // Keep their data/progress — they (or someone claiming to be them) can reclaim it
        players[roleId].connected = false;
        players[roleId].moving = { left: false, right: false };
      } else {
        // Still in the lobby — free the role up completely
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

// --- Global physics/movement tick (runs continuously while the game is live) ---
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
