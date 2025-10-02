/**
 * 🤖 COSMIC FLEET - BOTS CONFIGURATION
 *
 * Типы ботов, флоты, AI стратегии
 */

module.exports = {
  // Типы ботов по сложности
  difficulties: {
    easy: {
      name: 'Пиратский скаут',
      nameEn: 'Pirate Scout',
      description: 'Слабый противник для новичков',
      fleet: [
        { tier: 1, type: 'FIGHTER', level: 1 }
      ],
      difficultyMultiplier: 0.8,  // -20% ко всем статам
      aiStrategy: 'random',
      rewardDifficulty: 'easy'
    },

    medium: {
      name: 'Пиратский патруль',
      nameEn: 'Pirate Patrol',
      description: 'Средний противник',
      fleet: [
        { tier: 1, type: 'TANK', level: 2 },
        { tier: 1, type: 'FIGHTER', level: 2 },
        { tier: 2, type: 'FIGHTER', level: 1 }
      ],
      difficultyMultiplier: 1.0,
      aiStrategy: 'focus_weakest',
      rewardDifficulty: 'medium'
    },

    hard: {
      name: 'Пиратский флагман',
      nameEn: 'Pirate Flagship',
      description: 'Сильный противник',
      fleet: [
        { tier: 2, type: 'TANK', level: 3 },
        { tier: 2, type: 'FIGHTER', level: 3 },
        { tier: 2, type: 'FIGHTER', level: 3 },
        { tier: 3, type: 'BOMBER', level: 2 }
      ],
      difficultyMultiplier: 1.2,  // +20%
      aiStrategy: 'smart_targeting',
      rewardDifficulty: 'hard'
    }
  },

  // Особые боты (события)
  special: {
    daily_boss: {
      name: 'Космический Дредноут',
      nameEn: 'Space Dreadnought',
      description: 'Ежедневный босс',
      fleet: [
        { tier: 3, type: 'TANK', level: 8 },
        { tier: 3, type: 'FIGHTER', level: 8 },
        { tier: 3, type: 'FIGHTER', level: 8 },
        { tier: 3, type: 'BOMBER', level: 8 },
        { tier: 3, type: 'SUPPORT', level: 8 }
      ],
      difficultyMultiplier: 1.5,  // +50%
      aiStrategy: 'smart_targeting',
      rewardDifficulty: 'boss',

      // Ограничения
      availableOnce: true,        // 1 раз в день
      resetTime: '00:00',         // сброс в полночь
      requiresMinLevel: 5         // мин. уровень корабля
    },

    weekly_champion: {
      name: 'Чемпион арены',
      nameEn: 'Arena Champion',
      description: 'Еженедельный босс',
      fleet: [
        { tier: 3, type: 'TANK', level: 10 },
        { tier: 3, type: 'FIGHTER', level: 10 },
        { tier: 3, type: 'FIGHTER', level: 10 },
        { tier: 3, type: 'BOMBER', level: 10 },
        { tier: 3, type: 'SUPPORT', level: 10 }
      ],
      difficultyMultiplier: 2.0,  // x2
      aiStrategy: 'smart_targeting',
      rewardDifficulty: 'boss',
      rewardMultiplier: 3,        // x3 награда

      availableOnce: true,
      resetTime: 'monday_00:00',
      requiresMinLevel: 8
    }
  },

  // Настройки AI
  ai: {
    // Задержка между ходами (мс) - для визуализации
    turnDelay: 1000,

    // Вероятность ошибки AI (промах по слабой цели)
    mistakeChance: {
      easy: 0.2,    // 20% шанс ошибки
      medium: 0.1,  // 10%
      hard: 0.05    // 5%
    },

    // Агрессивность (шанс атаковать вместо защиты)
    aggressiveness: {
      easy: 0.7,    // 70% атака
      medium: 0.8,
      hard: 0.9
    }
  },

  // Генерация случайного флота бота (для вариативности)
  generateRandomFleet(difficulty, tier = 1) {
    const baseFleet = this.difficulties[difficulty].fleet;

    // Добавляем небольшую случайность в уровни (±1)
    return baseFleet.map(ship => ({
      ...ship,
      level: Math.max(1, ship.level + Math.floor(Math.random() * 3) - 1)
    }));
  },

  // Применение модификаторов сложности к флоту
  applyDifficultyModifier(ship, multiplier) {
    return {
      ...ship,
      hp: Math.floor(ship.hp * multiplier),
      maxHp: Math.floor(ship.maxHp * multiplier),
      damage: Math.floor(ship.damage * multiplier),
      armor: Math.floor(ship.armor * multiplier)
    };
  },

  // 🔥 НОВОЕ: Расчёт силы флота
  calculateFleetPower(fleet) {
    return fleet.reduce((total, ship) => {
      // Формула: (HP + Damage×2 + Armor) × Tier
      const tier = ship.tier || 1;
      const shipPower = (ship.hp + ship.damage * 2 + (ship.armor || 0)) * tier;
      return total + shipPower;
    }, 0);
  },

  // 🔥 НОВОЕ: Генерация адаптивного бота ±variance от силы игрока
  generateAdaptiveBot(playerFleet, variance = 0.05) {
    const shipsConfig = require('./ships.config');

    // Рассчитать силу флота игрока
    const playerPower = this.calculateFleetPower(playerFleet);
    console.log(`⚖️ Сила флота игрока: ${playerPower}`);

    // Целевая сила бота: ±variance от силы игрока
    const randomMod = 1 + (Math.random() * variance * 2 - variance);
    const targetPower = playerPower * randomMod;
    console.log(`🎯 Целевая сила бота: ${Math.floor(targetPower)} (${(randomMod * 100 - 100).toFixed(1)}%)`);

    // Генерируем флот бота
    const botFleet = [];
    let currentPower = 0;
    let shipIndex = 0;

    // Определяем средний tier игрока
    const avgTier = playerFleet.length > 0
      ? playerFleet.reduce((sum, s) => sum + (s.tier || 1), 0) / playerFleet.length
      : 1;

    // Генерируем корабли пока не достигнем целевой силы
    while (currentPower < targetPower && botFleet.length < 5) {
      // Выбираем случайный тип и tier близкий к игроку
      const types = ['FIGHTER', 'TANK', 'BOMBER', 'SUPPORT'];
      const type = types[Math.floor(Math.random() * types.length)];
      const tier = Math.max(1, Math.min(3, Math.floor(avgTier + Math.random() * 2 - 1)));
      const level = Math.max(1, Math.floor(Math.random() * 5) + 1);

      // Создаём корабль
      const stats = shipsConfig.calculateShipStats(tier, type, level);
      const ship = {
        id: `bot_${shipIndex++}`,
        ship_name: `Бот ${type} T${tier}`,
        ...stats,
        maxHp: stats.hp,
        tier
      };

      botFleet.push(ship);
      currentPower = this.calculateFleetPower(botFleet);
    }

    console.log(`🤖 Сгенерирован флот бота: ${botFleet.length} кораблей, сила ${currentPower}`);

    return {
      fleet: botFleet,
      power: currentPower,
      aiStrategy: 'smart_targeting',
      name: 'Адаптивный противник'
    };
  }
};
