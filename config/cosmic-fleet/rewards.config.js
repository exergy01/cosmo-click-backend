/**
 * 💰 COSMIC FLEET - REWARDS CONFIGURATION
 *
 * Награды за бои, формулы расчёта
 */

module.exports = {
  // Награды за бой с ботами
  botBattles: {
    easy: {
      baseLuminios: 15,
      bonusPerDamage: 0.01,      // +1 Luminios за 100 урона
      perfectWinBonus: 1.5,      // +50% если все корабли целы
      defeatReward: 0            // за поражение ничего
    },
    medium: {
      baseLuminios: 35,
      bonusPerDamage: 0.015,     // +1 Luminios за ~67 урона
      perfectWinBonus: 1.5,
      defeatReward: 0
    },
    hard: {
      baseLuminios: 75,
      bonusPerDamage: 0.02,      // +1 Luminios за 50 урона
      perfectWinBonus: 2.0,      // +100% за идеальную победу
      defeatReward: 5            // утешительный приз
    },
    boss: {
      baseLuminios: 200,
      bonusPerDamage: 0.05,      // +1 Luminios за 20 урона
      perfectWinBonus: 3.0,      // +200%
      defeatReward: 20
    }
  },

  // Формула расчёта награды за бой с ботом
  calculateBotReward(difficulty, damageDealt, isPerfectWin, isWin) {
    const config = this.botBattles[difficulty];
    if (!config) {
      throw new Error(`Unknown difficulty: ${difficulty}`);
    }

    // За поражение - фиксированная награда
    if (!isWin) {
      return config.defeatReward;
    }

    // Базовая награда
    let reward = config.baseLuminios;

    // Бонус за урон
    reward += Math.floor(damageDealt * config.bonusPerDamage);

    // Бонус за идеальную победу (все корабли выжили)
    if (isPerfectWin) {
      reward *= config.perfectWinBonus;
    }

    return Math.floor(reward);
  },

  // Награды за PvP
  pvp: {
    // Комиссия платформы
    houseFee: 0.1,              // 10% от банка

    // Минимальная/максимальная ставка
    minStars: 10,
    maxStars: 1000,

    // Допустимые ставки (для UI)
    allowedStakes: [10, 25, 50, 100, 250, 500, 1000],

    // Формула награды победителю
    calculatePvpReward(stakeStars) {
      const totalPot = stakeStars * 2;
      const fee = totalPot * this.houseFee;
      return totalPot - fee;
    }
  },

  // XP за бой (дополнительно к battle.config.js)
  experience: {
    // Бонусный XP за первую победу дня
    firstWinOfDay: 100,

    // Бонусный XP за серию побед
    winStreakBonus: {
      3: 50,   // 3 победы подряд = +50 XP
      5: 150,  // 5 побед = +150 XP
      10: 500  // 10 побед = +500 XP
    }
  },

  // Дропы (пока не реализовано, но можно добавить)
  drops: {
    enabled: false,

    // Шанс дропа после боя
    dropChance: {
      easy: 0.05,    // 5%
      medium: 0.10,  // 10%
      hard: 0.20,    // 20%
      boss: 0.50     // 50%
    },

    // Возможные дропы
    items: {
      repair_kit: {
        name: 'Ремонтный набор',
        description: 'Восстанавливает 50% HP всех кораблей',
        value: 100  // Luminios эквивалент
      },
      damage_boost: {
        name: 'Усилитель урона',
        description: '+20% урона на следующий бой',
        value: 50
      },
      shield_boost: {
        name: 'Усилитель щитов',
        description: '+20% HP на следующий бой',
        value: 50
      }
    }
  },

  // Ежедневные задания Cosmic Fleet
  dailyQuests: {
    win_3_battles: {
      name: 'Выиграй 3 боя',
      description: 'Одержи 3 победы с ботами',
      requirement: 3,
      reward: 50,
      type: 'wins'
    },
    deal_1000_damage: {
      name: 'Нанеси 1000 урона',
      description: 'Суммарно нанеси 1000 урона за день',
      requirement: 1000,
      reward: 30,
      type: 'damage'
    },
    perfect_wins: {
      name: 'Идеальные победы',
      description: 'Выиграй 5 боёв без потерь',
      requirement: 5,
      reward: 100,
      type: 'perfect_wins'
    }
  },

  // Достижения
  achievements: {
    first_blood: {
      name: 'Первая кровь',
      description: 'Одержи первую победу',
      reward: 50,
      check: (stats) => stats.totalWins >= 1
    },
    collector_t1: {
      name: 'Коллекционер Tier 1',
      description: 'Собери все корабли Tier 1',
      reward: 200,
      check: (stats) => stats.tier1Ships >= 4 // 4 типа
    },
    destroyer: {
      name: 'Разрушитель',
      description: 'Нанеси 10,000 урона всего',
      reward: 300,
      check: (stats) => stats.totalDamage >= 10000
    },
    unbeatable: {
      name: 'Непобедимый',
      description: 'Выиграй 10 боёв подряд',
      reward: 500,
      check: (stats) => stats.winStreak >= 10
    },
    fleet_master: {
      name: 'Мастер флота',
      description: 'Прокачай корабль до 10 уровня',
      reward: 1000,
      check: (stats) => stats.maxShipLevel >= 10
    }
  }
};
