class QuizManager {
  constructor(gameState) {
    this.gameState = gameState;
    this.responses = new Map();
    this.essayVotes = new Map();
    this.quizActive = false;
    this.currentQuiz = null;
    this.currentRound = 0;
    this.usedQuestions = [];
    this.quizTimeout = null;
  }

  startQuiz(io, round) {
    this.currentRound = round;
    this.quizActive = true;
    this.responses.clear();
    this.essayVotes.clear();

    const players = this.gameState.players;
    const isEssayRound = (round === 5 || round === 10);

    if (isEssayRound) {
      const essayIndex = round === 5 ? 0 : 1;
      const question = this.gameState.config.essayQuestions[essayIndex];

      this.currentQuiz = {
        type: "essay",
        question: question,
        timeLimit: this.gameState.config.gameSettings.essayTimeMs
      };

      io.to(this.gameState.hostId).emit("quizStarted", {
        type: "essay",
        question: question,
        round: round,
        timeLimit: this.currentQuiz.timeLimit
      });

      for (const [id, p] of Object.entries(players)) {
        if (!p.isDead && !p.isSpectator) {
          io.to(id).emit("quizStarted", {
            type: "essay",
            question: question,
            timeLimit: this.currentQuiz.timeLimit
          });
        }
      }

      this.quizTimeout = setTimeout(() => {
        this.endEssay(io);
      }, this.currentQuiz.timeLimit);
    } else {
      const usedQs = this.usedQuestions.filter(q => q.round !== round).map(q => q.question);
      const available = this.gameState.config.quizQuestions.filter(q => !usedQs.includes(q.q));
      const question = available.length > 0 ? available[Math.floor(Math.random() * available.length)] : this.gameState.config.quizQuestions[0];

      this.usedQuestions.push({ round: round, question: question.q });

      this.currentQuiz = {
        type: "quiz",
        question: question,
        timeLimit: this.gameState.config.gameSettings.quizTimeMs
      };

      io.to(this.gameState.hostId).emit("quizStarted", {
        type: "quiz",
        question: question,
        round: round,
        timeLimit: this.currentQuiz.timeLimit
      });

      for (const [id, p] of Object.entries(players)) {
        if (!p.isDead && !p.isSpectator) {
          io.to(id).emit("quizStarted", {
            type: "quiz",
            question: question,
            timeLimit: this.currentQuiz.timeLimit
          });
        }
      }

      this.quizTimeout = setTimeout(() => {
        this.endQuiz(io);
      }, this.currentQuiz.timeLimit);
    }
  }

  submitQuizAnswer(playerId, answer, io) {
    if (!this.quizActive || !this.currentQuiz || this.currentQuiz.type !== "quiz") return;
    if (this.responses.has(playerId)) return;

    const player = this.gameState.players[playerId];
    if (!player || player.isDead) return;

    this.responses.set(playerId, { answer: parseInt(answer), timestamp: Date.now() });

    const totalPlayers = Object.values(this.gameState.players).filter(p => !p.isDead && !p.isSpectator).length;

    io.to(this.gameState.hostId).emit("quizResponseReceived", {
      responses: this.responses.size,
      total: totalPlayers
    });

    if (this.responses.size >= totalPlayers) {
      this.endQuiz(io);
    }
  }

  submitEssay(playerId, text, io) {
    if (!this.quizActive || !this.currentQuiz || this.currentQuiz.type !== "essay") return;

    const player = this.gameState.players[playerId];
    if (!player || player.isDead) return;

    this.responses.set(playerId, { text: text, timestamp: Date.now() });

    const totalPlayers = Object.values(this.gameState.players).filter(p => !p.isDead && !p.isSpectator).length;

    io.to(this.gameState.hostId).emit("essayResponseReceived", {
      responses: this.responses.size,
      total: totalPlayers
    });

    if (this.responses.size >= totalPlayers) {
      this.endEssay(io);
    }
  }

