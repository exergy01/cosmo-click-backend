const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const pool = require('./db'); // 🔥 ДОБАВИЛИ импорт pool для работы с БД

const app = express();
const PORT = process.env.PORT || 5002;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Инициализируем бота
const bot = new Telegraf(BOT_TOKEN);

const cron = require('node-cron');
const { sendDailySummary } = require('./routes/telegramBot');

const tonWebhookRouter = require('./routes/ton-webhook');
app.use('/api/ton-webhook', tonWebhookRouter);

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
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization', 'X-Telegram-ID'],
  credentials: false
}));
app.use(express.json());

// CORS заголовки и логирование
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Telegram-ID');

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
  const dailyBonusRoutes = require('./routes/dailyBonus');
  app.use('/api/daily-bonus', dailyBonusRoutes);
} catch (err) {
  console.error('Ошибка подключения маршрутов ежедневных бонусов:', err);
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
  const adminRoutes = require('./routes/admin/index');

  app.use('/api/admin', adminRoutes);
  console.log('✅ Админские роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения админских роутов:', err);
}

// 📝 РУЧНЫЕ ЗАДАНИЯ
try {
  const manualQuestSubmissionRoutes = require('./routes/manual-quest-submission');
  app.use('/api/quests', manualQuestSubmissionRoutes);
  console.log('✅ Ручные задания роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения ручных заданий:', err);
}

// 🚀 COSMIC FLEET COMMANDER API РОУТЫ
try {
  const cosmicFleetRoutes = require('./routes/cosmic-fleet/index');
  app.use('/api/cosmic-fleet', cosmicFleetRoutes);
  console.log('✅ Cosmic Fleet основные роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Cosmic Fleet основных роутов:', err);
}

try {
  const cosmicFleetShipsRoutes = require('./routes/cosmic-fleet/ships');
  app.use('/api/cosmic-fleet/ships', cosmicFleetShipsRoutes);
  console.log('✅ Cosmic Fleet корабли роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Cosmic Fleet кораблей роутов:', err);
}

try {
  const cosmicFleetBattleRoutes = require('./routes/cosmic-fleet/battle');
  app.use('/api/cosmic-fleet/battle', cosmicFleetBattleRoutes);
  console.log('✅ Cosmic Fleet боевые роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Cosmic Fleet боевых роутов:', err);
}

// 🚀 COSMIC FLEET - FORMATIONS & BATTLES API
try {
  const cosmicFleetFormationsRoutes = require('./routes/cosmic-fleet/formations');
  app.use('/api/cosmic-fleet/formation', cosmicFleetFormationsRoutes);
  console.log('✅ Cosmic Fleet формации роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Cosmic Fleet формаций роутов:', err);
}

try {
  const cosmicFleetBattlesRoutes = require('./routes/cosmic-fleet/battles');
  app.use('/api/cosmic-fleet/battles', cosmicFleetBattlesRoutes);
  console.log('✅ Cosmic Fleet система боёв роуты подключены');

  // 🔧 Cosmic Fleet миграции
  const cosmicFleetMigrateRoutes = require('./routes/cosmic-fleet/migrate');
  app.use('/api/cosmic-fleet/migrate', cosmicFleetMigrateRoutes);
  console.log('✅ Cosmic Fleet миграции роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Cosmic Fleet системы боёв роутов:', err);
}

// 🌌 GALACTIC EMPIRE v2.0 API РОУТЫ
try {
  const galacticEmpireRoutes = require('./routes/galactic-empire');
  app.use('/api/galactic-empire', galacticEmpireRoutes);
  console.log('✅ Galactic Empire v2.0 роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Galactic Empire роутов:', err);
}

// 🚀 GALACTIC EMPIRE SHIPS API РОУТЫ
try {
  const galacticEmpireShipsRoutes = require('./routes/galactic-empire/ships');
  app.use('/api/galactic-empire/ships', galacticEmpireShipsRoutes);
  console.log('✅ Galactic Empire Ships роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Galactic Empire Ships роутов:', err);
}

