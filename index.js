const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const pool = require('./db'); // 🔥 ДОБАВИЛИ импорт pool для работы с БД

const app = express();
const PORT = process.env.PORT || 5000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Инициализируем бота
const bot = new Telegraf(BOT_TOKEN);

const cron = require('node-cron');
const { sendDailySummary } = require('./routes/telegramBot');

// 📊 НАСТРОЙКА ЕЖЕДНЕВНОЙ СВОДКИ В 12:00 ПО МОСКОВСКОМУ ВРЕМЕНИ
cron.schedule('0 12 * * *', async () => {
  console.log('📊 Запуск ежедневной сводки...');
  try {
    await sendDailySummary();
    console.log('✅ Ежедневная сводка отправлена успешно');
  } catch (error) {
    console.error('❌ Ошибка отправки ежедневной сводки:', error);
  }
}, {
  scheduled: true,
  timezone: "Europe/Moscow" // Московское время
});

console.log('⏰ Cron задача для ежедневной сводки настроена на 12:00 МСК');

// Middleware
app.use(express.static('public'));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: false
}));
app.use(express.json());

// CORS заголовки и логирование
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// TON Connect manifest
app.get('/tonconnect-manifest.json', (req, res) => {
  res.json({
    "url": "https://t.me/CosmoClickBot/cosmoclick",
    "name": "CosmoClick",
    "iconUrl": `${req.protocol}://${req.get('host')}/logo-192.png`,
    "termsOfUseUrl": `${req.protocol}://${req.get('host')}/terms`,
    "privacyPolicyUrl": `${req.protocol}://${req.get('host')}/privacy`
  });
});

// Redirect для старых реферальных ссылок
app.get('/webhook', (req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  
  if (userAgent.includes('Mozilla')) {
    const referralParam = req.query.tgWebAppStartParam || req.query.startapp || req.query.start;
    let redirectUrl = 'https://cosmoclick-frontend.vercel.app';
    
    if (referralParam) {
      redirectUrl += `?tgWebAppStartParam=${referralParam}`;
    }
    
    return res.redirect(redirectUrl);
  }
  
  next();
});

// Обработка команд бота
bot.start((ctx) => {
  ctx.reply('Привет! Бот запущен и готов к работе. Запускай игру через Web App!');
});

bot.help((ctx) => {
  ctx.reply('Я бот для CosmoClick Game.');
});

bot.catch((err, ctx) => {
  console.error(`Ошибка Telegraf для ${ctx.updateType}:`, err);
});

// Подключение маршрутов
try {
  const walletRoutes = require('./routes/wallet');
  app.use('/api/wallet', walletRoutes);
} catch (err) {
  console.error('Ошибка подключения wallet маршрутов:', err);
}

try {
  const tonRoutes = require('./routes/ton');
  app.use('/api/ton', tonRoutes);
} catch (err) {
  console.error('Ошибка подключения TON маршрутов:', err);
}

try {
  const starsRoutes = require('./routes/stars');
  app.use('/api/stars', starsRoutes);
} catch (err) {
  console.error('Ошибка подключения Stars маршрутов:', err);
}

try {
  const gameRoutes = require('./routes/index');
  app.use('/', gameRoutes);
} catch (err) {
  console.error('Ошибка подключения игровых маршрутов:', err);
}

try {
  const miniGamesRoutes = require('./routes/games');
  app.use('/api/games', miniGamesRoutes);
} catch (err) {
  console.error('Ошибка подключения маршрутов миниигр:', err);
}

try {
  const cosmicShellsRoutes = require('./routes/games/cosmic_shells');
  app.use('/api/games/cosmic-shells', cosmicShellsRoutes);
} catch (err) {
  console.error('Ошибка подключения маршрутов cosmic shells:', err);
}

try {
  const galacticSlotsRoutes = require('./routes/games/galactic_slots');
  app.use('/api/games/galactic-slots', galacticSlotsRoutes);
} catch (err) {
  console.error('Ошибка подключения маршрутов galactic slots:', err);
}

try {
  const adsgramRoutes = require('./routes/adsgram');
  app.use('/api/adsgram', adsgramRoutes);
} catch (err) {
  console.error('Ошибка подключения Adsgram маршрутов:', err);
}

// Добавить в index.js после других роутов:
try {
  const testRoutes = require('./routes/test');
  app.use('/api/test', testRoutes);
  console.log('✅ Тестовые роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения тестовых роутов:', err);
}

// 🔥 ДОБАВЛЯЕМ АДМИНСКИЕ РОУТЫ
try {
  const adminRoutes = require('./routes/admin');
  app.use('/api/admin', adminRoutes);
  console.log('✅ Админские роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения админских роутов:', err);
}

// 🔥 ИСПРАВЛЕНО: Telegram webhook для обычных сообщений бота (НЕ платежи Stars)
app.post('/webhook', (req, res) => {
  const { pre_checkout_query, successful_payment } = req.body;
  
  // Если это платеж Stars - игнорируем здесь (обрабатывается в /api/wallet/webhook-stars)
  if (pre_checkout_query || successful_payment) {
    console.log('💰 Stars платеж обнаружен, но обрабатывается в /api/wallet/webhook-stars');
    return res.json({ success: true });
  }
  
  // Обычные сообщения бота (/start, /help и т.д.) обрабатываем через Telegraf
  console.log('📨 Обычное сообщение бота:', req.body?.message?.text || 'unknown');
  bot.handleUpdate(req.body, res);
});

