/**
 * ⚙️ GALACTIC EMPIRE - SHIP MODULES SYSTEM
 * Система модулей для кораблей: оружие, защита, двигатели, спецоборудование
 */

// 🔧 ТИПЫ СЛОТОВ МОДУЛЕЙ
const MODULE_SLOTS = {
  HIGH: 'high_slot',     // Оружие, лончеры
  MID: 'mid_slot',       // Щиты, вебы, РЭБ
  LOW: 'low_slot',       // Броня, усилители урона, ремонт
  RIG: 'rig_slot'        // Риги (постоянные модификаторы)
};

// 🎯 TIER СИСТЕМА
const MODULE_TIERS = {
  T1: {
    level: 1,
    costMultiplier: 1.0,
    powerMultiplier: 1.0,
    dropChance: 0.70,  // 70% шанс дропа
    upgradeToT2Cost: { luminios: 1000, materials: 50 }
  },
  T2: {
    level: 2,
    costMultiplier: 3.0,
    powerMultiplier: 1.4,  // +40% эффективность
    dropChance: 0.25,  // 25% шанс дропа
    upgradeToT3Cost: { luminios: 5000, materials: 200 }
  },
  T3: {
    level: 3,
    costMultiplier: 10.0,
    powerMultiplier: 2.0,  // +100% эффективность
    dropChance: 0.05,  // 5% шанс дропа (редкие)
    upgradeToT4Cost: null  // T3 - максимальный тир
  }
};

// 🔫 HIGH SLOT МОДУЛИ (Оружие и лончеры)
const HIGH_SLOT_MODULES = {
  // === AMARR LASER MODULES ===
  laser_turret_t1: {
    id: 'laser_turret_t1',
    name: 'Basic Laser Turret',
    nameRu: 'Базовая лазерная турель',
    tier: 'T1',
    slot: MODULE_SLOTS.HIGH,
    race: 'amarr',
    stats: {
      attack: +15,
      accuracy: +0.05,
      energyCost: 15
    },
    description: 'Базовая лазерная турель Amarr',
    price: { luminios: 500 }
  },

  laser_turret_t2: {
    id: 'laser_turret_t2',
    name: 'Advanced Laser Turret',
    nameRu: 'Продвинутая лазерная турель',
    tier: 'T2',
    slot: MODULE_SLOTS.HIGH,
    race: 'amarr',
    stats: {
      attack: +25,
      accuracy: +0.08,
      energyCost: 18
    },
    description: 'Улучшенная лазерная турель с повышенной мощностью',
    price: { luminios: 2000 }
  },

  laser_turret_t3: {
    id: 'laser_turret_t3',
    name: 'Elite Laser Turret',
    nameRu: 'Элитная лазерная турель',
    tier: 'T3',
    slot: MODULE_SLOTS.HIGH,
    race: 'amarr',
    stats: {
      attack: +40,
      accuracy: +0.12,
      energyCost: 20,
      critChance: +0.05
    },
    description: 'Легендарная лазерная турель высшего класса',
    price: { luminios: 8000 }
  },

  // === CALDARI MISSILE MODULES ===
  missile_launcher_t1: {
    id: 'missile_launcher_t1',
    name: 'Basic Missile Launcher',
    nameRu: 'Базовая ракетная установка',
    tier: 'T1',
    slot: MODULE_SLOTS.HIGH,
    race: 'caldari',
    stats: {
      attack: +20,
      aoeRadius: +10
    },
    description: 'Стандартная ракетная установка Caldari',
    price: { luminios: 600 }
  },

  missile_launcher_t2: {
    id: 'missile_launcher_t2',
    name: 'Advanced Missile Launcher',
    nameRu: 'Продвинутая ракетная установка',
    tier: 'T2',
    slot: MODULE_SLOTS.HIGH,
    race: 'caldari',
    stats: {
      attack: +32,
      aoeRadius: +15,
      aoeDamage: +0.05
    },
    description: 'Улучшенная ракетница с большей зоной поражения',
    price: { luminios: 2200 }
  },

  // === GALLENTE PLASMA MODULES ===
  plasma_cannon_t1: {
    id: 'plasma_cannon_t1',
    name: 'Basic Plasma Cannon',
    nameRu: 'Базовая плазменная пушка',
    tier: 'T1',
    slot: MODULE_SLOTS.HIGH,
    race: 'gallente',
    stats: {
      attack: +25,
      armorPenetration: +0.10
    },
    description: 'Мощная плазменная пушка Gallente',
    price: { luminios: 650 }
  },

  plasma_cannon_t2: {
    id: 'plasma_cannon_t2',
    name: 'Heavy Plasma Cannon',
    nameRu: 'Тяжелая плазменная пушка',
    tier: 'T2',
    slot: MODULE_SLOTS.HIGH,
    race: 'gallente',
    stats: {
      attack: +38,
      armorPenetration: +0.18,
      critDamage: +0.15
    },
    description: 'Разрушительная плазменная пушка',
    price: { luminios: 2400 }
  },

  // === MINMATAR PROJECTILE MODULES ===
  projectile_cannon_t1: {
    id: 'projectile_cannon_t1',
    name: 'Autocannon I',
    nameRu: 'Автопушка I',
    tier: 'T1',
    slot: MODULE_SLOTS.HIGH,
    race: 'minmatar',
    stats: {
      attack: +12,
      fireRate: +0.20,  // -20% кулдаун
      critChance: +0.08
    },
    description: 'Быстрая автопушка Minmatar',
    price: { luminios: 550 }
  },

  projectile_cannon_t2: {
    id: 'projectile_cannon_t2',
    name: 'Autocannon II',
    nameRu: 'Автопушка II',
    tier: 'T2',
    slot: MODULE_SLOTS.HIGH,
    race: 'minmatar',
    stats: {
      attack: +18,
      fireRate: +0.30,
      critChance: +0.12,
      critDamage: +0.25
    },
    description: 'Усовершенствованная автопушка с высокой скорострельностью',
    price: { luminios: 2000 }
  }
};