// ⚔️ GALACTIC EMPIRE BATTLES API РОУТЫ
try {
  const galacticEmpireBattlesRoutes = require('./routes/galactic-empire/battles');
  app.use('/api/galactic-empire/battles', galacticEmpireBattlesRoutes);
  console.log('✅ Galactic Empire Battles роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Galactic Empire Battles роутов:', err);
}

// 💰 LUMINIOS CURRENCY API РОУТЫ
try {
  const luminiosRoutes = require('./routes/luminios');
  app.use('/api/luminios', luminiosRoutes);
  console.log('✅ Luminios валютные роуты подключены');
} catch (err) {
  console.error('❌ Ошибка подключения Luminios валютных роутов:', err);
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

// Добавляем НОВЫЙ CRON JOB в index.js (после существующих cron jobs)

// 🔄 НОВЫЙ CRON JOB: Ежедневный сброс счетчиков рекламы заданий в полночь МСК
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 === ЕЖЕДНЕВНЫЙ СБРОС РЕКЛАМЫ ЗАДАНИЙ ===');
  console.log('⏰ Время:', new Date().toISOString());
  
  try {
    // Получаем игроков, у которых нужно сбросить счетчик
    const playersToResetResult = await pool.query(`
      SELECT telegram_id, quest_ad_views, first_name, username
      FROM players 
      WHERE quest_ad_views > 0 
         OR quest_ad_last_reset::date < CURRENT_DATE
         OR quest_ad_last_reset IS NULL
    `);
    
    const playersToReset = playersToResetResult.rows;
    console.log(`📊 Игроков для сброса: ${playersToReset.length}`);
    
    if (playersToReset.length > 0) {
      // Сбрасываем счетчики
      const resetResult = await pool.query(`
        UPDATE players 
        SET quest_ad_views = 0, 
            quest_ad_last_reset = NOW()
        WHERE quest_ad_views > 0 
           OR quest_ad_last_reset::date < CURRENT_DATE
           OR quest_ad_last_reset IS NULL
      `);
      
      console.log(`✅ Сброшено счетчиков рекламы заданий: ${resetResult.rowCount}`);
      console.log(`📋 Игроки: ${playersToReset.slice(0, 10).map(p => 
        `${p.telegram_id}(${p.first_name || p.username})`
      ).join(', ')}${playersToReset.length > 10 ? '...' : ''}`);
      
      // Отправляем уведомление админу о сбросе
      try {
        const { Telegraf } = require('telegraf');
        const notifyBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        const adminId = process.env.ADMIN_TELEGRAM_ID || '1222791281';
        
        await notifyBot.telegram.sendMessage(
          adminId,
          `🔄 Ежедневный сброс рекламы заданий выполнен!\n\n📊 Сброшено у ${resetResult.rowCount} игроков\n⏰ ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`
        );
      } catch (adminNotifyError) {
        console.error('⚠️ Не удалось уведомить админа о сбросе:', adminNotifyError.message);
      }
    } else {
      console.log('✅ Все счетчики рекламы заданий уже актуальны');
    }
    
    console.log('🏁 Ежедневный сброс рекламы заданий завершен успешно');
    
  } catch (error) {
    console.error('❌ ОШИБКА ежедневного сброса рекламы заданий:', error);
    
    // Уведомляем админа об ошибке
    try {
      const { Telegraf } = require('telegraf');
      const errorBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      const adminId = process.env.ADMIN_TELEGRAM_ID || '1222791281';
      
      await errorBot.telegram.sendMessage(
        adminId,
        `🚨 ОШИБКА сброса рекламы заданий!\n\n${error.message}\n\n⏰ ${new Date().toLocaleString('ru-RU')}`
      );
    } catch (adminErrorNotify) {
      console.error('❌ Не удалось уведомить админа об ошибке сброса:', adminErrorNotify.message);
    }
  }
}, {
  scheduled: true,
  timezone: "Europe/Moscow"
});

