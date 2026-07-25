class ShelterManager {
  constructor(config) {
    this.config = config;
    this.integrity = 100;
    this.constructionActive = false;
    this.constructionTimer = null;
    this.constructorRepairTimer = null;
    this.furnitureDurability = {};

    for (const f of config.furniture) {
      this.furnitureDurability[f.id] = f.durability;
    }
  }

  hideInFurniture(player, furnitureId) {
    const furniture = this.config.furniture.find(f => f.id === furnitureId);
    if (!furniture) return { success: false, reason: "Furniture not found." };

    const dur = this.furnitureDurability[furnitureId] || 0;
    if (dur <= 0) return { success: false, reason: "This furniture is too damaged to hide in." };

    player.hiding = true;
    player.hidingIn = furniture;

    return { success: true, furniture: furniture };
  }

  unhide(player) {
    player.hiding = false;
    player.hidingIn = null;
    return { success: true };
  }

  startConstruction(engineerId, io) {
    this.constructionActive = true;
    this.constructionTimer = null;

    const repairAmount = Math.floor(Math.random() * 15) + 10;
    this.integrity = Math.min(100, this.integrity + repairAmount);

    return { success: true, amount: repairAmount };
  }

  startConstructorRepair(io) {
    if (this.constructorRepairTimer) return;

    this.constructorRepairTimer = setInterval(() => {
      if (this.integrity < 100) {
        this.integrity = Math.min(100, this.integrity + 20);
        if (io) {
          io.emit("shelterUpdate", {
            integrity: this.integrity,
            furnitureDurability: { ...this.furnitureDurability }
          });
        }
      }
    }, 20000);
  }

  stopConstructorRepair() {
    if (this.constructorRepairTimer) {
      clearInterval(this.constructorRepairTimer);
      this.constructorRepairTimer = null;
    }
  }

  getCaretakerRepair(furnitureId) {
    const furniture = this.config.furniture.find(f => f.id === furnitureId);
    if (!furniture) return { success: false, reason: "Furniture not found." };

    const currentDur = this.furnitureDurability[furnitureId] || 0;
    if (currentDur >= furniture.durability) return { success: false, reason: "This furniture is already at full durability." };

    return { success: true, furniture: furniture, newDurability: furniture.durability };
  }

  applyCaretakerRepair(furnitureId) {
    const furniture = this.config.furniture.find(f => f.id === furnitureId);
    if (!furniture) return false;

    this.furnitureDurability[furnitureId] = furniture.durability;
    return true;
  }

  getState() {
    return {
      integrity: this.integrity,
      constructionActive: this.constructionActive,
      furnitureDurability: { ...this.furnitureDurability }
    };
  }
}

module.exports = ShelterManager;
