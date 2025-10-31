// ===== telegramBot.js - ОБНОВЛЕННАЯ ВЕРСИЯ =====
const TelegramBot = require('node-telegram-bot-api');
const pool = require('../db');
require('dotenv').config();

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });

// 👑 АДМИНСКИЙ ID ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

const messages = {
  en: { cargoFull: 'Cargo is full!' },
  ru: { cargoFull: 'Грузовой отсек заполнен!' }
};

// 🔥 НОВАЯ ФУНКЦИЯ - УВЕДОМЛЕНИЯ АДМИНУ
const sendAdminNotification = async (messageText, options = {}) => {
  try {
    if (!ADMIN_TELEGRAM_ID) {
      console.warn('⚠️ ADMIN_TELEGRAM_ID не установлен, уведомление не отправлено');
      return false;
    }

    console.log(`📱 [NOTIFICATION] Отправляем уведомление админу ${ADMIN_TELEGRAM_ID}`);
    console.log(`📱 [NOTIFICATION] Текст: ${messageText.slice(0, 150)}...`);

    await bot.sendMessage(ADMIN_TELEGRAM_ID, messageText, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    });

    console.log('✅ [NOTIFICATION] Уведомление админу отправлено успешно');
    return true;
  } catch (err) {
    console.error(`❌ [NOTIFICATION] Ошибка отправки уведомления админу: ${err.message}`);
    console.error(`❌ [NOTIFICATION] Stack:`, err.stack);
    return false;
  }
};

// 💰 УВЕДОМЛЕНИЕ О ПОПОЛНЕНИИ STARS
const notifyStarsDeposit = async (playerData, amount) => {
  try {
    const message = `💰 <b>Пополнение Stars</b>

👤 Игрок: <b>${playerData.first_name || playerData.username || 'Аноним'}</b>
🆔 ID: <code>${playerData.telegram_id}</code>
⭐ Сумма: <b>${amount} Stars</b>
💵 ~$${(amount * 0.013).toFixed(2)}

🕐 Время: ${new Date().toLocaleString('ru-RU')}`;

    await sendAdminNotification(message, {
      reply_markup: {
        inline_keyboard: [[
          { text: '👤 Профиль игрока', callback_data: `player_${playerData.telegram_id}` },
          { text: '📊 Статистика', callback_data: 'admin_stats' }
        ]]
      }
    });
  } catch (err) {
    console.error('❌ Ошибка уведомления о Stars:', err);
  }
};

// 💎 УВЕДОМЛЕНИЕ О ПОПОЛНЕНИИ TON
const notifyTonDeposit = async (playerData, amount, transactionHash) => {
  try {
    const message = `💎 <b>Пополнение TON</b>

👤 Игрок: <b>${playerData.first_name || playerData.username || 'Аноним'}</b>
🆔 ID: <code>${playerData.telegram_id}</code>
💎 Сумма: <b>${amount} TON</b>
💵 ~$${(amount * 3.30).toFixed(2)}

🔗 Hash: <code>${transactionHash?.slice(0, 20)}...</code>
🕐 Время: ${new Date().toLocaleString('ru-RU')}`;

    await sendAdminNotification(message, {
      reply_markup: {
        inline_keyboard: [[
          { text: '👤 Профиль игрока', callback_data: `player_${playerData.telegram_id}` },
          { text: '🔍 Транзакция', url: `https://tonscan.org/tx/${transactionHash}` }
        ]]
      }
    });
  } catch (err) {
    console.error('❌ Ошибка уведомления о TON:', err);
  }
};