console.log('⏰ НОВЫЙ Cron задача для ежедневного сброса рекламы заданий настроена на 00:00 МСК');

// ========================
// 📅 ПЛАНИРОВЩИК ЗАДАНИЙ - CRON АВТОМАТИЗАЦИЯ
// Добавить в index.js ПОСЛЕ существующих cron jobs
// ========================

// 📅 ФУНКЦИЯ АВТОМАТИЧЕСКОЙ АКТИВАЦИИ ЗАДАНИЙ
const processScheduledQuests = async () => {
  console.log('📅 === ЗАПУСК ПЛАНИРОВЩИКА ЗАДАНИЙ ===');
  console.log('⏰ Время:', new Date().toISOString());
  
  try {
    // Получаем задания готовые к активации
    const readyQuests = await pool.query(`
      SELECT 
        id, quest_key, quest_type, reward_cs,
        schedule_type, schedule_pattern, schedule_time,
        schedule_start_date, schedule_end_date,
        auto_activate, auto_deactivate,
        schedule_metadata, next_scheduled_activation,
        is_active
      FROM quest_templates 
      WHERE is_scheduled = true 
        AND schedule_status = 'active'
        AND next_scheduled_activation IS NOT NULL 
        AND next_scheduled_activation <= NOW()
      ORDER BY next_scheduled_activation ASC
    `);
    
    if (readyQuests.rows.length === 0) {
      console.log('📅 Нет заданий готовых к активации');
      return { processed: 0, activated: 0, errors: 0 };
    }
    
    console.log(`📋 Найдено заданий к обработке: ${readyQuests.rows.length}`);
    
    let processedCount = 0;
    let activatedCount = 0;
    let errorCount = 0;
    
    for (const quest of readyQuests.rows) {
      try {
        processedCount++;
        
        console.log(`🔄 Обрабатываем задание: ${quest.quest_key} (${quest.quest_type})`);
        
        await pool.query('BEGIN');
        
        // Проверяем не истекло ли расписание
        if (quest.schedule_end_date && new Date(quest.schedule_end_date) < new Date()) {
          console.log(`⏰ Расписание истекло для ${quest.quest_key}, деактивируем`);
          
          await pool.query(`
            UPDATE quest_templates 
            SET schedule_status = 'completed', 
                next_scheduled_activation = NULL,
                is_active = false
            WHERE id = $1
          `, [quest.id]);
          
          await pool.query(`
            INSERT INTO quest_scheduler_history (
              quest_key, quest_template_id, action_type, scheduled_time, 
              status, details, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            quest.quest_key, quest.id, 'expired', quest.next_scheduled_activation,
            'completed', JSON.stringify({ reason: 'schedule_expired' }), 'system'
          ]);
          
          await pool.query('COMMIT');
          continue;
        }
        
        // Активируем задание если нужно
        if (quest.auto_activate && !quest.is_active) {
          await pool.query(
            'UPDATE quest_templates SET is_active = true WHERE id = $1',
            [quest.id]
          );
          
          activatedCount++;
          console.log(`✅ Активировано задание: ${quest.quest_key}`);
          
          // Логируем активацию
          await pool.query(`
            INSERT INTO quest_scheduler_history (
              quest_key, quest_template_id, action_type, scheduled_time, 
              status, details, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            quest.quest_key, quest.id, 'activated', quest.next_scheduled_activation,
            'completed', JSON.stringify({ auto_activated: true }), 'system'
          ]);
        }
        
        // Вычисляем следующую активацию
        const nextActivation = calculateNextActivationForQuest(quest);
        
        await pool.query(`
          UPDATE quest_templates 
          SET last_scheduled_activation = NOW(),
              next_scheduled_activation = $1
          WHERE id = $2
        `, [nextActivation, quest.id]);
        
        console.log(`🔄 Следующая активация ${quest.quest_key}: ${nextActivation || 'не запланирована'}`);
        
        await pool.query('COMMIT');
        
      } catch (questError) {
        await pool.query('ROLLBACK');
        errorCount++;
        
        console.error(`❌ Ошибка обработки ${quest.quest_key}:`, questError);
        
        // Логируем ошибку
        try {
          await pool.query(`
            INSERT INTO quest_scheduler_history (
              quest_key, quest_template_id, action_type, scheduled_time, 
              status, error_message, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            quest.quest_key, quest.id, 'error', quest.next_scheduled_activation,
            'failed', questError.message, 'system'
          ]);
        } catch (logError) {
          console.error('❌ Не удалось залогировать ошибку:', logError);
        }
      }
    }
    
    const result = {
      processed: processedCount,
      activated: activatedCount,
      errors: errorCount,
      timestamp: new Date().toISOString()
    };
    
    console.log('📊 === РЕЗУЛЬТАТЫ ПЛАНИРОВЩИКА ===');
    console.log(`✅ Обработано заданий: ${processedCount}`);
    console.log(`🚀 Активировано заданий: ${activatedCount}`);
    console.log(`❌ Ошибок: ${errorCount}`);
    console.log('🏁 Планировщик заданий завершен');
    
    // Уведомляем админа при ошибках
    if (errorCount > 0) {
      try {
        const { Telegraf } = require('telegraf');
        const notifyBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        const adminId = process.env.ADMIN_TELEGRAM_ID || '1222791281';
        
        await notifyBot.telegram.sendMessage(
          adminId,
          `⚠️ ПЛАНИРОВЩИК ЗАДАНИЙ\n\n📊 Обработано: ${processedCount}\n✅ Активировано: ${activatedCount}\n❌ Ошибок: ${errorCount}\n\n⏰ ${new Date().toLocaleString('ru-RU')}`
        );
      } catch (notifyError) {
        console.error('❌ Не удалось уведомить админа:', notifyError);
      }
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ КРИТИЧЕСКАЯ ОШИБКА планировщика заданий:', error);
    
    // Критическое уведомление админа
    try {
      const { Telegraf } = require('telegraf');
      const errorBot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
      const adminId = process.env.ADMIN_TELEGRAM_ID || '1222791281';
      
      await errorBot.telegram.sendMessage(
        adminId,
        `🚨 КРИТИЧЕСКАЯ ОШИБКА ПЛАНИРОВЩИКА!\n\n${error.message}\n\n⏰ ${new Date().toLocaleString('ru-RU')}`
      );
    } catch (notifyError) {
      console.error('❌ Не удалось уведомить админа о критической ошибке:', notifyError);
    }
    
    throw error;
  }
};

// 📅 ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ РАСЧЕТА СЛЕДУЮЩЕЙ АКТИВАЦИИ
function calculateNextActivationForQuest(quest) {
  const now = new Date();
  const { schedule_pattern, schedule_time, schedule_end_date, schedule_metadata } = quest;
  
  if (!schedule_pattern) return null;
  
  // Парсим время активации
  const [hours, minutes] = (schedule_time || '09:00').split(':').map(Number);
  
  let nextDate = new Date();
  nextDate.setHours(hours, minutes, 0, 0);
  
  switch (schedule_pattern) {
    case 'daily':
      // Каждый день
      nextDate.setDate(nextDate.getDate() + 1);
      break;
      
    case 'weekly':
      // Каждую неделю в тот же день
      nextDate.setDate(nextDate.getDate() + 7);
      break;
      
    case 'weekdays':
      // Только будние дни
      do {
        nextDate.setDate(nextDate.getDate() + 1);
      } while (nextDate.getDay() === 0 || nextDate.getDay() === 6);
      break;
      
    case 'weekends':
      // Только выходные
      do {
        nextDate.setDate(nextDate.getDate() + 1);
      } while (nextDate.getDay() !== 0 && nextDate.getDay() !== 6);
      break;
      
    case 'monthly':
      // Каждый месяц в тот же день
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
      
    case 'one_time':
      // Одноразовое задание
      return null;
      
    default:
      // По умолчанию - ежедневно
      nextDate.setDate(nextDate.getDate() + 1);
      break;
  }
  
  // Проверяем не превышает ли дата окончания
  if (schedule_end_date && nextDate > new Date(schedule_end_date)) {
    return null;
  }
  
  return nextDate;
}

// 📅 НОВЫЙ CRON JOB: Планировщик заданий (каждые 5 минут)
cron.schedule('*/5 * * * *', async () => {
  console.log('📅 Запуск CRON: Планировщик заданий');
  try {
    await processScheduledQuests();
  } catch (error) {
    console.error('❌ CRON планировщика failed:', error);
  }
}, {
  scheduled: true,
  timezone: "Europe/Moscow"
});

console.log('⏰ НОВЫЙ Cron задача планировщика заданий настроена на каждые 5 минут');

// 📅 ENDPOINT ДЛЯ РУЧНОГО ЗАПУСКА ПЛАНИРОВЩИКА
app.post('/api/admin/manual-run-scheduler', async (req, res) => {
  const { admin_id } = req.body;
  
  // Проверяем админа
  if (admin_id !== process.env.ADMIN_TELEGRAM_ID && admin_id !== '1222791281') {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  try {
    console.log('🔧 Ручной запуск планировщика заданий админом:', admin_id);
    const result = await processScheduledQuests();
    
    res.json({
      success: true,
      message: 'Manual scheduler run completed',
      ...result
    });
  } catch (error) {
    console.error('❌ Ошибка ручного запуска планировщика:', error);
    res.status(500).json({ 
      error: 'Manual scheduler run failed', 
      details: error.message 
    });
  }
});

// Создание таблицы ежедневных бонусов при запуске
const createDailyBonusTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_bonus_streaks (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(50) UNIQUE NOT NULL,
        current_streak INTEGER DEFAULT 0,
        last_claim_date TIMESTAMP,
        total_claims INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Таблица daily_bonus_streaks проверена/создана');
  } catch (error) {
    console.error('❌ Ошибка создания таблицы daily_bonus_streaks:', error);
  }
};

// Создание таблицы очереди постройки кораблей при запуске
const addBuiltAtColumn = async () => {
  try {
    // Проверяем, существует ли колонка built_at
    const checkColumn = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name='galactic_empire_ships' AND column_name='built_at'
    `);

    if (checkColumn.rows.length === 0) {
      // Добавляем колонку built_at (по умолчанию NOW() для старых кораблей)
      await pool.query(`
        ALTER TABLE galactic_empire_ships
        ADD COLUMN built_at TIMESTAMP DEFAULT NOW()
      `);
      console.log('✅ Колонка built_at добавлена в galactic_empire_ships');
    } else {
      console.log('✅ Колонка built_at уже существует в galactic_empire_ships');
    }
  } catch (error) {
    console.error('❌ Ошибка добавления колонки built_at:', error);
  }
};

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`🚀 CosmoClick Backend запущен на порту ${PORT}`);
  console.log(`🔥 UNIFIED система верификации активирована!`);
  console.log(`✅ CORS обновлен - X-Telegram-ID header разрешен!`);

  // Создаем таблицу ежедневных бонусов
  await createDailyBonusTable();

  // Добавляем колонку built_at в таблицу кораблей
  await addBuiltAtColumn();

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

      // Запуск мониторинга TON депозитов
      const { tonDepositMonitor } = require('./services/tonDepositMonitor');
      await tonDepositMonitor.start();
      console.log('Мониторинг TON депозитов запущен');

    } catch (error) {
      console.error('Ошибка запуска TON сервисов:', error);
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