// 🛡️ MID SLOT МОДУЛИ (Щиты, РЭБ, веб)
const MID_SLOT_MODULES = {
  // === SHIELD MODULES ===
  shield_booster_t1: {
    id: 'shield_booster_t1',
    name: 'Shield Booster I',
    nameRu: 'Усилитель щитов I',
    tier: 'T1',
    slot: MODULE_SLOTS.MID,
    stats: {
      defense: +20,
      shieldRegenRate: +0.10
    },
    description: 'Базовый усилитель щитов',
    price: { luminios: 400 }
  },

  shield_booster_t2: {
    id: 'shield_booster_t2',
    name: 'Shield Booster II',
    nameRu: 'Усилитель щитов II',
    tier: 'T2',
    slot: MODULE_SLOTS.MID,
    stats: {
      defense: +35,
      shieldRegenRate: +0.18,
      maxHP: +50
    },
    description: 'Продвинутый усилитель щитов',
    price: { luminios: 1800 }
  },

  // === EW MODULES (Electronic Warfare) ===
  target_painter_t1: {
    id: 'target_painter_t1',
    name: 'Target Painter I',
    nameRu: 'Целеуказатель I',
    tier: 'T1',
    slot: MODULE_SLOTS.MID,
    stats: {
      enemyEvasion: -0.15  // Снижает уклонение врага на 15%
    },
    activeEffect: {
      type: 'debuff',
      target: 'enemy',
      stat: 'evasion',
      value: -0.15,
      duration: 5000
    },
    description: 'Снижает уклонение цели',
    price: { luminios: 600 }
  },

  ecm_jammer_t1: {
    id: 'ecm_jammer_t1',
    name: 'ECM Jammer I',
    nameRu: 'Глушилка I',
    tier: 'T1',
    slot: MODULE_SLOTS.MID,
    stats: {
      enemyAccuracy: -0.20  // Снижает точность врага на 20%
    },
    activeEffect: {
      type: 'debuff',
      target: 'enemy',
      stat: 'accuracy',
      value: -0.20,
      duration: 6000
    },
    description: 'Снижает точность вражеских кораблей',
    price: { luminios: 700 }
  },

  stasis_web_t1: {
    id: 'stasis_web_t1',
    name: 'Stasis Webifier I',
    nameRu: 'Замедлитель I',
    tier: 'T1',
    slot: MODULE_SLOTS.MID,
    stats: {
      enemySpeed: -0.40  // Снижает скорость врага на 40%
    },
    activeEffect: {
      type: 'debuff',
      target: 'enemy',
      stat: 'speed',
      value: -0.40,
      duration: 8000
    },
    description: 'Замедляет вражеский корабль',
    price: { luminios: 650 }
  }
};

