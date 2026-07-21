/**
 * ShelterManager — shelter integrity, furniture durability, construction system.
 * Engineers must initialize; Constructors execute repairs.
 * Housekeepers restore furniture after events (both must click).
 */

class ShelterManager {
  constructor({ furnitureConfig, io, getPlayers, getGameStarted }) {
    this.io = io;
    this.getPlayers = getPlayers;
    this.getGameStarted = getGameStarted;

    this.shelterIntegrity = 100;
    this.furniture = {};
    this.constructionActive = false;
    this.constructionTimer = null;
    this.constructionProgress = 0;
    this.pendingConstruction = null;
    this.rubbleCount = 0;
    this.housekeepersRestored = new Set();

    this._initFurniture(furnitureConfig);
  }

  _initFurniture(config) {
    if (!config) return;
    config.forEach(f => {
      this.furniture[f.id] = {
        ...f,
        currentDurability: f.durability,
        damaged: false,
        destroyed: false,
        hiddenBy: null
      };
    });
  }

  reset() {
    this.shelterIntegrity = 100;
    this.constructionActive = false;
    this.constructionProgress = 0;
    this.pendingConstruction = null;
    this.rubbleCount = 0;
    this.housekeepersRestored = new Set();
    if (this.constructionTimer) clearInterval(this.constructionTimer);
    this.constructionTimer = null;
    for (const fid in this.furniture) {
      const f = this.furniture[fid];
      f.currentDurability = f.durability;
      f.damaged = false;
      f.destroyed = false;
      f.hiddenBy = null;
    }
  }

  getState() {
    return {
      shelterIntegrity: this.shelterIntegrity,
      furniture: { ...this.furniture },
      constructionActive: this.constructionActive,
      constructionProgress: this.constructionProgress,
      rubbleCount: this.rubbleCount,
      housekeepersRestored: Array.from(this.housekeepersRestored)
    };
  }

  damageShelter(amount) {
    this.shelterIntegrity = Math.max(0, this.shelterIntegrity - amount);
    this.io.emit('shelterUpdate', this.getState());
    return this.shelterIntegrity;
  }

  repairShelter(amount) {
    this.shelterIntegrity = Math.min(100, this.shelterIntegrity + amount);
    this.io.emit('shelterUpdate', this.getState());
    return this.shelterIntegrity;
  }

  damageFurniture(furnitureId) {
    const f = this.furniture[furnitureId];
    if (!f || f.destroyed) return null;
    f.currentDurability = Math.max(0, f.currentDurability - 1);
    if (f.currentDurability <= 0) {
      f.destroyed = true;
      f.damaged = false;
      f.hiddenBy = null;
    } else {
      f.damaged = true;
    }
    this.io.emit('furnitureUpdate', { furnitureId, furniture: f });
    return f;
  }

  damageRandomFurniture(chance) {
    const ids = Object.keys(this.furniture).filter(id => !this.furniture[id].destroyed);
    const damaged = [];
    for (const id of ids) {
      if (Math.random() < chance) {
        damaged.push(this.damageFurniture(id));
      }
    }
    return damaged;
  }

  repairFurniture(furnitureId) {
    const f = this.furniture[furnitureId];
    if (!f || f.destroyed) return null;
    f.currentDurability = Math.min(f.durability, f.currentDurability + 1);
    if (f.currentDurability >= f.durability) f.damaged = false;
    this.io.emit('furnitureUpdate', { furnitureId, furniture: f });
    return f;
  }

  repairAllFurniture(amount) {
    const repaired = [];
    for (const fid in this.furniture) {
      const f = this.furniture[fid];
      if (f.damaged && !f.destroyed) {
        f.currentDurability = Math.min(f.durability, f.currentDurability + (amount || 1));
        if (f.currentDurability >= f.durability) f.damaged = false;
        repaired.push(fid);
      }
    }
    if (repaired.length > 0) this.io.emit('shelterUpdate', this.getState());
    return repaired;
  }

  cleanRubble() {
    if (this.rubbleCount <= 0) return false;
    this.rubbleCount--;
    this.shelterIntegrity = Math.min(100, this.shelterIntegrity + 2);
    this.io.emit('shelterUpdate', this.getState());
    return true;
  }

  addRubble(count) {
    this.rubbleCount = Math.min(20, this.rubbleCount + (count || 1));
    this.io.emit('shelterUpdate', this.getState());
  }

  initializeConstruction(engineerRoleId) {
    const players = this.getPlayers();
    const engineer = players[engineerRoleId];
    if (!engineer || engineer.roleName !== 'Engineer') {
      return { ok: false, error: 'Only the Engineer can initialize construction.' };
    }
    if (this.constructionActive) {
      return { ok: false, error: 'Construction is already in progress.' };
    }
    this.constructionActive = true;
    this.pendingConstruction = { startedBy: engineerRoleId, startedAt: Date.now() };
    this.constructionProgress = 0;
    this.io.emit('constructionInitialized', { by: engineer.name });
    return { ok: true };
  }

