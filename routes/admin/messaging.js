// routes/admin/messaging.js - Модуль сообщений и рассылок
const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { adminAuth } = require('./auth');

const router = express.Router();

// 🛡️ Все маршруты требуют админских прав
router.use(adminAuth);

// 📱 POST /send-message/:telegramId - отправка сообщения игроку (с отладкой)
router.post('/send-message/:telegramId', async (req, res) => {
  const { playerId, message } = req.body;
  
  console.log('🔍 === ОТЛАДКА ОТПРАВКИ СООБЩЕНИЯ ===');
  console.log('📦 Полученные данные:', { playerId, message, adminId: req.params.telegramId });
  
  if (!playerId || !message?.trim()) {
    console.log('❌ Отсутствуют обязательные поля');
    return res.status(400).json({ error: 'Player ID and message are required' });
  }
  
  try {
    console.log(`📱 Отправка сообщения игроку ${playerId}: "${message}"`);
    
    // Проверяем, что игрок существует
    console.log('🔍 Проверяем существование игрока...');
    const player = await getPlayer(playerId);
    console.log('👤 Данные игрока:', player ? {
      telegram_id: player.telegram_id,
      username: player.username,
      first_name: player.first_name
    } : 'НЕ НАЙДЕН');
    
    if (!player) {
      console.log('❌ Игрок не найден в базе данных');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    // Формируем сообщение
    const fullMessage = `💬 <b>Сообщение от администрации CosmoClick</b>\n\n${message}\n\n🕐 Отправлено: ${new Date().toLocaleString('ru-RU')}`;
    console.log('📝 Сформированное сообщение:', fullMessage);
    
    // Пытаемся отправить через разные способы
    console.log('📤 Начинаем отправку сообщения...');
    
    // Способ 1: Через существующую функцию (если есть)
    try {
      const { sendTelegramMessage } = require('../telegramBot');
      console.log('✅ Функция sendTelegramMessage найдена, используем её');
      await sendTelegramMessage(playerId, fullMessage);
      console.log('✅ Сообщение отправлено через sendTelegramMessage');
    } catch (telegramBotError) {
      console.log('⚠️ Ошибка через telegramBot:', telegramBotError.message);
      
      // Способ 2: Прямой вызов Telegram API
      console.log('🔄 Пробуем прямой вызов Telegram API...');
      
      const axios = require('axios');
      const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!BOT_TOKEN) {
        throw new Error('TELEGRAM_BOT_TOKEN не установлен в переменных окружения');
      }
      
      console.log('🔑 BOT_TOKEN найден:', BOT_TOKEN ? 'ДА (длина: ' + BOT_TOKEN.length + ')' : 'НЕТ');
      
      const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      const payload = {
        chat_id: playerId,
        text: fullMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };
      
      console.log('🌐 URL для запроса:', telegramUrl.replace(BOT_TOKEN, 'HIDDEN_TOKEN'));
      console.log('📦 Payload для Telegram:', { ...payload, text: payload.text.substring(0, 50) + '...' });
      
      const telegramResponse = await axios.post(telegramUrl, payload, {
        timeout: 10000 // 10 секунд таймаут
      });
      
      console.log('📥 Ответ от Telegram API:', {
        ok: telegramResponse.data.ok,
        message_id: telegramResponse.data.result?.message_id,
        error_code: telegramResponse.data.error_code,
        description: telegramResponse.data.description
      });
      
      if (!telegramResponse.data.ok) {
        throw new Error(`Telegram API ошибка: ${telegramResponse.data.description} (код: ${telegramResponse.data.error_code})`);
      }
    }
    
    // Логируем отправку (если таблица существует)
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        playerId,
        'admin_message_sent',
        JSON.stringify({
          admin_id: req.params.telegramId,
          message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
          timestamp: new Date().toISOString(),
          success: true
        })
      ]);
      console.log('📝 Действие залогировано в базу данных');
    } catch (logError) {
      console.log('⚠️ Не удалось логировать отправку сообщения:', logError.message);
    }
    
    console.log(`✅ Сообщение успешно отправлено игроку ${playerId} (${player.first_name || player.username})`);
    
    res.json({
      success: true,
      message: 'Сообщение отправлено успешно',
      player: {
        telegram_id: playerId,
        first_name: player.first_name,
        username: player.username
      },
      debug: {
        message_length: message.length,
        full_message_length: fullMessage.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (err) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА отправки сообщения игроку:', err);
    console.error('❌ Stack trace:', err.stack);
    
    // Дополнительная диагностика
    console.log('🔍 Дополнительная диагностика:');
    console.log('- Player ID тип:', typeof playerId);
    console.log('- Player ID значение:', playerId);
    console.log('- Message тип:', typeof message);
    console.log('- Message длина:', message?.length);
    console.log('- BOT_TOKEN установлен:', !!process.env.TELEGRAM_BOT_TOKEN);
    console.log('- Текущее время:', new Date().toISOString());
    
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message,
      debug: {
        player_id: playerId,
        message_length: message?.length,
        error_type: err.constructor.name,
        bot_token_exists: !!process.env.TELEGRAM_BOT_TOKEN
      }
    });
  }
});

