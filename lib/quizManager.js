/**
 * QuizManager — multiple choice quiz, essay questions, voting system.
 * Host triggers quizzes; top 3 fastest correct players get rewards.
 * Essay: situational question, 50 char max, 1 min timer, winner gets immunity.
 */

class QuizManager {
  constructor({ quizQuestions, essayQuestions, io, getPlayers, getGameStarted, scoringConfig }) {
    this.io = io;
    this.getPlayers = getPlayers;
    this.getGameStarted = getGameStarted;
    this.quizQuestions = quizQuestions || [];
    this.essayQuestions = essayQuestions || [];
    this.quizPointCorrect = (scoringConfig && scoringConfig.quizPointCorrect) || 10;
    this.quizPointWrong = (scoringConfig && scoringConfig.quizPointWrong) || -5;
    this.quizPointTimeout = (scoringConfig && scoringConfig.quizPointTimeout) || 0;

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
    const p = this.getPlayers()[playerRoleId];
    if (!p || !p.isAlive) return { ok: false, error: 'Dead players cannot answer.' };

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

    const players = this.getPlayers();
    const correctEntries = [];
    const wrongEntries = [];
    const timeoutEntries = [];

    for (const rid in players) {
      const p = players[rid];
      if (!p.isAlive) continue;
      if (!p.quizScore) p.quizScore = 0;
      if (this.quizResponses.has(rid)) {
        const resp = this.quizResponses.get(rid);
        if (resp.isCorrect) {
          p.quizScore += this.quizPointCorrect;
          correctEntries.push({ roleId: rid, timeTaken: resp.timeTaken });
        } else {
          p.quizScore += this.quizPointWrong;
          wrongEntries.push({ roleId: rid, timeTaken: resp.timeTaken });
        }
      } else {
        p.quizScore += this.quizPointTimeout;
        timeoutEntries.push({ roleId: rid });
      }
    }

    correctEntries.sort((a, b) => a.timeTaken - b.timeTaken);

    const winners = [];
    const bonusPoints = [10, 5, 3];

    for (let i = 0; i < Math.min(3, correctEntries.length); i++) {
      const winner = correctEntries[i];
      const p = players[winner.roleId];
      if (p && p.isAlive) {
        const pts = bonusPoints[i];
        p.quizScore += pts;
        winners.push({
          roleId: winner.roleId,
          name: p.name,
          roleIcon: p.roleIcon,
          timeTaken: winner.timeTaken,
          place: i + 1,
          points: pts
        });
      }
    }

    const scoringSummary = {};
    for (const rid in players) {
      if (players[rid].isAlive) scoringSummary[rid] = players[rid].quizScore;
    }

    this.io.emit('quizResults', {
      correctIndex: this.activeQuiz.correctIndex,
      question: this.activeQuiz.question,
      winners,
      wrongEntries: wrongEntries.map(e => e.roleId),
      timeoutEntries: timeoutEntries.map(e => e.roleId),
      scoringSummary,
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

  /** Player votes for up to 2 essay submissions */
  voteEssay(voterRoleId, targetRoleIds) {
    if (!this.essayVoting) return { ok: false, error: 'No active essay vote.' };
    if (this.essayVotes.has(voterRoleId)) return { ok: false, error: 'Already voted.' };
    if (!Array.isArray(targetRoleIds)) targetRoleIds = [targetRoleIds];
    if (targetRoleIds.length < 2) return { ok: false, error: 'Vote for another one!' };
    if (targetRoleIds.length > 2) return { ok: false, error: 'Can only vote for 2 people.' };
    if (targetRoleIds[0] === targetRoleIds[1]) return { ok: false, error: 'Cannot vote for the same person twice.' };
    if (targetRoleIds.includes(voterRoleId)) return { ok: false, error: 'Cannot vote for yourself.' };

    this.essayVotes.set(voterRoleId, targetRoleIds);

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
    for (const [_, targets] of this.essayVotes) {
      for (const target of targets) {
        voteCounts[target] = (voteCounts[target] || 0) + 1;
      }
    }

    const sorted = Object.entries(voteCounts).sort((a, b) => b[1] - a[1]);
    const pointsMap = {};
    if (sorted.length > 0) pointsMap[sorted[0][0]] = 30;
    if (sorted.length > 1) pointsMap[sorted[1][0]] = 20;
    if (sorted.length > 2) pointsMap[sorted[2][0]] = 10;

    const players = this.getPlayers();
    for (const rid in players) {
      if (!players[rid].isAlive) continue;
      if (!players[rid].quizScore) players[rid].quizScore = 0;
      if (pointsMap[rid]) {
        players[rid].quizScore += pointsMap[rid];
        if (rid === sorted[0][0]) players[rid].essayImmunity = true;
      }
    }

    if (sorted.length > 0 && players[sorted[0][0]]) {
      const winner = sorted[0][0];
      const runnerUp = sorted.length > 1 ? sorted[1][0] : null;
      const third = sorted.length > 2 ? sorted[2][0] : null;
      this.io.emit('gameMessage', { msg: `📝 ${players[winner].roleIcon} ${players[winner].name} won the essay! Immunity for 1 round!` });
      this.io.emit('essayWinner', {
        roleId: winner,
        name: players[winner].name,
        roleIcon: players[winner].roleIcon,
        text: this.essayResponses.get(winner)?.text || '',
        votes: sorted[0][1],
        points: 30,
        runnerUp: runnerUp ? { roleId: runnerUp, name: players[runnerUp].name, roleIcon: players[runnerUp].roleIcon, points: 20 } : null,
        third: third ? { roleId: third, name: players[third].name, roleIcon: players[third].roleIcon, points: 10 } : null
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

  /** Auto-select quiz or essay based on round */
  throwQuizOrEssay(round) {
    if (round === 5 || round === 10) {
      return this.throwEssay();
    }
    return this.throwQuiz();
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
