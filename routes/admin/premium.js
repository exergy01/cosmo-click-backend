// routes/admin/premium.js - Модуль управления премиум статусами
const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { adminAuth } = require('./auth');

const router = express.Router();

// 🛡️ Все маршруты требуют админских прав
router.use(adminAuth);

// 🏆 POST /grant-premium-30days/:telegramId - Выдача 30-дневного премиума
router.post('/grant-premium-30days/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (process.env.NODE_ENV === 'development') console.log(`🏆 Админ выдает 30-дневный премиум игроку: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Выдаем 30-дневный премиум + verified = true
    await client.query(
      `UPDATE players SET 
       premium_no_ads_until = GREATEST(
         COALESCE(premium_no_ads_until, NOW()),
         NOW() + INTERVAL '30 days'
       ),
       verified = TRUE
       WHERE telegram_id = $1`,
      [playerId]
    );
    
    // Создаем запись в подписках
    const subscriptionResult = await client.query(
      `INSERT INTO premium_subscriptions (
        telegram_id, 
        subscription_type, 
        payment_method, 
        payment_amount,
        end_date,
        transaction_id,
        granted_by_admin
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        playerId,
        'no_ads_30_days',
        'admin_grant',
        0,
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        `admin_${Date.now()}_${playerId}`,
        true
      ]
    );
    
    // Логируем транзакцию
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        playerId,
        'admin_grant',
        'no_ads_30_days',
        'admin_grant',
        0,
        'admin',
        'Premium 30 days granted by admin',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          granted_timestamp: new Date().toISOString(),
          verified_granted: true
        })
      ]
    );
    
    // Логируем действие админа
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_premium_30days_grant',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          verified_granted: true
        })
      ]);
    } catch (logError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать админское действие:', logError.message);
    }
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ 30-дневный премиум выдан игроку ${playerId} + verified = true`);
    
    res.json({
      success: true,
      message: '30-дневный премиум и верификация выданы успешно',
      player: updatedPlayer,
      subscription_id: subscriptionResult.rows[0].id
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка выдачи 30-дневного премиума:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// 🏆 POST /grant-premium-forever/:telegramId - Выдача постоянного премиума
router.post('/grant-premium-forever/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (process.env.NODE_ENV === 'development') console.log(`🏆 Админ выдает постоянный премиум игроку: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Выдаем постоянный премиум + verified = true
    await client.query(
      `UPDATE players SET 
       premium_no_ads_forever = TRUE,
       premium_no_ads_until = NULL,
       verified = TRUE
       WHERE telegram_id = $1`,
      [playerId]
    );
    
    // Создаем запись в подписках
    const subscriptionResult = await client.query(
      `INSERT INTO premium_subscriptions (
        telegram_id, 
        subscription_type, 
        payment_method, 
        payment_amount,
        end_date,
        transaction_id,
        granted_by_admin
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        playerId,
        'no_ads_forever',
        'admin_grant',
        0,
        null, // Навсегда
        `admin_forever_${Date.now()}_${playerId}`,
        true
      ]
    );
    
    // Логируем транзакцию
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        playerId,
        'admin_grant',
        'no_ads_forever',
        'admin_grant',
        0,
        'admin',
        'Premium forever granted by admin',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          granted_timestamp: new Date().toISOString(),
          verified_granted: true
        })
      ]
    );
    
    // Логируем действие админа
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_premium_forever_grant',
        JSON.stringify({
          admin_id: req.params.telegramId,
          subscription_id: subscriptionResult.rows[0].id,
          verified_granted: true
        })
      ]);
    } catch (logError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать админское действие:', logError.message);
    }
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ Постоянный премиум выдан игроку ${playerId} + verified = true`);
    
    res.json({
      success: true,
      message: 'Постоянный премиум и верификация выданы успешно',
      player: updatedPlayer,
      subscription_id: subscriptionResult.rows[0].id
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка выдачи постоянного премиума:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// 🚫 POST /revoke-premium/:telegramId - Отмена всех премиум статусов
router.post('/revoke-premium/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    if (process.env.NODE_ENV === 'development') console.log(`🚫 Админ отменяет все премиум статусы игрока: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Сохраняем текущий статус для логирования
    const currentStatus = {
      verified: player.verified,
      premium_no_ads_forever: player.premium_no_ads_forever,
      premium_no_ads_until: player.premium_no_ads_until
    };
    
    // Сбрасываем ВСЕ статусы: премиум + verified
    await client.query(
      `UPDATE players SET 
       premium_no_ads_forever = FALSE,
       premium_no_ads_until = NULL,
       verified = FALSE
       WHERE telegram_id = $1`,
      [playerId]
    );
    
    // Деактивируем все активные подписки
    await client.query(
      `UPDATE premium_subscriptions 
       SET status = 'admin_revoked' 
       WHERE telegram_id = $1 
         AND status = 'active'`,
      [playerId]
    );
    
    // Логируем транзакцию отмены
    await client.query(
      `INSERT INTO premium_transactions (
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        payment_currency,
        description,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        playerId,
        'admin_revoke',
        'all_premium',
        'admin_action',
        0,
        'admin',
        'All premium statuses revoked by admin',
        JSON.stringify({
          admin_id: req.params.telegramId,
          revoked_timestamp: new Date().toISOString(),
          previous_status: currentStatus,
          verified_revoked: true
        })
      ]
    );
    
    // Логируем действие админа
    try {
      await client.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_premium_revoke_all',
        JSON.stringify({
          admin_id: req.params.telegramId,
          previous_status: currentStatus,
          verified_revoked: true
        })
      ]);
    } catch (logError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать админское действие:', logError.message);
    }
    
    await client.query('COMMIT');
    
    const updatedPlayer = await getPlayer(playerId);
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ Все премиум статусы отменены для игрока ${playerId} + verified = false`);
    
    res.json({
      success: true,
      message: 'Все премиум статусы и верификация отменены',
      player: updatedPlayer,
      previous_status: currentStatus
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка отмены премиум статусов:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  } finally {
    client.release();
  }
});

// ✅ POST /grant-basic-verification/:telegramId - Выдача ТОЛЬКО базовой верификации
router.post('/grant-basic-verification/:telegramId', async (req, res) => {
  const { playerId } = req.body;
  
  if (!playerId) {
    return res.status(400).json({ error: 'Player ID is required' });
  }
  
  try {
    if (process.env.NODE_ENV === 'development') console.log(`✅ Админ выдает базовую верификацию игроку: ${playerId}`);
    
    // Проверяем, что игрок существует
    const player = await getPlayer(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Выдаем ТОЛЬКО verified = true (БЕЗ премиум функций)
    await pool.query(
      'UPDATE players SET verified = TRUE WHERE telegram_id = $1',
      [playerId]
    );
    
    // Логируем действие админа
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_basic_verification_grant',
        JSON.stringify({
          admin_id: req.params.telegramId,
          verification_type: 'basic_only',
          premium_granted: false
        })
      ]);
    } catch (logError) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Не удалось логировать верификацию:', logError.message);
    }
    
    const updatedPlayer = await getPlayer(playerId);
    
    if (process.env.NODE_ENV === 'development') console.log(`✅ Базовая верификация выдана игроку ${playerId} (без премиум функций)`);
    
    res.json({
      success: true,
      message: 'Базовая верификация выдана успешно',
      player: updatedPlayer,
      verification_type: 'basic_only'
    });
    
  } catch (err) {
    console.error('❌ Ошибка выдачи базовой верификации:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 📊 GET /premium-overview/:telegramId - Обзор премиум статистики
router.get('/premium-overview/:telegramId', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📊 Админ запрашивает обзор премиум статистики');
    
    // Общая статистика премиум игроков
    const premiumStats = await pool.query(`
      SELECT 
        COUNT(CASE WHEN verified = true THEN 1 END) as total_verified,
        COUNT(CASE WHEN premium_no_ads_forever = true THEN 1 END) as premium_forever,
        COUNT(CASE WHEN premium_no_ads_until > NOW() THEN 1 END) as premium_30days_active,
        COUNT(CASE WHEN premium_no_ads_until IS NOT NULL AND premium_no_ads_until <= NOW() THEN 1 END) as premium_expired,
        COUNT(CASE WHEN verified = true AND premium_no_ads_forever = false AND (premium_no_ads_until IS NULL OR premium_no_ads_until <= NOW()) THEN 1 END) as basic_verified_only
      FROM players
    `);
    
    // Последние премиум транзакции
    const recentTransactions = await pool.query(`
      SELECT 
        telegram_id,
        transaction_type,
        subscription_type,
        payment_method,
        payment_amount,
        description,
        created_at
      FROM premium_transactions 
      ORDER BY created_at DESC 
      LIMIT 20
    `);
    
    // Топ игроков с премиумом
    const premiumPlayers = await pool.query(`
      SELECT 
        telegram_id,
        first_name,
        username,
        verified,
        premium_no_ads_forever,
        premium_no_ads_until,
        created_at
      FROM players 
      WHERE verified = true 
      ORDER BY 
        premium_no_ads_forever DESC,
        premium_no_ads_until DESC NULLS LAST,
        created_at DESC
      LIMIT 15
    `);
    
    res.json({
      success: true,
      stats: premiumStats.rows[0],
      recent_transactions: recentTransactions.rows,
      premium_players: premiumPlayers.rows,
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения премиум обзора:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// 🧪 POST /test-premium-cleanup/:telegramId - Тестовая очистка премиума
router.post('/test-premium-cleanup/:telegramId', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') console.log('🧪 Админ запускает тестовую очистку премиум подписок');
    
    const axios = require('axios');
    const apiUrl = process.env.NODE_ENV === 'production'
      ? 'https://cosmoclick-backend.onrender.com'
      : 'http://localhost:5000';
    
    // Вызываем endpoint очистки
    const response = await axios.post(`${apiUrl}/api/admin/manual-cleanup-premium`, {
      admin_id: req.params.telegramId
    });
    
    res.json({
      success: true,
      message: 'Тестовая очистка завершена',
      cleanup_result: response.data
    });
    
  } catch (err) {
    console.error('❌ Ошибка тестовой очистки:', err);
    res.status(500).json({ 
      error: 'Test cleanup failed', 
      details: err.response?.data?.error || err.message 
    });
  }
});

module.exports = router;