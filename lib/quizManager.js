/**
 * QuizManager — multiple choice quiz, essay questions, voting system.
 * Host triggers quizzes; top 3 fastest correct players get rewards.
 * Essay: situational question, 50 char max, 1 min timer, winner gets immunity.
 */

class QuizManager {
  constructor({ quizQuestions, essayQuestions, io, getPlayers, getGameStarted }) {
    this.io = io;
    this.getPlayers = getPlayers;
    this.getGameStarted = getGameStarted;
    this.quizQuestions = quizQuestions || [];
    this.essayQuestions = essayQuestions || [];

    this.activeQuiz = null;
    this.quizResponses = new Map();
    this.quizTimer = null;

    this.activeEssay = null;
    this.essayResponses = new Map();
    this.essayTimer = null;
    this.essayVoting = null;
    this.essayVotes = new Map();
  }

  reset() {
    this.activeQuiz = null;
    this.quizResponses.clear();
    if (this.quizTimer) clearTimeout(this.quizTimer);
    this.quizTimer = null;

    this.activeEssay = null;
    this.essayResponses.clear();
    this.essayVotes.clear();
    this.essayVoting = null;
    if (this.essayTimer) clearTimeout(this.essayTimer);
    this.essayTimer = null;
  }

  /** Throw a random multiple choice quiz question */
  throwQuiz() {
    if (this.activeQuiz || this.activeEssay) {
      return { ok: false, error: 'A quiz or essay is already in progress.' };
    }
    if (this.quizQuestions.length === 0) {
      return { ok: false, error: 'No quiz questions available.' };
    }

    const q = this.quizQuestions[Math.floor(Math.random() * this.quizQuestions.length)];
    this.activeQuiz = {
      question: q.q,
      options: q.options,
      correctIndex: q.correct,
      startedAt: Date.now(),
      timeLimitMs: 15000
    };
    this.quizResponses.clear();

    const players = this.getPlayers();
    const totalAlive = Object.values(players).filter(p => p.isAlive && p.connected).length;

    this.io.emit('quizStarted', {
      question: q.q,
      options: q.options,
      timeLimitMs: 15000,
      totalPlayers: totalAlive,
      responded: 0
    });

    this.quizTimer = setTimeout(() => this._endQuiz(), 15000);
    return { ok: true };
  }

  /** Player submits quiz answer */
  submitQuizAnswer(playerRoleId, answerIndex) {
    if (!this.activeQuiz) return { ok: false, error: 'No active quiz.' };
    if (this.quizResponses.has(playerRoleId)) return { ok: false, error: 'Already answered.' };

    const timeTaken = Date.now() - this.activeQuiz.startedAt;
    const isCorrect = answerIndex === this.activeQuiz.correctIndex;

    this.quizResponses.set(playerRoleId, {
      answerIndex,
      isCorrect,
      timeTaken
    });

    const players = this.getPlayers();
    const totalAlive = Object.values(players).filter(p => p.isAlive && p.connected).length;
    const responded = this.quizResponses.size;

    this.io.emit('quizResponseCount', { responded, totalPlayers: totalAlive });

    if (responded >= totalAlive) {
      if (this.quizTimer) clearTimeout(this.quizTimer);
      this._endQuiz();
    }

    return { ok: true, isCorrect };
  }

  _endQuiz() {
    if (!this.activeQuiz) return;

    const results = [];
    for (const [roleId, resp] of this.quizResponses) {
      if (resp.isCorrect) {
        results.push({ roleId, timeTaken: resp.timeTaken });
      }
    }

    results.sort((a, b) => a.timeTaken - b.timeTaken);

    const players = this.getPlayers();
    const winners = [];
    const prizes = [
      { health: 20, food: 10 },
      { health: 15, food: 8 },
      { health: 10, food: 5 }
    ];

    for (let i = 0; i < Math.min(3, results.length); i++) {
      const winner = results[i];
      const p = players[winner.roleId];
      if (p && p.isAlive) {
        const prize = prizes[i];
        p.health = Math.min(100, p.health + prize.health);
        p.hunger = Math.min(100, p.hunger + prize.food);
        winners.push({
          roleId: winner.roleId,
          name: p.name,
          roleIcon: p.roleIcon,
          timeTaken: winner.timeTaken,
          place: i + 1,
          prize
        });
      }
    }

    this.io.emit('quizResults', {
      correctIndex: this.activeQuiz.correctIndex,
      question: this.activeQuiz.question,
      winners,
      totalAnswered: this.quizResponses.size
    });

    this.io.emit('updatePlayers', players);

    this.activeQuiz = null;
    this.quizResponses.clear();
    this.quizTimer = null;
    this.io.emit('quizComplete');
  }

