/**
 * 🌌 GALACTIC EMPIRE - ОСНОВНЫЕ ИГРОВЫЕ ПАРАМЕТРЫ
 *
 * Все константы игры Galactic Empire v2.0
 */

module.exports = {
  // =====================================================
  // 💎 ВАЛЮТЫ И КУРСЫ
  // =====================================================
  currencies: {
    exchangeRates: {
      star: 100,      // 1 Star = 100 Luminios
      ton: 10000      // 1 TON = 10000 Luminios
    },
    limits: {
      minWithdrawal: 1000,
      minDeposit: 10,
      maxDailyWithdrawal: 100000
    }
  },

  // =====================================================
  // 🎭 СИСТЕМА РАС
  // =====================================================
  races: {
    // Выбор расы
    selection: {
      freeFirstTime: true,          // Первый выбор бесплатный
      changeCost: 50000,            // 50,000 Luminios для смены расы
      resetProgress: true,          // Смена расы сбрасывает прогресс
    },

    // Dual race (две расы одновременно)
    dualRace: {
      enabled: true,
      cost: 100000,                 // 100,000 Luminios
      separateProgress: true        // Отдельный прогресс для каждой расы
    }
  },

  // =====================================================
  // 🔧 РЕМОНТ КОРАБЛЕЙ
  // =====================================================
  repair: {
    // Авто-ремонт
    autoRepair: {
      enabled: true,
      hpPerInterval: 1,             // +1 HP за интервал
      intervalMinutes: 5,           // каждые 5 минут

      // Бонусы рас
      raceBonuses: {
        zerg: 2.5,                  // Зерги: каждые 2.5 минуты
        human: 4                    // Люди: каждые 4 минуты
      }
    },

    // Быстрый ремонт
    quickRepair: {
      costMultiplier: 0.5,          // 50% от цены корабля
      fullRepairDiscount: 0.10,     // 10% скидка на полный ремонт
      percentOptions: [25, 50, 75]
    }
  },

  // =====================================================
  // ⚔️ БОЕВАЯ СИСТЕМА
  // =====================================================
  battle: {
    // Режимы боя
    modes: {
      auto: {
        replaySpeed: 500,           // 500ms между атаками
        speeds: {
          slow: 1000,
          normal: 500,
          fast: 200
        }
      },
      manual: {
        turnTimeoutSeconds: 10,     // 10 секунд на ход
        idlePenalty: 'random_target' // AI выбирает случайную цель
      }
    },

    // Лимиты
    maxRounds: 50,
    tiebreaker: 'total_hp',          // или 'damage_dealt'

    // Урон и защита
    damageCalculation: {
      baseDamage: 'ship.damage',
      critChance: 0.10,               // 10% базовый шанс крита
      critMultiplier: 2.0,            // x2 урона при крите

      // Типы урона vs типы защиты
      effectiveness: {
        laser_vs_shield: 0.7,         // Лазеры слабы против щитов
        laser_vs_armor: 1.3,          // Лазеры сильны против брони
        missiles_vs_shield: 1.2,
        missiles_vs_armor: 0.9,
        drones_vs_shield: 1.0,
        drones_vs_armor: 1.0,
        artillery_vs_shield: 1.4,
        artillery_vs_armor: 0.8,
        biological_vs_shield: 0.9,
        biological_vs_armor: 1.1
      }
    }
  },

  // =====================================================
  // 🤖 PvE - БОИ С БОТАМИ
  // =====================================================
  pve: {
    adaptiveBot: {
      powerVariance: 0.05,            // ±5% от силы игрока
      rewardDivisor: 10,              // Награда = сила флота / 10

      bonuses: {
        perfectWin: 1.5,              // +50% если все корабли живы
        fastWin: 1.2,                 // +20% если меньше 3 раундов
        firstWin: 2.0                 // x2 за первую победу дня
      }
    }
  },

  // =====================================================
  // 👤 PvP - БОИ С ИГРОКАМИ
  // =====================================================
  pvp: {
    matchmaking: {
      maxPowerDifference: 0.05,       // ±5% разница в силе
      searchTimeout: 60,              // 60 секунд поиск
      rankingEnabled: true
    },

    betting: {
      limits: {
        luminios: { min: 10, max: 10000 },
        stars: { min: 1, max: 100 },
        ton: { min: 0.01, max: 1.0 }
      },
      houseCommission: 0.20,          // 20%
      requireEqualBets: true,
      escrowEnabled: true
    },

    types: {
      practice: {
        enabled: true,
        noStakes: true,
        rewardXP: true
      },
      ranked: {
        enabled: true,
        requireStakes: true,
        affectsRating: true
      }
    }
  },

  // =====================================================
  // 🎁 СИСТЕМА ЛУТА (ДОБЫЧА ОРУЖИЯ)
  // =====================================================
  loot: {
    weaponDrop: {
      baseChance: 0.01,               // 1% базовый шанс

      // Особые шансы для рас (СЕКРЕТНО!)
      raceChances: {
        human: 0.05,                  // 5% для людей (НЕ ПОКАЗЫВАТЬ!)
        amarr: 0.01,
        caldari: 0.01,
        gallente: 0.01,
        minmatar: 0.01,
        zerg: 0.01
      }
    },

    weaponSlots: 3,                   // У корабля 3 слота оружия
    canMixWeapons: true,              // Можно миксовать оружие разных рас

    // Редкость оружия
    rarity: {
      common: 0.70,                   // 70%
      rare: 0.20,                     // 20%
      epic: 0.08,                     // 8%
      legendary: 0.02                 // 2%
    }
  },

  // =====================================================
  // 📊 РАСЧЁТ СИЛЫ ФЛОТА
  // =====================================================
  fleetPower: {
    weights: {
      hp: 1.0,
      damage: 2.0,
      speed: 0.5,
      armor: 1.5,
      shield: 1.3
    }
  },

  // =====================================================
  // 🏆 НАГРАДЫ И ПРОГРЕСС
  // =====================================================
  rewards: {
    xp: {
      pveWin: 50,
      pveLoss: 10,
      pvpWin: 100,
      pvpLoss: 25
    },
    daily: {
      firstWinBonus: 2.0,
      loginBonus: 50
    }
  },

  // =====================================================
  // 🛡️ АНТИ-ЧИТ И БЕЗОПАСНОСТЬ
  // =====================================================
  security: {
    rateLimits: {
      battlesPerHour: 20,
      repairsPerHour: 10,
      pvpBetsPerDay: 50
    },
    validateAllMoves: true,
    logSuspiciousActivity: true,
    banThresholds: {
      invalidMoves: 5,
      timeoutAbuse: 10
    }
  },

  // =====================================================
  // 🐛 ZERG - ОСОБЫЕ ПРАВИЛА
  // =====================================================
  zergRules: {
    dailyCheck: {
      enabled: true,
      checkTime: '00:00',             // Проверка в полночь UTC
      penalty: {
        hpLoss: -10,                  // -10 HP за каждый пропущенный день
        maxDaysBeforeDeath: 10        // Через 10 дней корабли умирают
      },
      bonus: {
        streakDays: 7,                // Бонус за 7 дней подряд
        bonusReward: 500              // +500 Luminios
      }
    }
  }
};
