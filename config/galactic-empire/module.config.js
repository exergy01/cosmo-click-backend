/**
 * 🔧 MODULE SYSTEM CONFIG - GALACTIC EMPIRE
 * Конфигурация системы модулей
 */

/**
 * ТИПЫ МОДУЛЕЙ
 */
const MODULE_TYPES = {
  WEAPON: 'weapon',      // Оружие (+attack)
  ARMOR: 'armor',        // Броня (+defense)
  ENGINE: 'engine',      // Двигатель (+speed)
  SHIELD: 'shield',      // Щит (+hp)
  REACTOR: 'reactor'     // Реактор (+все характеристики)
};

/**
 * БОНУСЫ ОТ МОДУЛЕЙ ПО TIER
 * Процентные бонусы к характеристикам
 */
const MODULE_BONUSES = {
  weapon: {
    1: { attack: 10 },        // T1: +10 атаки
    2: { attack: 25 },        // T2: +25 атаки
    3: { attack: 50 }         // T3: +50 атаки
  },
  armor: {
    1: { defense: 10 },       // T1: +10 защиты
    2: { defense: 25 },       // T2: +25 защиты
    3: { defense: 50 }        // T3: +50 защиты
  },
  engine: {
    1: { speed: 5 },          // T1: +5 скорости
    2: { speed: 12 },         // T2: +12 скорости
    3: { speed: 25 }          // T3: +25 скорости
  },
  shield: {
    1: { hp: 50 },            // T1: +50 HP
    2: { hp: 125 },           // T2: +125 HP
    3: { hp: 250 }            // T3: +250 HP
  },
  reactor: {
    1: { attack: 5, defense: 5, speed: 2, hp: 25 },      // T1: малый бонус ко всему
    2: { attack: 12, defense: 12, speed: 5, hp: 60 },    // T2: средний бонус
    3: { attack: 25, defense: 25, speed: 10, hp: 125 }   // T3: большой бонус
  }
};

/**
 * СТОИМОСТЬ СОЗДАНИЯ МОДУЛЕЙ
 * Создание модулей в мастерской
 */
const MODULE_CRAFT_COSTS = {
  weapon: {
    1: { luminios: 100, seconds: 300 },      // T1: 100 Lum, 5 мин
    2: { luminios: 300, seconds: 1800 },     // T2: 300 Lum, 30 мин
    3: { luminios: 800, seconds: 7200 }      // T3: 800 Lum, 2 часа
  },
  armor: {
    1: { luminios: 100, seconds: 300 },
    2: { luminios: 300, seconds: 1800 },
    3: { luminios: 800, seconds: 7200 }
  },
  engine: {
    1: { luminios: 100, seconds: 300 },
    2: { luminios: 300, seconds: 1800 },
    3: { luminios: 800, seconds: 7200 }
  },
  shield: {
    1: { luminios: 150, seconds: 450 },      // Щиты дороже
    2: { luminios: 400, seconds: 2400 },
    3: { luminios: 1000, seconds: 9000 }
  },
  reactor: {
    1: { luminios: 200, seconds: 600 },      // Реакторы самые дорогие
    2: { luminios: 600, seconds: 3600 },
    3: { luminios: 1500, seconds: 14400 }
  }
};

/**
 * ПОЛУЧИТЬ БОНУСЫ МОДУЛЯ
 * @param {string} moduleType - тип модуля
 * @param {number} moduleTier - tier модуля (1-3)
 * @returns {object} - объект с бонусами {attack?, defense?, speed?, hp?}
 */
function getModuleBonuses(moduleType, moduleTier) {
  if (!MODULE_BONUSES[moduleType] || !MODULE_BONUSES[moduleType][moduleTier]) {
    return {};
  }
  return MODULE_BONUSES[moduleType][moduleTier];
}

/**
 * РАССЧИТАТЬ ФИНАЛЬНЫЕ ХАРАКТЕРИСТИКИ С МОДУЛЯМИ
 * @param {object} baseStats - базовые характеристики {hp, attack, defense, speed}
 * @param {array} modules - массив модулей [{type, tier}, ...]
 * @returns {object} - финальные характеристики
 */
