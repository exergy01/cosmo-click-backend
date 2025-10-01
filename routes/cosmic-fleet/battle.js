// routes/cosmic-fleet/battle.js - API для боевой системы
const express = require('express');
const router = express.Router();
const db = require('../../db');

// Константы
const DEBUG_TELEGRAM_IDS = [2097930691, 850758749, 1222791281, 123456789];

// Враги для PvE боев
const PVE_ENEMIES = [
  {
    name: 'Астероидный пират',
    health: 80,
    damage: 15,
    speed: 50,
    reward: 25,
    experience: 10
  },
  {
    name: 'Дрон-охранник',
    health: 120,
    damage: 22,
    speed: 40,
    reward: 40,
    experience: 15
  },
  {
    name: 'Космический рейдер',
    health: 180,
    damage: 35,
    speed: 60,
    reward: 75,
    experience: 25
  },
  {
    name: 'Военный корвет',
    health: 250,
    damage: 45,
    speed: 35,
    reward: 120,
    experience: 40
  }
];

// Middleware для проверки доступа
const checkDebugAccess = (req, res, next) => {
  const telegramId = parseInt(req.body.telegramId);

  if (!DEBUG_TELEGRAM_IDS.includes(telegramId)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Cosmic Fleet is in development.'
    });
  }

  next();
};

// Функция симуляции боя
const simulateBattle = (playerShip, enemy) => {
  let playerHealth = playerShip.health;
  let enemyHealth = enemy.health;
  const battleLog = [];

  // Определяем кто ходит первым на основе скорости
  let playerTurn = playerShip.speed >= enemy.speed;

  while (playerHealth > 0 && enemyHealth > 0) {
    if (playerTurn) {
      // Ход игрока
      const damage = Math.floor(playerShip.damage * (0.8 + Math.random() * 0.4));
      enemyHealth = Math.max(0, enemyHealth - damage);
      battleLog.push({
        attacker: 'player',
        target: 'enemy',
        damage,
        attackerHealth: playerHealth,
        targetHealth: enemyHealth
      });
    } else {
      // Ход врага
      const damage = Math.floor(enemy.damage * (0.7 + Math.random() * 0.6));
      playerHealth = Math.max(0, playerHealth - damage);
      battleLog.push({
        attacker: 'enemy',
        target: 'player',
        damage,
        attackerHealth: enemyHealth,
        targetHealth: playerHealth
      });
    }

    playerTurn = !playerTurn;

    // Защита от бесконечного цикла
    if (battleLog.length > 50) {
      break;
    }
  }

  const victory = playerHealth > 0;
  const damageReceived = playerShip.health - playerHealth;

  return {
    victory,
    playerHealthAfter: playerHealth,
    damageReceived,
    battleLog
  };
};

