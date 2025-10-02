/**
 * ⚔️ COSMIC FLEET - BATTLE CONFIGURATION
 *
 * Все формулы боя, расчёт урона, критов, побед
 */

module.exports = {
  // Формула расчёта урона
  damage: {
    // Базовая формула: damage * (1 - armor_reduction) * random * crit
    armorReductionFormula: (attackerDamage, defenderArmor) => {
      // Броня снижает урон: каждые 10 брони = -10% урона, но не больше 80%
      const reduction = Math.min(defenderArmor / 10 * 0.1, 0.8);
      return attackerDamage * (1 - reduction);
    },

    // Случайность урона ±20%
    randomRange: [0.8, 1.2],

    // Критический удар
    critChance: 0.15,        // 15% шанс крита
    critMultiplier: 1.5,     // x1.5 урон при крите

    // Минимальный урон (всегда наносится хотя бы 1)
    minDamage: 1
  },

  // Очерёдность атак
  turnOrder: {
    // Сортировка по скорости (больше = первым ходит)
    sortBy: 'speed',

    // First strike (атакует первым, игнорируя скорость)
    firstStrikeTypes: ['FIGHTER'],

    // Контратака (атакует в ответ, если выжил)
    counterAttack: true,
    counterDamageMultiplier: 0.5 // контратака наносит 50% урона
  },

  // Таргетинг (выбор цели)
  targeting: {
    // Стратегии AI для ботов
    strategies: {
      random: {
        name: 'Случайная цель',
        selectTarget: (enemies) => {
          const aliveEnemies = enemies.filter(e => e.hp > 0);
          return aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
        }
      },

      focus_weakest: {
        name: 'Фокус на слабейшего',
        selectTarget: (enemies) => {
          const aliveEnemies = enemies.filter(e => e.hp > 0);
          return aliveEnemies.reduce((weakest, current) =>
            current.hp < weakest.hp ? current : weakest
          );
        }
      },

      focus_strongest: {
        name: 'Фокус на сильнейшего',
        selectTarget: (enemies) => {
          const aliveEnemies = enemies.filter(e => e.hp > 0);
          return aliveEnemies.reduce((strongest, current) =>
            current.damage > strongest.damage ? current : strongest
          );
        }
      },

      smart_targeting: {
        name: 'Умный таргетинг',
        selectTarget: (enemies, attacker) => {
          const aliveEnemies = enemies.filter(e => e.hp > 0);

          // Приоритет: убить того, кого можем убить за 1 удар
          const killable = aliveEnemies.find(e => e.hp <= attacker.damage);
          if (killable) return killable;

          // Иначе бьём самого опасного (высокий урон)
          return aliveEnemies.reduce((strongest, current) =>
            current.damage > strongest.damage ? current : strongest
          );
        }
      }
    },

    // Стратегия по умолчанию для игрока (пока автобой)
    playerDefaultStrategy: 'smart_targeting'
  },

  // Условия победы
  victory: {
    // Побеждает тот, у кого остались живые корабли
    allShipsDestroyed: true,

    // Лимит раундов (чтобы бой не длился вечно)
    maxRounds: 50,

    // Ничья, если оба флота уничтожены одновременно
    drawPossible: true,

    // Если достигнут maxRounds - побеждает тот, у кого больше HP
    tiebreaker: 'total_hp'
  },

  // XP за бой
  experience: {
    // Базовый XP за участие
    baseXp: 20,

    // XP за победу
    winBonus: 30,

    // XP за нанесённый урон
    perDamageDealt: 0.1,  // 1 XP за 10 урона

    // XP за полученный урон (меньше)
    perDamageReceived: 0.05, // 1 XP за 20 урона

    // XP делится между всеми кораблями флота
    distributeAmongFleet: true
  },

  // Расчёт силы флота (для матчмейкинга)
  calculateFleetPower(ships) {
    return ships.reduce((total, ship) => {
      // Формула силы: (HP + Damage*2 + Armor) * Tier
      const shipPower = (ship.hp + ship.damage * 2 + ship.armor) * ship.tier;
      return total + shipPower;
    }, 0);
  },

  // Расчёт урона (главная функция)
  calculateDamage(attacker, defender, isCrit = false, isCounter = false) {
    // Базовый урон атакующего
    let damage = attacker.damage;

    // Снижение от брони
    damage = this.damage.armorReductionFormula(damage, defender.armor);

    // Случайность
    const randomMod = Math.random() *
      (this.damage.randomRange[1] - this.damage.randomRange[0]) +
      this.damage.randomRange[0];
    damage *= randomMod;

    // Критический удар
    if (isCrit) {
      damage *= this.damage.critMultiplier;
    }

    // Контратака наносит меньше урона
    if (isCounter) {
      damage *= this.turnOrder.counterDamageMultiplier;
    }

    // Минимальный урон
    return Math.max(Math.floor(damage), this.damage.minDamage);
  },

  // Проверка крита
  rollCrit() {
    return Math.random() < this.damage.critChance;
  }
};
