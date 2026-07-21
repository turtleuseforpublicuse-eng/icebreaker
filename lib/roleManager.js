/**
 * RoleManager — role swap requests and seat bookkeeping.
 * Preserves player stats (health, hunger, position) while swapping roles.
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
}

module.exports = RoleManager;
