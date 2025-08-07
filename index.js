const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 5000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Инициализируем бота
const bot = new Telegraf(BOT_TOKEN);

// Добавьте статические файлы (если их еще нет)
app.use(express.static('public'));

// Middleware CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: false
}));

// JSON Body Parser
app.use(express.json());

// Дополнительные CORS заголовки
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

  console.log(`🌐 ${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log(`📋 Headers:`, req.headers);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log(`📦 Body:`, req.body);
  }

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS запрос обработан');
    res.sendStatus(200);
  } else {
    next();
  }
});

// 🔥 TON Connect manifest.json
app.get('/tonconnect-manifest.json', (req, res) => {
  res.json({
    "url": "https://t.me/CosmoClickBot/cosmoclick",
    "name": "CosmoClick",
    "iconUrl": `${req.protocol}://${req.get('host')}/logo-192.png`,
    "termsOfUseUrl": `${req.protocol}://${req.get('host')}/terms`,
    "privacyPolicyUrl": `${req.protocol}://${req.get('host')}/privacy`
  });
});

// 🔥 КРИТИЧЕСКИ ВАЖНО: REDIRECT для старых реферальных ссылок ПЕРЕД webhook
app.get('/webhook', (req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  const hasParams = Object.keys(req.query).length > 0;
  
  console.log('🔍 Запрос на /webhook');
  console.log('🔍 User-Agent:', userAgent);
  console.log('🔍 Query params:', req.query);
  console.log('🔍 Has params:', hasParams);
  
  if (userAgent.includes('Mozilla')) {
    console.log('🔄 REDIRECT: Браузерный запрос обнаружен');
    
    const referralParam = req.query.tgWebAppStartParam || req.query.startapp || req.query.start;
    
    let redirectUrl = 'https://cosmoclick-frontend.vercel.app';
    if (referralParam) {
      redirectUrl += `?tgWebAppStartParam=${referralParam}`;
      console.log(`🎯 Реферальный параметр: ${referralParam}`);
    } else {
      console.log('🎯 Прямое открытие бота (без реферального параметра)');
    }
    
    console.log('🎯 Redirect на frontend:', redirectUrl);
    return res.redirect(redirectUrl);
  }
  
  console.log('📡 Передаем к Telegram webhook');
  next();
});

// --- >>> ВЕБХУК TELEGRAM (после redirect) <<< ---
app.use(bot.webhookCallback('/webhook'));

// Обработка тестовых команд бота
bot.start((ctx) => {
  console.log('Bot /start command received.');
  ctx.reply('Привет! Бот запущен и готов к работе. Запускай игру через Web App!');
});
bot.help((ctx) => {
  console.log('Bot /help command received.');
  ctx.reply('Я бот для CosmoClick Game.');
});