// 🔩 LOW SLOT МОДУЛИ (Броня, усилители урона, ремонт)
const LOW_SLOT_MODULES = {
  // === ARMOR MODULES ===
  armor_plate_t1: {
    id: 'armor_plate_t1',
    name: 'Armor Plate I',
    nameRu: 'Броневая пластина I',
    tier: 'T1',
    slot: MODULE_SLOTS.LOW,
    stats: {
      maxHP: +100,
      defense: +15
    },
    drawback: {
      speed: -0.05  // -5% к скорости
    },
    description: 'Увеличивает броню, снижает скорость',
    price: { luminios: 450 }
  },

  armor_plate_t2: {
    id: 'armor_plate_t2',
    name: 'Armor Plate II',
    nameRu: 'Броневая пластина II',
    tier: 'T2',
    slot: MODULE_SLOTS.LOW,
    stats: {
      maxHP: +180,
      defense: +25
    },
    drawback: {
      speed: -0.08
    },
    description: 'Значительно усиливает броню',
    price: { luminios: 1900 }
  },

  // === DAMAGE ENHANCERS ===
  damage_amplifier_t1: {
    id: 'damage_amplifier_t1',
    name: 'Damage Control I',
    nameRu: 'Усилитель урона I',
    tier: 'T1',
    slot: MODULE_SLOTS.LOW,
    stats: {
      attack: +10,
      critDamage: +0.10
    },
    description: 'Увеличивает наносимый урон',
    price: { luminios: 500 }
  },

  damage_amplifier_t2: {
    id: 'damage_amplifier_t2',
    name: 'Damage Control II',
    nameRu: 'Усилитель урона II',
    tier: 'T2',
    slot: MODULE_SLOTS.LOW,
    stats: {
      attack: +18,
      critDamage: +0.18,
      critChance: +0.05
    },
    description: 'Значительно увеличивает урон',
    price: { luminios: 2100 }
  },

  // === REPAIR MODULES ===
  armor_repairer_t1: {
    id: 'armor_repairer_t1',
    name: 'Armor Repairer I',
    nameRu: 'Ремонтник брони I',
    tier: 'T1',
    slot: MODULE_SLOTS.LOW,
    stats: {
      hpRegenRate: +0.15  // +15% к регену HP
    },
    description: 'Ускоряет восстановление брони',
    price: { luminios: 550 }
  },

  armor_repairer_t2: {
    id: 'armor_repairer_t2',
    name: 'Armor Repairer II',
    nameRu: 'Ремонтник брони II',
    tier: 'T2',
    slot: MODULE_SLOTS.LOW,
    stats: {
      hpRegenRate: +0.25,
      maxHP: +30
    },
    description: 'Значительно ускоряет ремонт',
    price: { luminios: 2000 }
  }
};