  /** Throw an essay question */
  throwEssay() {
    if (this.activeQuiz || this.activeEssay) {
      return { ok: false, error: 'A quiz or essay is already in progress.' };
    }
    if (this.essayQuestions.length === 0) {
      return { ok: false, error: 'No essay questions available.' };
    }

    const q = this.essayQuestions[Math.floor(Math.random() * this.essayQuestions.length)];
    this.activeEssay = {
      question: q.q,
      maxChars: q.maxChars || 50,
      startedAt: Date.now(),
      timeLimitMs: 60000,
      submitted: new Set()
    };
    this.essayResponses.clear();
    this.essayVotes.clear();
    this.essayVoting = null;

    const players = this.getPlayers();
    const totalAlive = Object.values(players).filter(p => p.isAlive && p.connected).length;

    this.io.emit('essayStarted', {
      question: q.q,
      maxChars: q.maxChars || 50,
      timeLimitMs: 60000,
      totalPlayers: totalAlive,
      responded: 0
    });

    this.essayTimer = setTimeout(() => this._beginVoting(), 60000);
    return { ok: true };
  }

  /** Player submits essay response */
  submitEssay(playerRoleId, text) {
    if (!this.activeEssay) return { ok: false, error: 'No active essay.' };
    if (this.activeEssay.submitted.has(playerRoleId)) return { ok: false, error: 'Already submitted.' };

    const trimmed = (text || '').slice(0, this.activeEssay.maxChars);
    this.essayResponses.set(playerRoleId, {
      text: trimmed,
      submittedAt: Date.now()
    });
    this.activeEssay.submitted.add(playerRoleId);

    const players = this.getPlayers();
    const totalAlive = Object.values(players).filter(p => p.isAlive && p.connected).length;
    const responded = this.activeEssay.submitted.size;

    this.io.emit('essayResponseCount', { responded, totalPlayers: totalAlive });

    if (responded >= totalAlive) {
      if (this.essayTimer) clearTimeout(this.essayTimer);
      this._beginVoting();
    }

    return { ok: true };
  }

  _beginVoting() {
    if (!this.activeEssay) return;
    if (this.essayResponses.size === 0) {
      this.activeEssay = null;
      this.io.emit('essayCancelled', { reason: 'No submissions received.' });
      this.io.emit('essayComplete');
      return;
    }

    const responses = [];
    for (const [roleId, resp] of this.essayResponses) {
      const players = this.getPlayers();
      const p = players[roleId];
      if (p) {
        responses.push({
          roleId,
          name: p.name,
          roleIcon: p.roleIcon,
          text: resp.text
        });
      }
    }

    this.essayVoting = {
      responses,
      startedAt: Date.now(),
      timeLimitMs: 30000
    };
    this.essayVotes.clear();

    const players = this.getPlayers();
    const totalAlive = Object.values(players).filter(p => p.isAlive && p.connected).length;

    this.io.emit('essayVotingStarted', { responses, timeLimitMs: 30000, totalPlayers: totalAlive, responded: 0 });

    if (this.essayTimer) clearTimeout(this.essayTimer);
    this.essayTimer = setTimeout(() => this._endVoting(), 30000);
  }

  /** Player votes for an essay (cannot vote for self) */
  voteEssay(voterRoleId, targetRoleId) {
    if (!this.essayVoting) return { ok: false, error: 'No active essay vote.' };
    if (voterRoleId === targetRoleId) return { ok: false, error: 'Cannot vote for yourself.' };
    if (this.essayVotes.has(voterRoleId)) return { ok: false, error: 'Already voted.' };

    this.essayVotes.set(voterRoleId, targetRoleId);

    const players = this.getPlayers();
    const totalAlive = Object.values(players).filter(p => p.isAlive && p.connected).length;
    const voted = this.essayVotes.size;

    this.io.emit('essayVoteCount', { voted, totalPlayers: totalAlive });

    if (voted >= totalAlive) {
      if (this.essayTimer) clearTimeout(this.essayTimer);
      this._endVoting();
    }

    return { ok: true };
  }

  _endVoting() {
    if (!this.essayVoting) return;

    const voteCounts = {};
    for (const [_, target] of this.essayVotes) {
      voteCounts[target] = (voteCounts[target] || 0) + 1;
    }

    let winner = null;
    let maxVotes = 0;
    for (const [roleId, count] of Object.entries(voteCounts)) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = roleId;
      }
    }

    const players = this.getPlayers();
    if (winner && players[winner]) {
      players[winner].essayImmunity = true;
      this.io.emit('essayWinner', {
        roleId: winner,
        name: players[winner].name,
        roleIcon: players[winner].roleIcon,
        text: this.essayResponses.get(winner)?.text || '',
        votes: maxVotes
      });
    } else {
      this.io.emit('essayCancelled', { reason: 'No votes cast.' });
    }

    this.io.emit('updatePlayers', players);

    this.activeEssay = null;
    this.essayResponses.clear();
    this.essayVotes.clear();
    this.essayVoting = null;
    this.essayTimer = null;
    this.io.emit('essayComplete');
  }

  getState() {
    return {
      activeQuiz: this.activeQuiz,
      activeEssay: this.activeEssay,
      essayVoting: this.essayVoting
    };
  }
}

module.exports = QuizManager;
