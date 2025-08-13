// index.js - ПОЛНЫЙ файл с ИСПРАВЛЕННЫМ cron job

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: [
    'https://cosmoclick-frontend.vercel.app',
    'http://localhost:3000',
    'https://t.me'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Routes
app.use('/api/players', require('./routes/players'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/exchange', require('./routes/exchange'));
app.use('/api/minigames', require('./routes/minigames'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/test', require('./routes/telegramBot'));

// ===== 🔥 ИСПРАВЛЕННАЯ ФУНКЦИЯ ОЧИСТКИ ПРЕМИУМА =====
const cleanupExpiredPremium = async () => {
  console.log('🧹 === НАЧИНАЕМ ОЧИСТКУ ИСТЕКШИХ ПРЕМИУМ ПОДПИСОК (UNIFIED) ===');
  console.log('⏰ Время:', new Date().toISOString());
  
  try {
    // 1. Обновляем статус истекших подписок в таблице premium_subscriptions
    console.log('📋 Шаг 1: Обновляем статус истекших подписок...');
    const expiredSubscriptionsResult = await pool.query(
      `UPDATE premium_subscriptions 
       SET status = 'expired' 
       WHERE status = 'active' 
         AND end_date IS NOT NULL 
         AND end_date < NOW()
       RETURNING telegram_id, subscription_type, end_date`
    );
    
    const expiredSubscriptions = expiredSubscriptionsResult.rows;
    console.log(`   ✅ Обновлено подписок: ${expiredSubscriptions.length}`);
    
    if (expiredSubscriptions.length > 0) {
      console.log('   📄 Истекшие подписки:', expiredSubscriptions.map(s => 
        `ID: ${s.telegram_id}, тип: ${s.subscription_type}, истек: ${s.end_date}`
      ));
    }

    // 🔥 2. ГЛАВНОЕ ИЗМЕНЕНИЕ: Очищаем премиум поля И СБРАСЫВАЕМ VERIFIED
    console.log('🔥 Шаг 2: Очищаем премиум статус И verified у игроков...');
    const cleanedPlayersResult = await pool.query(
      `UPDATE players 
       SET premium_no_ads_until = NULL,
           verified = FALSE
       WHERE premium_no_ads_until IS NOT NULL 
         AND premium_no_ads_until < NOW()
         AND premium_no_ads_forever = FALSE
       RETURNING telegram_id, first_name, username`
    );
    
    const cleanedPlayers = cleanedPlayersResult.rows;
    console.log(`   ✅ Очищено игроков: ${cleanedPlayers.length}`);
    console.log(`   🚫 Verified сброшен у: ${cleanedPlayers.map(p => `${p.telegram_id} (${p.first_name || p.username})`).join(', ')}`);

    // 3. Логируем транзакции для аудита
    console.log('📝 Шаг 3: Логируем транзакции expiration...');
    for (const player of cleanedPlayers) {
      try {
        await pool.query(
          `INSERT INTO premium_transactions (
            telegram_id,
            transaction_type,
            subscription_type,
            description,
            metadata
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            player.telegram_id,
            'expiration',
            'no_ads_30_days',
            'Premium subscription expired - verified status revoked by cron',
            JSON.stringify({
              expired_at: new Date().toISOString(),
              verified_revoked: true,
              cleanup_job: true,
              cron_execution: true
            })
          ]
        );
      } catch (logError) {
        console.error(`   ⚠️ Ошибка логирования для ${player.telegram_id}:`, logError.message);
      }
    }

    // 4. Уведомляем игроков об истечении (опционально)
    console.log('📬 Шаг 4: Отправляем уведомления об истечении...');
    let notificationsSent = 0;
    
    for (const player of cleanedPlayers) {
      try {
        // Получаем экземпляр бота для уведомлений
        const { Telegraf } = require('telegraf');
        const notifyBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        
        await notifyBot.telegram.sendMessage(
          player.telegram_id,
          `⏰ Ваша премиум подписка истекла!\n\n🚫 Реклама снова включена\n❌ Верификация отозвана\n\n💎 Продлите подписку, чтобы снова наслаждаться игрой без рекламы и с верификацией!`,
          {
            reply_markup: {
              inline_keyboard: [[{
                text: '🛒 Купить премиум',
                web_app: { url: 'https://cosmoclick-frontend.vercel.app' }
              }]]
            }
          }
        );
        
        notificationsSent++;
        console.log(`   📧 Уведомление отправлено: ${player.telegram_id}`);
        
        // Небольшая задержка между уведомлениями (чтобы не превысить лимиты Telegram)
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (notifyError) {
        console.error(`   ⚠️ Ошибка уведомления ${player.telegram_id}:`, notifyError.message);
      }
    }

    // 5. Уведомляем админа о результатах очистки
    if (cleanedPlayers.length > 0) {
      try {
        const { Telegraf } = require('telegraf');
        const adminBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        const adminId = process.env.ADMIN_TELEGRAM_ID;
        
        if (adminId) {
          await adminBot.telegram.sendMessage(
            adminId,
            `🧹 Автоматическая очистка премиума завершена!\n\n📊 Результаты:\n• Истекших подписок: ${expiredSubscriptions.length}\n• Игроков очищено: ${cleanedPlayers.length}\n• Verified сброшен у: ${cleanedPlayers.length}\n• Уведомлений отправлено: ${notificationsSent}\n\n⏰ Время: ${new Date().toLocaleString('ru-RU')}`
          );
        }
      } catch (adminNotifyError) {
        console.error('⚠️ Не удалось уведомить админа о результатах:', adminNotifyError.message);
      }
    }

    // 6. Итоговая статистика
    console.log('📊 === РЕЗУЛЬТАТЫ ОЧИСТКИ ===');
    console.log(`✅ Истекших подписок обновлено: ${expiredSubscriptions.length}`);
    console.log(`✅ Игроков очищено: ${cleanedPlayers.length}`);
    console.log(`🔥 Verified статус сброшен у: ${cleanedPlayers.length} игроков`);
    console.log(`✅ Уведомлений отправлено: ${notificationsSent}`);
    console.log('🏁 Очистка истекших премиум подписок завершена успешно (UNIFIED система)');

    // 7. Возвращаем результат для внешних вызовов
    return {
      success: true,
      expired_subscriptions: expiredSubscriptions.length,
      cleaned_players: cleanedPlayers.length,
      notifications_sent: notificationsSent,
      verified_revoked: cleanedPlayers.length, // 🔥 НОВОЕ ПОЛЕ
      affected_players: cleanedPlayers.map(p => ({
        telegram_id: p.telegram_id,
        name: p.first_name || p.username
      }))
    };

  } catch (error) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА при очистке истекших подписок:', error);
    console.error('❌ Stack trace:', error.stack);
    
    // Уведомляем админа об ошибке cron job
    try {
      const { Telegraf } = require('telegraf');
      const adminBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      const adminId = process.env.ADMIN_TELEGRAM_ID;
      
      if (adminId) {
        await adminBot.telegram.sendMessage(
          adminId,
          `🚨 ОШИБКА CRON JOB (UNIFIED)!\n\nОчистка истекших премиум подписок не удалась:\n\n${error.message}\n\nВремя: ${new Date().toLocaleString('ru-RU')}\n\n⚠️ Возможно нужно проверить базу данных или логи сервера.`
        );
      }
    } catch (adminNotifyError) {
      console.error('❌ Не удалось уведомить админа об ошибке:', adminNotifyError.message);
    }
    
    throw error;
  }
};

// ===== 🔥 ИСПРАВЛЕННЫЙ CRON JOB =====
// Запускаем каждый час (в минуту 0)
cron.schedule('0 * * * *', async () => {
  console.log('⏰ === ЗАПУСК CRON JOB: ОЧИСТКА ИСТЕКШИХ ПРЕМИУМ ПОДПИСОК (UNIFIED) ===');
  try {
    await cleanupExpiredPremium();
  } catch (error) {
    console.error('❌ Cron job failed:', error);
  }
});

// АЛЬТЕРНАТИВНО: если нужно чаще проверять (каждые 30 минут):
// cron.schedule('*/30 * * * *', async () => {
//   console.log('⏰ ЗАПУСК CRON JOB: очистка истекших премиум подписок (каждые 30 мин)');
//   try {
//     await cleanupExpiredPremium();
//   } catch (error) {
//     console.error('❌ Cron job failed:', error);
//   }
// });

// ===== 🔧 ENDPOINT ДЛЯ РУЧНОЙ ОЧИСТКИ АДМИНОМ =====
app.post('/api/admin/manual-cleanup-premium', async (req, res) => {
  const { admin_id } = req.body;
  
  console.log('🔧 Запрос ручной очистки от:', admin_id);
  
  // Проверяем админа
  if (!admin_id || String(admin_id).trim() !== String(process.env.ADMIN_TELEGRAM_ID).trim()) {
    console.log('🚫 Доступ запрещен для:', admin_id, 'ожидается:', process.env.ADMIN_TELEGRAM_ID);
    return res.status(403).json({ error: 'Access denied - not admin' });
  }
  
  try {
    console.log('🔧 Ручная очистка премиум подписок запущена админом:', admin_id);
    const result = await cleanupExpiredPremium();
    
    console.log('✅ Ручная очистка завершена успешно:', result);
    
    res.json({
      success: true,
      message: 'Manual cleanup completed successfully (UNIFIED system)',
      cleanup_type: 'unified_verification',
      ...result
    });
  } catch (error) {
    console.error('❌ Ошибка ручной очистки:', error);
    res.status(500).json({ 
      error: 'Manual cleanup failed', 
      details: error.message 
    });
  }
});

// ===== 🔄 ДОПОЛНИТЕЛЬНЫЕ ENDPOINTS ДЛЯ ОТЛАДКИ =====

// Endpoint для проверки статуса cron job
app.get('/api/admin/cron-status/:adminId', async (req, res) => {
  const { adminId } = req.params;
  
  if (String(adminId).trim() !== String(process.env.ADMIN_TELEGRAM_ID).trim()) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    // Проверяем последние истекшие подписки
    const expiredCheck = await pool.query(`
      SELECT COUNT(*) as expired_count
      FROM players 
      WHERE premium_no_ads_until IS NOT NULL 
        AND premium_no_ads_until < NOW()
        AND premium_no_ads_forever = FALSE
    `);
    
    // Проверяем активные подписки
    const activeCheck = await pool.query(`
      SELECT COUNT(*) as active_count
      FROM players 
      WHERE (premium_no_ads_forever = TRUE OR premium_no_ads_until > NOW())
    `);
    
    res.json({
      success: true,
      cron_status: 'running',
      next_cleanup: 'every hour at minute 0',
      current_time: new Date().toISOString(),
      expired_subscriptions_pending: parseInt(expiredCheck.rows[0].expired_count),
      active_premium_users: parseInt(activeCheck.rows[0].active_count),
      unified_system: true
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Failed to check cron status', details: error.message });
  }
});

// Endpoint для форсированной очистки (только для экстренных случаев)
app.post('/api/admin/force-cleanup-all/:adminId', async (req, res) => {
  const { adminId } = req.params;
  
  if (String(adminId).trim() !== String(process.env.ADMIN_TELEGRAM_ID).trim()) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    console.log('🚨 ФОРСИРОВАННАЯ ОЧИСТКА всех истекших подписок запущена админом:', adminId);
    
    // Форсированно очищаем ВСЕ истекшие подписки
    const forceCleanResult = await pool.query(`
      UPDATE players 
      SET premium_no_ads_until = NULL,
          verified = CASE 
            WHEN premium_no_ads_forever = TRUE THEN TRUE
            ELSE FALSE 
          END
      WHERE premium_no_ads_until IS NOT NULL 
        AND premium_no_ads_until <= NOW()
      RETURNING telegram_id, first_name
    `);
    
    console.log(`🔥 Форсированно очищено: ${forceCleanResult.rows.length} игроков`);
    
    res.json({
      success: true,
      message: 'Force cleanup completed',
      cleaned_players: forceCleanResult.rows.length,
      players: forceCleanResult.rows
    });
    
  } catch (error) {
    console.error('❌ Ошибка форсированной очистки:', error);
    res.status(500).json({ error: 'Force cleanup failed', details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Получен сигнал SIGINT, завершаем сервер...');
  try {
    await pool.end();
    console.log('✅ База данных отключена');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при завершении:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('🛑 Получен сигнал SIGTERM, завершаем сервер...');
  try {
    await pool.end();
    console.log('✅ База данных отключена');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при завершении:', error);
    process.exit(1);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`🔧 Режим: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🧹 Cron job очистки премиума: активен (каждый час)`);
  console.log(`🔥 UNIFIED система верификации: включена`);
  console.log(`⏰ Время запуска: ${new Date().toLocaleString('ru-RU')}`);
});