  endQuiz() {
    if (!this.quizActive || !this.currentQuiz) return;
    clearTimeout(this.quizTimeout);

    const question = this.currentQuiz.question;
    const players = this.gameState.players;
    const gameSettings = this.gameState.config.gameSettings;

    const results = {};
    for (const [id, response] of this.responses) {
      const player = players[id];
      if (!player) continue;

      const isCorrect = response.answer === question.correct;
      let points = 0;

      if (isCorrect) {
        points = gameSettings.quizPointCorrect || 10;
      } else {
        points = gameSettings.quizPointWrong || -5;
      }

      player.totalPoints = (player.totalPoints || 0) + points;
      player.eventPoints = (player.eventPoints || 0) + points;

      results[id] = {
        name: player.name,
        icon: player.icon,
        answer: response.answer,
        isCorrect: isCorrect,
        points: points,
        totalPoints: player.totalPoints
      };
    }

    for (const [id, p] of Object.entries(players)) {
      if (!this.responses.has(id) && !p.isDead && !p.isSpectator) {
        const timeoutPoints = gameSettings.quizPointTimeout || 0;
        p.totalPoints = (p.totalPoints || 0) + timeoutPoints;
        p.eventPoints = (p.eventPoints || 0) + timeoutPoints;

        results[id] = {
          name: p.name,
          icon: p.icon,
          answer: -1,
          isCorrect: false,
          points: timeoutPoints,
          totalPoints: p.totalPoints,
          timedOut: true
        };
      }
    }

    this.gameState.quizCooldown = true;
    this.quizActive = false;
    this.currentQuiz = null;

    this.gameState.io.emit("quizComplete", {
      correctAnswer: question.correct,
      results: results,
      question: question
    });
  }

  endEssay() {
    if (!this.quizActive || !this.currentQuiz) return;
    clearTimeout(this.quizTimeout);

    const players = this.gameState.players;

    const essays = {};
    for (const [id, response] of this.responses) {
      const player = players[id];
      if (!player) continue;
      essays[id] = {
        name: player.name,
        icon: player.icon,
        text: response.text
      };
    }

    for (const [id, p] of Object.entries(players)) {
      if (!this.responses.has(id) && !p.isDead && !p.isSpectator) {
        essays[id] = {
          name: p.name,
          icon: p.icon,
          text: "(No response submitted)",
          timedOut: true
        };
      }
    }

    this.gameState.quizCooldown = true;
    this.quizActive = false;
    this.currentQuiz = null;

    this.gameState.io.emit("essayComplete", {
      essays: essays
    });

    this.gameState.io.to(this.gameState.hostId).emit("essayVotingStart", {
      essays: essays
    });
  }

  voteEssay(voterId, essayId, io) {
    if (this.essayVotes.has(voterId)) return;

    this.essayVotes.set(voterId, essayId);

    const totalPlayers = Object.values(this.gameState.players).filter(p => !p.isDead && !p.isSpectator).length;

    io.to(this.gameState.hostId).emit("essayVoteReceived", {
      votes: this.essayVotes.size,
      total: totalPlayers
    });

    if (this.essayVotes.size >= totalPlayers) {
      this.tallyEssayVotes(io);
    }
  }

  tallyEssayVotes(io) {
    const voteCounts = {};
    for (const [voterId, essayId] of this.essayVotes) {
      voteCounts[essayId] = (voteCounts[essayId] || 0) + 1;
    }

    let winningId = null;
    let maxVotes = 0;
    for (const [essayId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        winningId = essayId;
      }
    }

    const winner = this.gameState.players[winningId];
    if (winner) {
      winner.totalPoints = (winner.totalPoints || 0) + 5;
      winner.eventPoints = (winner.eventPoints || 0) + 5;
    }

    io.emit("essayVotingComplete", {
      votes: voteCounts,
      winner: winner ? { name: winner.name, icon: winner.icon } : null
    });

    this.essayVotes.clear();
  }

  getResponseCount() {
    return this.responses.size;
  }
}

module.exports = QuizManager;