// 💸 УВЕДОМЛЕНИЕ О ЗАЯВКЕ НА ВЫВОД
const notifyWithdrawalRequest = async (playerData, amount, withdrawalId) => {
  try {
    const message = `💸 <b>Заявка на вывод TON</b>

👤 Игрок: <b>${playerData.first_name || playerData.username || 'Аноним'}</b>
🆔 ID: <code>${playerData.telegram_id}</code>
💸 Сумма: <b>${amount} TON</b>
💵 ~$${(amount * 3.30).toFixed(2)}

🔢 ID заявки: <code>${withdrawalId}</code>
🕐 Время: ${new Date().toLocaleString('ru-RU')}

⚠️ <b>Требует ручного подтверждения!</b>`;

    await sendAdminNotification(message, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Одобрить', callback_data: `approve_${withdrawalId}` },
            { text: '❌ Отклонить', callback_data: `reject_${withdrawalId}` }
          ],
          [
            { text: '👤 Профиль игрока', callback_data: `player_${playerData.telegram_id}` }
          ]
        ]
      }
    });
  } catch (err) {
    console.error('❌ Ошибка уведомления о выводе:', err);
  }
};

// 🚨 КРИТИЧЕСКОЕ УВЕДОМЛЕНИЕ (ОШИБКИ, ПОДОЗРИТЕЛЬНАЯ АКТИВНОСТЬ)
const notifyCriticalEvent = async (eventType, details) => {
  try {
    const message = `🚨 <b>Критическое событие</b>

⚠️ Тип: <b>${eventType}</b>
📋 Детали: ${details}

🕐 Время: ${new Date().toLocaleString('ru-RU')}`;

    await sendAdminNotification(message);
  } catch (err) {
    console.error('❌ Ошибка критического уведомления:', err);
  }
};

// 📊 ЕЖЕДНЕВНАЯ СВОДКА (ФУНКЦИЯ ДЛЯ CRON)
const sendDailySummary = async () => {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📊 Генерируем ежедневную сводку...');

    // Получаем данные за последние 24 часа
    const summaryData = await pool.query(`
      WITH daily_stats AS (
        -- Новые игроки
        SELECT COUNT(*) as new_players
        FROM players 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      ),
      stars_stats AS (
        -- Stars транзакции
        SELECT 
          COUNT(*) as stars_transactions,
          COALESCE(SUM(amount), 0) as total_stars,
          COALESCE(SUM(amount * 0.013), 0) as total_stars_usd
        FROM star_transactions 
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND transaction_type = 'deposit'
          AND status = 'completed'
      ),
      ton_stats AS (
        -- TON транзакции
        SELECT 
          COUNT(*) as ton_transactions,
          COALESCE(SUM(amount), 0) as total_ton,
          COALESCE(SUM(amount * 3.30), 0) as total_ton_usd
        FROM ton_deposits 
        WHERE created_at > NOW() - INTERVAL '24 hours'
          AND status = 'completed'
      ),
      withdrawal_stats AS (
        -- Заявки на вывод
        SELECT 
          COUNT(*) as withdrawal_requests,
          COALESCE(SUM(amount), 0) as total_withdrawal_amount
        FROM withdrawals 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      )
      SELECT 
        d.new_players,
        s.stars_transactions, s.total_stars, s.total_stars_usd,
        t.ton_transactions, t.total_ton, t.total_ton_usd,
        w.withdrawal_requests, w.total_withdrawal_amount
      FROM daily_stats d, stars_stats s, ton_stats t, withdrawal_stats w
    `);

    const stats = summaryData.rows[0];

    // Общая статистика системы
    const systemStats = await pool.query(`
      SELECT 
        COUNT(*) as total_players,
        COUNT(CASE WHEN verified = true THEN 1 END) as verified_players,
        COALESCE(SUM(CAST(telegram_stars AS INTEGER)), 0) as total_stars_in_system,
        COALESCE(SUM(ton), 0) as total_ton_in_system
      FROM players
    `);

    const system = systemStats.rows[0];

    const totalRevenue = parseFloat(stats.total_stars_usd || 0) + parseFloat(stats.total_ton_usd || 0);

    const message = `📊 <b>Ежедневная сводка CosmoClick</b>
<i>${new Date().toLocaleDateString('ru-RU')}</i>

👥 <b>Игроки:</b>
• Новых за 24ч: <b>${stats.new_players || 0}</b>
• Всего: <b>${system.total_players || 0}</b>
• Верифицированных: <b>${system.verified_players || 0}</b>

💰 <b>Доходы за 24ч:</b>
• ⭐ Stars: <b>${stats.total_stars || 0}</b> (~$${parseFloat(stats.total_stars_usd || 0).toFixed(2)})
• 💎 TON: <b>${parseFloat(stats.total_ton || 0).toFixed(4)}</b> (~$${parseFloat(stats.total_ton_usd || 0).toFixed(2)})
• 📈 <b>Общий доход: $${totalRevenue.toFixed(2)}</b>

💸 <b>Выводы за 24ч:</b>
• Заявок: <b>${stats.withdrawal_requests || 0}</b>
• Сумма: <b>${parseFloat(stats.total_withdrawal_amount || 0).toFixed(4)} TON</b>

💳 <b>Состояние системы:</b>
• Stars в игре: <b>${system.total_stars_in_system || 0}</b>
• TON в игре: <b>${parseFloat(system.total_ton_in_system || 0).toFixed(4)}</b>

⏰ Сводка на ${new Date().toLocaleString('ru-RU')}`;

    await sendAdminNotification(message, {
      reply_markup: {
        inline_keyboard: [[
          { text: '📊 Подробная статистика', callback_data: 'full_stats' },
          { text: '🎮 Открыть админку', url: 'https://cosmoclick-frontend.vercel.app/admin' }
        ]]
      }
    });

    if (process.env.NODE_ENV === 'development') console.log('✅ Ежедневная сводка отправлена успешно');
  } catch (err) {
    console.error('❌ Ошибка отправки ежедневной сводки:', err);
  }
};