  startConstruction(constructorRoleId) {
    const players = this.getPlayers();
    const constructor = players[constructorRoleId];
    if (!constructor || constructor.roleName !== 'Constructor') {
      return { ok: false, error: 'Only Constructors can perform construction.' };
    }
    if (!this.constructionActive) {
      return { ok: false, error: 'Engineer must initialize construction first.' };
    }
    if (this.constructionTimer) {
      return { ok: false, error: 'Construction is already underway.' };
    }

    const buildTime = 20000;
    const tickMs = 500;
    this.constructionProgress = 0;

    this.constructionTimer = setInterval(() => {
      this.constructionProgress += (tickMs / buildTime) * 100;
      this.io.emit('constructionProgress', { progress: Math.min(100, this.constructionProgress) });

      if (this.constructionProgress >= 100) {
        clearInterval(this.constructionTimer);
        this.constructionTimer = null;
        this.constructionActive = false;
        this.pendingConstruction = null;
        this.constructionProgress = 0;

        this.shelterIntegrity = Math.min(100, this.shelterIntegrity + 25);
        this.repairAllFurniture(1);

        this.io.emit('constructionComplete', { shelterIntegrity: this.shelterIntegrity });
        this.io.emit('shelterUpdate', this.getState());
      }
    }, tickMs);

    this.io.emit('constructionStarted', { by: constructor.name });
    return { ok: true };
  }

  cancelConstruction() {
    if (this.constructionTimer) clearInterval(this.constructionTimer);
    this.constructionTimer = null;
    this.constructionActive = false;
    this.pendingConstruction = null;
    this.constructionProgress = 0;
    this.io.emit('constructionCancelled');
  }

  getFurnitureProtection(playerX, playerFloor) {
    let bonus = 0;
    for (const fid in this.furniture) {
      const f = this.furniture[fid];
      if (f.destroyed || f.floor !== playerFloor) continue;
      const dist = Math.abs(playerX - (f.x + f.w / 2));
      if (dist < f.w * 1.5) {
        bonus = Math.max(bonus, f.hidingBonus || 0);
      }
    }
    return bonus;
  }

  isPlayerHiding(playerX, playerFloor) {
    for (const fid in this.furniture) {
      const f = this.furniture[fid];
      if (f.destroyed || f.floor !== playerFloor) continue;
      const dist = Math.abs(playerX - (f.x + f.w / 2));
      if (dist < f.w * 0.8) {
        return { hiding: true, furnitureId: fid, protection: f.hidingBonus || 0 };
      }
    }
    return { hiding: false };
  }

  /** Player hides in furniture - durability reduced randomly 1-2 */
  hideInFurniture(playerRoleId, furnitureId) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player || !player.isAlive) return { ok: false, error: 'Player not available.' };

    const f = this.furniture[furnitureId];
    if (!f) return { ok: false, error: 'Furniture not found.' };
    if (f.destroyed) return { ok: false, error: 'That furniture is destroyed.' };
    if (f.floor !== player.floor) return { ok: false, error: 'You must be on the same floor.' };

    const dist = Math.abs(player.x - (f.x + f.w / 2));
    if (dist > f.w * 1.2) return { ok: false, error: 'You are too far from the furniture.' };

    if (f.currentDurability <= 1) return { ok: false, error: 'That furniture is too damaged to hide in.' };

    const durabilityLoss = Math.random() < 0.5 ? 1 : 2;
    f.currentDurability = Math.max(1, f.currentDurability - durabilityLoss);
    f.damaged = true;
    f.hiddenBy = playerRoleId;
    player.hidingIn = furnitureId;

    this.io.emit('furnitureUpdate', { furnitureId, furniture: f });
    this.io.emit('updatePlayers', players);
    return { ok: true, furnitureName: f.name, durabilityLoss };
  }

  unhiding(playerRoleId) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player) return;

    if (player.hidingIn) {
      const f = this.furniture[player.hidingIn];
      if (f && f.hiddenBy === playerRoleId) {
        f.hiddenBy = null;
        this.io.emit('furnitureUpdate', { furnitureId: player.hidingIn, furniture: f });
      }
      player.hidingIn = null;
      this.io.emit('updatePlayers', players);
    }
  }

  /** Housekeeper clicks restore - both must click for furniture to replenish */
  housekeeperRestore(housekeeperRoleId) {
    const players = this.getPlayers();
    const hk = players[housekeeperRoleId];
    if (!hk || hk.roleName !== 'Housekeeper') return { ok: false, error: 'Only Housekeepers can restore furniture.' };
    if (!hk.isAlive) return { ok: false, error: 'You are eliminated.' };

    this.housekeepersRestored.add(housekeeperRoleId);

    const allHousekeepers = Object.entries(players)
      .filter(([_, p]) => p.roleName === 'Housekeeper' && p.isAlive)
      .map(([rid, _]) => rid);

    const allClicked = allHousekeepers.every(rid => this.housekeepersRestored.has(rid));

    if (allClicked) {
      let restored = 0;
      for (const fid in this.furniture) {
        const f = this.furniture[fid];
        if (!f.destroyed && f.currentDurability < f.durability) {
          f.currentDurability = f.durability;
          f.damaged = false;
          f.hiddenBy = null;
          restored++;
          this.io.emit('furnitureUpdate', { furnitureId: fid, furniture: f });
        }
      }
      this.housekeepersRestored.clear();
      this.io.emit('furnitureRestored', { count: restored, message: 'Both Housekeepers restored all furniture!' });
      return { ok: true, restored, complete: true };
    } else {
      const remaining = allHousekeepers.filter(rid => !this.housekeepersRestored.has(rid));
      const remainingNames = remaining.map(rid => players[rid]?.name).filter(Boolean);
      this.io.emit('housekeeperWaiting', {
        clickedBy: hk.name,
        waitingFor: remainingNames,
        message: `${hk.name} clicked restore. Waiting for ${remainingNames.join(' and ')}...`
      });
      return { ok: true, restored: 0, complete: false, waitingFor: remainingNames };
    }
  }
}

module.exports = ShelterManager;