// 🎯 POST /api/cosmic-fleet/battle/pve - PvE бой
router.post('/pve', checkDebugAccess, async (req, res) => {
  try {
    const { telegramId, shipId } = req.body;

    if (!telegramId || !shipId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data'
      });
    }

    // Начинаем транзакцию
    await db.query('BEGIN');

    try {
      // 1. Получаем корабль и игрока
      const shipQuery = `
        SELECT s.*, p.id as player_id, p.luminios_balance
        FROM cosmic_fleet_ships s
        JOIN cosmic_fleet_players p ON s.player_id = p.id
        WHERE s.id = $1 AND p.telegram_id = $2
      `;
      const shipResult = await db.query(shipQuery, [shipId, telegramId]);

      if (shipResult.rows.length === 0) {
        await db.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Ship not found'
        });
      }

      const ship = shipResult.rows[0];

      if (ship.health <= 0) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Ship is destroyed and needs repair'
        });
      }

      // 2. Выбираем случайного врага
      const enemy = PVE_ENEMIES[Math.floor(Math.random() * PVE_ENEMIES.length)];

      // 3. Симулируем бой
      const battleResult = simulateBattle(ship, enemy);

      // 4. Обновляем здоровье корабля
      const updateShipQuery = `
        UPDATE cosmic_fleet_ships
        SET health = $1, experience = experience + $2
        WHERE id = $3
        RETURNING *
      `;

      const experienceGained = battleResult.victory ? enemy.experience : Math.floor(enemy.experience * 0.3);
      const updatedShipResult = await db.query(updateShipQuery, [
        battleResult.playerHealthAfter,
        experienceGained,
        shipId
      ]);

      let luminiosReward = 0;
      let newLuminiosBalance = ship.luminios_balance;

      // 5. Если победа - даем награды
      if (battleResult.victory) {
        luminiosReward = enemy.reward;

        const updatePlayerQuery = `
          UPDATE cosmic_fleet_players
          SET luminios_balance = luminios_balance + $1,
              total_battles = total_battles + 1,
              wins = wins + 1
          WHERE id = $2
          RETURNING luminios_balance
        `;
        const updatePlayerResult = await db.query(updatePlayerQuery, [luminiosReward, ship.player_id]);
        newLuminiosBalance = updatePlayerResult.rows[0].luminios_balance;

        // Записываем награду
        const rewardTransactionQuery = `
          INSERT INTO luminios_transactions (
            telegram_id, transaction_type, luminios_amount, description
          ) VALUES ($1, $2, $3, $4)
        `;
        await db.query(rewardTransactionQuery, [
          telegramId,
          'reward',
          luminiosReward,
          `Victory against ${enemy.name}`
        ]);
      } else {
        // Поражение - только обновляем статистику
        const updatePlayerQuery = `
          UPDATE cosmic_fleet_players
          SET total_battles = total_battles + 1,
              losses = losses + 1
          WHERE id = $1
        `;
        await db.query(updatePlayerQuery, [ship.player_id]);
      }

      // 6. Записываем бой в историю
      const battleRecordQuery = `
        INSERT INTO cosmic_fleet_battles (
          player1_id, ship1_id, battle_type, winner_id,
          battle_log, luminios_reward, experience_gained
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      await db.query(battleRecordQuery, [
        ship.player_id,
        shipId,
        'PvE',
        battleResult.victory ? ship.player_id : null,
        JSON.stringify({
          enemy: enemy.name,
          battleLog: battleResult.battleLog
        }),
        luminiosReward,
        experienceGained
      ]);

      await db.query('COMMIT');

      // Возвращаем результаты
      const updatedShip = updatedShipResult.rows[0];

      res.json({
        success: true,
        result: {
          victory: battleResult.victory,
          experienceGained,
          luminiosReward,
          damageReceived: battleResult.damageReceived
        },
        updatedShip: {
          id: updatedShip.id.toString(),
          name: updatedShip.ship_name,
          health: updatedShip.health,
          maxHealth: updatedShip.max_health,
          damage: updatedShip.damage,
          speed: updatedShip.speed,
          level: updatedShip.level,
          experience: updatedShip.experience
        },
        newLuminiosBalance
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error in PvE battle:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// 🎯 GET /api/cosmic-fleet/leaderboard - Таблица лидеров
router.get('/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const leaderboardQuery = `
      SELECT
        telegram_id,
        wins,
        losses,
        total_battles,
        rank_points,
        luminios_balance,
        (wins::float / GREATEST(total_battles, 1) * 100) as win_rate
      FROM cosmic_fleet_players
      WHERE total_battles > 0
      ORDER BY wins DESC, win_rate DESC, rank_points DESC
      LIMIT $1
    `;
    const leaderboardResult = await db.query(leaderboardQuery, [limit]);

    const leaderboard = leaderboardResult.rows.map(player => ({
      telegramId: player.telegram_id,
      wins: player.wins,
      losses: player.losses,
      totalBattles: player.total_battles,
      rankPoints: player.rank_points,
      luminiosBalance: player.luminios_balance,
      winRate: parseFloat(player.win_rate).toFixed(1)
    }));

    res.json(leaderboard);
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;