bot.catch((err, ctx) => {
  console.error(`❌ Ошибка Telegraf для ${ctx.updateType}:`, err);
});
// 🔥 ОТЛАДОЧНЫЙ МАРШРУТ
app.get('/api/debug/count-referrals/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const pool = require('./db');
    console.log(`🔍 DEBUG: Считаем рефералов для ${telegramId}`);
    
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM players WHERE referrer_id = $1', 
      [telegramId]
    );
    
    const listResult = await pool.query(
      'SELECT telegram_id, username, first_name, referrer_id FROM players WHERE referrer_id = $1', 
      [telegramId]
    );
    
    const result = {
      telegramId,
      countFromPlayersTable: parseInt(countResult.rows[0].count),
      playersWithThisReferrer: listResult.rows,
      timestamp: new Date().toISOString()
    };
    
    console.log('🔍 DEBUG результат:', result);
    res.json(result);
  } catch (err) {
    console.error('❌ DEBUG ошибка:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🔥 WALLET API - подключаем wallet маршруты ПЕРВЫМИ
console.log('🔥 Подключаем WALLET маршруты...');
try {
  const walletRoutes = require('./routes/wallet');
  app.use('/api/wallet', walletRoutes);
  console.log('✅ WALLET маршруты подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения WALLET маршрутов:', err);
}

// 🔥 КРИТИЧЕСКИ ВАЖНО: TON API
console.log('🔥 Подключаем TON маршруты...');
try {
  const tonRoutes = require('./routes/ton');
  app.use('/api/ton', tonRoutes);
  console.log('✅ TON маршруты подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения TON маршрутов:', err);
}

// 🌟 ПОДКЛЮЧАЕМ STARS API
console.log('🌟 Подключаем маршруты Stars...');
try {
  const starsRoutes = require('./routes/stars');
  app.use('/api/stars', starsRoutes);
  console.log('✅ Маршруты Stars подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов Stars:', err);
}

// 🔥 ВАЖНЫЕ ИГРОВЫЕ МАРШРУТЫ
console.log('🔥 Подключаем игровые маршруты из routes/index.js...');
try {
  const gameRoutes = require('./routes/index');
  app.use('/', gameRoutes);
  console.log('✅ Игровые маршруты подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения игровых маршрутов:', err);
}

// 🎮 ПОДКЛЮЧАЕМ МИНИИГРЫ
console.log('🎮 Подключаем маршруты миниигр...');
try {
  const miniGamesRoutes = require('./routes/games');
  app.use('/api/games', miniGamesRoutes);
  console.log('✅ Маршруты миниигр подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов миниигр:', err);
}

// 🎮 ПОДКЛЮЧАЕМ КОСМИЧЕСКИЕ НАПЁРСТКИ
console.log('🎮 Подключаем маршруты космических напёрстков...');
try {
  const cosmicShellsRoutes = require('./routes/games/cosmic_shells');
  app.use('/api/games/cosmic-shells', cosmicShellsRoutes);
  console.log('✅ Маршруты космических напёрстков подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов космических напёрстков:', err);
}

// 🎰 ПОДКЛЮЧАЕМ ГАЛАКТИЧЕСКИЕ СЛОТЫ
console.log('🎰 Подключаем маршруты галактических слотов...');
try {
  const galacticSlotsRoutes = require('./routes/games/galactic_slots');
  app.use('/api/games/galactic-slots', galacticSlotsRoutes);
  console.log('✅ Маршруты галактических слотов подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов галактических слотов:', err);
}

// 🎯 ПОДКЛЮЧАЕМ ADSGRAM
console.log('🎯 Подключаем маршруты Adsgram...');
try {
  const adsgramRoutes = require('./routes/adsgram');
  app.use('/api/adsgram', adsgramRoutes);
  console.log('✅ Маршруты Adsgram подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов Adsgram:', err);
}
// 🔥 БАЗОВЫЕ МАРШРУТЫ
app.get('/api/time', (req, res) => {
  console.log('⏰ Запрос времени сервера');
  res.json({
    serverTime: new Date().toISOString(),
    message: 'API работает корректно'
  });
});

app.get('/api/health', (req, res) => {
  console.log('🏥 Проверка здоровья API');
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    routes: {
      wallet: 'активен',
      ton: 'активен',
      stars: 'активен',
      player: 'активен',
      shop: 'активен',
      games: 'активен',
      cosmic_shells: 'активен',
      galactic_slots: 'активен',
      adsgram: 'активен'
    }
  });
});

