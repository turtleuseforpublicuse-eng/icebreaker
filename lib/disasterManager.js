/**
 * DisasterManager — automatic disaster scheduling, warnings, and damage.
 * Updated: shelter damage, umbrella protection, furniture damage, meteor piercing roof.
 */

const WARNING_DURATION_MS = 5000;
const LOOKOUT_EARLY_MS = 3000;
const MIN_INTERVAL_MS = 60000;
const MAX_INTERVAL_MS = 120000;
const DAMAGE_TICKS = 5;

class DisasterManager {
  constructor({ events, io, getPlayers, getGameStarted, onDisasterEnd, shelterManager, itemManager }) {
    this.events = events;
    this.io = io;
    this.getPlayers = getPlayers;
    this.getGameStarted = getGameStarted;
    this.onDisasterEnd = onDisasterEnd || (() => {});
    this.shelterManager = shelterManager || null;
    this.itemManager = itemManager || null;

    this.activeEvent = null;
    this.pendingEvent = null;
    this.detectedByLookout = false;
    this.scheduleTimer = null;
    this.warningTimer = null;
    this.damageInterval = null;
    this.endTimer = null;
    this.phase = 'idle';
  }

  getActiveEvent() {
    return this.activeEvent;
  }

  isBusy() {
    return this.phase !== 'idle';
  }

  reset() {
    this._clearTimers();
    this.activeEvent = null;
    this.pendingEvent = null;
    this.detectedByLookout = false;
    this.phase = 'idle';
  }

  startAutoSchedule() {
    this.reset();
    this._scheduleNext();
  }

  stopAutoSchedule() {
    this._clearTimers();
    this.phase = 'idle';
    this.activeEvent = null;
    this.pendingEvent = null;
  }

  markDetected() {
    if (this.phase === 'lookout' && this.pendingEvent) {
      this.detectedByLookout = true;
      return true;
    }
    return false;
  }

  forceTrigger(eventId) {
    if (!this.getGameStarted() || this.isBusy()) return false;
    const ev = this.events.find(e => e.id === eventId);
    if (!ev) return false;
    this._clearTimers();
    this._beginWarningSequence(ev, false);
    return true;
  }

  _scheduleNext() {
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    const delay = MIN_INTERVAL_MS + Math.random() * (MAX_INTERVAL_MS - MIN_INTERVAL_MS);
    this.scheduleTimer = setTimeout(() => {
      if (!this.getGameStarted() || this.isBusy()) {
        this._scheduleNext();
        return;
      }
      const ev = this.events[Math.floor(Math.random() * this.events.length)];
      this._beginWarningSequence(ev, true);
    }, delay);
  }

  _beginWarningSequence(ev, rescheduleAfter) {
    this.pendingEvent = ev;
    this.detectedByLookout = false;
    this.phase = 'lookout';

    const players = this.getPlayers();
    for (const rid in players) {
      const p = players[rid];
      if (p.connected && p.isAlive && p.roleName === 'Lookout') {
        this.io.to(p.socketId).emit('lookoutEarlyWarning', {
          event: ev,
          detectWindowMs: LOOKOUT_EARLY_MS
        });
      }
    }

    this.warningTimer = setTimeout(() => {
      this.phase = 'warning';
      this.io.emit('disasterWarning', {
        event: ev,
        size: this.detectedByLookout ? 'small' : 'large',
        durationMs: WARNING_DURATION_MS
      });

      setTimeout(() => this._startDisaster(ev, rescheduleAfter), WARNING_DURATION_MS);
    }, LOOKOUT_EARLY_MS);
  }

  _startDisaster(ev, rescheduleAfter) {
    this.phase = 'active';
    this.activeEvent = ev.id;
    this.pendingEvent = null;
    this.io.emit('eventStart', ev);

    let tick = 0;
    const tickMs = ev.duration / DAMAGE_TICKS;

    this.damageInterval = setInterval(() => {
      tick++;
      const players = this.getPlayers();
      for (const rid in players) {
        const p = players[rid];
        if (!p.isAlive) continue;

        let dmg = Math.floor(Math.random() * (ev.damage[1] - ev.damage[0] + 1)) + ev.damage[0];

        // Shelter integrity reduces damage
        if (this.shelterManager) {
          const shelterReduction = this.shelterManager.shelterIntegrity / 100;
          dmg = Math.round(dmg * (1 - shelterReduction * 0.3));
        }

        // Furniture hiding bonus reduces damage
        if (this.shelterManager) {
          const protection = this.shelterManager.getFurnitureProtection(p.x, p.offsetY > 200 ? 2 : 1);
          dmg = Math.round(dmg * (1 - protection));
        }

        // Umbrella blocks meteor damage
        if (ev.id === 'meteor_shower' && this.itemManager) {
          if (this.itemManager.hasUmbrella(rid)) {
            this.itemManager.useUmbrella(rid);
            dmg = 0;
          }
        }

        // Essay immunity
        if (p.essayImmunity) {
          dmg = 0;
        }

        p.health = Math.max(0, p.health - Math.max(0, Math.round(dmg / DAMAGE_TICKS)));
        p.hunger = Math.max(0, p.hunger - 3);

        if (p.health <= 0) {
          p.isAlive = false;
          if (this.itemManager) {
            this.itemManager.dropItems(rid);
          }
        }
      }
      this.io.emit('updatePlayers', players);

      // Shelter and furniture damage
      if (this.shelterManager && ev.shelterDamage) {
        const sDmg = Math.floor(Math.random() * (ev.shelterDamage[1] - ev.shelterDamage[0] + 1)) + ev.shelterDamage[0];
        this.shelterManager.damageShelter(Math.round(sDmg / DAMAGE_TICKS));

        if (ev.furnitureDamageChance) {
          this.shelterManager.damageRandomFurniture(ev.furnitureDamageChance / DAMAGE_TICKS);
        }

        if (ev.id === 'earthquake') {
          this.shelterManager.addRubble(1);
        }
      }

      if (tick >= DAMAGE_TICKS) clearInterval(this.damageInterval);
    }, tickMs);

    this.endTimer = setTimeout(() => {
      this.activeEvent = null;
      this.phase = 'idle';
      this.io.emit('eventEnd');
      this.onDisasterEnd(ev);
      if (rescheduleAfter) this._scheduleNext();
    }, ev.duration);
  }

  _clearTimers() {
    if (this.scheduleTimer) clearTimeout(this.scheduleTimer);
    if (this.warningTimer) clearTimeout(this.warningTimer);
    if (this.damageInterval) clearInterval(this.damageInterval);
    if (this.endTimer) clearTimeout(this.endTimer);
    this.scheduleTimer = this.warningTimer = this.damageInterval = this.endTimer = null;
  }
}

module.exports = DisasterManager;