// СУЩЕСТВУЮЩАЯ ФУНКЦИЯ (БЕЗ ИЗМЕНЕНИЙ)
const sendNotification = async (telegramId, messageKey, isPremium = false) => {
  try {
    const playerResult = await pool.query('SELECT verified, language FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (!player || (!isPremium && !player.verified)) return;

    const language = player.language || 'en';
    const message = messages[language] && messages[language][messageKey] ? messages[language][messageKey] : messages.en[messageKey];

    await bot.sendMessage(telegramId, message);
    if (process.env.NODE_ENV === 'development') console.log(`Notification sent to ${telegramId}: ${message}`);
  } catch (err) {
    console.error(`Failed to send notification to ${telegramId}: ${err.message}`);
  }
};

// ===== ДОБАВИТЬ В telegramBot.js - ОБРАБОТЧИКИ КНОПОК =====

// 🔧 НАСТРОЙКА ОБРАБОТКИ CALLBACK ЗАПРОСОВ
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  if (process.env.NODE_ENV === 'development') console.log(`📱 Callback от админа: ${data}`);

  try {
    if (data.startsWith('player_')) {
      // Показать профиль игрока
      const playerId = data.replace('player_', '');
      await handlePlayerProfile(chatId, messageId, playerId);
    } 
    else if (data.startsWith('approve_')) {
      // Одобрить вывод
      const withdrawalId = data.replace('approve_', '');
      await handleApproveWithdrawal(chatId, messageId, withdrawalId);
    }
    else if (data.startsWith('reject_')) {
      // Отклонить вывод
      const withdrawalId = data.replace('reject_', '');
      await handleRejectWithdrawal(chatId, messageId, withdrawalId);
    }
    else if (data === 'admin_stats') {
      // Показать статистику
      await handleAdminStats(chatId, messageId);
    }
    else if (data === 'full_stats') {
      // Подробная статистика
      await handleFullStats(chatId, messageId);
    }

    // Отвечаем на callback
    await bot.answerCallbackQuery(callbackQuery.id);

  } catch (error) {
    console.error('❌ Ошибка обработки callback:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: 'Произошла ошибка', 
      show_alert: true 
    });
  }
});

