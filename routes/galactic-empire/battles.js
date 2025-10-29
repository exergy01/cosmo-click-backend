/**
 * ⚔️ БОЕВАЯ СИСТЕМА - GALACTIC EMPIRE v2.0
 * Все бои рассчитываются на сервере
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const gameConfig = require('../../config/galactic-empire/game.config');
const racesConfig = require('../../config/galactic-empire/races.config');
const { calculateRegeneratedHP } = require('../../utils/ship-regeneration');
const { WEAPONS, FORMULAS } = require('../../config/galactic-empire/weapons.config');

// =====================================================
// БОЕВОЙ ДВИЖОК
// =====================================================

/**
 * Рассчитать урон с учётом всех модификаторов
 */
function calculateDamage(attacker, defender, attackerRace, defenderRace) {
  const baseDamage = attacker.attack;

  // Случайный разброс ±10%
  const variance = 0.9 + Math.random() * 0.2;

  // Крит
  const isCrit = Math.random() < gameConfig.battle.damageCalculation.critChance;
  const critMultiplier = isCrit ? gameConfig.battle.damageCalculation.critMultiplier : 1.0;

  // Защита снижает урон
  const defenseReduction = 1 - (defender.defense / (defender.defense + 100));

  // Финальный урон
  let finalDamage = Math.floor(baseDamage * variance * critMultiplier * defenseReduction);

  // Минимум 1 урон
  finalDamage = Math.max(1, finalDamage);

  return {
    damage: finalDamage,
    isCrit,
    blocked: Math.floor(baseDamage * variance - finalDamage)
  };
}

/**
 * Получить следующего живого атакующего
 */
function getNextAttacker(fleet, lastAttackerIndex) {
  // Сортируем по скорости
  const sortedFleet = [...fleet]
    .map((ship, index) => ({ ship, originalIndex: index }))
    .filter(item => item.ship.current_hp > 0)
    .sort((a, b) => b.ship.speed - a.ship.speed);

  if (sortedFleet.length === 0) return null;

  // Находим следующего после последнего атаковавшего
  if (lastAttackerIndex !== null) {
    const currentIndex = sortedFleet.findIndex(item => item.originalIndex === lastAttackerIndex);
    if (currentIndex !== -1 && currentIndex < sortedFleet.length - 1) {
      return sortedFleet[currentIndex + 1];
    }
  }

  // Возвращаем самого быстрого
  return sortedFleet[0];
}

/**
 * Выбрать цель для атаки (простой AI)
 */
function selectTarget(enemyFleet, strategy = 'weakest') {
  const aliveEnemies = enemyFleet
    .map((ship, index) => ({ ship, index }))
    .filter(item => item.ship.current_hp > 0);

  if (aliveEnemies.length === 0) return null;

  switch (strategy) {
    case 'weakest':
      // Атакуем корабль с наименьшим HP
      return aliveEnemies.reduce((min, current) =>
        current.ship.current_hp < min.ship.current_hp ? current : min
      );

    case 'strongest':
      // Атакуем корабль с наибольшей атакой
      return aliveEnemies.reduce((max, current) =>
        current.ship.attack > max.ship.attack ? current : max
      );

    case 'random':
    default:
      return aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
  }
}

/**
 * Обновить кулдауны всех кораблей
 */
function updateCooldowns(ships) {
  ships.forEach(ship => {
    if (ship.current_hp > 0 && ship.current_cooldown > 0) {
      ship.current_cooldown = Math.max(0, ship.current_cooldown - 1000); // -1 секунда
    }
  });
}

/**
 * Проверить, может ли корабль стрелять
 */
function canShoot(ship) {
  const result = ship.current_hp > 0 && ship.current_cooldown <= 0;
  if (process.env.NODE_ENV === 'development') {
    console.log(`  canShoot(${ship.id}): HP=${ship.current_hp}/${ship.max_hp}, CD=${ship.current_cooldown}, weapon=${ship.weapon_type}, result=${result}`);
  }
  return result;
}

/**
 * ⚔️ НОВАЯ 4-ФАЗНАЯ СИСТЕМА БОЯ (ОДНОВРЕМЕННЫЕ АТАКИ)
 * Все корабли атакуют одновременно, урон применяется в конце раунда
 */
