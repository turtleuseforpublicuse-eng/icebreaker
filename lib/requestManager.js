const itemsConfig = require('../config.json').items;

class RequestManager {
  constructor(gameState) {
    this.gameState = gameState;
    this.requests = new Map();
  }

  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  createRequest(fromId, toId, type, payload, io) {
    const from = this.gameState.players[fromId];
    const to = this.gameState.players[toId];

    if (!from || !to) return { success: false, reason: "Player not found." };
    if (from.isDead || to.isDead) return { success: false, reason: "Dead players cannot send requests." };

    const requestId = this.generateRequestId();

    if (type === "food") {
      const hasFood = from.inventory.some(id => {
        const item = itemsConfig.find(i => i.id === id);
        return item && (item.id === "food" || item.id === "water");
      });
      if (!hasFood) return { success: false, reason: "No food available in your inventory to share." };
    }

    if (type === "heal") {
      if (from.health >= 50) return { success: false, reason: "Health must be below 50 to request healing." };
      const medicCount = from.medicRequestCount || 0;
      if (medicCount >= 2) return { success: false, reason: "Medic heal limit reached (2 per game)." };
    }

    const request = {
      id: requestId,
      from: fromId,
      to: toId,
      type: type,
      payload: payload || {},
      status: "pending",
      createdAt: Date.now()
    };

    this.requests.set(requestId, request);

    from.requestsSent = (from.requestsSent || 0) + 1;

    if (type === "heal") {
      from.medicRequestCount = (from.medicRequestCount || 0) + 1;
    }

    io.to(toId).emit("newRequest", {
      requestId: requestId,
      from: from.name,
      fromIcon: from.icon,
      type: type,
      message: this.getRequestMessage(from, type, payload)
    });

    io.to(fromId).emit("requestSent", {
      requestId: requestId,
      to: to.name,
      toIcon: to.icon,
      type: type
    });

    return { success: true, requestId: requestId };
  }

  getRequestMessage(from, type, payload) {
    switch(type) {
      case "heal": return `${from.icon} ${from.name} needs healing!`;
      case "food": return `${from.icon} ${from.name} wants to share food.`;
      case "help": return `${from.icon} ${from.name} needs help!`;
      default: return `${from.icon} ${from.name} sent a request.`;
    }
  }

  respondToRequest(requestId, accepted, responderId, io) {
    const request = this.requests.get(requestId);
    if (!request) return { success: false, reason: "Request not found." };
    if (request.status !== "pending") return { success: false, reason: "Request already responded to." };
    if (request.to !== responderId) return { success: false, reason: "Not your request." };

    const responder = this.gameState.players[responderId];
    const requester = this.gameState.players[request.from];
    if (!responder || !requester) return { success: false, reason: "Player not found." };

    request.status = accepted ? "accepted" : "denied";

    if (accepted) {
      this.gameState.roleManager.handleAcceptedRequest(request, io);
    }

    io.to(request.from).emit("requestResponse", {
      requestId: requestId,
      accepted: accepted,
      responderName: responder.name,
      responderIcon: responder.icon,
      type: request.type
    });

    io.to(responderId).emit("requestConfirmed", {
      requestId: requestId,
      accepted: accepted,
      requesterName: requester.name,
      requesterIcon: requester.icon
    });

    return { success: true, accepted: accepted };
  }

  acceptFoodFromInventory(requestId, responderId, selectedItemId, io) {
    const request = this.requests.get(requestId);
    if (!request || request.type !== "food" || request.status !== "pending") return { success: false, reason: "Invalid food request." };
    if (request.to !== responderId) return { success: false, reason: "Not your request." };

    const responder = this.gameState.players[responderId];
    const requester = this.gameState.players[request.from];
    if (!responder || !requester) return { success: false, reason: "Player not found." };

    const itemIndex = responder.inventory.indexOf(selectedItemId);
    if (itemIndex === -1) return { success: false, reason: "Item not found in your inventory." };

    const item = itemsConfig.find(i => i.id === selectedItemId);
    if (!item || (item.id !== "food" && item.id !== "water")) return { success: false, reason: "Only food or water items can be shared from inventory." };

    responder.inventory.splice(itemIndex, 1);

    requester.inventory.push(selectedItemId);

    let message = `${responder.icon} ${responder.name} shared ${item.icon} ${item.name} with you!`;

    if (item.hungerRestore) {
      requester.hunger = Math.min(100, requester.hunger + item.hungerRestore);
      message += ` Restored ${item.hungerRestore} hunger.`;
    }
    if (item.healthRestore) {
      requester.health = Math.min(100, requester.health + item.healthRestore);
      message += ` Restored ${item.healthRestore} health.`;
    }

    request.status = "accepted";

    io.to(request.from).emit("foodReceived", {
      item: item,
      message: message,
      hunger: requester.hunger,
      health: requester.health
    });

    io.to(responderId).emit("foodShared", {
      item: item,
      toName: requester.name,
      toIcon: requester.icon,
      inventory: responder.inventory
    });

    return { success: true, item: item, message: message };
  }

  getPendingRequestsForPlayer(playerId) {
    const pending = [];
    for (const [id, req] of this.requests) {
      if (req.to === playerId && req.status === "pending") {
        pending.push(req);
      }
    }
    return pending;
  }
}

module.exports = RequestManager;