// 👤 ОБРАБОТЧИК ПРОФИЛЯ ИГРОКА
const handlePlayerProfile = async (chatId, messageId, playerId) => {
  try {
    const playerResult = await pool.query(`
      SELECT 
        telegram_id, first_name, username, verified,
        ccc, cs, ton, telegram_stars, created_at,
        referrer_id, referrals_count
      FROM players 
      WHERE telegram_id = $1
    `, [playerId]);

    if (playerResult.rows.length === 0) {
      await bot.editMessageText('❌ Игрок не найден', {
        chat_id: chatId,
        message_id: messageId
      });
      return;
    }

    const player = playerResult.rows[0];
    
    const profileText = `👤 <b>Профиль игрока</b>

🆔 ID: <code>${player.telegram_id}</code>
👤 Имя: <b>${player.first_name || 'Не указано'}</b>
📛 Username: ${player.username ? `@${player.username}` : 'Не указан'}
✅ Статус: ${player.verified ? '✅ Верифицирован' : '❌ Не верифицирован'}

💰 <b>Баланс:</b>
• CCC: <b>${parseFloat(player.ccc || 0).toFixed(2)}</b>
• CS: <b>${parseFloat(player.cs || 0).toFixed(2)}</b>
• TON: <b>${parseFloat(player.ton || 0).toFixed(4)}</b>
• Stars: <b>${parseInt(player.telegram_stars || 0)}</b>

👥 <b>Рефералы:</b>
• Привлечен: ${player.referrer_id ? `<code>${player.referrer_id}</code>` : 'Нет'}
• Привлек: <b>${player.referrals_count || 0}</b> чел.

📅 Регистрация: <i>${new Date(player.created_at).toLocaleDateString('ru-RU')}</i>`;

    await bot.editMessageText(profileText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Верифицировать', callback_data: `verify_${playerId}` },
            { text: '🚫 Заблокировать', callback_data: `block_${playerId}` }
          ],
          [
            { text: '← Назад', callback_data: 'admin_stats' }
          ]
        ]
      }
    });

  } catch (error) {
    console.error('❌ Ошибка получения профиля игрока:', error);
    await bot.editMessageText('❌ Ошибка загрузки профиля игрока', {
      chat_id: chatId,
      message_id: messageId
    });
  }
};

// ✅ ОБРАБОТЧИК ОДОБРЕНИЯ ВЫВОДА
const handleApproveWithdrawal = async (chatId, messageId, withdrawalId) => {
  try {
    const withdrawalResult = await pool.query(`
      SELECT w.*, p.first_name, p.username 
      FROM withdrawals w
      JOIN players p ON w.player_id = p.telegram_id
      WHERE w.id = $1 AND w.status = 'pending'
    `, [withdrawalId]);

    if (withdrawalResult.rows.length === 0) {
      await bot.editMessageText('❌ Заявка не найдена или уже обработана', {
        chat_id: chatId,
        message_id: messageId
      });
      return;
    }

    const withdrawal = withdrawalResult.rows[0];

    // Обновляем статус на одобрено
    await pool.query(
      'UPDATE withdrawals SET status = $1, processed_at = NOW(), processed_by = $2 WHERE id = $3',
      ['approved', ADMIN_TELEGRAM_ID, withdrawalId]
    );

    const approvedText = `✅ <b>Вывод одобрен</b>

👤 Игрок: <b>${withdrawal.first_name || withdrawal.username}</b>
🆔 ID: <code>${withdrawal.player_id}</code>
💸 Сумма: <b>${withdrawal.amount} TON</b>
🔢 Заявка: <code>${withdrawalId}</code>
✅ Статус: <b>ОДОБРЕНО</b>
🕐 Обработано: ${new Date().toLocaleString('ru-RU')}

⚠️ <b>Не забудьте отправить TON игроку!</b>`;

    await bot.editMessageText(approvedText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Средства отправлены', callback_data: `sent_${withdrawalId}` }
        ]]
      }
    });

    // Уведомляем игрока
    try {
      await bot.sendMessage(withdrawal.player_id, 
        `✅ Ваша заявка на вывод ${withdrawal.amount} TON одобрена!\n\nСредства будут отправлены в ближайшее время.`
      );
    } catch (playerNotifyError) {
      console.error('❌ Не удалось уведомить игрока:', playerNotifyError);
    }

  } catch (error) {
    console.error('❌ Ошибка одобрения вывода:', error);
    await bot.editMessageText('❌ Ошибка при одобрении вывода', {
      chat_id: chatId,
      message_id: messageId
    });
  }
};

