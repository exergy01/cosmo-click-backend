/**
 * 🚀 КОНФИГ КОРАБЛЕЙ - GALACTIC EMPIRE
 *
 * Классы кораблей (по подобию EVE Online):
 * - Frigate (Фрегат) - быстрый, маневренный, дешёвый
 * - Destroyer (Эсминец) - больше урона, средняя защита
 * - Cruiser (Крейсер) - сбалансированный боевой корабль
 * - Battleship (Линкор) - тяжёлая броня и мощное оружие
 * - Capital (Капитальный) - премиум корабли за реальные деньги
 * - Drones (Дроны) - автономные боевые единицы
 * - Torpedoes (Торпеды) - дальнобойные снаряды
 * - REB (РЭБ) - электронное подавление
 * - AI (ИИ) - командные системы с ИИ
 */

module.exports = {
  // =====================================================
  // FRIGATE - ФРЕГАТЫ (TIER 1-2)
  // =====================================================
  frigate_t1: {
    id: 'frigate_t1',
    class: 'frigate',
    tier: 1,
    name: 'Light Frigate',
    nameRu: 'Лёгкий фрегат',
    description: '🚀 Fast and maneuverable scout ship. Low cost, perfect for beginners.',
    descriptionRu: '🚀 Быстрый и маневренный разведывательный корабль. Низкая цена, идеален для новичков.',

    cost: {
      luminios: 500
    },

    baseStats: {
      hp: 1000,
      attack: 100,
      defense: 50,
      speed: 100
    },

    requirements: {
      level: 1
    },

    buildTime: 5 // секунды
  },

  frigate_t2: {
    id: 'frigate_t2',
    class: 'frigate',
    tier: 2,
    name: 'Assault Frigate',
    nameRu: 'Штурмовой фрегат',
    description: '⚡ Enhanced combat frigate with improved weapons and armor.',
    descriptionRu: '⚡ Улучшенный боевой фрегат с усиленным вооружением и бронёй.',

    cost: {
      luminios: 1200
    },

    baseStats: {
      hp: 1500,
      attack: 150,
      defense: 80,
      speed: 90
    },

    requirements: {
      level: 1
    },

    buildTime: 10 // секунды
  },

  // =====================================================
  // DESTROYER - ЭСМИНЦЫ (TIER 1-2)
  // =====================================================
  destroyer_t1: {
    id: 'destroyer_t1',
    class: 'destroyer',
    tier: 1,
    name: 'Light Destroyer',
    nameRu: 'Лёгкий эсминец',
    description: '💥 Anti-frigate vessel with enhanced firepower.',
    descriptionRu: '💥 Противофрегатный корабль с усиленной огневой мощью.',

    cost: {
      luminios: 2500
    },

    baseStats: {
      hp: 2500,
      attack: 250,
      defense: 120,
      speed: 70
    },

    requirements: {
      level: 3
    },

    buildTime: 30 // секунды
  },

  destroyer_t2: {
    id: 'destroyer_t2',
    class: 'destroyer',
    tier: 2,
    name: 'Heavy Destroyer',
    nameRu: 'Тяжёлый эсминец',
    description: '🎯 Heavily armed destroyer with superior tracking systems.',
    descriptionRu: '🎯 Тяжеловооружённый эсминец с превосходными системами наведения.',

    cost: {
      luminios: 5000
    },

    baseStats: {
      hp: 3500,
      attack: 350,
      defense: 180,
      speed: 60
    },

    requirements: {
      level: 5
    },

    buildTime: 60 // секунды (1 мин)
  },

  // =====================================================
  // CRUISER - КРЕЙСЕРЫ (TIER 1-2)
  // =====================================================
  cruiser_t1: {
    id: 'cruiser_t1',
    class: 'cruiser',
    tier: 1,
    name: 'Combat Cruiser',
    nameRu: 'Боевой крейсер',
    description: '⚔️ Balanced warship for prolonged engagements.',
    descriptionRu: '⚔️ Сбалансированный военный корабль для длительных сражений.',

    cost: {
      luminios: 10000
    },

    baseStats: {
      hp: 6000,
      attack: 500,
      defense: 300,
      speed: 50
    },

    requirements: {
      level: 8
    },

    buildTime: 300 // секунды (5 мин)
  },

  cruiser_t2: {
    id: 'cruiser_t2',
    class: 'cruiser',
    tier: 2,
    name: 'Heavy Assault Cruiser',
    nameRu: 'Тяжёлый штурмовой крейсер',
    description: '🔥 Elite cruiser with devastating firepower.',
    descriptionRu: '🔥 Элитный крейсер с сокрушительной огневой мощью.',

    cost: {
      luminios: 20000
    },

    baseStats: {
      hp: 9000,
      attack: 750,
      defense: 450,
      speed: 45
    },

    requirements: {
      level: 12
    },

    buildTime: 600 // секунды (10 мин)
  },

  // =====================================================
  // BATTLESHIP - ЛИНКОРЫ (TIER 1-2)
  // =====================================================
  battleship_t1: {
    id: 'battleship_t1',
    class: 'battleship',
    tier: 1,
    name: 'Battleship',
    nameRu: 'Линкор',
    description: '🛡️ Massive warship with heavy armor and weapons.',
    descriptionRu: '🛡️ Массивный военный корабль с тяжёлой бронёй и вооружением.',

    cost: {
      luminios: 40000
    },

    baseStats: {
      hp: 15000,
      attack: 1200,
      defense: 700,
      speed: 30
    },

    requirements: {
      level: 15
    },

    buildTime: 1800 // секунды (30 мин)
  },

  battleship_t2: {
    id: 'battleship_t2',
    class: 'battleship',
    tier: 2,
    name: 'Dreadnought',
    nameRu: 'Дредноут',
    description: '💀 Ultimate battleship designed to dominate the battlefield.',
    descriptionRu: '💀 Высший линкор, созданный для господства на поле боя.',

    cost: {
      luminios: 80000
    },

    baseStats: {
      hp: 25000,
      attack: 2000,
      defense: 1200,
      speed: 25
    },

    requirements: {
      level: 20
    },

    buildTime: 3600 // секунды (1 час)
  },

  // =====================================================
  // PREMIUM - ПРЕМИУМ КОРАБЛИ
  // =====================================================
  premium_t1: {
    id: 'premium_t1',
    class: 'premium',
    tier: 1,
    name: 'Carrier',
    nameRu: 'Авианосец',
    description: '✈️ Fleet carrier capable of deploying squadrons. Premium ship. One per formation.',
    descriptionRu: '✈️ Флотский авианосец, способный развёртывать эскадрильи. Премиум корабль. Один на формацию.',

    cost: {
      luminios: 0,
      premium: true // Покупается за реальные деньги
    },

    baseStats: {
      hp: 40000,
      attack: 3000,
      defense: 2000,
      speed: 15
    },

    requirements: {
      level: 25
    },

    limitPerFormation: 1,
    buildTime: 5 // секунды (премиум = быстро)
  },

  premium_t2: {
    id: 'premium_t2',
    class: 'premium',
    tier: 2,
    name: 'Titan',
    nameRu: 'Титан',
    description: '👑 Colossal flagship with unmatched power. Premium ship. One per formation.',
    descriptionRu: '👑 Колоссальный флагман с непревзойдённой мощью. Премиум корабль. Один на формацию.',

    cost: {
      luminios: 0,
      premium: true // Покупается за реальные деньги
    },

    baseStats: {
      hp: 70000,
      attack: 5000,
      defense: 3500,
      speed: 10
    },

    requirements: {
      level: 30
    },

    limitPerFormation: 1,
    buildTime: 5 // секунды (премиум = быстро)
  },

  // =====================================================
  // DRONES - ДРОНЫ (3 типа)
  // =====================================================
  drone_antimosquito: {
    id: 'drone_antimosquito',
    class: 'drones',
    tier: 1,
    name: 'Anti-Mosquito Drone',
    nameRu: 'Антимоскитный дрон',
    description: '🛡️ Defensive drone that intercepts enemy torpedoes and small craft.',
    descriptionRu: '🛡️ Защитный дрон, перехватывающий вражеские торпеды и малые суда.',

    cost: {
      luminios: 300
    },

    baseStats: {
      hp: 400,
      attack: 50,
      defense: 80,
      speed: 140
    },

    requirements: {
      level: 1
    },

    special: 'Intercepts torpedoes with 30% chance',
    buildTime: 5 // секунды
  },

  drone_repair: {
    id: 'drone_repair',
    class: 'drones',
    tier: 1,
    name: 'Repair Drone',
    nameRu: 'Ремонтный дрон',
    description: '🔧 Support drone that repairs damaged ships during combat.',
    descriptionRu: '🔧 Вспомогательный дрон, ремонтирующий повреждённые корабли в бою.',

    cost: {
      luminios: 500
    },

    baseStats: {
      hp: 300,
      attack: 0,
      defense: 50,
      speed: 100
    },

    requirements: {
      level: 3
    },

    special: 'Repairs 50 HP per turn to random damaged ship',
    buildTime: 8 // секунды
  },

  drone_assault: {
    id: 'drone_assault',
    class: 'drones',
    tier: 1,
    name: 'Assault Drone',
    nameRu: 'Штурмовой дрон',
    description: '💎 Boarding drone that steals enemy technology and parts.',
    descriptionRu: '💎 Абордажный дрон, ворующий вражеские технологии и запчасти.',

    cost: {
      luminios: 800
    },

    baseStats: {
      hp: 600,
      attack: 100,
      defense: 40,
      speed: 120
    },

    requirements: {
      level: 5
    },

    special: 'On kill: 15% chance to steal enemy tech/parts',
    buildTime: 10 // секунды
  },

  // =====================================================
  // TORPEDOES - ТОРПЕДЫ (3 типа)
  // =====================================================
  torpedo_standard: {
    id: 'torpedo_standard',
    class: 'torpedoes',
    tier: 1,
    name: 'Standard Torpedo',
    nameRu: 'Обычная торпеда',
    description: '🚀 Basic long-range guided missile.',
    descriptionRu: '🚀 Базовая дальнобойная управляемая ракета.',

    cost: {
      luminios: 400
    },

    baseStats: {
      hp: 150,
      attack: 250,
      defense: 5,
      speed: 160
    },

    requirements: {
      level: 2
    },

    buildTime: 5 // секунды
  },

  torpedo_reb: {
    id: 'torpedo_reb',
    class: 'torpedoes',
    tier: 1,
    name: 'ECM Torpedo',
    nameRu: 'РЭБ торпеда',
    description: '📡 Electronic warfare torpedo that disrupts enemy systems.',
    descriptionRu: '📡 Торпеда радиоэлектронной борьбы, нарушающая системы противника.',

    cost: {
      luminios: 600
    },

    baseStats: {
      hp: 100,
      attack: 100,
      defense: 10,
      speed: 150
    },

    requirements: {
      level: 4
    },

    special: 'Reduces enemy accuracy by 20% for 2 turns',
    buildTime: 10 // секунды
  },

  torpedo_antimatter: {
    id: 'torpedo_antimatter',
    class: 'torpedoes',
    tier: 2,
    name: 'Antimatter Torpedo',
    nameRu: 'Антиматерийная торпеда',
    description: '💣 Devastating antimatter warhead with massive damage.',
    descriptionRu: '💣 Разрушительная антиматерийная боеголовка с огромным уроном.',

    cost: {
      luminios: 2000
    },

    baseStats: {
      hp: 200,
      attack: 800,
      defense: 10,
      speed: 130
    },

    requirements: {
      level: 10
    },

    special: 'Deals AOE damage to nearby ships',
    buildTime: 15 // секунды
  },

  // =====================================================
  // REB - ЭЛЕКТРОННАЯ ВОЙНА
  // =====================================================
  reb_system_t1: {
    id: 'reb_system_t1',
    class: 'reb',
    tier: 1,
    name: 'ECM System',
    nameRu: 'Система РЭБ',
    description: '📡 Electronic countermeasure system that protects fleet from torpedoes.',
    descriptionRu: '📡 Система радиоэлектронного противодействия, защищающая флот от торпед.',

    cost: {
      luminios: 5000
    },

    baseStats: {
      hp: 1000,
      attack: 0,
      defense: 300,
      speed: 0
    },

    requirements: {
      level: 6
    },

    special: 'Deflects enemy torpedoes with 40% chance',
    buildTime: 600 // секунды (10 мин)
  },

  reb_system_t2: {
    id: 'reb_system_t2',
    class: 'reb',
    tier: 2,
    name: 'Advanced ECM System',
    nameRu: 'Продвинутая система РЭБ',
    description: '⚠️ Advanced electronic warfare platform with full spectrum jamming.',
    descriptionRu: '⚠️ Продвинутая система электронной войны с полным спектром подавления.',

    cost: {
      luminios: 15000
    },

    baseStats: {
      hp: 2000,
      attack: 0,
      defense: 500,
      speed: 0
    },

    requirements: {
      level: 12
    },

    special: 'Deflects enemy torpedoes with 60% chance + reduces enemy accuracy by 10%',
    buildTime: 1200 // секунды (20 мин)
  },

  // =====================================================
  // AI - ИСКУССТВЕННЫЙ ИНТЕЛЛЕКТ
  // =====================================================
  ai_system_t1: {
    id: 'ai_system_t1',
    class: 'ai',
    tier: 1,
    name: 'AI Combat System',
    nameRu: 'ИИ боевая система',
    description: '🧠 AI-controlled combat system for automated battles.',
    descriptionRu: '🧠 Боевая система с ИИ для автоматических сражений.',

    cost: {
      luminios: 10000
    },

    baseStats: {
      hp: 0,
      attack: 0,
      defense: 0,
      speed: 0
    },

    requirements: {
      level: 8
    },

    special: 'Enables auto-battle mode',
    buildTime: 900 // секунды (15 мин)
  },

  ai_system_t2: {
    id: 'ai_system_t2',
    class: 'ai',
    tier: 2,
    name: 'Advanced AI System',
    nameRu: 'Продвинутая ИИ система',
    description: '🌟 Advanced tactical AI with strategic optimization.',
    descriptionRu: '🌟 Продвинутый тактический ИИ со стратегической оптимизацией.',

    cost: {
      luminios: 30000
    },

    baseStats: {
      hp: 0,
      attack: 0,
      defense: 0,
      speed: 0
    },

    requirements: {
      level: 18
    },

    special: 'Enables auto-battle mode + 15% better tactical decisions',
    buildTime: 1800 // секунды (30 мин)
  }
};