function simulateRound(fleet1, fleet2, race1, race2, roundNumber) {
  const actions = [];
  const plannedAttacks = [];

  // ========================================
  // ФАЗА 1: Обновление кулдаунов оружия
  // ========================================
  updateCooldowns([...fleet1, ...fleet2]);

  // ========================================
  // ФАЗА 2: Планирование атак (ВСЕ ОДНОВРЕМЕННО)
  // ========================================
  const allShips = [
    ...fleet1.map((ship, i) => ({ ship, fleet: 1, index: i })),
    ...fleet2.map((ship, i) => ({ ship, fleet: 2, index: i }))
  ];

  for (const attacker of allShips) {
    // Пропускаем тех, кто не может стрелять
    if (!canShoot(attacker.ship)) continue;

    const enemyFleet = attacker.fleet === 1 ? fleet2 : fleet1;
    const attackerRace = attacker.fleet === 1 ? race1 : race2;

    // Выбираем цель
    const target = selectTarget(enemyFleet, 'weakest');
    if (!target) continue;

    // Получаем оружие корабля
    const weaponType = attacker.ship.weapon_type || 'laser';
    const weapon = WEAPONS[weaponType];

    if (!weapon) {
      console.error(`❌ Неизвестный тип оружия: ${weaponType}`);
      continue;
    }

    // Планируем атаку
    plannedAttacks.push({
      attacker,
      target,
      weapon,
      attackerRace
    });

    // Устанавливаем кулдаун (будет применен после выстрела)
    attacker.ship.current_cooldown = weapon.cooldown;
  }

  // ========================================
  // ФАЗА 3: Применение урона (ВСЕ АТАКИ СРАЗУ)
  // ========================================
  const damageQueue = []; // Очередь урона для одновременного применения

  for (const attack of plannedAttacks) {
    const { attacker, target, weapon, attackerRace } = attack;

    // Рассчитываем урон через новую систему
    const damage = FORMULAS.calculateDamage(weapon, attacker.ship, target.ship);

    // Добавляем в очередь урона
    damageQueue.push({
      target: target.ship,
      damage,
      attacker: attacker.ship,
      weapon
    });

    // Логируем действие
    actions.push({
      round: roundNumber,
      attacker: {
        fleet: attacker.fleet,
        index: attacker.index,
        shipId: attacker.ship.id,
        shipType: attacker.ship.ship_type,
        weapon: weapon.name
      },
      target: {
        fleet: attacker.fleet === 1 ? 2 : 1,
        index: target.index,
        shipId: target.ship.id,
        shipType: target.ship.ship_type
      },
      damage,
      weaponUsed: weapon.nameRu,
      targetRemainingHP: 0, // Обновим после применения урона
      isKill: false,
      attackerFleet: attacker.fleet
    });
  }

  // Применяем весь урон ОДНОВРЕМЕННО
  damageQueue.forEach(({ target, damage }) => {
    target.current_hp = Math.max(0, target.current_hp - damage);
  });

  // Обновляем логи с финальным HP и статусом kill
  actions.forEach(action => {
    const targetFleet = action.target.fleet === 1 ? fleet1 : fleet2;
    const targetShip = targetFleet[action.target.index];
    action.targetRemainingHP = targetShip.current_hp;
    action.isKill = targetShip.current_hp === 0;
  });

  // ========================================
  // ФАЗА 4: Проверка условий победы
  // ========================================
  const fleet1Alive = fleet1.filter(s => s.current_hp > 0).length;
  const fleet2Alive = fleet2.filter(s => s.current_hp > 0).length;

  if (fleet1Alive === 0 || fleet2Alive === 0) {
    const winningFleet = fleet1Alive > 0 ? 1 : 2;
    if (actions.length > 0) {
      actions[actions.length - 1].isWinningBlow = true;
      actions[actions.length - 1].attackerFleet = winningFleet;
    }
  }

  return actions;
}

/**
 * Провести полный бой
 */