// ❌ ОБРАБОТЧИК ОТКЛОНЕНИЯ ВЫВОДА
const handleRejectWithdrawal = async (chatId, messageId, withdrawalId) => {
  try {
    const withdrawalResult = await pool.query(`
      SELECT w.*, p.first_name, p.username 
      FROM withdrawals w
      JOIN players p ON w.player_id = p.telegram_id
      WHERE w.id = $1 AND w.status = 'pending'
    `, [withdrawalId]);

    if (withdrawalResult.rows.length === 0) {
      await bot.editMessageText('❌ Заявка не найдена или уже обработана', {
        chat_id: chatId,
        message_id: messageId
      });
      return;
    }

    const withdrawal = withdrawalResult.rows[0];

    // Обновляем статус на отклонено
    await pool.query(
      'UPDATE withdrawals SET status = $1, processed_at = NOW(), processed_by = $2 WHERE id = $3',
      ['rejected', ADMIN_TELEGRAM_ID, withdrawalId]
    );

    const rejectedText = `❌ <b>Вывод отклонен</b>

👤 Игрок: <b>${withdrawal.first_name || withdrawal.username}</b>
🆔 ID: <code>${withdrawal.player_id}</code>
💸 Сумма: <b>${withdrawal.amount} TON</b>
🔢 Заявка: <code>${withdrawalId}</code>
❌ Статус: <b>ОТКЛОНЕНО</b>
🕐 Обработано: ${new Date().toLocaleString('ru-RU')}`;

    await bot.editMessageText(rejectedText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML'
    });

    // Уведомляем игрока
    try {
      await bot.sendMessage(withdrawal.player_id, 
        `❌ Ваша заявка на вывод ${withdrawal.amount} TON отклонена.\n\nЕсли у вас есть вопросы, обратитесь в поддержку.`
      );
    } catch (playerNotifyError) {
      console.error('❌ Не удалось уведомить игрока:', playerNotifyError);
    }

  } catch (error) {
    console.error('❌ Ошибка отклонения вывода:', error);
    await bot.editMessageText('❌ Ошибка при отклонении вывода', {
      chat_id: chatId,
      message_id: messageId
    });
  }
};

// 📊 ОБРАБОТЧИК БЫСТРОЙ СТАТИСТИКИ
const handleAdminStats = async (chatId, messageId) => {
  try {
    const quickStats = await pool.query(`
      SELECT 
        COUNT(*) as total_players,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END) as new_players_24h,
        COUNT(CASE WHEN verified = true THEN 1 END) as verified_players,
        COALESCE(SUM(CAST(telegram_stars AS INTEGER)), 0) as total_stars,
        COALESCE(SUM(ton), 0) as total_ton
      FROM players
    `);

    const stats = quickStats.rows[0];

    const statsText = `📊 <b>Быстрая статистика</b>

👥 <b>Игроки:</b>
• Всего: <b>${stats.total_players}</b>
• За 24ч: <b>${stats.new_players_24h}</b>
• Верифицированных: <b>${stats.verified_players}</b>

💰 <b>Средства в системе:</b>
• Stars: <b>${stats.total_stars}</b>
• TON: <b>${parseFloat(stats.total_ton).toFixed(4)}</b>

🕐 Обновлено: ${new Date().toLocaleString('ru-RU')}`;

    await bot.editMessageText(statsText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 Подробная статистика', callback_data: 'full_stats' },
            { text: '🎮 Админка', url: 'https://cosmoclick-frontend.vercel.app/admin' }
          ],
          [
            { text: '📨 Отправить сводку', callback_data: 'send_summary' }
          ]
        ]
      }
    });

  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error);
    await bot.editMessageText('❌ Ошибка загрузки статистики', {
      chat_id: chatId,
      message_id: messageId
    });
  }
};

