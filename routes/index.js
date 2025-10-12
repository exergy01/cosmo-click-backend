// cosmo-click-backend\routes
 
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { logPlayerAction, detectSuspiciousActivity, updateLifetimeStats, logBalanceChange } = require('./shared/logger');

// Импортируем модули
const playerRoutes = require('./player');
const shopRoutes = require('./shop');
const questRoutes = require('./quests');
const referralRoutes = require('./referrals');
const exchangeRoutes = require('./exchange');
const adminRoutes = require('./admin');

const router = express.Router();

// Подключаем модули к роутам
router.use('/api/player', playerRoutes);
router.use('/api/shop', shopRoutes);
router.use('/api/quests', questRoutes);
router.use('/api/referrals', referralRoutes);
router.use('/api/exchange', exchangeRoutes);
router.use('/api/admin', adminRoutes);

// ИСПРАВЛЕННЫЙ роут для обычного сбора ресурсов
router.post('/api/collect', async (req, res) => {
  const { telegramId, systemId } = req.body;
  if (!telegramId || !systemId) return res.status(400).json({ error: 'Telegram ID and System ID are required' });
  
  console.log(`💰 СБОР РЕСУРСОВ: игрок ${telegramId}, система ${systemId}`);
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 🔒 SECURITY: Lock player row to prevent race conditions
    const playerResult = await client.query(`
      SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // 🛡️ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
    const suspicious = await detectSuspiciousActivity(telegramId, 'collect', 0, systemId);
    if (suspicious) {
      console.log(`🚨 Подозрительная активность при сборе: ${telegramId}`);
      // Можно заблокировать или просто логировать
    }

    const currentSystemStr = String(systemId);
    const lastCollectionTimeMillis = new Date(player.last_collection_time[currentSystemStr]).getTime();
    const collectedAmount = player.collected_by_system[currentSystemStr] || 0;

    const miningSpeed = player.mining_speed_data?.[systemId] || 0;
    const maxCargoCapacity = player.max_cargo_capacity_data?.[systemId] || 0;
    const totalAsteroidResources = player.asteroid_total_data?.[systemId] || 0;

    console.log(`💰 ДАННЫЕ СБОРА СИСТЕМА ${systemId}:`, {
      уже_собрано: collectedAmount,
      скорость_в_секунду: miningSpeed,
      макс_карго: maxCargoCapacity,
      всего_ресурсов: totalAsteroidResources
    });

    const currentTime = Date.now();
    const timeElapsed = (currentTime - lastCollectionTimeMillis) / 1000;

    let newResources = collectedAmount + (miningSpeed * timeElapsed);
    newResources = Math.min(newResources, maxCargoCapacity);
    newResources = Math.min(newResources, totalAsteroidResources);

    if (totalAsteroidResources === 0 && newResources > 0) newResources = 0;
    if (newResources <= 0) newResources = 0;

    // 📊 СОХРАНЯЕМ БАЛАНС ДО ОПЕРАЦИИ
    const balanceBefore = {
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton)
    };

    const updatedCollectedBySystem = { ...player.collected_by_system };
    updatedCollectedBySystem[currentSystemStr] = 0;

    const newLastCollectionTime = { ...player.last_collection_time };
    newLastCollectionTime[currentSystemStr] = new Date().toISOString();

    // Обновляем астероиды (вычитаем собранное)
    const updatedAsteroidTotal = { ...player.asteroid_total_data };
    updatedAsteroidTotal[currentSystemStr] = Math.max(0, (updatedAsteroidTotal[currentSystemStr] || 0) - newResources);

    let actionId = null;
    let balanceAfter = { ...balanceBefore };

    // 🔥 ИСПРАВЛЕНО: правильная поддержка CS для системы 4
    if (systemId === 4) {
      const updatedCs = parseFloat(player.cs) + newResources;
      balanceAfter.cs = updatedCs;
      
      console.log(`✅ СБОР CS: собрано ${newResources} CS, новый баланс ${updatedCs}`);
      
      await client.query(
        'UPDATE players SET cs = $1, collected_by_system = $2, last_collection_time = $3, asteroid_total_data = $4 WHERE telegram_id = $5',
        [updatedCs, updatedCollectedBySystem, newLastCollectionTime, updatedAsteroidTotal, telegramId]
      );

      // 📝 ЛОГИРОВАНИЕ
      actionId = await logPlayerAction(telegramId, 'collect_cs', newResources, systemId, null, {
        timeElapsed: timeElapsed,
        miningSpeed: miningSpeed,
        cargoCapacity: maxCargoCapacity
      }, req);

      // 📊 ОБНОВЛЯЕМ LIFETIME СТАТИСТИКУ
      await updateLifetimeStats(telegramId, 'collect_cs', newResources);

    } else {
      const updatedCcc = parseFloat(player.ccc) + newResources;
      balanceAfter.ccc = updatedCcc;
      
      console.log(`✅ СБОР CCC: собрано ${newResources} CCC, новый баланс ${updatedCcc}`);
      
      await client.query(
        'UPDATE players SET ccc = $1, collected_by_system = $2, last_collection_time = $3, asteroid_total_data = $4 WHERE telegram_id = $5',
        [updatedCcc, updatedCollectedBySystem, newLastCollectionTime, updatedAsteroidTotal, telegramId]
      );

      // 📝 ЛОГИРОВАНИЕ
      actionId = await logPlayerAction(telegramId, 'collect_ccc', newResources, systemId, null, {
        timeElapsed: timeElapsed,
        miningSpeed: miningSpeed,
        cargoCapacity: maxCargoCapacity
      }, req);

      // 📊 ОБНОВЛЯЕМ LIFETIME СТАТИСТИКУ
      await updateLifetimeStats(telegramId, 'collect_ccc', newResources);
    }

    // 📊 ЛОГИРУЕМ ИЗМЕНЕНИЕ БАЛАНСА
    if (actionId) {
      await logBalanceChange(telegramId, actionId, balanceBefore, balanceAfter);
    }

    await client.query('COMMIT');
    const updatedPlayer = await getPlayer(telegramId);
    res.json(updatedPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error collecting resources:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ИСПРАВЛЕННЫЙ роут для безопасного сбора ресурсов БЕЗ ЛОГИРОВАНИЯ
router.post('/api/safe/collect', async (req, res) => {
  console.log('🔍 ПОЛУЧЕН ЗАПРОС /api/safe/collect:', req.body);
  
  const { telegramId, last_collection_time, system, collected_ccc, collected_cs } = req.body;
  
  console.log('🔍 ИЗВЛЕЧЕННЫЕ ПАРАМЕТРЫ:', { telegramId, system, collected_ccc, collected_cs });
  
  const collectedAmount = system === 4 ? (collected_cs || 0) : (collected_ccc || 0);
  const currencyField = system === 4 ? 'cs' : 'ccc';
  const currencyName = system === 4 ? 'CS' : 'CCC';
  
  console.log('🔍 ЛОГИКА ОПРЕДЕЛЕНИЯ:', { system, collectedAmount, currencyField, currencyName });
  
  if (!telegramId || !system || collectedAmount === undefined || collectedAmount === 0) {
    console.log('❌ ВАЛИДАЦИЯ НЕ ПРОШЛА');
    return res.status(400).json({ error: 'Missing required fields' });
  }

  console.log('✅ ВАЛИДАЦИЯ ПРОШЛА, ПРОДОЛЖАЕМ...');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const systemStr = String(system);
    const currentAsteroidTotal = player.asteroid_total_data?.[systemStr] || 0;
    const updatedAsteroidTotal = { 
      ...player.asteroid_total_data, 
      [systemStr]: Math.max(0, currentAsteroidTotal - parseFloat(collectedAmount)) 
    };
    
    const currentBalance = parseFloat(player[currencyField] || '0');
    const updatedBalance = (currentBalance + parseFloat(collectedAmount)).toFixed(5);
    
    console.log(`💰 ОБНОВЛЕНИЕ БАЛАНСА: ${currencyName} ${currentBalance} + ${collectedAmount} = ${updatedBalance}`);
    
    const updatedCollectedBySystem = { ...player.collected_by_system, [systemStr]: 0 };
    const updatedLastCollectionTime = { ...last_collection_time, [systemStr]: new Date().toISOString() };

    const sqlQuery = `UPDATE players SET ${currencyField} = $1, collected_by_system = $2, asteroid_total_data = $3, last_collection_time = $4 WHERE telegram_id = $5`;
    console.log('🔍 SQL ЗАПРОС:', sqlQuery);
    console.log('🔍 SQL ПАРАМЕТРЫ:', [updatedBalance, updatedCollectedBySystem, updatedAsteroidTotal, updatedLastCollectionTime, telegramId]);
    
    await client.query(sqlQuery, [updatedBalance, updatedCollectedBySystem, updatedAsteroidTotal, updatedLastCollectionTime, telegramId]);

    await client.query('COMMIT');
    console.log(`✅ БЕЗОПАСНЫЙ СБОР: собрано ${collectedAmount} ${currencyName}, транзакция завершена`);
    
    // 🔥 ВАЖНО: Получаем обновленные данные игрока
    const updatedPlayer = await getPlayer(telegramId);
    
    console.log('🎯 ОТПРАВЛЯЕМ ОТВЕТ');
    res.json(updatedPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error collecting from safe:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// 🔥 ДОБАВЛЕНО: Эндпоинт для отладки
router.get('/api/debug/player/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const player = await getPlayer(telegramId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    
    res.json({
      основные_данные: {
        telegram_id: player.telegram_id,
        cs: player.cs,
        ccc: player.ccc,
        ton: player.ton
      },
      система_4: {
        дроны: player.drones.filter(d => d.system === 4),
        астероиды: player.asteroids.filter(a => a.system === 4),
        карго: player.cargo_levels.filter(c => c.system === 4),
        скорость_добычи: player.mining_speed_data[4],
        макс_карго: player.max_cargo_capacity_data[4],
        всего_ресурсов: player.asteroid_total_data[4],
        время_сбора: player.last_collection_time['4'],
        собрано: player.collected_by_system['4']
      },
      все_скорости: player.mining_speed_data,
      все_карго: player.max_cargo_capacity_data,
      все_ресурсы: player.asteroid_total_data
    });
  } catch (err) {
    console.error('Error fetching debug data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔥 ДОБАВЛЕНО: Эндпоинт для тестирования обновления
router.post('/api/test/update-balance', async (req, res) => {
  const { telegramId, cs, ccc, ton } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'Telegram ID required' });

  try {
    const updates = [];
    const values = [telegramId];
    let paramIndex = 2;

    if (cs !== undefined) {
      updates.push(`cs = $${paramIndex}`);
      values.push(parseFloat(cs));
      paramIndex++;
    }
    if (ccc !== undefined) {
      updates.push(`ccc = $${paramIndex}`);
      values.push(parseFloat(ccc));
      paramIndex++;
    }
    if (ton !== undefined) {
      updates.push(`ton = $${paramIndex}`);
      values.push(parseFloat(ton));
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No values to update' });
    }

    const query = `UPDATE players SET ${updates.join(', ')} WHERE telegram_id = $1`;
    await pool.query(query, values);

    console.log(`🧪 ТЕСТ: обновлены балансы для игрока ${telegramId}:`, { cs, ccc, ton });
    
    const updatedPlayer = await getPlayer(telegramId);
    res.json(updatedPlayer);
  } catch (err) {
    console.error('❌ Error updating balances:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET версия для пересчета через браузер
router.get('/api/recalculate/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const response = await fetch(`http://localhost:5000/api/shop/recalculate/${telegramId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    console.error('Error in recalculate:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ДОБАВЬТЕ В ФАЙЛ routes/index.js (найдите существующий роут /api/games/stats/:telegramId и замените):

router.get('/api/games/stats/:telegramId', async (req, res) => {
  try {
      console.log('🎮 Getting game stats for:', req.params.telegramId);
      const { telegramId } = req.params;

      // Получаем статистику всех миниигр
      const statsResult = await pool.query(`
          SELECT 
              COALESCE(SUM(total_games), 0) as total_games,
              COALESCE(SUM(total_wins), 0) as total_wins,
              COALESCE(SUM(total_losses), 0) as total_losses,
              COALESCE(SUM(total_bet), 0) as total_bet,
              COALESCE(SUM(total_won), 0) as total_won
          FROM minigames_stats 
          WHERE telegram_id = $1
      `, [telegramId]);

      // ИСПРАВЛЕНО: Получаем джекпот
      const jackpotResult = await pool.query(`
          SELECT current_amount FROM jackpot WHERE id = 1
      `);

      const stats = statsResult.rows[0] || {
          total_games: 0,
          total_wins: 0,
          total_losses: 0,
          total_bet: 0,
          total_won: 0
      };

      const jackpotAmount = jackpotResult.rows[0]?.current_amount || 0;

      console.log('🎮 Game stats response:', {
          totalGames: parseInt(stats.total_games),
          totalWins: parseInt(stats.total_wins),
          totalLosses: parseInt(stats.total_losses),
          jackpotAmount: parseInt(jackpotAmount)
      });

      res.json({
          totalGames: parseInt(stats.total_games),
          totalWins: parseInt(stats.total_wins),
          totalLosses: parseInt(stats.total_losses),
          totalBet: parseInt(stats.total_bet),
          totalWon: parseInt(stats.total_won),
          jackpotAmount: parseInt(jackpotAmount)
      });

  } catch (error) {
      console.error('🎮❌ Game stats error:', error);
      res.status(500).json({ 
          totalGames: 0,
          totalWins: 0,
          totalLosses: 0,
          totalBet: 0,
          totalWon: 0,
          jackpotAmount: 0,
          error: 'Server error'
      });
  }
});

module.exports = router;