// ⚡ RIG SLOT МОДУЛИ (Постоянные модификаторы, нельзя снять)
const RIG_SLOT_MODULES = {
  // === КАЛИБРОВОЧНЫЕ РИГИ ===
  cpu_overclocker_t1: {
    id: 'cpu_overclocker_t1',
    name: 'CPU Overclocker I',
    nameRu: 'Разгон процессора I',
    tier: 'T1',
    slot: MODULE_SLOTS.RIG,
    stats: {
      attack: +5,
      speed: +10,
      accuracy: +0.03
    },
    permanent: true,
    description: 'Постоянно увеличивает все параметры. Нельзя снять!',
    price: { luminios: 1000 }
  },

  targeting_computer_rig: {
    id: 'targeting_computer_rig',
    name: 'Targeting Computer Rig',
    nameRu: 'Риг системы наведения',
    tier: 'T1',
    slot: MODULE_SLOTS.RIG,
    stats: {
      accuracy: +0.10,
      critChance: +0.05
    },
    permanent: true,
    description: 'Улучшает точность и шанс крита. Постоянный эффект.',
    price: { luminios: 1200 }
  },

  engine_optimization_rig: {
    id: 'engine_optimization_rig',
    name: 'Engine Optimization Rig',
    nameRu: 'Риг оптимизации двигателей',
    tier: 'T1',
    slot: MODULE_SLOTS.RIG,
    stats: {
      speed: +30,
      evasion: +0.08
    },
    permanent: true,
    description: 'Улучшает скорость и уклонение. Нельзя снять.',
    price: { luminios: 1100 }
  }
};

// 📊 СЛОТЫ ПО КЛАССАМ КОРАБЛЕЙ
const SHIP_SLOT_CONFIGURATION = {
  frigate_t1: {
    highSlots: 2,
    midSlots: 2,
    lowSlots: 2,
    rigSlots: 1
  },
  frigate_t2: {
    highSlots: 3,
    midSlots: 2,
    lowSlots: 2,
    rigSlots: 1
  },
  destroyer_t1: {
    highSlots: 3,
    midSlots: 3,
    lowSlots: 2,
    rigSlots: 1
  },
  destroyer_t2: {
    highSlots: 4,
    midSlots: 3,
    lowSlots: 3,
    rigSlots: 2
  },
  cruiser_t1: {
    highSlots: 4,
    midSlots: 4,
    lowSlots: 3,
    rigSlots: 2
  },
  cruiser_t2: {
    highSlots: 5,
    midSlots: 4,
    lowSlots: 4,
    rigSlots: 2
  },
  battleship_t1: {
    highSlots: 6,
    midSlots: 5,
    lowSlots: 5,
    rigSlots: 3
  },
  battleship_t2: {
    highSlots: 8,
    midSlots: 6,
    lowSlots: 6,
    rigSlots: 3
  }
};

// 🎲 СИСТЕМА ДРОПА МОДУЛЕЙ
const MODULE_DROP_SYSTEM = {
  /**
   * Рассчитать шанс дропа модуля после боя
   */
  calculateDropChance(enemyFleetPower, playerVictory) {
    if (!playerVictory) return 0;

    const baseChance = 0.30; // 30% базовый шанс
    const powerBonus = Math.min(enemyFleetPower / 1000, 0.20); // До +20% от силы флота

    return baseChance + powerBonus;
  },

  /**
   * Определить тир дропнутого модуля
   */
  determineTier(luck = 0) {
    const roll = Math.random() + luck;

    if (roll > 0.95) return 'T3'; // 5% шанс
    if (roll > 0.70) return 'T2'; // 25% шанс
    return 'T1'; // 70% шанс
  },

  /**
   * Выбрать случайный модуль
   */
  getRandomModule(tier, slotType = null) {
    const allModules = {
      ...HIGH_SLOT_MODULES,
      ...MID_SLOT_MODULES,
      ...LOW_SLOT_MODULES
    };

    let availableModules = Object.values(allModules).filter(m => m.tier === tier);

    if (slotType) {
      availableModules = availableModules.filter(m => m.slot === slotType);
    }

    if (availableModules.length === 0) return null;

    return availableModules[Math.floor(Math.random() * availableModules.length)];
  }
};

module.exports = {
  MODULE_SLOTS,
  MODULE_TIERS,
  HIGH_SLOT_MODULES,
  MID_SLOT_MODULES,
  LOW_SLOT_MODULES,
  RIG_SLOT_MODULES,
  SHIP_SLOT_CONFIGURATION,
  MODULE_DROP_SYSTEM
};
