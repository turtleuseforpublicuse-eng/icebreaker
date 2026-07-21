/**
 * RoleManager — role swap requests, seat bookkeeping, role-specific actions.
 * Updated: Medic healing, Caretaker repair, role swap preservation.
 */

class RoleManager {
  constructor({ getRoles, getPlayers, getSocketToRole, io }) {
    this.getRoles = getRoles;
    this.getPlayers = getPlayers;
    this.getSocketToRole = getSocketToRole;
    this.io = io;
    this.pendingSwaps = new Map();
  }

  reset() {
    this.pendingSwaps.clear();
  }

  requestSwap(fromRoleId, toRoleId) {
    const players = this.getPlayers();
    const from = players[fromRoleId];
    const to = players[toRoleId];

    if (!from || !to || !from.connected || !to.connected || !from.isAlive || !to.isAlive) {
      return { ok: false, error: 'That player is not available for a swap.' };
    }
    if (fromRoleId === toRoleId) {
      return { ok: false, error: 'You cannot swap with yourself.' };
    }
    if (this.pendingSwaps.has(toRoleId)) {
      return { ok: false, error: 'That player already has a pending swap request.' };
    }

    this.pendingSwaps.set(toRoleId, {
      fromRoleId,
      fromName: from.name,
      fromRoleName: from.roleName,
      fromRoleIcon: from.roleIcon
    });

    return { ok: true, targetName: to.name };
  }

  respondSwap(toRoleId, accept) {
    const req = this.pendingSwaps.get(toRoleId);
    if (!req) return { ok: false, error: 'No pending swap request.' };

    this.pendingSwaps.delete(toRoleId);
    if (!accept) return { ok: true, accepted: false, fromRoleId: req.fromRoleId };

    const players = this.getPlayers();
    const socketToRole = this.getSocketToRole();
    const a = players[req.fromRoleId];
    const b = players[toRoleId];
    if (!a || !b) return { ok: false, error: 'Swap failed — player left.' };

    return this._executeSwap(req.fromRoleId, toRoleId, a, b, socketToRole);
  }

  cancelSwapFor(roleId) {
    for (const [target, req] of this.pendingSwaps.entries()) {
      if (req.fromRoleId === roleId || target === roleId) {
        this.pendingSwaps.delete(target);
      }
    }
  }

  _executeSwap(roleA, roleB, playerA, playerB, socketToRole) {
    const roles = this.getRoles();
    const roleDefA = roles.find(r => r.id === roleA);
    const roleDefB = roles.find(r => r.id === roleB);
    if (!roleDefA || !roleDefB) return { ok: false, error: 'Invalid roles.' };

    const newA = { ...playerA, roleId: roleB, roleName: roleDefB.name, roleIcon: roleDefB.icon };
    const newB = { ...playerB, roleId: roleA, roleName: roleDefA.name, roleIcon: roleDefA.icon };

    const players = this.getPlayers();
    players[roleA] = newB;
    players[roleB] = newA;

    roleDefA.takenBy = newB.name;
    roleDefB.takenBy = newA.name;

    for (const sid in socketToRole) {
      if (socketToRole[sid] === roleA) socketToRole[sid] = roleB;
      else if (socketToRole[sid] === roleB) socketToRole[sid] = roleA;
    }

    return {
      ok: true,
      accepted: true,
      swapped: [
        { roleId: roleB, player: newA },
        { roleId: roleA, player: newB }
      ]
    };
  }

  /** Medic heals a target player. Cannot heal self; only Medic can heal Medic. */
  heal(medicRoleId, targetRoleId) {
    const players = this.getPlayers();
    const medic = players[medicRoleId];
    const target = players[targetRoleId];

    if (!medic || !medic.isAlive) return { ok: false, error: 'Medic not available.' };
    if (medic.roleName !== 'Medic') return { ok: false, error: 'Only Medics can heal.' };
    if (!target || !target.isAlive) return { ok: false, error: 'Target is not alive.' };
    if (medicRoleId === targetRoleId) return { ok: false, error: 'Medic cannot heal themselves.' };
    if (target.roleName === 'Medic') {
      const otherMedic = Object.values(players).find(p =>
        p.roleName === 'Medic' && p.roleId !== medicRoleId && p.isAlive && p.connected
      );
      if (!otherMedic) {
        return { ok: false, error: 'Only another Medic can heal a Medic.' };
      }
    }

    target.health = Math.min(100, target.health + 20);
    this.io.emit('updatePlayers', players);
    this.io.emit('healed', { medic: medic.name, target: target.name, amount: 20 });
    return { ok: true, healed: target.name };
  }

  /** Caretaker repairs shelter and furniture */
  caretakerRepair(caretakerRoleId, shelterManager, furnitureId) {
    const players = this.getPlayers();
    const caretaker = players[caretakerRoleId];
    if (!caretaker || caretaker.roleName !== 'Caretaker') {
      return { ok: false, error: 'Only Caretakers can perform maintenance.' };
    }
    if (!caretaker.isAlive) return { ok: false, error: 'Caretaker is eliminated.' };

    if (furnitureId) {
      const result = shelterManager.repairFurniture(furnitureId);
      if (result) {
        this.io.emit('updatePlayers', players);
        return { ok: true, repaired: result.name };
      }
      return { ok: false, error: 'Furniture not damaged or not found.' };
    }

    if (shelterManager.rubbleCount > 0) {
      shelterManager.cleanRubble();
      return { ok: true, action: 'cleaned_rubble' };
    }

    shelterManager.repairShelter(5);
    this.io.emit('updatePlayers', players);
    return { ok: true, action: 'repaired_shelter', amount: 5 };
  }

  /** Scavenger gathers items */
  scavenge(scavengerRoleId, spotId, itemManager) {
    const players = this.getPlayers();
    const scavenger = players[scavengerRoleId];
    if (!scavenger || scavenger.roleName !== 'Scavenger') {
      return { ok: false, error: 'Only Scavengers can scavenge.' };
    }
    return itemManager.scavenge(scavengerRoleId, spotId);
  }
}

module.exports = RoleManager;
