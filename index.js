const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');

const app = express();
const PORT = process.env.PORT || 5000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Инициализируем бота
const bot = new Telegraf(BOT_TOKEN);

// Middleware CORS - ДОЛЖЕН БЫТЬ ОЧЕНЬ РАННО
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: false
}));

// Дополнительные CORS заголовки (ваш оригинальный код)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With', 'Content-Type', 'Accept', 'Authorization');

  // Детальное логирование (ваш оригинальный код)
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

// JSON Body Parser - ДОЛЖЕН БЫТЬ ПЕРЕД ВЕБХУКОМ TELEGRAM
app.use(express.json());

// 🔥 КРИТИЧЕСКИ ВАЖНО: REDIRECT для старых реферальных ссылок ПЕРЕД webhook
app.get('/webhook', (req, res, next) => {
  // Проверяем, это браузерный запрос (старая реферальная ссылка) или Telegram webhook
  const userAgent = req.headers['user-agent'] || '';
  const hasParams = Object.keys(req.query).length > 0;
  
  console.log('🔍 Запрос на /webhook');
  console.log('🔍 User-Agent:', userAgent);
  console.log('🔍 Query params:', req.query);
  console.log('🔍 Has params:', hasParams);
  
  // Если это браузер с параметрами - это старая реферальная ссылка
  if (userAgent.includes('Mozilla') && hasParams) {
    console.log('🔄 REDIRECT: Старая реферальная ссылка обнаружена');
    
    // Извлекаем реферальный параметр
    const referralParam = req.query.tgWebAppStartParam || req.query.startapp || req.query.start;
    
    // Формируем правильную ссылку на frontend
    let redirectUrl = 'https://cosmoclick-frontend.vercel.app';
    if (referralParam) {
      redirectUrl += `?tgWebAppStartParam=${referralParam}`;
      console.log(`🎯 Реферальный параметр: ${referralParam}`);
    }
    
    console.log('🎯 Redirect на frontend:', redirectUrl);
    return res.redirect(redirectUrl);
  }
  
  // Если это не браузерный запрос - пропускаем дальше к Telegram webhook
  console.log('📡 Передаем к Telegram webhook');
  next();
});

// --- >>> ВЕБХУК TELEGRAM (после redirect) <<< ---
app.use(bot.webhookCallback('/webhook'));

// Обработка тестовых команд бота (для проверки, что бот работает)
bot.start((ctx) => {
  console.log('Bot /start command received.');
  ctx.reply('Привет! Бот запущен и готов к работе. Запускай игру через Web App!');
});
bot.help((ctx) => {
  console.log('Bot /help command received.');
  ctx.reply('Я бот для CosmoClick Game.');
});

// Обработка ошибок бота
bot.catch((err, ctx) => {
    console.error(`❌ Ошибка Telegraf для ${ctx.updateType}:`, err);
});

// 🔥 КРИТИЧЕСКИ ВАЖНО: TON API ПЕРВЫМ! (ваш оригинальный код)
console.log('🔥 Подключаем TON маршруты...');
try {
  const tonRoutes = require('./routes/ton');
  app.use('/api/ton', tonRoutes);
  console.log('✅ TON маршруты подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения TON маршрутов:', err);
}

// 🔥 ВАЖНЫЕ ИГРОВЫЕ МАРШРУТЫ из routes/index.js (содержит /api/collect, /api/safe/collect и др.) (ваш оригинальный код)
console.log('🔥 Подключаем игровые маршруты из routes/index.js...');
try {
  const gameRoutes = require('./routes/index'); // Это тот файл, который вы ранее давали
  app.use('/', gameRoutes); // Подключаем ваш router из routes/index.js
  console.log('✅ Игровые маршруты подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения игровых маршрутов:', err);
}

