/**
 * RoleManager - Handles role definitions, permissions, and mutual role swapping.
 */
class RoleManager {
  constructor(gameState) {
    this.gameState = gameState;
    this.roles = {
      Lookout: { canDetectEarly: true, description: "Detects incoming disasters early without full screen overlay." },
      Medic: { canHealOthers: true, canHealSelf: false, description: "Can heal teammates (+25 HP)." },
      Scavenger: { canScavenge: true, canShareFood: true, description: "Collects food and supplies from foraging spots." },
      Engineer: { canInitConstruction: true, description: "Initializes construction and repair projects." },
      Constructor: { canConstruct: true, description: "Builds and repairs structures once initialized." },
      Caretaker: { canClean: true, canRepairFurniture: true, description: "Maintains shelter integrity and furniture durability." }
    };
    this.pendingSwaps = {};
  }

  assignInitialRoles(players) {
    const roleList = Object.keys(this.roles);
    let index = 0;
    Object.values(players).forEach(p => {
      p.role = roleList[index % roleList.length];
      index++;
    });
  }

  requestSwap(requesterId, targetId) {
    if (!this.gameState.players[requesterId] || !this.gameState.players[targetId]) {
      return { success: false, reason: "Player not found." };
    }
    const requestId = `swap_${requesterId}_${targetId}_${Date.now()}`;
    this.pendingSwaps[requestId] = { requesterId, targetId };
    return { success: true, requestId };
  }

  executeSwap(requestId, accepted) {
    const swap = this.pendingSwaps[requestId];
    if (!swap) return { success: false, reason: "Request expired or invalid." };

    delete this.pendingSwaps[requestId];

    if (!accepted) return { success: false, reason: "Swap declined by target player." };

    const pA = this.gameState.players[swap.requesterId];
    const pB = this.gameState.players[swap.targetId];

    if (!pA || !pB) return { success: false, reason: "One of the players disconnected." };

    // Perform swap while preserving stats, inventory, position, and health/food
    const tempRole = pA.role;
    pA.role = pB.role;
    pB.role = tempRole;

    return {
      success: true,
      playerA: { id: pA.id, role: pA.role, socketId: pA.socketId },
      playerB: { id: pB.id, role: pB.role, socketId: pB.socketId }
    };
  }
}

module.exports = RoleManager;