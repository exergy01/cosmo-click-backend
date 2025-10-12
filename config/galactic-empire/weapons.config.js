/**
 * ⚔️ GALACTIC EMPIRE - WEAPON SYSTEM CONFIG
 * Конфигурация всех типов оружия по расам
 */

const WEAPONS = {
  // 🔴 AMARR - Лазеры (энергетическое оружие)
  laser: {
    name: 'Laser',
    nameRu: 'Лазер',
    race: 'amarr',
    baseDamage: 45,
    accuracy: 0.95, // 95% точность
    cooldown: 3000, // 3 секунды
    energyCost: 20, // Требует энергию конденсатора
    special: 'capacitor_dependent', // Зависит от энергии
    description: 'Высокая точность, средний урон, зависит от энергии',
    damageType: 'em_thermal' // Электромагнитный + термический
  },

  // 🔵 CALDARI - Ракеты
  missile: {
    name: 'Missile',
    nameRu: 'Ракета',
    race: 'caldari',
    baseDamage: 60,
    accuracy: 0.85, // 85% точность
    cooldown: 5000, // 5 секунд
    aoeRadius: 50, // AOE урон в радиусе 50 единиц
    aoeDamagePercent: 0.3, // 30% урона по соседним целям
    special: 'aoe_damage',
    description: 'Высокий урон, AOE, низкая скорость',
    damageType: 'kinetic_explosive'
  },

  // 🟢 GALLENTE - Плазма
  plasma: {
    name: 'Plasma',
    nameRu: 'Плазма',
    race: 'gallente',
    baseDamage: 70,
    accuracy: 0.80, // 80% точность
    cooldown: 4000, // 4 секунды
    armorPenetration: 0.25, // 25% пробитие брони
    special: 'armor_penetration',
    description: 'Очень высокий урон, пробитие брони, низкая точность',
    damageType: 'thermal_kinetic'
  },

  // 🟡 MINMATAR - Снаряды (проджектилы)
  projectile: {
    name: 'Projectile',
    nameRu: 'Снаряд',
    race: 'minmatar',
    baseDamage: 35,
    accuracy: 0.90, // 90% точность
    cooldown: 2000, // 2 секунды
    rapidFire: true, // Быстрая стрельба
    criticalChance: 0.15, // 15% шанс критического урона
    criticalMultiplier: 2.0, // x2 урон при крите
    special: 'rapid_fire_critical',
    description: 'Быстрая стрельба, средний урон, шанс крита',
    damageType: 'explosive_kinetic'
  },

  // 👨 HUMAN - Баллистика (комбинированное оружие)
  ballistic: {
    name: 'Ballistic',
    nameRu: 'Баллистика',
    race: 'human',
    baseDamage: 50,
    accuracy: 0.88, // 88% точность
    cooldown: 3500, // 3.5 секунды
    versatile: true, // Универсальное против всех типов
    shieldBonus: 1.15, // +15% урона по щитам
    special: 'versatile_balanced',
    description: 'Сбалансированное оружие, эффективно против щитов',
    damageType: 'kinetic_explosive'
  },

  // 👽 ZERG - Биологическое оружие (органика)
  bio: {
    name: 'Bio',
    nameRu: 'Био-оружие',
    race: 'zerg',
    baseDamage: 55,
    accuracy: 0.92, // 92% точность
    cooldown: 2500, // 2.5 секунды
    damageOverTime: 12, // 12 урона в секунду
    dotDuration: 3000, // 3 секунды DOT
    armorCorrosion: 0.15, // 15% коррозия брони (снижение защиты)
    special: 'dot_corrosion',
    description: 'Урон со временем + коррозия брони цели',
    damageType: 'thermal_toxic'
  }
};

// 🚀 ТОРПЕДЫ (тяжелые ракеты для больших кораблей)
const TORPEDOES = {
  heavy_torpedo: {
    name: 'Heavy Torpedo',
    nameRu: 'Тяжелая торпеда',
    baseDamage: 150,
    accuracy: 0.70, // Низкая точность против маленьких целей
    cooldown: 10000, // 10 секунд
    aoeRadius: 100,
    aoeDamagePercent: 0.5, // 50% урона по соседним
    shipClassRequired: ['cruiser', 'battleship'], // Только большие корабли
    description: 'Огромный урон, долгая перезарядка, AOE',
    damageType: 'explosive'
  },

  light_torpedo: {
    name: 'Light Torpedo',
    nameRu: 'Легкая торпеда',
    baseDamage: 80,
    accuracy: 0.80,
    cooldown: 6000,
    aoeRadius: 60,
    aoeDamagePercent: 0.4,
    shipClassRequired: ['destroyer', 'cruiser'],
    description: 'Средний урон, средняя перезарядка',
    damageType: 'explosive'
  }
};

