/**
 * ItemManager — item spawning, inventory, scavenging, umbrella system.
 * Scavengers gather items from shrubs between disasters.
 */

class ItemManager {
  constructor({ itemsConfig, scavengeSpots, io, getPlayers }) {
    this.io = io;
    this.getPlayers = getPlayers;
    this.itemsConfig = itemsConfig || [];
    this.scavengeSpots = scavengeSpots || [];
    this.scavengeCooldowns = new Map();
    this.droppedItems = [];
  }

  reset() {
    this.scavengeCooldowns.clear();
    this.droppedItems = [];
  }

  getItemDef(itemId) {
    return this.itemsConfig.find(i => i.id === itemId);
  }

  /** Create an item instance */
  createItem(itemId) {
    const def = this.getItemDef(itemId);
    if (!def) return null;
    return {
      id: def.id,
      name: def.name,
      icon: def.icon,
      description: def.description,
      durability: def.durability || 0,
      maxDurability: def.durability || 0,
      blocksMeteor: def.blocksMeteor || false,
      healthRestore: def.healthRestore || 0,
      hungerRestore: def.hungerRestore || 0,
      shelterRepair: def.shelterRepair || 0,
      special: def.special || null
    };
  }

  /** Give a random item to a player */
  giveRandomItem(playerRoleId) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player) return null;

    const weights = [
      { id: 'food', weight: 30 },
      { id: 'water', weight: 20 },
      { id: 'supplies', weight: 15 },
      { id: 'umbrella', weight: 8 },
      { id: 'repair_kit', weight: 10 },
      { id: 'first_aid', weight: 7 },
      { id: 'battery', weight: 10 }
    ];

    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
    let rand = Math.random() * totalWeight;
    let chosen = weights[0].id;
    for (const w of weights) {
      rand -= w.weight;
      if (rand <= 0) { chosen = w.id; break; }
    }

    const item = this.createItem(chosen);
    if (item) {
      player.inventory.push(item);
      this.io.emit('itemReceived', { playerId: playerRoleId, item });
    }
    return item;
  }

  /** Scavenger gathers items from a scavenge spot - must be near the shrub */
  scavenge(playerRoleId, spotId) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player) return { ok: false, error: 'Player not found.' };
    if (player.roleName !== 'Scavenger') return { ok: false, error: 'Only Scavengers can scavenge.' };
    if (!player.isAlive) return { ok: false, error: 'You are eliminated.' };

    const now = Date.now();
    const lastScavenge = this.scavengeCooldowns.get(playerRoleId) || 0;
    const cooldown = 10000;
    if (now - lastScavenge < cooldown) {
      return { ok: false, error: `Wait ${Math.ceil((cooldown - (now - lastScavenge)) / 1000)}s before scavenging again.` };
    }

    const spot = this.scavengeSpots.find(s => s.id === spotId);
    if (!spot) return { ok: false, error: 'Invalid scavenge spot.' };

    const dist = Math.abs(player.x - spot.x);
    if (dist > 80) {
      return { ok: false, error: 'You must be closer to the shrub to scavenge!' };
    }

    this.scavengeCooldowns.set(playerRoleId, now);
    const item = this.giveRandomItem(playerRoleId);
    return { ok: true, item };
  }

  /** Use an item from inventory */
  useItem(playerRoleId, inventoryIndex) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player || !player.isAlive) return { ok: false, error: 'Cannot use item.' };

    const item = player.inventory[inventoryIndex];
    if (!item) return { ok: false, error: 'Item not found.' };

    const result = { ok: true, item: item.name, effects: [] };

    if (item.id === 'food') {
      if (player.roleName === 'Scavenger') {
        return { ok: false, error: 'Scavengers cannot eat food — share it with others!' };
      }
      player.hunger = Math.min(100, player.hunger + (item.hungerRestore || 25));
      result.effects.push(`+${item.hungerRestore || 25} Food`);
    } else if (item.id === 'water') {
      if (player.roleName === 'Scavenger') {
        return { ok: false, error: 'Scavengers cannot eat food — share it with others!' };
      }
      player.hunger = Math.min(100, player.hunger + (item.hungerRestore || 15));
      player.health = Math.min(100, player.health + (item.healthRestore || 10));
      result.effects.push(`+${item.hungerRestore || 15} Food, +${item.healthRestore || 10} Health`);
    } else if (item.id === 'first_aid') {
      player.health = Math.min(100, player.health + (item.healthRestore || 30));
      result.effects.push(`+${item.healthRestore || 30} Health`);
    } else if (item.id === 'umbrella') {
      result.effects.push(`Equipped umbrella (${item.durability} hits remaining)`);
    } else if (item.id === 'repair_kit') {
      result.effects.push('Repair kit ready — use on shelter or furniture.');
    } else {
      result.effects.push('Item noted.');
    }

    if (item.id !== 'umbrella') {
      player.inventory.splice(inventoryIndex, 1);
    }

    this.io.emit('updatePlayers', players);
    return result;
  }

  /** Share food from Scavenger to another player */
  shareFood(fromRoleId, toRoleId, inventoryIndex) {
    const players = this.getPlayers();
    const from = players[fromRoleId];
    const to = players[toRoleId];
    if (!from || !to) return { ok: false, error: 'Player not found.' };
    if (from.roleName !== 'Scavenger') return { ok: false, error: 'Only Scavengers can share food.' };
    if (!from.isAlive || !to.isAlive) return { ok: false, error: 'Both players must be alive.' };

    const item = from.inventory[inventoryIndex];
    if (!item || (item.id !== 'food' && item.id !== 'water')) {
      return { ok: false, error: 'Can only share food or water.' };
    }

    const restore = item.hungerRestore || 25;
    to.hunger = Math.min(100, to.hunger + restore);
    from.inventory.splice(inventoryIndex, 1);

    this.io.emit('updatePlayers', players);
    this.io.emit('foodShared', { from: from.name, to: to.name, amount: restore });
    return { ok: true, amount: restore };
  }

  /** Check if player has an active umbrella */
  hasUmbrella(playerRoleId) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player) return false;
    return player.inventory.some(item => item.id === 'umbrella' && item.durability > 0);
  }

  /** Use umbrella durability against meteor */
  useUmbrella(playerRoleId) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player) return false;

    const idx = player.inventory.findIndex(item => item.id === 'umbrella' && item.durability > 0);
    if (idx === -1) return false;

    player.inventory[idx].durability--;
    const remaining = player.inventory[idx].durability;

    if (remaining <= 0) {
      player.inventory.splice(idx, 1);
      this.io.emit('umbrellaBroken', { playerId: playerRoleId });
    }

    this.io.emit('updatePlayers', players);
    return true;
  }

  /** Repair shelter with repair kit */
  useRepairKit(playerRoleId, inventoryIndex, shelterManager) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player || !player.isAlive) return { ok: false, error: 'Cannot use item.' };

    const item = player.inventory[inventoryIndex];
    if (!item || item.id !== 'repair_kit') return { ok: false, error: 'Not a repair kit.' };

    shelterManager.repairShelter(item.shelterRepair || 20);
    player.inventory.splice(inventoryIndex, 1);

    this.io.emit('updatePlayers', players);
    return { ok: true, repaired: item.shelterRepair || 20 };
  }

  /** Drop items on player death */
  dropItems(playerRoleId) {
    const players = this.getPlayers();
    const player = players[playerRoleId];
    if (!player) return [];

    const dropped = [...player.inventory];
    player.inventory = [];
    this.io.emit('updatePlayers', players);
    return dropped;
  }

  getState() {
    return {
      scavengeSpots: this.scavengeSpots,
      droppedItems: this.droppedItems
    };
  }
}

module.exports = ItemManager;