app.get('/', (req, res) => {
  console.log('🏠 Главная страница');
  res.send(`
    <h1>🚀 CosmoClick Backend</h1>
    <p>Сервер работает корректно!</p>
    <h3>📡 Доступные API:</h3>
    <ul>
      <li>GET /api/health - проверка работы</li>
      <li>GET /api/time - время сервера</li>
      <li><strong>💳 POST /api/wallet/connect - подключение кошелька</strong></li>
      <li><strong>💳 POST /api/wallet/disconnect - отключение кошелька</strong></li>
      <li><strong>💳 POST /api/wallet/prepare-withdrawal - подготовка вывода</strong></li>
      <li><strong>💳 POST /api/wallet/confirm-withdrawal - подтверждение вывода</strong></li>
      <li><strong>💳 GET /api/wallet/history/:telegramId - история операций</strong></li>
      <li>GET /api/ton/calculate/15 - расчет стейкинга</li>
      <li>POST /api/ton/stake - создание стейка</li>
      <li>GET /api/ton/stakes/:telegramId - список стейков</li>
      <li><strong>🌟 GET /api/stars/rates - текущие курсы Stars</strong></li>
      <li><strong>🌟 POST /api/stars/exchange - обмен Stars → CS</strong></li>
      <li><strong>🌟 GET /api/stars/history/:telegramId - история обменов</strong></li>
      <li><strong>🌟 POST /api/stars/update-ton-rate - обновить курс TON</strong></li>
      <li>GET /api/debug/count-referrals/:telegramId - отладка рефералов</li>
      <li><strong>GET /api/games/stats/:telegramId - статистика игр</strong></li>
      <li><strong>GET /api/games/tapper/status/:telegramId - статус тапалки</strong></li>
      <li><strong>POST /api/games/tapper/tap/:telegramId - тап по астероиду</strong></li>
      <li><strong>🛸 GET /api/games/cosmic-shells/status/:telegramId - статус космических напёрстков</strong></li>
      <li><strong>🛸 POST /api/games/cosmic-shells/start-game/:telegramId - начать игру</strong></li>
      <li><strong>🛸 POST /api/games/cosmic-shells/make-choice/:telegramId - сделать выбор</strong></li>
      <li><strong>🛸 POST /api/games/cosmic-shells/watch-ad/:telegramId - реклама за игру</strong></li>
      <li><strong>🛸 GET /api/games/cosmic-shells/history/:telegramId - история игр</strong></li>
      <li><strong>🎰 GET /api/games/galactic-slots/status/:telegramId - статус галактических слотов</strong></li>
      <li><strong>🎰 POST /api/games/galactic-slots/spin/:telegramId - крутить слоты</strong></li>
      <li><strong>🎰 POST /api/games/galactic-slots/watch-ad/:telegramId - реклама за игру</strong></li>
      <li><strong>🎰 GET /api/games/galactic-slots/history/:telegramId - история слотов</strong></li>
      <li><strong>🎯 GET /api/adsgram/reward?userid=[userId] - Adsgram награды</strong></li>
      <li><strong>🎯 GET /api/adsgram/stats/:telegramId - статистика Adsgram</strong></li>
    </ul>
    <p><strong>Время сервера:</strong> ${new Date().toISOString()}</p>
    <h3>🔧 Redirect система:</h3>
    <p>Старые реферальные ссылки автоматически перенаправляются на frontend</p>
  `);
});

// 💳 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики WALLET запросов
app.use('/api/wallet/*', (req, res, next) => {
  console.log(`💳 WALLET API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 WALLET Headers:`, req.headers);
  console.log(`📦 WALLET Body:`, req.body);
  next();
});

// 🔥 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики TON запросов
app.use('/api/ton/*', (req, res, next) => {
  console.log(`💰 TON API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 TON Headers:`, req.headers);
  console.log(`📦 TON Body:`, req.body);
  next();
});

// 🌟 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики STARS запросов
app.use('/api/stars/*', (req, res, next) => {
  console.log(`🌟 STARS API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 STARS Headers:`, req.headers);
  console.log(`📦 STARS Body:`, req.body);
  next();
});

// 🎮 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики ИГРОВЫХ запросов
app.use('/api/games/*', (req, res, next) => {
  console.log(`🎮 GAMES API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 GAMES Headers:`, req.headers);
  console.log(`📦 GAMES Body:`, req.body);
  next();
});

