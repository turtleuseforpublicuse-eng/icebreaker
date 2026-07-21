/**
 * DisasterManager — automatic disaster scheduling, warnings, and damage.
 * Extensible: add events in config.json; they are picked at random.
 */

const WARNING_DURATION_MS = 5000;
const LOOKOUT_EARLY_MS = 3000;
const MIN_INTERVAL_MS = 60000;
const MAX_INTERVAL_MS = 120000;
const DAMAGE_TICKS = 5;

class DisasterManager {
  constructor({ events, io, getPlayers, getGameStarted, onDisasterEnd }) {
    this.events = events;
    this.io = io;
    this.getPlayers = getPlayers;
    this.getGameStarted = getGameStarted;
    this.onDisasterEnd = onDisasterEnd || (() => {});

    this.activeEvent = null;
    this.pendingEvent = null;
    this.detectedByLookout = false;
    this.scheduleTimer = null;
    this.warningTimer = null;
    this.damageInterval = null;
    this.endTimer = null;
    this.phase = 'idle'; // idle | lookout | warning | active
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

  /** Lookout pressed detect during early-warning window */
  markDetected() {
    if (this.phase === 'lookout' && this.pendingEvent) {
      this.detectedByLookout = true;
      return true;
    }
    return false;
  }

  /** Manual trigger (host debug / future quiz immunity skip) */
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
        const dmg = Math.floor(Math.random() * (ev.damage[1] - ev.damage[0] + 1)) + ev.damage[0];
        p.health = Math.max(0, p.health - Math.round(dmg / DAMAGE_TICKS));
        p.hunger = Math.max(0, p.hunger - 3);
        if (p.health <= 0) p.isAlive = false;
      }
      this.io.emit('updatePlayers', players);
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
