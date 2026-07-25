class DisasterManager {
  constructor(gameState) {
    this.gameState = gameState;
    this.disasterTimer = null;
    this.warningTimer = null;
    this.activeEvent = null;
    this.paused = false;
    this.pausedTimeLeft = 0;
    this.eventStartTime = 0;
  }

  startDisasterCycle(io) {
    if (this.gameState.isGameFinished) return;

    const minDelay = this.gameState.config.gameSettings.disasterMinIntervalMs;
    const maxDelay = this.gameState.config.gameSettings.disasterMaxIntervalMs;
    const delay = Math.random() * (maxDelay - minDelay) + minDelay;

    this.warningTimer = setTimeout(() => {
      if (!this.gameState.isGameStarted || this.gameState.isGameFinished) return;
      this.startEvent(io);
    }, delay);
  }

  startEvent(io) {
    if (!this.gameState.isGameStarted || this.gameState.isGameFinished) return;
    if (this.gameState.currentEvent) return;

    const events = this.gameState.config.events;
    const event = events[Math.floor(Math.random() * events.length)];
    const duration = Math.floor(Math.random() * (event.durationRange[1] - event.durationRange[0]) + event.durationRange[0]);

    this.activeEvent = event;
    this.gameState.currentEvent = event.id;

    const players = this.gameState.players;
    for (const [id, p] of Object.entries(players)) {
      p.currentEvent = event.id;
      p.hiding = false;
      p.hidingIn = null;
    }

    this.gameState.markDetected(event);
    this.gameState.sendPlayerUpdates(io);

    io.to(this.gameState.hostId).emit("disasterDetected", {
      eventId: event.id,
      eventName: event.name,
      eventIcon: event.icon,
      hint: event.hint
    });

    io.emit("disasterHint", {
      name: event.name,
      icon: event.icon,
      hint: event.hint,
      duration: duration
    });

    this.gameState.emitTimeUpdate(io);
    this.gameState.sendGameState(io);

    this.eventStartTime = Date.now();

    this.disasterTimer = setTimeout(() => {
      this.endEvent(io);
    }, duration);
  }

  endEvent(io) {
    if (!this.activeEvent) return;

    const event = this.activeEvent;
    const players = this.gameState.players;
    const config = this.gameState.config;
    const damageRange = event.damage;
    const shelterDamageRange = event.shelterDamage;

    const shelterDamage = Math.floor(Math.random() * (shelterDamageRange[1] - shelterDamageRange[0]) + shelterDamageRange[0]);
    this.gameState.shelter.integrity = Math.max(0, this.gameState.shelter.integrity - shelterDamage);

    let playersInDanger = 0;

    for (const [id, p] of Object.entries(players)) {
      if (p.isDead || p.isSpectator) continue;

      const hidingBonus = p.hidingIn ? (p.hidingIn.hidingBonus || 0) : 0;

      if (!p.hiding || !p.hidingIn) {
        const baseDamage = Math.floor(Math.random() * (damageRange[1] - damageRange[0]) + damageRange[0]);
        let finalDamage = Math.max(1, Math.round(baseDamage * (1 - hidingBonus)));

        let blockedByUmbrella = false;
        if (event.id === "earthquake" || event.id === "typhoon") {
          for (const itemId of p.inventory) {
            const item = config.items.find(i => i.id === itemId);
            if (item && item.blocksMeteor && item.durability > 0) {
              item.durability--;
              blockedByUmbrella = true;
              break;
            }
          }
        }
        if (blockedByUmbrella) finalDamage = Math.round(finalDamage * 0.5);

        const hungerMultiplier = p.hunger < config.gameSettings.hungerThreshold ? 1.3 : 1;
        const healthMultiplier = p.health < 30 ? 1.2 : 1;
        finalDamage = Math.round(finalDamage * hungerMultiplier * healthMultiplier);

        p.health = Math.max(0, p.health - finalDamage);

        if (p.hiding && p.hidingIn) {
          const d = Math.floor(Math.random() * 2) + 1;
          this.gameState.shelter.furnitureDurability[p.hidingIn.id] = Math.max(0, (this.gameState.shelter.furnitureDurability[p.hidingIn.id] || 0) - d);
        }

        playersInDanger++;
      } else {
        if (p.hidingIn) {
          const d = Math.floor(Math.random() * 2) + 1;
          this.gameState.shelter.furnitureDurability[p.hidingIn.id] = Math.max(0, (this.gameState.shelter.furnitureDurability[p.hidingIn.id] || 0) - d);
        }
        p.safeFromCurrentDisaster = true;
      }

      if (p.health <= 0) {
        p.health = 0;
        p.isDead = true;
        p.deathCause = event.name;
      }
    }

    this.gameState.shelter.integrity = Math.max(0, this.gameState.shelter.integrity);

    if (this.gameState.shelter.integrity <= 0) {
      this.gameState.endGame(io, "Shelter destroyed!");
      this.activeEvent = null;
      return;
    }

    const alive = Object.values(players).filter(p => !p.isDead);
    if (alive.length === 0) {
      this.gameState.endGame(io, "No survivors remain...");
      this.activeEvent = null;
      return;
    }

    for (const [id, p] of Object.entries(players)) {
      p.hiding = false;
      p.hidingIn = null;
      p.safeFromCurrentDisaster = false;
      p.currentEvent = null;
    }

    const roundScore = {};
    for (const [id, p] of Object.entries(players)) {
      if (p.isDead) {
        roundScore[id] = { name: p.name, points: p.eventPoints || 0, dead: true };
      } else {
        const earnedPoints = Math.floor((p.health / 10) + (p.hunger / 10));
        p.eventPoints = (p.eventPoints || 0) + earnedPoints;
        p.totalPoints = (p.totalPoints || 0) + earnedPoints;
        roundScore[id] = { name: p.name, points: earnedPoints, total: p.totalPoints, dead: false };
      }
    }

    this.gameState.currentRound++;
    this.activeEvent = null;
    this.gameState.currentEvent = null;

    io.emit("eventEnd", {
      eventId: event.id,
      eventName: event.name,
      shelterDamage: shelterDamage,
      playersInDanger: playersInDanger,
      shelterIntegrity: this.gameState.shelter.integrity,
      round: this.gameState.currentRound,
      scores: roundScore
    });

    this.gameState.emitTimeUpdate(io);
    this.gameState.sendGameState(io);

    if (this.gameState.currentRound >= this.gameState.config.gameSettings.totalRounds) {
      this.gameState.endGame(io, "All rounds complete!");
      return;
    }

    if (this.gameState.quizCooldown) {
      this.gameState.quizCooldown = false;
    }

    io.to(this.gameState.hostId).emit("throwQuiz", { round: this.gameState.currentRound });
  }

  pause() {
    if (this.disasterTimer && !this.paused) {
      clearTimeout(this.disasterTimer);
      this.disasterTimer = null;
      this.pausedTimeLeft = Math.max(0, (this.eventStartTime + this.gameState.config.events.find(e => e.id === this.gameState.currentEvent)?.durationRange[1] || 60000) - Date.now());
      this.paused = true;
    }
  }

  resume(io) {
    if (this.paused && this.pausedTimeLeft > 0) {
      this.disasterTimer = setTimeout(() => {
        this.endEvent(io);
      }, this.pausedTimeLeft);
      this.paused = false;
    }
  }

  cancel() {
    if (this.disasterTimer) {
      clearTimeout(this.disasterTimer);
      this.disasterTimer = null;
    }
    if (this.warningTimer) {
      clearTimeout(this.warningTimer);
      this.warningTimer = null;
    }
    this.activeEvent = null;
    this.paused = false;
  }
}

module.exports = DisasterManager;