function calculateStatsWithModules(baseStats, modules) {
  const finalStats = { ...baseStats };

  modules.forEach(module => {
    if (!module || !module.type || !module.tier) return;

    const bonuses = getModuleBonuses(module.type, module.tier);

    if (bonuses.attack) finalStats.attack += bonuses.attack;
    if (bonuses.defense) finalStats.defense += bonuses.defense;
    if (bonuses.speed) finalStats.speed += bonuses.speed;
    if (bonuses.hp) {
      finalStats.hp += bonuses.hp;
      finalStats.maxHp += bonuses.hp;
    }
  });

  return finalStats;
}

/**
 * ПОЛУЧИТЬ ИНФОРМАЦИЮ О МОДУЛЕ
 * @param {string} moduleType
 * @param {number} moduleTier
 * @returns {object}
 */
function getModuleInfo(moduleType, moduleTier) {
  const bonuses = getModuleBonuses(moduleType, moduleTier);
  const craftCost = MODULE_CRAFT_COSTS[moduleType]?.[moduleTier];

  return {
    type: moduleType,
    tier: moduleTier,
    bonuses,
    craftCost,
    name: {
      ru: getModuleNameRu(moduleType, moduleTier),
      en: getModuleNameEn(moduleType, moduleTier)
    },
    icon: getModuleIcon(moduleType),
    color: getModuleColor(moduleTier)
  };
}

/**
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ НАЗВАНИЙ И ИКОНОК
 */
function getModuleNameRu(type, tier) {
  const names = {
    weapon: ['Лёгкое оружие', 'Среднее оружие', 'Тяжёлое оружие'],
    armor: ['Лёгкая броня', 'Средняя броня', 'Тяжёлая броня'],
    engine: ['Базовый двигатель', 'Продвинутый двигатель', 'Квантовый двигатель'],
    shield: ['Малый щит', 'Средний щит', 'Большой щит'],
    reactor: ['Малый реактор', 'Средний реактор', 'Большой реактор']
  };
  return names[type]?.[tier - 1] || 'Неизвестный модуль';
}

function getModuleNameEn(type, tier) {
  const names = {
    weapon: ['Light Weapon', 'Medium Weapon', 'Heavy Weapon'],
    armor: ['Light Armor', 'Medium Armor', 'Heavy Armor'],
    engine: ['Basic Engine', 'Advanced Engine', 'Quantum Engine'],
    shield: ['Small Shield', 'Medium Shield', 'Large Shield'],
    reactor: ['Small Reactor', 'Medium Reactor', 'Large Reactor']
  };
  return names[type]?.[tier - 1] || 'Unknown Module';
}

function getModuleIcon(type) {
  const icons = {
    weapon: '⚔️',
    armor: '🛡️',
    engine: '🚀',
    shield: '💠',
    reactor: '⚡'
  };
  return icons[type] || '📦';
}

function getModuleColor(tier) {
  const colors = {
    1: '#4ECDC4',  // Cyan (базовый)
    2: '#FFD700',  // Gold (улучшенный)
    3: '#FF6B6B'   // Red (продвинутый)
  };
  return colors[tier] || '#999';
}

/**
 * ВАЛИДАЦИЯ МОДУЛЯ
 */
function isValidModule(moduleType, moduleTier) {
  return MODULE_BONUSES[moduleType] && MODULE_BONUSES[moduleType][moduleTier];
}

/**
 * ПОЛУЧИТЬ СТОИМОСТЬ СОЗДАНИЯ
 */
function getCraftCost(moduleType, moduleTier) {
  return MODULE_CRAFT_COSTS[moduleType]?.[moduleTier] || null;
}

/**
 * ЭКСПОРТ
 */
module.exports = {
  MODULE_TYPES,
  MODULE_BONUSES,
  MODULE_CRAFT_COSTS,
  getModuleBonuses,
  calculateStatsWithModules,
  getModuleInfo,
  isValidModule,
  getCraftCost
};
