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
    console.log('🧪 Тестовый запрос ежедневной сводки от админа');
    
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
    
    console.log('🧪 Тестовое Stars уведомление:', { playerData, amount });
    
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
    
    console.log('🧪 Тестовое TON уведомление:', { playerData, amount, transactionHash });
    
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
    
    console.log('🧪 === ТЕСТОВАЯ ОТПРАВКА СООБЩЕНИЯ ИГРОКУ ===');
    console.log('📋 Параметры:', { playerId, message });
    
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
    console.log('👤 Найден игрок:', player);
    
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
    
    console.log('📤 Отправляем в Telegram:', {
      url: telegramUrl.replace(BOT_TOKEN, 'HIDDEN'),
      chat_id: playerId,
      message_preview: testMessage.substring(0, 100)
    });
    
    const telegramResponse = await axios.post(telegramUrl, {
      chat_id: playerId,
      text: testMessage,
      parse_mode: 'HTML'
    });
    
    console.log('📥 Ответ Telegram:', telegramResponse.data);
    
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
    
    console.log('🧪 Тестовое Withdrawal уведомление:', { playerData, amount, withdrawalId });
    
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
    
    console.log('🧪 Тестовое критическое уведомление:', { eventType, details });
    
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
    
    console.log('🧪 Тестовое обновление курса TON:', newRate);
    
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
    
    console.log('🧪 Простое тестовое сообщение:', message);
    
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