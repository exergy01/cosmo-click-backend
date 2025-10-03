/**
 * 🎮 COSMIC FLEET - ОСНОВНЫЕ ИГРОВЫЕ ПАРАМЕТРЫ
 *
 * Здесь хранятся все константы игры.
 * Изменение этих параметров влияет на баланс игры.
 */

module.exports = {
  // =====================================================
  // 💎 ВАЛЮТЫ И КУРСЫ
  // =====================================================
  currencies: {
    // Курсы обмена (базовая валюта - Luminios)
    exchangeRates: {
      star: 100,      // 1 Star = 100 Luminios
      ton: 10000      // 1 TON = 10000 Luminios
    },

    // Минимальные/максимальные суммы для операций
    limits: {
      minWithdrawal: 1000,     // минимум для вывода Luminios
      minDeposit: 10,          // минимум для депозита
      maxDailyWithdrawal: 100000 // лимит вывода в день
    }
  },

  // =====================================================
  // 🔧 РЕМОНТ КОРАБЛЕЙ
  // =====================================================
  repair: {
    // Авто-ремонт
    autoRepair: {
      enabled: true,
      hpPerInterval: 1,         // +1 HP за интервал
      intervalMinutes: 5,       // каждые 5 минут
      maxHP: 100                // до максимума
    },

    // Быстрый ремонт
    quickRepair: {
      // Стоимость = (цена_корабля / 2) / maxHP
      costMultiplier: 0.5,      // 50% от цены корабля

      // Скидки
      fullRepairDiscount: 0.10, // 10% скидка на полный ремонт

      // Предустановленные варианты процентного ремонта
      percentOptions: [25, 50, 75]
    }
  },

  // =====================================================
  // 🚢 ФОРМАЦИИ
  // =====================================================
  formations: {
    defaultSlots: 3,            // изначально доступно
    maxSlots: 5,                // максимум

    // Цены разблокировки слотов
    slotPrices: {
      4: 100,   // 4-й слот = 100 Luminios
      5: 200    // 5-й слот = 200 Luminios
    }
  },

  // =====================================================
  // ⚔️ БОЕВАЯ СИСТЕМА
  // =====================================================
  battle: {
    // Режимы боя
    modes: {
      auto: {
        replaySpeed: 500,         // 500ms между атаками
        speeds: {
          slow: 1000,
          normal: 500,
          fast: 200
        }
      },
      manual: {
        turnTimeoutSeconds: 10,   // 10 секунд на ход
        idlePenalty: 'auto'       // auto = AI выбирает случайную цель
      }
    },

    // Максимум раундов
    maxRounds: 50,

    // Тайбрейкер при ничьей
    tiebreaker: 'total_hp'  // 'total_hp' | 'damage_dealt'
  },

  // =====================================================
  // 🤖 PvE - БОИ С БОТАМИ
  // =====================================================
  pve: {
    // Адаптивный бот
    adaptiveBot: {
      powerVariance: 0.05,      // ±5% от силы игрока

      // Формула награды: floor(fleetPower / rewardDivisor)
      rewardDivisor: 10,        // базовая награда = сила / 10

      // Бонусные множители
      bonuses: {
        perfectWin: 1.5,        // +50% если все корабли живы
        fastWin: 1.2,           // +20% если меньше 3 раундов
        firstWin: 2.0           // x2 за первую победу дня
      }
    }
  },

  // =====================================================
  // 👤 PvP - БОИ С ИГРОКАМИ
  // =====================================================
  pvp: {
    // Балансировка
    matchmaking: {
      maxPowerDifference: 0.05, // ±5% разница в силе
      searchTimeout: 60,        // 60 секунд поиск
      rankingEnabled: true
    },

    // Ставки
    betting: {
      // Минимальные/максимальные ставки по валютам
      limits: {
        luminios: { min: 10, max: 10000 },
        stars: { min: 1, max: 100 },
        ton: { min: 0.01, max: 1.0 }
      },

      // Комиссия дома
      houseCommission: 0.20,    // 20%

      // Защита от скама
      requireEqualBets: true,   // оба ставят одинаково
      escrowEnabled: true       // ставки блокируются до конца боя
    },

    // Типы PvP боёв
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
  // 📊 РАСЧЁТ СИЛЫ ФЛОТА
  // =====================================================
  fleetPower: {
    // Веса характеристик
    weights: {
      hp: 1.0,
      damage: 2.0,
      speed: 0.5,
      armor: 1.5
    },

    // Формула: sum(hp*1 + damage*2 + speed*0.5 + armor*1.5)
    calculatePower: function(ship) {
      return (
        ship.hp * this.weights.hp +
        ship.damage * this.weights.damage +
        ship.speed * this.weights.speed +
        ship.armor * this.weights.armor
      );
    }
  },

  // =====================================================
  // 🏆 НАГРАДЫ И ПРОГРЕСС
  // =====================================================
  rewards: {
    // XP за бои
    xp: {
      pveWin: 50,
      pveLoss: 10,
      pvpWin: 100,
      pvpLoss: 25
    },

    // Ежедневные бонусы
    daily: {
      firstWinBonus: 2.0,       // x2 Luminios за первую победу
      loginBonus: 50            // +50 Luminios за ежедневный вход
    }
  },

  // =====================================================
  // 🛡️ АНТИ-ЧИТ И БЕЗОПАСНОСТЬ
  // =====================================================
  security: {
    // Лимиты на действия
    rateLimits: {
      battlesPerHour: 20,       // макс 20 боёв в час
      repairsPerHour: 10,       // макс 10 ремонтов в час
      pvpBetsPerDay: 50         // макс 50 ставок в день
    },

    // Валидация
    validateAllMoves: true,     // проверка каждого хода
    logSuspiciousActivity: true,

    // Бан система
    banThresholds: {
      invalidMoves: 5,          // 5 невалидных ходов = предупреждение
      timeoutAbuse: 10          // 10 таймаутов = временный бан
    }
  }
};
