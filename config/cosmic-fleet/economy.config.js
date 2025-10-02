/**
 * 💸 COSMIC FLEET - ECONOMY CONFIGURATION
 *
 * Цены, стоимости, ремонт, улучшения
 */

module.exports = {
  // Стоимость кораблей (дублируется из ships.config для удобства)
  shipPrices: {
    tier1: { cs: 0, luminios: 100 },
    tier2: { cs: 0, luminios: 500 },
    tier3: { cs: 0, luminios: 2000 }
  },

  // Ремонт кораблей
  repair: {
    // Стоимость за 1 HP
    costPerHp: 0.5,  // 0.5 Luminios за 1 HP

    // Скидка при полном ремонте флота
    fullFleetDiscount: 0.2,  // -20%

    // Мгновенный ремонт (дороже)
    instant: {
      enabled: true,
      costMultiplier: 2.0  // x2 цена
    },

    // Автоматический ремонт (расходник)
    autoRepair: {
      enabled: true,
      cost: 100,  // Luminios
      restorePercent: 1.0  // 100% HP
    },

    // Формула расчёта стоимости ремонта
    calculateRepairCost(currentHp, maxHp, isInstant = false, isFullFleet = false) {
      const hpToRepair = maxHp - currentHp;
      let cost = hpToRepair * this.costPerHp;

      // Скидка за полный ремонт флота
      if (isFullFleet) {
        cost *= (1 - this.fullFleetDiscount);
      }

      // Мгновенный ремонт дороже
      if (isInstant) {
        cost *= this.instant.costMultiplier;
      }

      return Math.ceil(cost);
    }
  },

  // Слоты флотилии
  fleetSlots: {
    baseSlots: 3,        // начальные слоты
    maxSlots: 5,         // максимум слотов

    // Стоимость дополнительных слотов
    slotPrices: [
      { slot: 4, luminios: 500 },
      { slot: 5, luminios: 1500 }
    ]
  },

  // Улучшения кораблей
  upgrades: {
    weapon: {
      name: 'Оружие',
      maxLevel: 3,
      bonusPerLevel: 0.1,  // +10% урона за уровень
      costs: [100, 250, 500],  // Luminios за уровни 1/2/3
      requirements: [
        { level: 0, shipLevel: 1 },
        { level: 1, shipLevel: 3 },
        { level: 2, shipLevel: 5 }
      ]
    },
    shield: {
      name: 'Щиты',
      maxLevel: 3,
      bonusPerLevel: 0.1,  // +10% HP за уровень
      costs: [100, 250, 500],
      requirements: [
        { level: 0, shipLevel: 1 },
        { level: 1, shipLevel: 3 },
        { level: 2, shipLevel: 5 }
      ]
    },
    engine: {
      name: 'Двигатель',
      maxLevel: 3,
      bonusPerLevel: 0.1,  // +10% скорость за уровень
      costs: [150, 300, 600],
      requirements: [
        { level: 0, shipLevel: 1 },
        { level: 1, shipLevel: 4 },
        { level: 2, shipLevel: 7 }
      ]
    }
  },

  // Расходники (бустеры)
  consumables: {
    damage_boost: {
      name: 'Усилитель урона',
      description: '+20% урона на 1 бой',
      cost: 50,
      effect: { damage: 1.2 },
      duration: 1  // 1 бой
    },
    shield_boost: {
      name: 'Усилитель щитов',
      description: '+20% HP на 1 бой',
      cost: 50,
      effect: { hp: 1.2 },
      duration: 1
    },
    repair_kit: {
      name: 'Ремонтный набор',
      description: 'Восстанавливает 50% HP после боя',
      cost: 100,
      effect: { heal: 0.5 },
      duration: 1
    },
    full_restore: {
      name: 'Полное восстановление',
      description: 'Восстанавливает 100% HP всех кораблей',
      cost: 200,
      effect: { heal: 1.0 },
      duration: 0  // мгновенно
    }
  },

  // Обмен валют
  exchange: {
    // CS → Luminios
    csToLuminios: {
      rate: 10,        // 1 CS = 10 Luminios
      minCs: 1,
      maxCs: 10000,
      fee: 0           // без комиссии
    },

    // Luminios → Stars (пока отключено)
    lumToStars: {
      enabled: false,
      rate: 100,       // 100 Luminios = 1 Star
      fee: 0.05        // 5% комиссия
    }
  },

  // Ежедневные лимиты (защита от фарма)
  dailyLimits: {
    maxBotBattles: 50,        // максимум 50 боёв с ботами в день
    maxLumFromBots: 2000,     // максимум 2000 Luminios с ботов в день

    // Бонус за первую победу дня
    firstWinBonus: {
      luminios: 100,
      xp: 100
    }
  }
};