// 📡 СИСТЕМЫ РЭБ (Радиоэлектронная Борьба)
const EW_SYSTEMS = {
  // Сканер - снижает уклонение врага
  target_painter: {
    name: 'Target Painter',
    nameRu: 'Целеуказатель',
    effect: 'reduce_evasion',
    power: 0.30, // Снижает уклонение на 30%
    duration: 5000, // 5 секунд
    cooldown: 15000, // 15 секунд
    range: 1, // На 1 цель
    description: 'Снижает уклонение цели на 30%'
  },

  // Глушилка - снижает точность врага
  ecm_jammer: {
    name: 'ECM Jammer',
    nameRu: 'Глушилка',
    effect: 'reduce_accuracy',
    power: 0.40, // Снижает точность на 40%
    duration: 6000,
    cooldown: 18000,
    range: 2, // На 2 цели
    description: 'Снижает точность 2 врагов на 40%'
  },

  // Нейтрализатор - истощает энергию
  energy_neutralizer: {
    name: 'Energy Neutralizer',
    nameRu: 'Нейтрализатор',
    effect: 'drain_energy',
    power: 40, // Отнимает 40 энергии
    duration: 0, // Мгновенный эффект
    cooldown: 12000,
    range: 1,
    description: 'Отнимает энергию у цели (против Amarr)'
  },

  // Веб - снижает скорость
  stasis_webifier: {
    name: 'Stasis Webifier',
    nameRu: 'Замедлитель',
    effect: 'reduce_speed',
    power: 0.60, // Снижает скорость на 60%
    duration: 8000,
    cooldown: 20000,
    range: 1,
    description: 'Снижает скорость цели на 60%'
  },

  // Щит - увеличивает защиту
  shield_booster: {
    name: 'Shield Booster',
    nameRu: 'Усилитель щита',
    effect: 'boost_defense',
    power: 50, // +50 к защите
    duration: 10000,
    cooldown: 25000,
    range: 0, // На себя
    description: 'Временно увеличивает защиту на 50'
  }
};

// ⚙️ МОДИФИКАТОРЫ УРОНА ПО КЛАССАМ КОРАБЛЕЙ
const DAMAGE_MODIFIERS = {
  // Большие корабли получают больше урона от торпед
  battleship: {
    vs_torpedo: 1.5, // +50% урона от торпед
    vs_laser: 1.0,
    vs_missile: 1.2,
    vs_plasma: 1.1,
    vs_projectile: 1.0,
    vs_ballistic: 1.0,
    vs_bio: 0.9 // Bio менее эффективно против больших кораблей
  },

  cruiser: {
    vs_torpedo: 1.3,
    vs_laser: 1.0,
    vs_missile: 1.1,
    vs_plasma: 1.0,
    vs_projectile: 1.0,
    vs_ballistic: 1.0,
    vs_bio: 1.0
  },

  destroyer: {
    vs_torpedo: 0.8, // -20% урона от торпед (маленькая цель)
    vs_laser: 1.0,
    vs_missile: 0.9,
    vs_plasma: 1.0,
    vs_projectile: 1.1,
    vs_ballistic: 1.0,
    vs_bio: 1.1
  },

  frigate: {
    vs_torpedo: 0.5, // -50% урона от торпед (очень маленькая)
    vs_laser: 1.0,
    vs_missile: 0.7,
    vs_plasma: 0.9,
    vs_projectile: 1.2, // Снаряды эффективны против фрегатов
    vs_ballistic: 1.1,
    vs_bio: 1.2 // Bio очень эффективно против маленьких кораблей
  }
};

// 🎯 ФОРМУЛЫ РАСЧЕТА УРОНА
const FORMULAS = {
  /**
   * Базовый расчет урона
   * @param {Object} weapon - Оружие атакующего
   * @param {Object} attacker - Корабль атакующего
   * @param {Object} defender - Корабль защитника
   * @returns {number} - Итоговый урон
   */
  calculateDamage(weapon, attacker, defender) {
    let damage = weapon.baseDamage;

    // 1. Модификатор атаки корабля
    damage += attacker.attack * 0.5;

    // 2. Проверка попадания
    const hitChance = this.calculateHitChance(weapon, attacker, defender);
    if (Math.random() > hitChance) {
      return 0; // Промах
    }

    // 3. Критический урон (для projectile)
    if (weapon.criticalChance && Math.random() < weapon.criticalChance) {
      damage *= weapon.criticalMultiplier;
    }

    // 4. Пробитие брони (для plasma)
    let effectiveDefense = defender.defense;
    if (weapon.armorPenetration) {
      effectiveDefense *= (1 - weapon.armorPenetration);
    }

    // 5. Применяем защиту
    damage = Math.max(damage - effectiveDefense * 0.3, damage * 0.2);

    // 6. Модификатор по классу корабля
    const classModifier = DAMAGE_MODIFIERS[defender.ship_class]?.[`vs_${weapon.name.toLowerCase()}`] || 1.0;
    damage *= classModifier;

    return Math.floor(damage);
  },

  /**
   * Расчет шанса попадания
   */
  calculateHitChance(weapon, attacker, defender) {
    let baseAccuracy = weapon.accuracy;

    // Скорость цели влияет на уклонение
    const evasionBonus = defender.speed / 1000; // Чем выше скорость, тем больше уклонение
    const finalAccuracy = baseAccuracy - evasionBonus;

    return Math.max(0.1, Math.min(0.99, finalAccuracy)); // От 10% до 99%
  },

  /**
   * Расчет AOE урона для ракет и торпед
   */
  calculateAOEDamage(weapon, primaryDamage, isSecondaryTarget) {
    if (!weapon.aoeRadius || !isSecondaryTarget) {
      return primaryDamage;
    }

    return Math.floor(primaryDamage * weapon.aoeDamagePercent);
  }
};

module.exports = {
  WEAPONS,
  TORPEDOES,
  EW_SYSTEMS,
  DAMAGE_MODIFIERS,
  FORMULAS
};
