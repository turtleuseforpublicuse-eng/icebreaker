/**
 * RequestManager — player request system.
 * Players can request: healing, food, engineer initialization, construction, role switching.
 * Requests appear only to the appropriate player.
 */

class RequestManager {
  constructor({ io, getPlayers }) {
    this.io = io;
    this.getPlayers = getPlayers;
    this.pendingRequests = [];
    this.requestIdCounter = 0;
  }

  reset() {
    this.pendingRequests = [];
    this.requestIdCounter = 0;
  }

  /**
   * Create a request.
   * type: 'heal' | 'food' | 'engineer_init' | 'construction' | 'role_swap'
   * fromRoleId: who is requesting
   * targetRoleId: who should receive (optional, auto-determined if not given)
   */
  createRequest(type, fromRoleId, targetRoleId) {
    const players = this.getPlayers();
    const from = players[fromRoleId];
    if (!from || !from.isAlive) return { ok: false, error: 'Cannot make request.' };

    if (!targetRoleId) {
      targetRoleId = this._findTarget(type, fromRoleId);
    }

    if (!targetRoleId) {
      return { ok: false, error: 'No eligible player available for this request.' };
    }

    const target = players[targetRoleId];
    if (!target) return { ok: false, error: 'Target player not found.' };

    const requestId = ++this.requestIdCounter;
    const request = {
      id: requestId,
      type,
      fromRoleId,
      fromName: from.name,
      fromRoleIcon: from.roleIcon,
      targetRoleId,
      targetName: target.name,
      targetRoleIcon: target.roleIcon,
      createdAt: Date.now(),
      status: 'pending'
    };

    this.pendingRequests.push(request);

    if (target.socketId) {
      this.io.to(target.socketId).emit('requestReceived', {
        requestId,
        type,
        fromName: from.name,
        fromRoleIcon: from.roleIcon,
        message: this._getRequestMessage(type, from.name)
      });
    }

    if (from.socketId) {
      this.io.to(from.socketId).emit('requestSent', {
        requestId,
        type,
        targetName: target.name,
        targetRoleIcon: target.roleIcon
      });
    }

    return { ok: true, requestId, targetName: target.name };
  }

  /** Respond to a request */
  respondRequest(requestId, responderRoleId, accept) {
    const reqIdx = this.pendingRequests.findIndex(r => r.id === requestId && r.status === 'pending');
    if (reqIdx === -1) return { ok: false, error: 'Request not found or already handled.' };

    const request = this.pendingRequests[reqIdx];
    if (request.targetRoleId !== responderRoleId) {
      return { ok: false, error: 'This request is not for you.' };
    }

    request.status = accept ? 'accepted' : 'declined';
    const players = this.getPlayers();

    if (accept) {
      this._fulfillRequest(request, players);
    }

    const from = players[request.fromRoleId];
    if (from && from.socketId) {
      this.io.to(from.socketId).emit('requestResponse', {
        requestId,
        type: request.type,
        accepted: accept,
        targetName: request.targetName
      });
    }

    return { ok: true, accepted: accept };
  }

  _findTarget(type, fromRoleId) {
    const players = this.getPlayers();

    if (type === 'heal') {
      for (const rid in players) {
        const p = players[rid];
        if (rid !== fromRoleId && p.isAlive && p.connected && p.roleName === 'Medic') return rid;
      }
    } else if (type === 'food') {
      for (const rid in players) {
        const p = players[rid];
        if (rid !== fromRoleId && p.isAlive && p.connected && p.roleName === 'Scavenger') return rid;
      }
    } else if (type === 'engineer_init') {
      for (const rid in players) {
        const p = players[rid];
        if (rid !== fromRoleId && p.isAlive && p.connected && p.roleName === 'Engineer') return rid;
      }
    } else if (type === 'construction') {
      for (const rid in players) {
        const p = players[rid];
        if (rid !== fromRoleId && p.isAlive && p.connected && p.roleName === 'Constructor') return rid;
      }
    }

    return null;
  }

  _getRequestMessage(type, fromName) {
    const messages = {
      heal: `${fromName} needs healing!`,
      food: `${fromName} is hungry and needs food!`,
      engineer_init: `${fromName} requests Engineer to initialize construction!`,
      construction: `${fromName} requests a Constructor to begin repairs!`,
      role_swap: `${fromName} wants to swap roles with you!`
    };
    return messages[type] || `Request from ${fromName}`;
  }

  _fulfillRequest(request, players) {
    const from = players[request.fromRoleId];
    const target = players[request.targetRoleId];
    if (!from || !target) return;

    if (request.type === 'heal' && target.roleName === 'Medic') {
      from.health = Math.min(100, from.health + 20);
    } else if (request.type === 'food' && target.roleName === 'Scavenger') {
      from.hunger = Math.min(100, from.hunger + 25);
    }

    this.io.emit('updatePlayers', players);
  }

  /** Cancel requests from a player (on disconnect) */
  cancelRequestsFrom(roleId) {
    this.pendingRequests = this.pendingRequests.filter(r => {
      if (r.fromRoleId === roleId && r.status === 'pending') {
        r.status = 'cancelled';
        return false;
      }
      return true;
    });
  }

  getRequestsFor(roleId) {
    return this.pendingRequests.filter(r =>
      r.targetRoleId === roleId && r.status === 'pending'
    );
  }

  getState() {
    return {
      pendingRequests: this.pendingRequests.filter(r => r.status === 'pending')
    };
  }
}

module.exports = RequestManager;