// 🔥 БАЗОВЫЕ МАРШРУТЫ (ваш оригинальный код)
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
      ton: 'активен',
      player: 'активен',
      shop: 'активен'
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
      <li>GET /api/ton/calculate/15 - расчет стейкинга</li>
      <li>POST /api/ton/stake - создание стейка</li>
      <li>GET /api/ton/stakes/:telegramId - список стейков</li>
    </ul>
    <p><strong>Время сервера:</strong> ${new Date().toISOString()}</p>
    <h3>🔧 Redirect система:</h3>
    <p>Старые реферальные ссылки автоматически перенаправляются на frontend</p>
  `);
});

// 🔥 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики TON запросов (ваш оригинальный код)
app.use('/api/ton/*', (req, res, next) => {
  console.log(`💰 TON API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 TON Headers:`, req.headers);
  console.log(`📦 TON Body:`, req.body);
  next();
});

// 🔥 Обработчик ошибок с диагностикой (ваш оригинальный код)
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

// 🔥 Улучшенный обработчик 404 с диагностикой (ваш оригинальный код)
app.use((req, res) => {
  console.log(`❌ 404 NOT FOUND: ${req.method} ${req.path}`);
  console.log(`❌ 404 Headers:`, req.headers);
  console.log(`❌ 404 Body:`, req.body);
  console.log(`❌ 404 Query:`, req.query);

  // 🔥 СПЕЦИАЛЬНО ДЛЯ TON ЗАПРОСОВ
  if (req.path.startsWith('/api/ton')) {
    console.log('💰💥 TON API ЗАПРОС УПАЛ В 404!');
    console.log('💰💥 Доступные TON маршруты должны быть:');
    console.log('💰💥 - GET /api/ton/calculate/:amount');
    console.log('💰💥 - POST /api/ton/stake');
    console.log('💰💥 - GET /api/ton/stakes/:telegramId');
    console.log('💰💥 - POST /api/ton/withdraw');
    console.log('💰💥 - POST /api/ton/cancel');
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
      'GET /api/ton/calculate/:amount',
      'POST /api/ton/stake ⭐ ГЛАВНЫЙ',
      'GET /api/ton/stakes/:telegramId',
      'POST /api/ton/withdraw',
      'POST /api/ton/cancel',
      'POST /api/collect - сбор ресурсов',
      'POST /api/safe/collect - безопасный сбор',
      'GET /api/player/:telegramId',
      'POST /api/player/language',
      'GET /api/shop/asteroids',
      'POST /api/shop/buy',
      'GET /api/debug/player/:telegramId'
    ]
  });
});

// 🔥 ЗАПУСК СЕРВЕРА с диагностикой (ваш оригинальный код)
app.listen(PORT, async () => {
  console.log(`\n🚀 ============================================`);
  console.log(`🚀 CosmoClick Backend запущен успешно!`);
  console.log(`🚀 ============================================`);
  console.log(`📡 Порт: ${PORT}`);
  console.log(`🌐 CORS: разрешены все домены`);
  console.log(`💰 TON API: /api/ton/*`);
  console.log(`🎮 Player API: /api/player/*`);
  console.log(`🛒 Shop API: /api/shop/*`);
  console.log(`🏥 Health check: /api/health`);
  console.log(`⏰ Time check: /api/time`);
  console.log(`🔄 Redirect: /webhook -> frontend`);
  console.log(`🚀 ============================================\n`);

  // 🔥 Проверяем что TON маршруты загружены (ваш оригинальный код)
  console.log('🔍 Проверяем загруженные маршруты...');
  console.log('TON routes loaded:', app._router ? 'да' : 'нет');

  // --- >>> ВАЖНОЕ: Установка вебхука Telegram при запуске сервера <<< ---
  const webhookUrl = `https://cosmoclick-backend.onrender.com/webhook`;
  try {
    const success = await bot.telegram.setWebhook(webhookUrl);
    console.log(`📡 Установка вебхука Telegram (${webhookUrl}): ${success ? '✅ Успешно' : '❌ Ошибка'}`);
  } catch (error) {
    console.error('❌ Ошибка установки вебхука Telegram:', error.message);
    console.error('Убедитесь, что вебхук установлен правильно через BotFather или PUBLIC_URL настроен.');
  }

});