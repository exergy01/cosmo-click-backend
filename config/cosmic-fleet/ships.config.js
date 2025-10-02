/**
 * 🚀 COSMIC FLEET - SHIPS CONFIGURATION
 *
 * Все характеристики кораблей, типы, стоимость
 * Легко править для баланса
 */

module.exports = {
  // Уровни кораблей (Tier)
  tiers: {
    1: {
      name: 'Tier 1',
      description: 'Лёгкие корабли для начинающих',
      baseStats: {
        hp: { min: 100, max: 200 },
        damage: { min: 15, max: 30 },
        armor: { min: 5, max: 15 },
        speed: { min: 8, max: 12 }
      },
      cost: {
        cs: 0,
        luminios: 100
      }
    },
    2: {
      name: 'Tier 2',
      description: 'Средние корабли',
      baseStats: {
        hp: { min: 250, max: 400 },
        damage: { min: 35, max: 55 },
        armor: { min: 20, max: 35 },
        speed: { min: 10, max: 15 }
      },
      cost: {
        cs: 0,
        luminios: 500
      }
    },
    3: {
      name: 'Tier 3',
      description: 'Тяжёлые корабли',
      baseStats: {
        hp: { min: 500, max: 800 },
        damage: { min: 60, max: 100 },
        armor: { min: 40, max: 70 },
        speed: { min: 12, max: 18 }
      },
      cost: {
        cs: 0,
        luminios: 2000
      }
    }
  },

  // Типы кораблей (роли)
  types: {
    FIGHTER: {
      name: 'Истребитель',
      description: 'Высокий урон, средняя живучесть',
      hpMultiplier: 1.0,
      damageMultiplier: 1.3,
      armorMultiplier: 0.9,
      speedMultiplier: 1.2,
      role: 'damage',
      position: 'front' // может быть в первом ряду
    },
    TANK: {
      name: 'Танк',
      description: 'Максимум защиты, низкий урон',
      hpMultiplier: 1.6,
      damageMultiplier: 0.7,
      armorMultiplier: 1.5,
      speedMultiplier: 0.8,
      role: 'tank',
      position: 'front'
    },
    SUPPORT: {
      name: 'Поддержка',
      description: 'Средние характеристики, баффы',
      hpMultiplier: 0.9,
      damageMultiplier: 1.0,
      armorMultiplier: 1.0,
      speedMultiplier: 1.1,
      role: 'support',
      position: 'back', // только в заднем ряду
      specialAbility: 'heal' // пока не реализовано
    },
    BOMBER: {
      name: 'Бомбардировщик',
      description: 'Максимальный урон, низкая защита',
      hpMultiplier: 0.7,
      damageMultiplier: 1.8,
      armorMultiplier: 0.6,
      speedMultiplier: 0.9,
      role: 'damage',
      position: 'back'
    }
  },

  // Максимальные уровни прокачки
  leveling: {
    maxLevel: 10,
    xpPerLevel: [
      0,     // lvl 1
      100,   // lvl 2
      250,   // lvl 3
      500,   // lvl 4
      1000,  // lvl 5
      2000,  // lvl 6
      4000,  // lvl 7
      8000,  // lvl 8
      15000, // lvl 9
      30000  // lvl 10
    ],
    statBonusPerLevel: 0.05 // +5% всех статов за уровень
  },

  // Формула расчёта характеристик корабля
  calculateShipStats(tier, type, level = 1, upgrades = {}) {
    const tierConfig = this.tiers[tier];
    const typeConfig = this.types[type];

    if (!tierConfig || !typeConfig) {
      throw new Error(`Invalid ship configuration: tier=${tier}, type=${type}`);
    }

    // Базовые статы (среднее между min и max)
    const baseHp = (tierConfig.baseStats.hp.min + tierConfig.baseStats.hp.max) / 2;
    const baseDamage = (tierConfig.baseStats.damage.min + tierConfig.baseStats.damage.max) / 2;
    const baseArmor = (tierConfig.baseStats.armor.min + tierConfig.baseStats.armor.max) / 2;
    const baseSpeed = (tierConfig.baseStats.speed.min + tierConfig.baseStats.speed.max) / 2;

    // Модификаторы типа
    const hp = baseHp * typeConfig.hpMultiplier;
    const damage = baseDamage * typeConfig.damageMultiplier;
    const armor = baseArmor * typeConfig.armorMultiplier;
    const speed = baseSpeed * typeConfig.speedMultiplier;

    // Бонусы от уровня
    const levelBonus = 1 + (level - 1) * this.leveling.statBonusPerLevel;

    // Бонусы от улучшений
    const weaponBonus = 1 + (upgrades.weapon || 0) * 0.1;
    const shieldBonus = 1 + (upgrades.shield || 0) * 0.1;
    const engineBonus = 1 + (upgrades.engine || 0) * 0.1;

    return {
      hp: Math.floor(hp * levelBonus * shieldBonus),
      maxHp: Math.floor(hp * levelBonus * shieldBonus),
      damage: Math.floor(damage * levelBonus * weaponBonus),
      armor: Math.floor(armor * levelBonus * shieldBonus),
      speed: Math.floor(speed * levelBonus * engineBonus),
      tier,
      type,
      level,
      role: typeConfig.role,
      position: typeConfig.position
    };
  }
};
