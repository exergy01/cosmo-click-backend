/**
 * ⬆️ TIER SYSTEM CONFIG - GALACTIC EMPIRE
 * Конфигурация системы апгрейдов кораблей по уровням
 */

/**
 * МНОЖИТЕЛИ ХАРАКТЕРИСТИК ПО TIER
 * Все базовые характеристики корабля умножаются на эти значения
 */
const TIER_MULTIPLIERS = {
  1: 1.0,   // T1 - базовые характеристики (1.0x)
  2: 1.3,   // T2 - улучшенные характеристики (+30%)
  3: 1.7    // T3 - продвинутые характеристики (+70%)
};

/**
 * СТОИМОСТЬ И ВРЕМЯ АПГРЕЙДА
 * { fromTier: { toTier: { luminios, seconds } } }
 */
const UPGRADE_COSTS = {
  1: {
    2: {
      luminios: 500,
      seconds: 7200,    // 2 часа
      tonAccelerate: 0.1 // 0.1 TON для мгновенного апгрейда
    }
  },
  2: {
    3: {
      luminios: 1500,
      seconds: 21600,   // 6 часов
      tonAccelerate: 0.3 // 0.3 TON для мгновенного апгрейда
    }
  }
};

/**
 * ПОЛУЧИТЬ СТОИМОСТЬ АПГРЕЙДА
 * @param {number} fromTier - текущий tier
 * @param {number} toTier - целевой tier
 * @returns {{luminios: number, seconds: number, tonAccelerate: number} | null}
 */
function getUpgradeCost(fromTier, toTier) {
  if (!UPGRADE_COSTS[fromTier] || !UPGRADE_COSTS[fromTier][toTier]) {
    return null;
  }
  return UPGRADE_COSTS[fromTier][toTier];
}

/**
 * ВЫЧИСЛИТЬ ФИНАЛЬНЫЕ ХАРАКТЕРИСТИКИ С УЧЁТОМ TIER
 * @param {object} baseStats - базовые характеристики {hp, attack, defense, speed}
 * @param {number} tier - текущий tier корабля (1-3)
 * @returns {object} - финальные характеристики
 */
function calculateTierStats(baseStats, tier) {
  const multiplier = TIER_MULTIPLIERS[tier] || 1.0;

  return {
    hp: Math.floor(baseStats.hp * multiplier),
    maxHp: Math.floor(baseStats.hp * multiplier),
    attack: Math.floor(baseStats.attack * multiplier),
    defense: Math.floor(baseStats.defense * multiplier),
    speed: Math.floor(baseStats.speed * multiplier)
  };
}

/**
 * ПРОВЕРИТЬ ВОЗМОЖНОСТЬ АПГРЕЙДА
 * @param {number} currentTier - текущий tier
 * @param {number} targetTier - целевой tier
 * @returns {boolean}
 */
function canUpgrade(currentTier, targetTier) {
  // Можно апгрейдить только на следующий tier
  if (targetTier !== currentTier + 1) {
    return false;
  }

  // Tier не может быть больше 3
  if (targetTier > 3) {
    return false;
  }

  // Проверяем что стоимость определена
  return getUpgradeCost(currentTier, targetTier) !== null;
}

/**
 * ПОЛУЧИТЬ ИНФОРМАЦИЮ О TIER
 * @param {number} tier
 * @returns {object}
 */
function getTierInfo(tier) {
  return {
    tier,
    multiplier: TIER_MULTIPLIERS[tier] || 1.0,
    name: {
      ru: tier === 1 ? 'Базовый' : tier === 2 ? 'Улучшенный' : 'Продвинутый',
      en: tier === 1 ? 'Basic' : tier === 2 ? 'Advanced' : 'Elite'
    },
    color: tier === 1 ? '#4ECDC4' : tier === 2 ? '#FFD700' : '#FF6B6B',
    emoji: tier === 1 ? '⭐' : tier === 2 ? '⭐⭐' : '⭐⭐⭐'
  };
}

/**
 * ЭКСПОРТ
 */
module.exports = {
  TIER_MULTIPLIERS,
  UPGRADE_COSTS,
  getUpgradeCost,
  calculateTierStats,
  canUpgrade,
  getTierInfo
};