// 📢 POST /broadcast-message/:telegramId - рассылка всем игрокам
router.post('/broadcast-message/:telegramId', async (req, res) => {
  const { message, onlyVerified = false } = req.body;
  
  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }
  
  try {
    console.log(`📢 Начинаем рассылку всем игрокам${onlyVerified ? ' (только верифицированным)' : ''}: "${message}"`);
    
    // Получаем список игроков для рассылки
    const playersQuery = onlyVerified 
      ? 'SELECT telegram_id, first_name, username FROM players WHERE verified = true ORDER BY created_at DESC'
      : 'SELECT telegram_id, first_name, username FROM players ORDER BY created_at DESC';
      
    const playersResult = await pool.query(playersQuery);
    const players = playersResult.rows;
    
    if (players.length === 0) {
      return res.status(400).json({ error: 'Нет игроков для рассылки' });
    }
    
    console.log(`📊 Найдено ${players.length} игроков для рассылки`);
    
    // Формируем сообщение для рассылки
    const { sendTelegramMessage } = require('../telegramBot');
    
    const fullMessage = `📢 <b>Рассылка от администрации CosmoClick</b>\n\n${message}\n\n🕐 Отправлено: ${new Date().toLocaleString('ru-RU')}`;
    
    // Счетчики для статистики
    let sentCount = 0;
    let errorCount = 0;
    const errors = [];
    
    // Отправляем сообщения с задержкой чтобы не превысить лимиты Telegram
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      
      try {
        await sendTelegramMessage(player.telegram_id, fullMessage);
        sentCount++;
        console.log(`✅ Отправлено ${i + 1}/${players.length}: ${player.telegram_id}`);
        
        // Задержка 50ms между сообщениями (20 сообщений в секунду)
        if (i < players.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
      } catch (sendError) {
        errorCount++;
        errors.push({
          player_id: player.telegram_id,
          player_name: player.first_name || player.username,
          error: sendError.message
        });
        console.error(`❌ Ошибка отправки ${i + 1}/${players.length} (${player.telegram_id}):`, sendError.message);
      }
    }
    
    // Логируем рассылку (если таблица существует)
    try {
      await pool.query(`
        INSERT INTO player_actions (telegram_id, action_type, details)
        VALUES ($1, $2, $3)
      `, [
        req.params.telegramId,
        'admin_broadcast_sent',
        JSON.stringify({
          admin_id: req.params.telegramId,
          message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
          total_players: players.length,
          sent_count: sentCount,
          error_count: errorCount,
          only_verified: onlyVerified,
          timestamp: new Date().toISOString()
        })
      ]);
    } catch (logError) {
      console.log('⚠️ Не удалось логировать рассылку:', logError.message);
    }
    
    console.log(`✅ Рассылка завершена. Отправлено: ${sentCount}, ошибок: ${errorCount}`);
    
    res.json({
      success: true,
      message: 'Рассылка завершена',
      statistics: {
        total_players: players.length,
        sent_count: sentCount,
        error_count: errorCount,
        success_rate: Math.round((sentCount / players.length) * 100)
      },
      errors: errorCount > 0 ? errors.slice(0, 10) : [] // Показываем первые 10 ошибок
    });
    
  } catch (err) {
    console.error('❌ Ошибка рассылки сообщений:', err);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: err.message 
    });
  }
});

module.exports = router;