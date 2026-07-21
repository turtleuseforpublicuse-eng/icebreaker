const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const config = require('./config.json');

const DisasterManager = require('./lib/disasterManager');
const RoleManager = require('./lib/roleManager');
const QuizManager = require('./lib/quizManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Global Game State
const gameState = {
  round: 1,
  maxRounds: config.maxRounds || 10,
  shelterIntegrity: config.shelterMaxIntegrity || 100,
  players: {}, // socketId / token -> player data
  rejoinTokens: {}, // token -> socketId
  getPlayersByRole(role) {
    return Object.values(this.players).filter(p => p.role === role);
  }
};

const roleManager = new RoleManager(gameState);
const disasterManager = new DisasterManager(io, gameState, config);
const quizManager = new QuizManager(io, gameState, config.quizQuestions);

io.on('connection', (socket) => {
  console.log(`[Connected] Socket ID: ${socket.id}`);

  // Rejoin or Join Handler
  socket.on('join_game', ({ name, rejoinToken }) => {
    let token = rejoinToken;
    let player = null;

    if (token && gameState.rejoinTokens[token]) {
      // Existing rejoin token found
      const oldPlayer = gameState.players[gameState.rejoinTokens[token]];
      if (oldPlayer) {
        delete gameState.players[gameState.rejoinTokens[token]];
        player = oldPlayer;
        player.socketId = socket.id;
        gameState.players[socket.id] = player;
        gameState.rejoinTokens[token] = socket.id;
      }
    }

    if (!player) {
      // New player initialization
      token = `token_${Math.random().toString(36).substr(2, 9)}`;
      player = {
        id: socket.id,
        socketId: socket.id,
        token: token,
        name: name || `Player_${socket.id.substring(0, 4)}`,
        health: 100,
        food: 100,
        role: 'Caretaker',
        isAlive: true,
        hasImmunity: false,
        inventory: { umbrellaDurability: 0, firstAid: 0, repairKit: 0 },
        x: 100,
        y: 100
      };
      gameState.players[socket.id] = player;
      gameState.rejoinTokens[token] = socket.id;
    }

    socket.emit('joined_successfully', { player, rejoinToken: token });
    io.emit('game_state_update', gameState);
  });

  // Host Controls
  socket.on('host_start_game', () => {
    roleManager.assignInitialRoles(gameState.players);
    disasterManager.startAutoLoop();
    io.emit('game_started', gameState);
  });

  socket.on('host_next_round', () => {
    if (gameState.round < gameState.maxRounds) {
      gameState.round += 1;
      io.emit('game_state_update', gameState);
    } else {
      // Compute Winner
      let winner = null;
      let highestScore = -1;
      Object.values(gameState.players).forEach(p => {
        const score = p.health + p.food;
        if (score > highestScore) {
          highestScore = score;
          winner = p;
        }
      });
      io.emit('game_over', { winner, reason: "Max rounds reached." });
    }
  });

  socket.on('host_throw_quiz', () => quizManager.throwQuestion());
  socket.on('host_throw_essay', (prompt) => quizManager.throwEssayQuestion(prompt));

  // Player Controls & Actions
  socket.on('player_move', (data) => {
    const player = gameState.players[socket.id];
    if (player && player.isAlive) {
      player.x = data.x;
      player.y = data.y;
      socket.broadcast.emit('player_moved', { id: socket.id, x: player.x, y: player.y });
    }
  });

  // Role Switching Handlers
  socket.on('request_role_swap', ({ targetSocketId }) => {
    const result = roleManager.requestSwap(socket.id, targetSocketId);
    if (result.success) {
      io.to(targetSocketId).emit('role_swap_prompt', {
        requestId: result.requestId,
        requesterName: gameState.players[socket.id]?.name || "A player"
      });
    }
  });

  socket.on('respond_role_swap', ({ requestId, accepted }) => {
    const outcome = roleManager.executeSwap(requestId, accepted);
    if (outcome.success) {
      io.to(outcome.playerA.socketId).emit('role_updated', { newRole: outcome.playerA.role });
      io.to(outcome.playerB.socketId).emit('role_updated', { newRole: outcome.playerB.role });
      io.emit('game_state_update', gameState);
    }
  });

  // Quiz / Essay Answers
  socket.on('submit_quiz_answer', ({ answerIndex }) => quizManager.submitAnswer(socket.id, answerIndex));
  socket.on('submit_essay_answer', ({ text }) => quizManager.submitEssay(socket.id, text));
  socket.on('submit_essay_vote', ({ targetPlayerId }) => quizManager.submitVote(socket.id, targetPlayerId));

  socket.on('disconnect', () => {
    console.log(`[Disconnected] Socket ID: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`DRRR Safe House Server running on port ${PORT}`));