function simulateBattle(fleet1, fleet2, race1, race2) {
  // Глубокое копирование флотов
  const f1 = fleet1.map(s => ({ ...s }));
  const f2 = fleet2.map(s => ({ ...s }));

  const battleLog = [];
  let round = 1;
  let winner = null;

  while (round <= gameConfig.battle.maxRounds) {
    const roundActions = simulateRound(f1, f2, race1, race2, round);
    battleLog.push(...roundActions);

    // Проверяем есть ли решающий удар в этом раунде
    const winningAction = roundActions.find(a => a.isWinningBlow);
    if (winningAction) {
      winner = winningAction.attackerFleet;
      if (process.env.NODE_ENV === 'development') console.log(`🏆 Победа через isWinningBlow: флот ${winner} в раунде ${round}`);
      break;
    }

    // Дополнительная проверка на случай если все умерли
    const fleet1Alive = f1.filter(s => s.current_hp > 0).length;
    const fleet2Alive = f2.filter(s => s.current_hp > 0).length;

    if (process.env.NODE_ENV === 'development') console.log(`📊 Раунд ${round}: Флот 1 живых: ${fleet1Alive}, Флот 2 живых: ${fleet2Alive}`);

    if (fleet1Alive === 0 && fleet2Alive === 0) {
      winner = 'draw';
      if (process.env.NODE_ENV === 'development') console.log(`🏆 Ничья - оба флота уничтожены в раунде ${round}`);
      break;
    } else if (fleet1Alive === 0) {
      winner = 2;
      if (process.env.NODE_ENV === 'development') console.log(`🏆 Победа флота 2 - флот 1 уничтожен в раунде ${round}`);
      break;
    } else if (fleet2Alive === 0) {
      winner = 1;
      if (process.env.NODE_ENV === 'development') console.log(`🏆 Победа флота 1 - флот 2 уничтожен в раунде ${round}`);
      break;
    }

    round++;
  }

  // Если не определён победитель - считаем по HP
  if (!winner && round > gameConfig.battle.maxRounds) {
    const fleet1HP = f1.reduce((sum, s) => sum + s.current_hp, 0);
    const fleet2HP = f2.reduce((sum, s) => sum + s.current_hp, 0);

    if (process.env.NODE_ENV === 'development') console.log(`⏱️ Превышен лимит раундов. HP: Флот 1 = ${fleet1HP}, Флот 2 = ${fleet2HP}`);

    if (fleet1HP > fleet2HP) winner = 1;
    else if (fleet2HP > fleet1HP) winner = 2;
    else winner = 'draw';
  }

  if (process.env.NODE_ENV === 'development') console.log(`🏁 ФИНАЛЬНЫЙ РЕЗУЛЬТАТ: winner = ${winner}, rounds = ${round}`);

  return {
    winner,
    rounds: round,
    battleLog,
    fleet1Final: f1,
    fleet2Final: f2
  };
}

