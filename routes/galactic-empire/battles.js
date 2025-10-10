/**
 * ⚔️ БОЕВАЯ СИСТЕМА - GALACTIC EMPIRE v2.0
 * Все бои рассчитываются на сервере
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const gameConfig = require('../../config/galactic-empire/game.config');
const racesConfig = require('../../config/galactic-empire/races.config');

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
 * Провести один раунд боя
 */
function simulateRound(fleet1, fleet2, race1, race2, roundNumber) {
  const actions = [];

  // Определяем порядок атаки на основе скорости всех кораблей
  const allShips = [
    ...fleet1.map((ship, i) => ({ ship, fleet: 1, index: i })),
    ...fleet2.map((ship, i) => ({ ship, fleet: 2, index: i }))
  ].filter(item => item.ship.current_hp > 0)
   .sort((a, b) => b.ship.speed - a.ship.speed);

  // Каждый корабль атакует по очереди
  for (const attacker of allShips) {
    // Проверяем что атакующий ещё жив
    if (attacker.ship.current_hp <= 0) continue;

    const enemyFleet = attacker.fleet === 1 ? fleet2 : fleet1;
    const attackerRace = attacker.fleet === 1 ? race1 : race2;
    const defenderRace = attacker.fleet === 1 ? race2 : race1;

    // Выбираем цель
    const target = selectTarget(enemyFleet, 'weakest');
    if (!target) break; // Все враги мертвы

    // Рассчитываем урон
    const damageResult = calculateDamage(
      attacker.ship,
      target.ship,
      attackerRace,
      defenderRace
    );

    // Применяем урон
    target.ship.current_hp = Math.max(0, target.ship.current_hp - damageResult.damage);

    // Записываем действие
    actions.push({
      round: roundNumber,
      attacker: {
        fleet: attacker.fleet,
        index: attacker.index,
        shipId: attacker.ship.id,
        shipType: attacker.ship.ship_type
      },
      target: {
        fleet: attacker.fleet === 1 ? 2 : 1,
        index: target.index,
        shipId: target.ship.id,
        shipType: target.ship.ship_type
      },
      damage: damageResult.damage,
      isCrit: damageResult.isCrit,
      blocked: damageResult.blocked,
      targetRemainingHP: target.ship.current_hp,
      isKill: target.ship.current_hp === 0,
      attackerFleet: attacker.fleet // Для определения победителя
    });

    // Проверяем победу ПОСЛЕ КАЖДОГО ДЕЙСТВИЯ
    const enemiesAlive = enemyFleet.filter(s => s.current_hp > 0).length;
    if (enemiesAlive === 0) {
      // Враги уничтожены - победа атакующего флота
      actions[actions.length - 1].isWinningBlow = true;
      break;
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
      break;
    }

    // Дополнительная проверка на случай если все умерли
    const fleet1Alive = f1.filter(s => s.current_hp > 0).length;
    const fleet2Alive = f2.filter(s => s.current_hp > 0).length;

    if (fleet1Alive === 0 && fleet2Alive === 0) {
      winner = 'draw';
      break;
    } else if (fleet1Alive === 0) {
      winner = 2;
      break;
    } else if (fleet2Alive === 0) {
      winner = 1;
      break;
    }

    round++;
  }

  // Если не определён победитель - считаем по HP
  if (!winner && round > gameConfig.battle.maxRounds) {
    const fleet1HP = f1.reduce((sum, s) => sum + s.current_hp, 0);
    const fleet2HP = f2.reduce((sum, s) => sum + s.current_hp, 0);

    if (fleet1HP > fleet2HP) winner = 1;
    else if (fleet2HP > fleet1HP) winner = 2;
    else winner = 'draw';
  }

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

    // Проверяем что все корабли живы
    const allAlive = playerFleet.every(ship => ship.current_hp > 0);
    if (!allAlive) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ error: 'Some ships are damaged. Repair them first.' });
    }

    // Вычисляем силу флота игрока
    const playerPower = playerFleet.reduce((sum, ship) => {
      return sum + (ship.current_hp * 1.0) + (ship.attack * 2.0) + (ship.defense * 1.5) + (ship.speed * 0.5);
    }, 0);

    // Генерируем флот бота (±5% от силы игрока)
    const variance = 0.95 + Math.random() * 0.1;
    const botPower = playerPower * variance;

    // Создаём простой флот бота из фрегатов и эсминцев
    const botFleet = [];
    const botShipTypes = ['frigate_t1', 'frigate_t2', 'destroyer_t1'];
    const shipsCount = Math.min(5, playerFleet.length);

    for (let i = 0; i < shipsCount; i++) {
      const shipType = botShipTypes[Math.floor(Math.random() * botShipTypes.length)];
      const powerPerShip = botPower / shipsCount;

      botFleet.push({
        id: `bot_${i}`,
        ship_type: shipType,
        ship_class: shipType.split('_')[0],
        tier: parseInt(shipType.split('_')[1].replace('t', '')),
        race: 'bot',
        max_hp: Math.floor(powerPerShip * 0.4),
        current_hp: Math.floor(powerPerShip * 0.4),
        attack: Math.floor(powerPerShip * 0.3),
        defense: Math.floor(powerPerShip * 0.2),
        speed: Math.floor(50 + Math.random() * 50)
      });
    }

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

    // Получаем расу игрока
    const playerRaceResult = await client.query(`
      SELECT race FROM galactic_empire_players WHERE telegram_id = $1
    `, [telegramId]);
    const playerRace = playerRaceResult.rows[0]?.race || 'human';

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

    // Восстанавливаем HP всех кораблей игрока до максимума после боя
    for (const ship of battleResult.fleet1Final) {
      await client.query(`
        UPDATE galactic_empire_ships
        SET current_hp = max_hp, updated_at = NOW()
        WHERE id = $1
      `, [ship.id]);

      // Обновляем HP в объекте для ответа
      ship.current_hp = ship.max_hp;
    }

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

    res.json({
      success: true,
      battleId,
      winner: battleResult.winner,
      rounds: battleResult.rounds,
      battleLog: battleResult.battleLog,
      playerFleet: battleResult.fleet1Final, // Теперь с восстановленным HP
      botFleet: battleResult.fleet2Final,
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
