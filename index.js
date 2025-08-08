const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 5000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Инициализируем бота
const bot = new Telegraf(BOT_TOKEN);

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

// Telegram webhook
app.use(bot.webhookCallback('/webhook'));

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

// Функции для премиум подписок
const cleanupExpiredPremium = async () => {
  try {
    const pool = require('./db');
    
    const expiredResult = await pool.query(
      `UPDATE premium_subscriptions 
       SET status = 'expired' 
       WHERE status = 'active' 
         AND end_date IS NOT NULL 
         AND end_date < NOW()
       RETURNING telegram_id, subscription_type`
    );
    
    const cleanupResult = await pool.query(
      `UPDATE players 
       SET premium_no_ads_until = NULL 
       WHERE premium_no_ads_until IS NOT NULL 
         AND premium_no_ads_until < NOW()
         AND premium_no_ads_forever = FALSE
       RETURNING telegram_id`
    );
    
    if (expiredResult.rows.length > 0 || cleanupResult.rows.length > 0) {
      console.log(`Очищено ${expiredResult.rows.length} подписок и ${cleanupResult.rows.length} статусов игроков`);
    }
    
  } catch (err) {
    console.error('Ошибка очистки премиум подписок:', err);
  }
};

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`🚀 CosmoClick Backend запущен на порту ${PORT}`);

  // Установка webhook
  const webhookUrl = `https://cosmoclick-backend.onrender.com/webhook`;
  try {
    const success = await bot.telegram.setWebhook(webhookUrl);
    console.log(`Webhook установлен: ${success ? 'Успешно' : 'Ошибка'}`);
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

  // Запуск премиум cron задач
  setTimeout(() => {
    setInterval(cleanupExpiredPremium, 60 * 60 * 1000); // Каждый час
    cleanupExpiredPremium(); // Первый запуск
    console.log('Премиум cron задачи запущены');
  }, 10000);
});