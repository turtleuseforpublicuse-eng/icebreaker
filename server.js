const express = require('express');
const path = require('path');
const fs = require('fs');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static(path.join(__dirname, 'public')));

// Load roles + events from config.json so they're easy to tweak
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const events = config.events;

// --- Game State ---
let players = {};
let roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
let gameStarted = false;
let activeEvent = null;
let roles = config.roles.map(r => ({ ...r, takenBy: null }));

function resetGame() {
  players = {};
  roomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  gameStarted = false;
  activeEvent = null;
  roles = config.roles.map(r => ({ ...r, takenBy: null }));
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
    if ((code || '').toUpperCase() === roomCode) {
      if (gameStarted) {
        socket.emit('joinError', 'The game has already started — ask the host to reset!');
      } else {
        socket.emit('roomVerified', roles);
      }
    } else {
      socket.emit('joinError', 'Invalid room code — check the projector screen!');
    }
  });

  // --- PLAYER: Step 2, finalize join ---
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
    players[socket.id] = {
      id: socket.id,
      name,
      roleName: roles[roleIndex].name,
      roleIcon: roles[roleIndex].icon,
      roleId: data.roleId,
      color: data.color || '#43e97b',
      x: Math.floor(Math.random() * 550) + 120,
      jumpUntil: 0,
      health: 100,
      hunger: 100,
      isAlive: true
    };

    io.emit('updateRoles', roles);
    io.emit('updatePlayers', players);
    socket.emit('joinSuccess', players[socket.id]);
  });

  // --- PLAYER: movement (only works once game has started) ---
  socket.on('move', (direction) => {
    const p = players[socket.id];
    if (!gameStarted || !p || !p.isAlive) return;

    if (direction === 'left') p.x = Math.max(60, p.x - 25);
    if (direction === 'right') p.x = Math.min(740, p.x + 25);
    if (direction === 'jump') p.jumpUntil = Date.now() + 400; // visual-only hop

    io.emit('updatePlayers', players);
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
      for (const id in players) {
        const p = players[id];
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
    if (players[socket.id]) {
      const roleIndex = roles.findIndex(r => r.id === players[socket.id].roleId);
      if (roleIndex !== -1) roles[roleIndex].takenBy = null;
      delete players[socket.id];
      io.emit('updateRoles', roles);
      io.emit('updatePlayers', players);
    }
    console.log('Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`DRRR Safe House server running on port ${PORT}`);
});
