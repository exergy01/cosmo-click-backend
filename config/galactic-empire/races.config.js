/**
 * 🌌 GALACTIC EMPIRE - КОНФИГУРАЦИЯ РАС
 *
 * Все расы и их особенности
 */

module.exports = {
  // =====================================================
  // 🏛️ AMARR EMPIRE
  // =====================================================
  amarr: {
    id: 'amarr',
    name: 'Amarr Empire',
    nameRu: 'Империя Амарр',
    description: 'Золотые корабли с мощной броней. Религиозная империя с лазерным оружием.',
    descriptionRu: 'Золотые, светлые корабли с арками и куполами. Религиозно-монументальный стиль.',

    // Визуальный стиль
    color: '#FFD700',
    secondaryColor: '#FFA500',

    // Основное оружие
    weaponType: 'laser',
    weaponName: 'Лазеры',

    // Бонусы расы
    bonuses: {
      armor: 1.2,           // +20% к броне
      energyDamage: 1.15,   // +15% урон энергетическим оружием
      shield: 0.9           // -10% к щитам (слабость)
    },

    // Особенность
    specialAbility: {
      name: 'Божественный свет',
      description: '10% шанс полностью игнорировать урон',
      chance: 0.10
    },

    // Доступные корабли (будут добавлены позже)
    availableShips: []
  },

  // =====================================================
  // 🔵 CALDARI STATE
  // =====================================================
  caldari: {
    id: 'caldari',
    name: 'Caldari State',
    nameRu: 'Государство Калдари',
    description: 'Милитаристские корабли с мощными щитами и ракетами.',
    descriptionRu: 'Тёмно-серые, синие корабли. Угловатые, военно-корпоративный стиль.',

    color: '#4169E1',
    secondaryColor: '#1E90FF',

    weaponType: 'missiles',
    weaponName: 'Ракеты',

    bonuses: {
      shield: 1.25,         // +25% к щитам
      missileDamage: 1.10,  // +10% урон ракетами
      armor: 0.85           // -15% к броне (слабость)
    },

    specialAbility: {
      name: 'Залп ракет',
      description: '15% шанс выстрелить дважды',
      chance: 0.15
    },

    availableShips: []
  },

  // =====================================================
  // 🟢 GALLENTE FEDERATION
  // =====================================================
  gallente: {
    id: 'gallente',
    name: 'Gallente Federation',
    nameRu: 'Федерация Галленте',
    description: 'Универсальные корабли с дронами и гибридными пушками.',
    descriptionRu: 'Металлик с зелёными и синими тонами. Округлые формы.',

    color: '#32CD32',
    secondaryColor: '#00CED1',

    weaponType: 'hybrid_drones',
    weaponName: 'Дроны',

    bonuses: {
      hull: 1.15,           // +15% к корпусу
      droneDamage: 1.20,    // +20% урон дронами
      speed: 1.10           // +10% к скорости
    },

    specialAbility: {
      name: 'Рой дронов',
      description: 'Дроны атакуют всех врагов сразу (50% урона)',
      chance: 0.12
    },

    availableShips: []
  },

  // =====================================================
  // 🔴 MINMATAR REPUBLIC
  // =====================================================
  minmatar: {
    id: 'minmatar',
    name: 'Minmatar Republic',
    nameRu: 'Республика Минматар',
    description: 'Быстрые корабли с мощной артиллерией.',
    descriptionRu: 'Коричнево-серые, красные. Индустриальные, сваренные из кусков металла.',

    color: '#DC143C',
    secondaryColor: '#8B4513',

    weaponType: 'artillery',
    weaponName: 'Артиллерия',

    bonuses: {
      speed: 1.30,          // +30% к скорости
      alphaDamage: 1.25,    // +25% разовый урон
      armor: 0.90           // -10% к броне
    },

    specialAbility: {
      name: 'Критический выстрел',
      description: '20% шанс нанести x3 урона',
      chance: 0.20
    },

    availableShips: []
  },

  // =====================================================
  // 👤 HUMAN ALLIANCE (секретный бонус)
  // =====================================================
  human: {
    id: 'human',
    name: 'Human Alliance',
    nameRu: 'Альянс Людей',
    description: 'Универсальные корабли землян. Сбалансированные характеристики.',
    descriptionRu: 'Корабли людей с Земли. Универсальный стиль и вооружение.',

    color: '#00f0ff',
    secondaryColor: '#0080ff',

    weaponType: 'ballistic',
    weaponName: 'Баллистика',

    bonuses: {
      lootChance: 1.05,     // +5% к луту (СКРЫТО!)
      versatility: 1.10,    // +10% ко всем характеристикам
      repair: 1.15          // +15% к скорости ремонта
    },

    specialAbility: {
      name: 'Адаптация',
      description: 'Получает временный бонус против типа оружия противника',
      adaptBonus: 1.15
    },

    // СЕКРЕТНЫЙ БОНУС - НЕ ПОКАЗЫВАТЬ ИГРОКАМ!
    hiddenBonus: {
      lootDropRate: 0.05    // 5% вместо 1% на выпадение оружия
    },

    availableShips: []
  },

  // =====================================================
  // 🐛 ZERG SWARM
  // =====================================================
  zerg: {
    id: 'zerg',
    name: 'Zerg Swarm',
    nameRu: 'Рой Зергов',
    description: 'Биологические корабли. Требуют ежедневного входа.',
    descriptionRu: 'Органические корабли-существа. Быстрая регенерация, но требуют "кормления".',

    color: '#9D4EDD',
    secondaryColor: '#7B2CBF',

    weaponType: 'biological',
    weaponName: 'Био-оружие',

    bonuses: {
      regeneration: 2,      // +1 HP каждые 2.5 минуты (вместо 5)
      swarmDamage: 1.15,    // +15% урона при 3+ кораблях
      poison: 0.10          // 10% шанс отравить (DoT)
    },

    specialAbility: {
      name: 'Заражение',
      description: 'Враг получает урон в течение 3 раундов',
      damagePerTurn: 5
    },

    // Особые требования
    requirements: {
      dailyLoginRequired: true,
      dailyLoginPenalty: {
        type: 'health_decay',
        value: -10           // -10 HP всем кораблям за каждый день пропуска
      }
    },

    availableShips: []
  }
};