// =====================================================
// POST /api/galactic-empire/battles/start-pve
// Начать бой с ботом
// =====================================================
router.post('/start-pve', async (req, res) => {
  const client = await pool.connect(); // Get single client from pool

  try {
    const { telegramId } = req.body;

    if (!telegramId) {
      client.release();
      return res.status(400).json({ error: 'Missing telegramId' });
    }

    await client.query('BEGIN');

    // Получаем данные игрока
    const playerResult = await client.query(`
      SELECT * FROM galactic_empire_players
      WHERE telegram_id = $1
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // Получаем формацию игрока
    const formationResult = await client.query(`
      SELECT * FROM galactic_empire_formations
      WHERE player_id = $1
      LIMIT 1
    `, [telegramId]);

    if (formationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ error: 'No formation found' });
    }

    const formation = formationResult.rows[0];
    const shipIds = [
      formation.slot_1,
      formation.slot_2,
      formation.slot_3,
      formation.slot_4,
      formation.slot_5
    ].filter(id => id !== null);

    if (shipIds.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ error: 'Formation is empty' });
    }

    // Получаем корабли игрока
    const shipsResult = await client.query(`
      SELECT * FROM galactic_empire_ships
      WHERE id = ANY($1::int[]) AND player_id = $2
    `, [shipIds, telegramId]);

    const playerFleet = shipsResult.rows;

    // ✅ Применяем регенерацию HP перед проверкой
    const playerRace = player.race;
    for (const ship of playerFleet) {
      const regeneratedHP = calculateRegeneratedHP(ship, playerRace);
      ship.current_hp = regeneratedHP; // Обновляем текущий HP с учетом регенерации
    }

    // Проверяем что все корабли живы и имеют минимум 10% HP
    const minHpPercent = 0.1;
    for (const ship of playerFleet) {
      if (ship.current_hp <= 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({ error: 'Some ships are destroyed. Repair them first.' });
      }

      const hpPercent = ship.current_hp / ship.max_hp;
      if (hpPercent < minHpPercent) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({
          error: `Ship with less than 10% HP cannot battle. Repair it first.`,
          shipId: ship.id,
          currentHP: ship.current_hp,
          maxHP: ship.max_hp
        });
      }
    }

    // Вычисляем силу флота игрока
    const playerPower = playerFleet.reduce((sum, ship) => {
      return sum + (ship.current_hp * 1.0) + (ship.attack * 2.0) + (ship.defense * 1.5) + (ship.speed * 0.5);
    }, 0);

    // Генерируем флот бота (±5% от силы игрока)
    const variance = 0.95 + Math.random() * 0.1;
    const targetBotPower = playerPower * variance;

    // Создаём простой флот бота из фрегатов и эсминцев
    const botFleet = [];
    const botShipTypes = [
      { type: 'frigate_t1', hp: 1000, attack: 100, defense: 50, speed: 100 },
      { type: 'frigate_t2', hp: 1500, attack: 150, defense: 80, speed: 90 },
      { type: 'destroyer_t1', hp: 2500, attack: 250, defense: 120, speed: 70 }
    ];
    const shipsCount = Math.min(5, playerFleet.length);

    // Создаем базовый флот бота
    for (let i = 0; i < shipsCount; i++) {
      const shipConfig = botShipTypes[Math.floor(Math.random() * botShipTypes.length)];

      botFleet.push({
        id: `bot_${i}`,
        ship_type: shipConfig.type,
        ship_class: shipConfig.type.split('_')[0],
        tier: parseInt(shipConfig.type.split('_')[1].replace('t', '')),
        race: 'bot',
        max_hp: shipConfig.hp,
        current_hp: shipConfig.hp,
        attack: shipConfig.attack,
        defense: shipConfig.defense,
        speed: shipConfig.speed,
        weapon_type: 'laser', // 🔥 КРИТИЧНО: добавляем тип оружия для бота
        current_cooldown: 0    // 🔥 КРИТИЧНО: инициализируем кулдаун (бот может сразу стрелять)
      });
    }

    // ✅ МАСШТАБИРУЕМ: вычисляем текущую силу бота и корректируем
    const currentBotPower = botFleet.reduce((sum, ship) => {
      return sum + (ship.current_hp * 1.0) + (ship.attack * 2.0) + (ship.defense * 1.5) + (ship.speed * 0.5);
    }, 0);

    const scaleFactor = targetBotPower / currentBotPower;

    // Применяем масштабирование ко всем статам (включая скорость)
    botFleet.forEach(ship => {
      ship.max_hp = Math.floor(ship.max_hp * scaleFactor);
      ship.current_hp = Math.floor(ship.current_hp * scaleFactor);
      ship.attack = Math.floor(ship.attack * scaleFactor);
      ship.defense = Math.floor(ship.defense * scaleFactor);
      ship.speed = Math.floor(ship.speed * scaleFactor);
    });

    // ✅ СОХРАНЯЕМ НАЧАЛЬНОЕ СОСТОЯНИЕ ДЛЯ ВИЗУАЛИЗАЦИИ (до боя)
    const playerFleetInitial = playerFleet.map(s => ({ ...s }));
    const botFleetInitial = botFleet.map(s => ({ ...s }));

    // Симулируем бой
    const battleResult = simulateBattle(playerFleet, botFleet, player.race, 'bot');

    // Рассчитываем награду
    const baseReward = Math.floor(playerPower / gameConfig.pve.adaptiveBot.rewardDivisor);
    let reward = baseReward;

    // Бонусы
    if (battleResult.winner === 1) {
      const allShipsSurvived = battleResult.fleet1Final.every(s => s.current_hp === s.max_hp);
      if (allShipsSurvived) {
        reward *= gameConfig.pve.adaptiveBot.bonuses.perfectWin;
      }

      if (battleResult.rounds <= 3) {
        reward *= gameConfig.pve.adaptiveBot.bonuses.fastWin;
      }
    }

    reward = Math.floor(reward);

    // Сохраняем бой в БД
    const battleInsertResult = await client.query(`
      INSERT INTO galactic_empire_battles (
        player1_id,
        player2_id,
        battle_mode,
        battle_type,
        is_pve,
        winner,
        rounds,
        battle_log,
        reward_luminios,
        player1_race,
        player2_race
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `, [
      telegramId,
      null, // PvE - нет второго игрока
      'auto', // battle_mode
      'pve', // battle_type
      true, // is_pve
      battleResult.winner === 1 ? telegramId : null,
      battleResult.rounds,
      JSON.stringify(battleResult.battleLog),
      battleResult.winner === 1 ? reward : 0,
      playerRace,
      'bot' // bot race
    ]);

    const battleId = battleInsertResult.rows[0].id;

    // Сохраняем урон кораблей после боя
    if (process.env.NODE_ENV === 'development') console.log(`💾 Сохраняем HP после боя (${battleResult.fleet1Final.length} кораблей):`);
    for (const ship of battleResult.fleet1Final) {
      if (process.env.NODE_ENV === 'development') console.log(`  Ship ID ${ship.id}: ${ship.current_hp}/${ship.max_hp} HP`);
      await client.query(`
        UPDATE galactic_empire_ships
        SET current_hp = $1, updated_at = NOW()
        WHERE id = $2
      `, [ship.current_hp, ship.id]);
    }
    if (process.env.NODE_ENV === 'development') console.log(`✅ HP кораблей сохранен в БД`);

    // Начисляем награду если победа
    if (battleResult.winner === 1) {
      await client.query(`
        UPDATE galactic_empire_players
        SET luminios_balance = luminios_balance + $1
        WHERE telegram_id = $2
      `, [reward, telegramId]);
    }

    await client.query('COMMIT');
    client.release();

    if (process.env.NODE_ENV === 'development') console.log(`📤 Отправляем клиенту: winner = ${battleResult.winner}, reward = ${battleResult.winner === 1 ? reward : 0}`);

    res.json({
      success: true,
      battleId,
      winner: battleResult.winner,
      rounds: battleResult.rounds,
      battleLog: battleResult.battleLog,
      playerFleet: playerFleetInitial, // ✅ Отправляем НАЧАЛЬНОЕ состояние - BattleLog покажет изменения
      botFleet: botFleetInitial,
      reward: battleResult.winner === 1 ? reward : 0
    });

  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Ошибка боя с ботом:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// GET /api/galactic-empire/battles/history/:telegramId
// Получить историю боёв игрока
// =====================================================
router.get('/history/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const result = await pool.query(`
      SELECT
        b.*,
        p1.race as player1_race,
        p2.race as player2_race
      FROM galactic_empire_battles b
      LEFT JOIN galactic_empire_players p1 ON b.player1_id = p1.telegram_id
      LEFT JOIN galactic_empire_players p2 ON b.player2_id = p2.telegram_id
      WHERE b.player1_id = $1 OR b.player2_id = $1
      ORDER BY b.created_at DESC
      LIMIT $2
    `, [telegramId, limit]);

    res.json(result.rows);

  } catch (error) {
    console.error('❌ Ошибка получения истории боёв:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================
// GET /api/galactic-empire/battles/:battleId
// Получить подробности боя
// =====================================================
router.get('/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;

    const result = await pool.query(`
      SELECT
        b.*,
        p1.race as player1_race,
        p2.race as player2_race
      FROM galactic_empire_battles b
      LEFT JOIN galactic_empire_players p1 ON b.player1_id = p1.telegram_id
      LEFT JOIN galactic_empire_players p2 ON b.player2_id = p2.telegram_id
      WHERE b.id = $1
    `, [battleId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('❌ Ошибка получения боя:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
