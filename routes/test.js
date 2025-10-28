// routes/test.js - Тестовые эндпоинты для отладки уведомлений
const express = require('express');
const router = express.Router();

// Импортируем функции уведомлений
const { 
  sendAdminNotification,
  notifyStarsDeposit,
  notifyTonDeposit, 
  notifyWithdrawalRequest,
  notifyCriticalEvent,
  sendDailySummary
} = require('./telegramBot');

// 🔐 Middleware для проверки админских прав
const adminAuth = (req, res, next) => {
  const telegramId = req.body.telegramId || req.params.telegramId;
  
  if (String(telegramId) !== '1222791281') {
    return res.status(403).json({ 
      error: 'Access denied - admin only',
      receivedId: telegramId 
    });
  }
  
  next();
};

// 📊 Тестовая ежедневная сводка
router.post('/daily-summary', adminAuth, async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') console.log('🧪 Тестовый запрос ежедневной сводки от админа');
    
    await sendDailySummary();
    
    res.json({
      success: true,
      message: 'Ежедневная сводка отправлена!',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка тестовой сводки:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 💰 Тестовое уведомление о пополнении Stars
router.post('/notify-stars', adminAuth, async (req, res) => {
  try {
    const { playerData, amount } = req.body;
    
    if (!playerData || !amount) {
      return res.status(400).json({
        error: 'playerData и amount обязательны',
        required: ['playerData', 'amount']
      });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('🧪 Тестовое Stars уведомление:', { playerData, amount });
    
    await notifyStarsDeposit(playerData, amount);
    
    res.json({
      success: true,
      message: `Stars уведомление отправлено! ${amount} Stars для ${playerData.first_name}`,
      data: { playerData, amount },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка Stars уведомления:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 💎 Тестовое уведомление о пополнении TON
router.post('/notify-ton', adminAuth, async (req, res) => {
  try {
    const { playerData, amount, transactionHash } = req.body;
    
    if (!playerData || !amount) {
      return res.status(400).json({
        error: 'playerData и amount обязательны',
        required: ['playerData', 'amount', 'transactionHash (опционально)']
      });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('🧪 Тестовое TON уведомление:', { playerData, amount, transactionHash });
    
    await notifyTonDeposit(playerData, amount, transactionHash || 'test_transaction_hash');
    
    res.json({
      success: true,
      message: `TON уведомление отправлено! ${amount} TON для ${playerData.first_name}`,
      data: { playerData, amount, transactionHash },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка TON уведомления:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ===== ДОБАВИТЬ В routes/test.js для тестирования =====

// 🧪 POST /api/test/send-player-message - тестовая отправка сообщения игроку
router.post('/send-player-message', async (req, res) => {
  try {
    const { playerId, message } = req.body;
    
    if (process.env.NODE_ENV === 'development') console.log('🧪 === ТЕСТОВАЯ ОТПРАВКА СООБЩЕНИЯ ИГРОКУ ===');
    if (process.env.NODE_ENV === 'development') console.log('📋 Параметры:', { playerId, message });
    
    if (!playerId || !message) {
      return res.status(400).json({ 
        success: false, 
        error: 'Необходимы playerId и message' 
      });
    }
    
    // Проверяем игрока в базе
    const pool = require('../db');
    const playerResult = await pool.query(
      'SELECT telegram_id, username, first_name FROM players WHERE telegram_id = $1',
      [playerId]
    );
    
    if (playerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Игрок не найден в базе данных',
        player_id: playerId
      });
    }
    
    const player = playerResult.rows[0];
    if (process.env.NODE_ENV === 'development') console.log('👤 Найден игрок:', player);
    
    // Отправляем сообщение
    const axios = require('axios');
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!BOT_TOKEN) {
      return res.status(500).json({
        success: false,
        error: 'TELEGRAM_BOT_TOKEN не настроен'
      });
    }
    
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const testMessage = `🧪 <b>Тестовое сообщение от CosmoClick</b>\n\n${message}\n\n⏰ ${new Date().toLocaleString('ru-RU')}`;
    
    if (process.env.NODE_ENV === 'development') console.log('📤 Отправляем в Telegram:', {
      url: telegramUrl.replace(BOT_TOKEN, 'HIDDEN'),
      chat_id: playerId,
      message_preview: testMessage.substring(0, 100)
    });
    
    const telegramResponse = await axios.post(telegramUrl, {
      chat_id: playerId,
      text: testMessage,
      parse_mode: 'HTML'
    });
    
    if (process.env.NODE_ENV === 'development') console.log('📥 Ответ Telegram:', telegramResponse.data);
    
    if (telegramResponse.data.ok) {
      res.json({
        success: true,
        message: 'Тестовое сообщение отправлено успешно',
        player: player,
        telegram_response: {
          message_id: telegramResponse.data.result.message_id,
          chat_id: telegramResponse.data.result.chat.id
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: `Telegram API ошибка: ${telegramResponse.data.description}`,
        error_code: telegramResponse.data.error_code,
        player: player
      });
    }
    
  } catch (error) {
    console.error('❌ Ошибка тестовой отправки:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// 💸 Тестовое уведомление о заявке на вывод
router.post('/notify-withdrawal', adminAuth, async (req, res) => {
  try {
    const { playerData, amount, withdrawalId } = req.body;
    
    if (!playerData || !amount || !withdrawalId) {
      return res.status(400).json({
        error: 'playerData, amount и withdrawalId обязательны',
        required: ['playerData', 'amount', 'withdrawalId']
      });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('🧪 Тестовое Withdrawal уведомление:', { playerData, amount, withdrawalId });
    
    await notifyWithdrawalRequest(playerData, amount, withdrawalId);
    
    res.json({
      success: true,
      message: `Withdrawal уведомление отправлено! Заявка ${withdrawalId} на ${amount} TON`,
      data: { playerData, amount, withdrawalId },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка Withdrawal уведомления:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🚨 Тестовое критическое уведомление
router.post('/notify-critical', async (req, res) => {
  try {
    const { eventType, details } = req.body;
    
    if (!eventType || !details) {
      return res.status(400).json({
        error: 'eventType и details обязательны',
        required: ['eventType', 'details']
      });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('🧪 Тестовое критическое уведомление:', { eventType, details });
    
    await notifyCriticalEvent(eventType, details);
    
    res.json({
      success: true,
      message: `Критическое уведомление отправлено! ${eventType}`,
      data: { eventType, details },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка критического уведомления:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 🔄 Тестовое обновление курса TON
router.post('/update-ton-rate', adminAuth, async (req, res) => {
  try {
    const { newRate } = req.body;
    
    if (!newRate || newRate <= 0) {
      return res.status(400).json({
        error: 'newRate должен быть положительным числом',
        received: newRate
      });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('🧪 Тестовое обновление курса TON:', newRate);
    
    const pool = require('../db');
    
    // Получаем предыдущий курс
    const prevResult = await pool.query(
      'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY last_updated DESC LIMIT 1',
      ['TON_USD']
    );
    
    const previousRate = prevResult.rows[0]?.rate || 3.30;
    
    // Вставляем новый курс
    await pool.query(`
      INSERT INTO exchange_rates (currency_pair, rate, previous_rate, source, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'TON_USD',
      newRate,
      previousRate,
      'test_manual',
      JSON.stringify({
        test_update: true,
        admin_test: true,
        rate_change_percent: ((newRate - previousRate) / previousRate * 100).toFixed(2)
      })
    ]);
    
    // Обновляем курс Stars → CS
    await pool.query('SELECT update_stars_cs_rate()');
    
    // Отправляем уведомление
    await sendAdminNotification(`🧪 <b>Тестовое обновление курса TON</b>

📈 Курс обновлен: <b>${previousRate} → ${newRate} USD</b>
🔧 Источник: Тестовый запрос
🕐 Время: ${new Date().toLocaleString('ru-RU')}

⚠️ Это тестовое обновление!`);
    
    res.json({
      success: true,
      message: `Курс TON обновлен! ${previousRate} → ${newRate}`,
      data: {
        previousRate,
        newRate,
        changePercent: ((newRate - previousRate) / previousRate * 100).toFixed(2) + '%',
        source: 'test_manual'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка обновления курса TON:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 📱 Тестовое простое уведомление админу
router.post('/simple-message', adminAuth, async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({
        error: 'message обязательно',
        example: '{"message": "Тестовое сообщение!"}'
      });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('🧪 Простое тестовое сообщение:', message);
    
    await sendAdminNotification(`🧪 <b>Тестовое сообщение</b>

${message}

🕐 Отправлено: ${new Date().toLocaleString('ru-RU')}`);
    
    res.json({
      success: true,
      message: 'Простое уведомление отправлено!',
      data: { message },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Ошибка простого уведомления:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 👑 POST /api/test/grant-vip - Простая активация VIP (для теста)
router.post('/grant-vip', async (req, res) => {
  try {
    const { playerId } = req.body;

    if (!playerId) {
      return res.status(400).json({ error: 'playerId обязателен' });
    }

    if (process.env.NODE_ENV === 'development') console.log('🧪 Активация VIP для тестового аккаунта:', playerId);

    const pool = require('../db');

    const result = await pool.query(`
      UPDATE players
      SET premium_no_ads_until = NOW() + INTERVAL '30 days'
      WHERE telegram_id = $1
      RETURNING telegram_id, first_name, premium_no_ads_until, premium_no_ads_forever
    `, [playerId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Игрок не найден' });
    }

    const player = result.rows[0];

    res.json({
      success: true,
      message: 'VIP успешно активирован на 30 дней!',
      player: {
        telegram_id: player.telegram_id,
        name: player.first_name,
        vip_until: player.premium_no_ads_until,
        vip_forever: player.premium_no_ads_forever
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Ошибка активации VIP:', error);
    res.status(500).json({ error: error.message });
  }
});

// 🔄 POST /api/test/reset-player - Полный сброс игрока
router.post('/reset-player', async (req, res) => {
  try {
    const { playerId } = req.body;

    if (!playerId) {
      return res.status(400).json({ error: 'playerId обязателен' });
    }

    if (process.env.NODE_ENV === 'development') console.log('🧪 === ПОЛНЫЙ СБРОС ИГРОКА ===');
    if (process.env.NODE_ENV === 'development') console.log('📋 Player ID:', playerId);

    const pool = require('../db');

    // Удаляем связанные данные БЕЗ транзакции (чтобы ошибки не ломали весь процесс)
    if (process.env.NODE_ENV === 'development') console.log('🗑️ Удаляем связанные данные игрока...');

    const deleteQueries = [
      { table: 'balance_history', query: 'DELETE FROM balance_history WHERE telegram_id = $1' },
      { table: 'player_actions', query: 'DELETE FROM player_actions WHERE telegram_id = $1' },
      { table: 'player_quests', query: 'DELETE FROM player_quests WHERE telegram_id = $1' },
      { table: 'quests', query: 'DELETE FROM quests WHERE telegram_id = $1' },
      { table: 'suspicious_activity', query: 'DELETE FROM suspicious_activity WHERE telegram_id = $1' },
      { table: 'ton_staking', query: 'DELETE FROM ton_staking WHERE telegram_id = $1' },
      { table: 'systems', query: 'DELETE FROM systems WHERE telegram_id = $1' },
      { table: 'honor_board', query: 'DELETE FROM honor_board WHERE telegram_id = $1' },
      { table: 'referrals', query: 'DELETE FROM referrals WHERE referred_telegram_id = $1 OR referrer_telegram_id = $1' },
      { table: 'galactic_empire_ships', query: 'DELETE FROM galactic_empire_ships WHERE player_id = $1' },
      { table: 'galactic_empire_modules', query: 'DELETE FROM galactic_empire_modules WHERE player_id = $1' },
      { table: 'cosmic_fleet_ships', query: 'DELETE FROM cosmic_fleet_ships WHERE player_id = $1' },
      { table: 'cosmic_fleet_formations', query: 'DELETE FROM cosmic_fleet_formations WHERE telegram_id = $1' },
      { table: 'battle_history', query: 'DELETE FROM battle_history WHERE player1_id = $1 OR player2_id = $1' },
    ];

    // Удаляем записи по одной БЕЗ транзакции
    for (const { table, query } of deleteQueries) {
      try {
        const result = await pool.query(query, [playerId]);
        if (process.env.NODE_ENV === 'development') console.log(`   ✅ ${table}: удалено ${result.rowCount} записей`);
      } catch (err) {
        if (process.env.NODE_ENV === 'development') console.log(`   ⚠️ ${table}: ${err.message} (пропускаем)`);
      }
    }

    // Удаляем игрока
    if (process.env.NODE_ENV === 'development') console.log('🗑️ Удаляем игрока из таблицы players...');
    try {
      await pool.query('DELETE FROM players WHERE telegram_id = $1', [playerId]);
      if (process.env.NODE_ENV === 'development') console.log('   ✅ Игрок удален');
    } catch (err) {
      if (process.env.NODE_ENV === 'development') console.log(`   ⚠️ Ошибка удаления игрока: ${err.message}`);
    }

    // Создаем игрока заново
    if (process.env.NODE_ENV === 'development') console.log('👤 Создаем игрока заново...');
    try {
      await pool.query(`
        INSERT INTO players (
          telegram_id, username, ccc, cs, ton,
          asteroids, drones, cargo_levels, unlocked_systems,
          asteroid_total_data, max_cargo_capacity_data, mining_speed_data,
          collected_by_system, last_collection_time, color, created_at
        ) VALUES (
          $1, 'TestUser', 0, 0, 0,
          '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[1]'::jsonb,
          '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
          '{"1": 0, "2": 0, "3": 0, "4": 0}'::jsonb,
          jsonb_build_object(
            '1', NOW(), '2', NOW(), '3', NOW(), '4', NOW()
          ),
          '#00f0ff', NOW()
        )
      `, [playerId]);
      if (process.env.NODE_ENV === 'development') console.log('   ✅ Игрок создан заново!');
    } catch (err) {
      throw new Error(`Не удалось создать игрока: ${err.message}`);
    }

    res.json({
      success: true,
      message: `Игрок ${playerId} полностью обнулен и создан заново!`,
      player_id: playerId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Ошибка сброса игрока:', error);
    res.status(500).json({ error: error.message });
  }
});

// 📋 Список всех доступных тестовых эндпоинтов
router.get('/endpoints', (req, res) => {
  res.json({
    title: '🧪 Тестовые эндпоинты CosmoClick',
    baseUrl: 'https://cosmoclick-backend.onrender.com/api/test',
    adminId: '1222791281',
    endpoints: [
      {
        method: 'POST',
        path: '/daily-summary',
        description: '📊 Отправить ежедневную сводку',
        auth: 'admin',
        body: { telegramId: '1222791281', force: true }
      },
      {
        method: 'POST', 
        path: '/notify-stars',
        description: '💰 Уведомление о пополнении Stars',
        auth: 'admin',
        body: {
          telegramId: '1222791281',
          playerData: { telegram_id: '1222791281', first_name: 'Admin' },
          amount: 100
        }
      },
      {
        method: 'POST',
        path: '/notify-ton', 
        description: '💎 Уведомление о пополнении TON',
        auth: 'admin',
        body: {
          telegramId: '1222791281',
          playerData: { telegram_id: '1222791281', first_name: 'Admin' },
          amount: 5.5,
          transactionHash: 'test123'
        }
      },
      {
        method: 'POST',
        path: '/notify-withdrawal',
        description: '💸 Уведомление о заявке на вывод',
        auth: 'admin', 
        body: {
          telegramId: '1222791281',
          playerData: { telegram_id: '1222791281', first_name: 'Admin' },
          amount: 10.0,
          withdrawalId: 'test_withdrawal_123'
        }
      },
      {
        method: 'POST',
        path: '/notify-critical',
        description: '🚨 Критическое уведомление',
        auth: 'none',
        body: {
          eventType: 'Test Event',
          details: 'Тестовые детали события'
        }
      },
      {
        method: 'POST',
        path: '/update-ton-rate',
        description: '🔄 Обновить курс TON',
        auth: 'admin',
        body: { telegramId: '1222791281', newRate: 6.25 }
      },
      {
        method: 'POST',
        path: '/simple-message',
        description: '📱 Простое сообщение админу',
        auth: 'admin',
        body: { telegramId: '1222791281', message: 'Привет из Postman!' }
      }
    ],
    notes: [
      '🔐 Эндпоинты с auth: admin работают только для ID 1222791281',
      '📱 Все уведомления отправляются в Telegram',
      '🧪 Используйте для отладки и тестирования',
      '⚠️ НЕ используйте в продакшене без проверки прав!'
    ],
    timestamp: new Date().toISOString()
  });
});

module.exports = router;