// 🎯 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики ADSGRAM запросов
app.use('/api/adsgram/*', (req, res, next) => {
  console.log(`🎯 ADSGRAM API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 ADSGRAM Headers:`, req.headers);
  console.log(`📦 ADSGRAM Body:`, req.body);
  next();
});
// 🔥 Обработчик ошибок с диагностикой
app.use((err, req, res, next) => {
  console.error('🚨 КРИТИЧЕСКАЯ ОШИБКА СЕРВЕРА:', err);
  console.error('🚨 Stack trace:', err.stack);
  console.error('🚨 Request info:', {
    method: req.method,
    path: req.path,
    body: req.body,
    headers: req.headers
  });

  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// 🔥 Улучшенный обработчик 404 с диагностикой
app.use((req, res) => {
  console.log(`❌ 404 NOT FOUND: ${req.method} ${req.path}`);
  console.log(`❌ 404 Headers:`, req.headers);
  console.log(`❌ 404 Body:`, req.body);
  console.log(`❌ 404 Query:`, req.query);

  if (req.path.startsWith('/api/wallet')) {
    console.log('💳💥 WALLET API ЗАПРОС УПАЛ В 404!');
    console.log('💳💥 Доступные WALLET маршруты должны быть:');
    console.log('💳💥 - POST /api/wallet/connect');
    console.log('💳💥 - POST /api/wallet/disconnect');
    console.log('💳💥 - POST /api/wallet/prepare-withdrawal');
    console.log('💳💥 - POST /api/wallet/confirm-withdrawal');
    console.log('💳💥 - GET /api/wallet/history/:telegramId');
  }

  if (req.path.startsWith('/api/ton')) {
    console.log('💰💥 TON API ЗАПРОС УПАЛ В 404!');
    console.log('💰💥 Доступные TON маршруты должны быть:');
    console.log('💰💥 - GET /api/ton/calculate/:amount');
    console.log('💰💥 - POST /api/ton/stake');
    console.log('💰💥 - GET /api/ton/stakes/:telegramId');
    console.log('💰💥 - POST /api/ton/withdraw');
    console.log('💰💥 - POST /api/ton/cancel');
  }

  if (req.path.startsWith('/api/stars')) {
    console.log('🌟💥 STARS API ЗАПРОС УПАЛ В 404!');
    console.log('🌟💥 Доступные STARS маршруты должны быть:');
    console.log('🌟💥 - GET /api/stars/rates');
    console.log('🌟💥 - POST /api/stars/exchange');
    console.log('🌟💥 - GET /api/stars/history/:telegramId');
    console.log('🌟💥 - POST /api/stars/update-ton-rate');
  }

  if (req.path.startsWith('/api/games')) {
    console.log('🎮💥 GAMES API ЗАПРОС УПАЛ В 404!');
    console.log('🎮💥 Доступные GAMES маршруты должны быть:');
    console.log('🎮💥 - GET /api/games/stats/:telegramId');
    console.log('🎮💥 - GET /api/games/tapper/status/:telegramId');
    console.log('🎮💥 - POST /api/games/tapper/tap/:telegramId');
    console.log('🎮💥 - POST /api/games/tapper/watch-ad/:telegramId');
    console.log('🎮💥 - GET /api/games/cosmic-shells/status/:telegramId');
    console.log('🎮💥 - POST /api/games/cosmic-shells/start-game/:telegramId');
    console.log('🎮💥 - POST /api/games/cosmic-shells/make-choice/:telegramId');
    console.log('🎮💥 - POST /api/games/cosmic-shells/watch-ad/:telegramId');
    console.log('🎮💥 - GET /api/games/cosmic-shells/history/:telegramId');
    console.log('🎮💥 - GET /api/games/galactic-slots/status/:telegramId');
    console.log('🎮💥 - POST /api/games/galactic-slots/spin/:telegramId');
    console.log('🎮💥 - POST /api/games/galactic-slots/watch-ad/:telegramId');
    console.log('🎮💥 - GET /api/games/galactic-slots/history/:telegramId');
  }

  if (req.path.startsWith('/api/adsgram')) {
    console.log('🎯💥 ADSGRAM API ЗАПРОС УПАЛ В 404!');
    console.log('🎯💥 Доступные ADSGRAM маршруты должны быть:');
    console.log('🎯💥 - GET /api/adsgram/reward?userid=[userId]');
    console.log('🎯💥 - GET /api/adsgram/stats/:telegramId');
  }

  res.status(404).json({
    error: 'Route not found',
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    message: 'Маршрут не найден',
    timestamp: new Date().toISOString(),
    availableRoutes: [
      'GET /',
      'GET /api/health',
      'GET /api/time',
      'GET /api/debug/count-referrals/:telegramId',
      '💳 POST /api/wallet/connect - подключение кошелька',
      '💳 POST /api/wallet/disconnect - отключение кошелька', 
      '💳 POST /api/wallet/prepare-withdrawal - подготовка вывода',
      '💳 POST /api/wallet/confirm-withdrawal - подтверждение вывода',
      '💳 GET /api/wallet/history/:telegramId - история операций',
      'GET /api/ton/calculate/:amount',
      'POST /api/ton/stake ⭐ ГЛАВНЫЙ',
      'GET /api/ton/stakes/:telegramId',
      'POST /api/ton/withdraw',
      'POST /api/ton/cancel',
      '🌟 GET /api/stars/rates - текущие курсы Stars',
      '🌟 POST /api/stars/exchange - обмен Stars → CS',
      '🌟 GET /api/stars/history/:telegramId - история обменов',
      '🌟 POST /api/stars/update-ton-rate - обновить курс TON (админ)',
      'POST /api/collect - сбор ресурсов',
      'POST /api/safe/collect - безопасный сбор',
      'GET /api/player/:telegramId',
      'POST /api/player/language',
      'GET /api/shop/asteroids',
      'POST /api/shop/buy',
      'GET /api/debug/player/:telegramId',
      '🎮 GET /api/games/stats/:telegramId - статистика игр',
      '🎮 GET /api/games/tapper/status/:telegramId - статус тапалки',
      '🎮 POST /api/games/tapper/tap/:telegramId - тап по астероиду',
      '🎮 POST /api/games/tapper/watch-ad/:telegramId - реклама за энергию',
      '🛸 GET /api/games/cosmic-shells/status/:telegramId - статус космических напёрстков',
      '🛸 POST /api/games/cosmic-shells/start-game/:telegramId - начать игру',
      '🛸 POST /api/games/cosmic-shells/make-choice/:telegramId - сделать выбор',
      '🛸 POST /api/games/cosmic-shells/watch-ad/:telegramId - реклама за игру',
      '🛸 GET /api/games/cosmic-shells/history/:telegramId - история игр',
      '🎰 GET /api/games/galactic-slots/status/:telegramId - статус галактических слотов',
      '🎰 POST /api/games/galactic-slots/spin/:telegramId - крутить слоты',
      '🎰 POST /api/games/galactic-slots/watch-ad/:telegramId - реклама за игру',
      '🎰 GET /api/games/galactic-slots/history/:telegramId - история слотов',
      '🎯 GET /api/adsgram/reward?userid=[userId] - Adsgram награды',
      '🎯 GET /api/adsgram/stats/:telegramId - статистика Adsgram'
    ]
  });
});

// ДОБАВИТЬ В КОНЕЦ index.js (ПЕРЕД app.listen)

// ========================
// 👑 ПРЕМИУМ CRON ЗАДАЧИ
// ========================

console.log('🔄 Настраиваем cron задачи для премиум подписок...');

// Функция очистки истекших премиум подписок
const cleanupExpiredPremium = async () => {
  try {
    console.log('🧹 Запуск очистки истекших премиум подписок...');
    
    // Обновляем статус истекших подписок
    const expiredResult = await pool.query(
      `UPDATE premium_subscriptions 
       SET status = 'expired' 
       WHERE status = 'active' 
         AND end_date IS NOT NULL 
         AND end_date < NOW()
       RETURNING telegram_id, subscription_type`
    );
    
    // Очищаем премиум статус у игроков с истекшими подписками
    const cleanupResult = await pool.query(
      `UPDATE players 
       SET premium_no_ads_until = NULL 
       WHERE premium_no_ads_until IS NOT NULL 
         AND premium_no_ads_until < NOW()
         AND premium_no_ads_forever = FALSE
       RETURNING telegram_id`
    );
    
    if (expiredResult.rows.length > 0 || cleanupResult.rows.length > 0) {
      console.log(`✅ Очищено ${expiredResult.rows.length} подписок и ${cleanupResult.rows.length} статусов игроков`);
      
      // Уведомляем пользователей об истечении подписки
      for (const row of expiredResult.rows) {
        try {
          await bot.telegram.sendMessage(
            row.telegram_id,
            `⏰ Ваша премиум подписка "Без рекламы" истекла.\n\nВы можете продлить её в кошельке игры CosmoClick.`,
            {
              reply_markup: {
                inline_keyboard: [[{
                  text: '💳 Продлить подписку',
                  web_app: { url: 'https://cosmoclick-frontend.vercel.app' }
                }]]
              }
            }
          );
        } catch (msgErr) {
          console.error(`❌ Ошибка отправки уведомления о истечении премиума для ${row.telegram_id}:`, msgErr);
        }
      }
    } else {
      console.log('✅ Истекших премиум подписок не найдено');
    }
    
  } catch (err) {
    console.error('❌ Ошибка очистки премиум подписок:', err);
  }
};

// Функция обновления статистики премиум подписок
const updatePremiumStats = async () => {
  try {
    const statsResult = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE premium_no_ads_forever = TRUE) as forever_count,
        COUNT(*) FILTER (WHERE premium_no_ads_until > NOW()) as active_30_days,
        COUNT(*) FILTER (WHERE premium_no_ads_until IS NOT NULL AND premium_no_ads_until < NOW()) as expired_count
      FROM players
    `);
    
    const stats = statsResult.rows[0];
    console.log('📊 Премиум статистика:', {
      навсегда: stats.forever_count,
      активных_30_дней: stats.active_30_days,
      истекших: stats.expired_count
    });
    
  } catch (err) {
    console.error('❌ Ошибка обновления статистики премиум:', err);
  }
};

// Запуск cron задач
let premiumCleanupInterval;
let premiumStatsInterval;

const startPremiumCronJobs = () => {
  // Очистка каждый час
  premiumCleanupInterval = setInterval(cleanupExpiredPremium, 60 * 60 * 1000);
  
  // Статистика каждые 6 часов
  premiumStatsInterval = setInterval(updatePremiumStats, 6 * 60 * 60 * 1000);
  
  console.log('✅ Cron задачи для премиум подписок запущены');
  console.log('   - Очистка истекших: каждый час');
  console.log('   - Обновление статистики: каждые 6 часов');
  
  // Запускаем первый раз через 30 секунд после старта
  setTimeout(() => {
    cleanupExpiredPremium();
    updatePremiumStats();
  }, 30000);
};

// Graceful shutdown для cron задач
process.on('SIGTERM', () => {
  if (premiumCleanupInterval) clearInterval(premiumCleanupInterval);
  if (premiumStatsInterval) clearInterval(premiumStatsInterval);
  console.log('🛑 Cron задачи премиум остановлены');
});

process.on('SIGINT', () => {
  if (premiumCleanupInterval) clearInterval(premiumCleanupInterval);
  if (premiumStatsInterval) clearInterval(premiumStatsInterval);
  console.log('🛑 Cron задачи премиум остановлены');
});

// 🔥 ЗАПУСК СЕРВЕРА с диагностикой
app.listen(PORT, async () => {
  console.log(`\n🚀 ============================================`);
  console.log(`🚀 CosmoClick Backend запущен успешно!`);
  console.log(`🚀 ============================================`);
  console.log(`📡 Порт: ${PORT}`);
  console.log(`🌐 CORS: разрешены все домены`);
  console.log(`💳 WALLET API: /api/wallet/*`);
  console.log(`💰 TON API: /api/ton/*`);
  console.log(`🌟 STARS API: /api/stars/*`);
  console.log(`🎮 Player API: /api/player/*`);
  console.log(`🛒 Shop API: /api/shop/*`);
  console.log(`🎯 Games API: /api/games/*`);
  console.log(`🛸 Cosmic Shells: /api/games/cosmic-shells/*`);
  console.log(`🎰 Galactic Slots: /api/games/galactic-slots/*`);
  console.log(`🎯 Adsgram API: /api/adsgram/*`);
  console.log(`🏥 Health check: /api/health`);
  console.log(`⏰ Time check: /api/time`);
  console.log(`🔍 Debug: /api/debug/*`);
  console.log(`🔄 Redirect: /webhook -> frontend`);
  console.log(`🚀 ============================================\n`);

  console.log('🔍 Проверяем загруженные маршруты...');
  console.log('Wallet routes loaded:', app._router ? 'да' : 'нет');
  console.log('TON routes loaded:', app._router ? 'да' : 'нет');
  console.log('Stars routes loaded:', app._router ? 'да' : 'нет');
  console.log('Games routes loaded:', app._router ? 'да' : 'нет');
  console.log('Cosmic Shells routes loaded:', app._router ? 'да' : 'нет');
  console.log('Galactic Slots routes loaded:', app._router ? 'да' : 'нет');
  console.log('Adsgram routes loaded:', app._router ? 'да' : 'нет');

  const webhookUrl = `https://cosmoclick-backend.onrender.com/webhook`;
  try {
    const success = await bot.telegram.setWebhook(webhookUrl);
    console.log(`📡 Установка вебхука Telegram (${webhookUrl}): ${success ? '✅ Успешно' : '❌ Ошибка'}`);
  } catch (error) {
    console.error('❌ Ошибка установки вебхука Telegram:', error.message);
    console.error('Убедитесь, что вебхук установлен правильно через BotFather или PUBLIC_URL настроен.');
  }

  // 🔄 ЗАПУСК АВТООБНОВЛЕНИЯ КУРСОВ TON
  console.log('🔄 Запуск сервиса автообновления курсов TON...');
  try {
    const tonRateService = require('./services/tonRateService');
    
    // Запускаем автообновление через 30 секунд после старта сервера
    setTimeout(async () => {
      try {
        await tonRateService.startAutoUpdate();
        console.log('✅ Сервис курсов TON запущен успешно');
      } catch (error) {
        console.error('❌ Ошибка запуска сервиса курсов:', error);
      }
    }, 30000);
    
  } catch (err) {
    console.error('❌ Ошибка подключения сервиса курсов TON:', err);
  }

  // НАЙТИ В index.js секцию app.listen и ДОБАВИТЬ ЭТО В КОНЕЦ (перед закрывающей скобкой):

  // 🔄 ЗАПУСК ПРЕМИУМ CRON ЗАДАЧ
  setTimeout(() => {
    try {
      startPremiumCronJobs();
      console.log('👑 Премиум cron задачи запущены успешно');
    } catch (error) {
      console.error('❌ Ошибка запуска премиум cron:', error);
    }
  }, 10000); // Запуск через 10 секунд после старта сервера

// ПРИМЕР КАК ДОЛЖНО ВЫГЛЯДЕТЬ:

app.listen(PORT, async () => {
  // ... существующий код ...
  
  console.log(`🚀 ============================================`);
  console.log(`🚀 CosmoClick Backend запущен успешно!`);
  // ... остальной существующий код лога ...
  
  // ТУТ ДОБАВЛЯЕМ:
  
  // 🔄 ЗАПУСК ПРЕМИУМ CRON ЗАДАЧ
  setTimeout(() => {
    try {
      startPremiumCronJobs();
      console.log('👑 Премиум cron задачи запущены успешно');
    } catch (error) {
      console.error('❌ Ошибка запуска премиум cron:', error);
    }
  }, 10000);
  
});

});