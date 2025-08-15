// routes/admin/players.js - Модуль управления игроками (ИСПРАВЛЕНО)
const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { adminAuth } = require('./auth');

const router = express.Router();

// 🛡️ Все маршруты требуют админских прав
router.use(adminAuth);

// 👤 GET /player/:telegramId/:playerId - информация об игроке
router.get('/player/:telegramId/:playerId', async (req, res) => {
  const { playerId } = req.params;
  
  try {
    console.log(`👤 Запрос информации об игроке: ${playerId}`);
    
    const player = await getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // История действий игрока (последние 50)
    let actionsResult = { rows: [] };
    try {
      actionsResult = await pool.query(`
        SELECT action_type, amount, created_at, details
        FROM player_actions 
        WHERE telegram_id = $1 
        ORDER BY created_at DESC 
        LIMIT 50
      `, [playerId]);
    } catch (actionsError) {
      console.log('⚠️ Таблица player_actions недоступна:', actionsError.message);
    }
    
    // История обменов Stars
    let starsHistory = { rows: [] };
    try {
      starsHistory = await pool.query(`
        SELECT amount, cs_amount, exchange_rate, created_at, status
        FROM star_transactions 
        WHERE player_id = $1 
          AND transaction_type = 'stars_to_cs_exchange'
        ORDER BY created_at DESC 
        LIMIT 20
      `, [playerId]);
    } catch (starsError) {
      console.log('⚠️ Не удалось загрузить историю Stars:', starsError.message);
    }
    
    // Статистика рефералов
    let referralStats = { rows: [{ referrals_count: 0 }] };
    try {
      referralStats = await pool.query(`
        SELECT COUNT(*) as referrals_count
        FROM players 
        WHERE referrer_id = $1
      `, [playerId]);
    } catch (referralError) {
      console.log('⚠️ Ошибка загрузки рефералов:', referralError.message);
    }
    
    res.json({
      player,
      recent_actions: actionsResult.rows,
      stars_history: starsHistory.rows,
      referral_stats: referralStats.rows[0],
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения данных игрока:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 💰 POST /update-balance/:telegramId - обновление баланса игрока
router.post('/update-balance/:telegramId', async (req, res) => {
  const { playerId, currency, amount, operation } = req.body;
  
  if (!playerId || !currency || amount === undefined || !operation) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log(`💰 Обновление баланса: ${playerId}, ${currency}, ${operation} ${amount}`);
    
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    let updateQuery = '';
    let newBalance = 0;
    
    switch (currency.toLowerCase()) {
      case 'ccc':
        if (operation === 'set') {
          newBalance = parseFloat(amount);
          updateQuery = 'UPDATE players SET ccc = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseFloat(player.ccc) + parseFloat(amount);
          updateQuery = 'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2';
        }
        break;
      case 'cs':
        if (operation === 'set') {
          newBalance = parseFloat(amount);
          updateQuery = 'UPDATE players SET cs = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseFloat(player.cs) + parseFloat(amount);
          updateQuery = 'UPDATE players SET cs = cs + $1 WHERE telegram_id = $2';
        }
        break;
      case 'ton':
        if (operation === 'set') {
          newBalance = parseFloat(amount);
          updateQuery = 'UPDATE players SET ton = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseFloat(player.ton) + parseFloat(amount);
          updateQuery = 'UPDATE players SET ton = ton + $1 WHERE telegram_id = $2';
        }
        break;
      case 'stars':
        if (operation === 'set') {
          newBalance = parseInt(amount);
          updateQuery = 'UPDATE players SET telegram_stars = $1 WHERE telegram_id = $2';
        } else if (operation === 'add') {
          newBalance = parseInt(player.telegram_stars || 0) + parseInt(amount);
          updateQuery = 'UPDATE players SET telegram_stars = telegram_stars + $1 WHERE telegram_id = $2';
        }
        break;
      default:
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Invalid currency' });
    }
    
    await client.query(updateQuery, [amount, playerId]);
    
    // Логируем административное действие (если таблица существует)
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, amount, details)
        VALUES ($1, $2, $3, $4)
      `, [
        playerId,
        'admin_balance_update',
        amount,
        JSON.stringify({
          admin_id: req.params.telegramId,
          currency,
          operation,
          old_balance: operation === 'set' ? player[currency] : null,
          new_balance: newBalance
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать действие:', logError.message);
    }
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ Баланс обновлен: ${playerId} ${currency} ${operation} ${amount}`);
    
    res.json({
      success: true,
      player: updatedPlayer,
      operation: {
        currency,
        operation,
        amount,
        new_balance: newBalance
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка обновления баланса:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// 🔧 POST /verify-player/:telegramId - базовая верификация игрока
router.post('/verify-player/:telegramId', async (req, res) => {
  const { playerId, verified } = req.body;
  
  if (!playerId || verified === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    console.log(`🔧 Изменение базовой верификации: ${playerId} -> ${verified}`);
    
    // Работаем ТОЛЬКО с базовой верификацией, НЕ трогаем премиум поля
    await pool.query(
      'UPDATE players SET verified = $1 WHERE telegram_id = $2',
      [verified, playerId]
    );
    
    // Логируем действие
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_basic_verification_change',
        JSON.stringify({
          admin_id: req.params.telegramId,
          verified_status: verified,
          verification_type: 'basic_only',
          premium_affected: false
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать верификацию:', logError.message);
    }
    
    const updatedPlayer = await getPlayer(playerId);
    
    console.log(`✅ Базовая верификация изменена: ${playerId} -> verified = ${verified}`);
    
    res.json({
      success: true,
      player: updatedPlayer,
      verification_type: 'basic_only'
    });
    
  } catch (err) {
    console.error('❌ Ошибка верификации игрока:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 🔍 GET /search/:telegramId - поиск игроков
router.get('/search/:telegramId', async (req, res) => {
  const { q } = req.query;
  
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Search query too short' });
  }
  
  try {
    console.log(`🔍 Поиск игроков: "${q}"`);
    
    const result = await pool.query(`
      SELECT 
        telegram_id, 
        username, 
        first_name, 
        COALESCE(cs, 0) as cs, 
        COALESCE(ccc, 0) as ccc, 
        COALESCE(ton, 0) as ton, 
        COALESCE(telegram_stars, 0) as telegram_stars, 
        COALESCE(verified, false) as verified, 
        created_at as last_activity
      FROM players 
      WHERE 
        telegram_id::text ILIKE $1 
        OR username ILIKE $1 
        OR first_name ILIKE $1
      ORDER BY cs DESC
      LIMIT 20
    `, [`%${q}%`]);
    
    res.json({
      query: q,
      results: result.rows,
      count: result.rows.length
    });
    
  } catch (err) {
    console.error('❌ Ошибка поиска игроков:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

module.exports = router;