// 📈 ОБРАБОТЧИК ПОДРОБНОЙ СТАТИСТИКИ
const handleFullStats = async (chatId, messageId) => {
  try {
    await sendDailySummary(); // Отправляем полную сводку
    
    await bot.editMessageText('✅ Подробная статистика отправлена отдельным сообщением', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: {
        inline_keyboard: [[
          { text: '← Назад к быстрой статистике', callback_data: 'admin_stats' }
        ]]
      }
    });

  } catch (error) {
    console.error('❌ Ошибка отправки подробной статистики:', error);
    await bot.editMessageText('❌ Ошибка отправки подробной статистики', {
      chat_id: chatId,
      message_id: messageId
    });
  }
};

// ===== ДОБАВИТЬ В routes/telegramBot.js =====

// 📱 Функция для отправки сообщений игрокам
const sendTelegramMessage = async (telegramId, message) => {
  try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    
    if (!BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN не установлен');
    }
    
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    const payload = {
      chat_id: telegramId,
      text: message,
      parse_mode: 'HTML', // Поддержка HTML разметки
      disable_web_page_preview: true
    };
    
    if (process.env.NODE_ENV === 'development') console.log(`📤 Отправляем сообщение в Telegram: ${telegramId}`);
    
    const response = await axios.post(url, payload);
    
    if (response.data.ok) {
      if (process.env.NODE_ENV === 'development') console.log(`✅ Сообщение отправлено успешно: ${telegramId}`);
      return response.data;
    } else {
      throw new Error(`Telegram API ошибка: ${response.data.description}`);
    }
    
  } catch (error) {
    console.error(`❌ Ошибка отправки сообщения в Telegram (${telegramId}):`, error.message);
    
    // Обрабатываем специфичные ошибки Telegram
    if (error.response?.data?.error_code === 403) {
      throw new Error('Пользователь заблокировал бота');
    } else if (error.response?.data?.error_code === 400) {
      throw new Error('Неверный chat_id или сообщение');
    } else if (error.response?.data?.error_code === 429) {
      throw new Error('Превышен лимит запросов Telegram API');
    } else {
      throw new Error(error.message || 'Неизвестная ошибка отправки');
    }
  }
};

// ===== ДОБАВИТЬ В КОНЕЦ ФАЙЛА ПЕРЕД module.exports =====
module.exports = {
  sendDailySummary,
  sendAdminNotification,
  sendTelegramMessage // НОВЫЙ ЭКСПОРТ
};

// 🔄 ЭКСПОРТ ДОПОЛНИТЕЛЬНЫХ ФУНКЦИЙ
module.exports = { 
  sendNotification,
  sendAdminNotification,
  notifyStarsDeposit,
  notifyTonDeposit, 
  notifyWithdrawalRequest,
  notifyCriticalEvent,
  sendDailySummary,
  // Новые функции
  handlePlayerProfile,
  handleApproveWithdrawal,
  handleRejectWithdrawal
};

module.exports = { 
  sendNotification,
  sendAdminNotification,
  notifyStarsDeposit,
  notifyTonDeposit, 
  notifyWithdrawalRequest,
  notifyCriticalEvent,
  sendDailySummary
};