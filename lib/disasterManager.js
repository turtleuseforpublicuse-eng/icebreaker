/**
 * DisasterManager - Handles automatic disasters, warning timers,
 * Lookout role notifications, and disaster resolution logic.
 */
class DisasterManager {
  constructor(io, gameState, config) {
    this.io = io;
    this.gameState = gameState;
    this.config = config;
    this.disasterTimer = null;
    this.types = ['METEOR_SHOWER', 'EARTHQUAKE', 'TYPHOON'];
    this.nextDisasterType = null;
    this.isWarningActive = false;
  }

  startAutoLoop() {
    this.scheduleNextDisaster();
  }

  stopAutoLoop() {
    if (this.disasterTimer) clearTimeout(this.disasterTimer);
  }

  scheduleNextDisaster() {
    this.stopAutoLoop();
    const delay = Math.floor(
      Math.random() * (this.config.disasterIntervalMaxMs - this.config.disasterIntervalMinMs) +
      this.config.disasterIntervalMinMs
    );

    this.disasterTimer = setTimeout(() => {
      this.triggerWarningPhase();
    }, delay);
  }

  triggerWarningPhase() {
    this.nextDisasterType = this.types[Math.floor(Math.random() * this.types.length)];
    this.isWarningActive = true;

    // Send discrete warning to Lookouts
    const lookouts = this.gameState.getPlayersByRole('Lookout');
    lookouts.forEach(player => {
      this.io.to(player.socketId).emit('disaster_lookout_early_warning', {
        type: this.nextDisasterType,
        message: `[LOOKOUT DETECTED] ${this.nextDisasterType.replace('_', ' ')} incoming in ${this.config.warningDurationMs / 1000}s!`
      });
    });

    // Send global overlay warning to non-Lookouts & Projector
    this.io.emit('disaster_warning_overlay', {
      type: this.nextDisasterType,
      message: `⚠ ${this.nextDisasterType.replace('_', ' ')} INCOMING!`,
      durationMs: this.config.warningDurationMs,
      excludeLookouts: true
    });

    setTimeout(() => {
      this.executeDisaster();
    }, this.config.warningDurationMs);
  }

  executeDisaster() {
    this.isWarningActive = false;
    const disaster = this.nextDisasterType;
    let damageToShelter = 10;
    let damageToPlayers = 15;

    // Apply disaster-specific modifications
    if (disaster === 'METEOR_SHOWER') {
      damageToShelter = 20;
      damageToPlayers = 25;
    } else if (disaster === 'EARTHQUAKE') {
      damageToShelter = 25;
      damageToPlayers = 15;
    } else if (disaster === 'TYPHOON') {
      damageToShelter = 15;
      damageToPlayers = 20;
    }

    // Apply effects to shelter
    this.gameState.shelterIntegrity = Math.max(0, this.gameState.shelterIntegrity - damageToShelter);

    // Apply effects to players (considering immunity & items like umbrella)
    Object.values(this.gameState.players).forEach(player => {
      if (player.hasImmunity) {
        player.hasImmunity = false; // Immunity spent
        return;
      }

      let netDamage = damageToPlayers;

      // Umbrella blocks meteor damage (2 durability uses)
      if (disaster === 'METEOR_SHOWER' && player.inventory.umbrellaDurability > 0) {
        player.inventory.umbrellaDurability -= 1;
        netDamage = 0;
      }

      player.health = Math.max(0, player.health - netDamage);
      if (player.health === 0) player.isAlive = false;
    });

    this.io.emit('disaster_executed', {
      type: disaster,
      shelterIntegrity: this.gameState.shelterIntegrity,
      players: this.gameState.players
    });

    // Schedule next automatic disaster
    this.scheduleNextDisaster();
  }
}

module.exports = DisasterManager;