// Базовые API маршруты
app.get('/api/time', (req, res) => {
  res.json({
    serverTime: new Date().toISOString(),
    message: 'API работает корректно'
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send(`
    <h1>🚀 CosmoClick Backend</h1>
    <p>Сервер работает корректно!</p>
    <p><strong>Время сервера:</strong> ${new Date().toISOString()}</p>
  `);
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error('ОШИБКА СЕРВЕРА:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 обработчик
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// 🔥 ОБНОВЛЕННАЯ функция для премиум подписок с UNIFIED VERIFICATION
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
            'Premium subscription expired - verified status revoked',
            JSON.stringify({
              expired_at: new Date().toISOString(),
              verified_revoked: true,
              cleanup_job: true
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
          `⏰ Ваша премиум подписка истекла!\n\n🚫 Реклама снова включена\n❌ Верификация отозвана\n\n💎 Продлите подписку, чтобы снова наслаждаться игрой без рекламы!`,
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
        
        // Небольшая задержка между уведомлениями
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (notifyError) {
        console.error(`   ⚠️ Ошибка уведомления ${player.telegram_id}:`, notifyError.message);
      }
    }

    // 5. Итоговая статистика
    console.log('📊 === РЕЗУЛЬТАТЫ UNIFIED ОЧИСТКИ ===');
    console.log(`✅ Истекших подписок обновлено: ${expiredSubscriptions.length}`);
    console.log(`✅ Игроков очищено: ${cleanedPlayers.length}`);
    console.log(`✅ Verified статус сброшен у: ${cleanedPlayers.length} игроков`);
    console.log(`✅ Уведомлений отправлено: ${notificationsSent}`);
    console.log('🏁 UNIFIED очистка истекших премиум подписок завершена успешно');

    // 6. Возвращаем результат для внешних вызовов
    return {
      success: true,
      expired_subscriptions: expiredSubscriptions.length,
      cleaned_players: cleanedPlayers.length,
      notifications_sent: notificationsSent,
      affected_players: cleanedPlayers.map(p => ({
        telegram_id: p.telegram_id,
        name: p.first_name || p.username
      }))
    };

  } catch (error) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА при UNIFIED очистке истекших подписок:', error);
    console.error('❌ Stack trace:', error.stack);
    
    // Уведомляем админа об ошибке cron job
    try {
      const { Telegraf } = require('telegraf');
      const adminBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      const adminId = process.env.ADMIN_TELEGRAM_ID;
      
      if (adminId) {
        await adminBot.telegram.sendMessage(
          adminId,
          `🚨 ОШИБКА UNIFIED CRON JOB!\n\nОчистка истекших премиум подписок не удалась:\n\n${error.message}\n\nВремя: ${new Date().toLocaleString('ru-RU')}`
        );
      }
    } catch (adminNotifyError) {
      console.error('❌ Не удалось уведомить админа об ошибке:', adminNotifyError.message);
    }
    
    throw error;
  }
};

// 🔥 НОВЫЙ ENDPOINT ДЛЯ РУЧНОЙ ОЧИСТКИ ПРЕМИУМА
app.post('/api/admin/manual-cleanup-premium', async (req, res) => {
  const { admin_id } = req.body;
  
  // Проверяем админа
  if (admin_id !== process.env.ADMIN_TELEGRAM_ID) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    console.log('🔧 Ручная UNIFIED очистка премиум подписок запущена админом:', admin_id);
    const result = await cleanupExpiredPremium();
    
    res.json({
      success: true,
      message: 'Manual UNIFIED cleanup completed successfully',
      ...result
    });
  } catch (error) {
    console.error('❌ Ошибка ручной UNIFIED очистки:', error);
    res.status(500).json({ 
      error: 'Manual cleanup failed', 
      details: error.message 
    });
  }
});

// 🔥 НОВЫЙ CRON JOB ДЛЯ ПРЕМИУМ ОЧИСТКИ (каждый час)
cron.schedule('0 * * * *', async () => {
  console.log('⏰ Запуск UNIFIED cron job: очистка истекших премиум подписок');
  try {
    await cleanupExpiredPremium();
  } catch (error) {
    console.error('❌ UNIFIED Cron job failed:', error);
  }
}, {
  scheduled: true,
  timezone: "Europe/Moscow"
});

console.log('⏰ UNIFIED Cron задача для очистки премиума настроена на каждый час');

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`🚀 CosmoClick Backend запущен на порту ${PORT}`);
  console.log(`🔥 UNIFIED система верификации активирована!`);

  // 🔥 ИСПРАВЛЕНО: Webhook установлен правильно на Stars эндпоинт
  const webhookUrl = `https://cosmoclick-backend.onrender.com/api/wallet/webhook-stars`;
  
  try {
    const success = await bot.telegram.setWebhook(webhookUrl, {
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query', 'successful_payment']
    });
    
    console.log(`Webhook установлен: ${success ? 'Успешно' : 'Ошибка'}`);
    console.log(`Webhook URL: ${webhookUrl}`);
  } catch (error) {
    console.error('Ошибка установки webhook:', error.message);
  }

  // Запуск автообновления курсов TON
  setTimeout(async () => {
    try {
      const tonRateService = require('./services/tonRateService');
      await tonRateService.startAutoUpdate();
      console.log('Сервис курсов TON запущен');
    } catch (error) {
      console.error('Ошибка запуска сервиса курсов:', error);
    }
  }, 30000);

  // 🔥 ПЕРВЫЙ ЗАПУСК UNIFIED ОЧИСТКИ (через 10 секунд после старта)
  setTimeout(async () => {
    try {
      console.log('🧹 Первый запуск UNIFIED очистки премиума после старта сервера...');
      await cleanupExpiredPremium();
    } catch (error) {
      console.error('❌ Ошибка первого запуска UNIFIED очистки:', error);
    }
  }, 10000);
});