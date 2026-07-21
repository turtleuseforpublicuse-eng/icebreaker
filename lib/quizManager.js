/**
 * QuizManager - Manages DRRR trivia rounds, speed scoring, essay questions, and peer voting.
 */
class QuizManager {
  constructor(io, gameState, questions) {
    this.io = io;
    this.gameState = gameState;
    this.questions = questions || [];
    this.activeQuestion = null;
    this.answers = [];
    this.activeEssay = null;
    this.essaySubmissions = {};
    this.essayVotes = {};
    this.essayTimer = null;
  }

  throwQuestion() {
    if (this.questions.length === 0) return;
    const randomQ = this.questions[Math.floor(Math.random() * this.questions.length)];
    this.activeQuestion = { ...randomQ, startTime: Date.now() };
    this.answers = [];

    this.io.emit('quiz_question_start', {
      id: randomQ.id,
      question: randomQ.question,
      options: randomQ.options
    });
  }

  submitAnswer(playerId, answerIndex) {
    if (!this.activeQuestion) return;
    if (this.answers.some(a => a.playerId === playerId)) return; // One answer per player

    const timeTaken = Date.now() - this.activeQuestion.startTime;
    const isCorrect = answerIndex === this.activeQuestion.answer;

    this.answers.push({ playerId, answerIndex, isCorrect, timeTaken });

    // Close question once all connected players answer
    const totalConnected = Object.keys(this.gameState.players).length;
    if (this.answers.length >= totalConnected) {
      this.evaluateQuizWinners();
    }
  }

  evaluateQuizWinners() {
    if (!this.activeQuestion) return;

    const correctAnswers = this.answers
      .filter(a => a.isCorrect)
      .sort((a, b) => a.timeTaken - b.timeTaken);

    const winners = correctAnswers.slice(0, 3);
    winners.forEach(w => {
      const p = this.gameState.players[w.playerId];
      if (p) {
        p.health = Math.min(100, p.health + 20);
        p.food = Math.min(100, p.food + 10);
      }
    });

    this.io.emit('quiz_results', {
      correctAnswer: this.activeQuestion.answer,
      winners: winners.map(w => ({
        name: this.gameState.players[w.playerId]?.name || "Player",
        timeTakenSec: (w.timeTaken / 1000).toFixed(2)
      }))
    });

    this.activeQuestion = null;
  }

  throwEssayQuestion(promptText) {
    this.activeEssay = {
      prompt: promptText || "What is your immediate response when a 7.2 earthquake strikes while indoors?",
      startTime: Date.now()
    };
    this.essaySubmissions = {};
    this.essayVotes = {};

    this.io.emit('essay_question_start', {
      prompt: this.activeEssay.prompt,
      maxChars: 50,
      durationSec: 60
    });

    if (this.essayTimer) clearTimeout(this.essayTimer);
    this.essayTimer = setTimeout(() => {
      this.startEssayVoting();
    }, 60000);
  }

  submitEssay(playerId, text) {
    if (!this.activeEssay) return;
    const trimmed = (text || "").substring(0, 50);
    this.essaySubmissions[playerId] = trimmed;

    const totalConnected = Object.keys(this.gameState.players).length;
    if (Object.keys(this.essaySubmissions).length >= totalConnected) {
      if (this.essayTimer) clearTimeout(this.essayTimer);
      this.startEssayVoting();
    }
  }

  startEssayVoting() {
    this.io.emit('essay_voting_start', {
      submissions: Object.entries(this.essaySubmissions).map(([pId, text]) => ({
        playerId: pId,
        text
      }))
    });
  }

  submitVote(voterId, targetPlayerId) {
    if (voterId === targetPlayerId) return; // Prevent self-voting
    this.essayVotes[voterId] = targetPlayerId;

    const totalConnected = Object.keys(this.gameState.players).length;
    if (Object.keys(this.essayVotes).length >= totalConnected) {
      this.tallyEssayVotes();
    }
  }

  tallyEssayVotes() {
    const counts = {};
    Object.values(this.essayVotes).forEach(target => {
      counts[target] = (counts[target] || 0) + 1;
    });

    let winnerId = null;
    let maxVotes = -1;
    Object.entries(counts).forEach(([pId, count]) => {
      if (count > maxVotes) {
        maxVotes = count;
        winnerId = pId;
      }
    });

    if (winnerId && this.gameState.players[winnerId]) {
      this.gameState.players[winnerId].hasImmunity = true;
    }

    this.io.emit('essay_results', {
      winnerId,
      winnerName: this.gameState.players[winnerId]?.name || "None",
      votes: maxVotes > -1 ? maxVotes : 0
    });

    this.activeEssay = null;
  }
}

module.exports = QuizManager;