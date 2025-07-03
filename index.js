const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser'); // Добавлено: для обработки JSON
const dotenv = require('dotenv'); // Добавлено: для загрузки .env
const { Telegraf } = require('telegraf'); // <<< ВАЖНО: Импортируем Telegraf

dotenv.config(); // Загружаем переменные окружения

const app = express();
const PORT = process.env.PORT || 5000;
const BOT_TOKEN = process.env.BOT_TOKEN; // <<< Ваш токен бота из .env
const PUBLIC_URL = process.env.PUBLIC_URL; // <<< Ваш публичный URL бэкенда на Render

// Проверка наличия BOT_TOKEN и PUBLIC_URL
if (!BOT_TOKEN) {
  console.error('❌ Ошибка: BOT_TOKEN не найден в .env или переменных окружения!');
  process.exit(1);
}
if (!PUBLIC_URL) {
  console.error('❌ Ошибка: PUBLIC_URL не найден в .env или переменных окружения! Он нужен для установки вебхука.');
  // Не выходим, так как можно установить вебхук вручную, но предупреждаем
}

// Инициализируем бота
const bot = new Telegraf(BOT_TOKEN); // <<< Инициализируем бота

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: false
}));

// Дополнительные CORS заголовки (ваш код)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With', 'Content-Type', 'Accept', 'Authorization');

  // Детальное логирование (ваш код)
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

app.use(express.json());
app.use(bodyParser.json()); // Добавлено: для корректной работы Telegraf с JSON телом запроса

// --- >>> ВАЖНОЕ ДОБАВЛЕНИЕ ДЛЯ ВЕБХУКА TELEGRAM <<< ---
// Этот middleware должен быть установлен ПЕРЕД другими маршрутами API,
// чтобы Telegraf мог перехватывать входящие обновления от Telegram на /webhook.
app.use(bot.webhookCallback('/webhook')); // <<< ЭТО СОЗДАЕТ POST /webhook

// Обработка тестовых команд бота (для проверки, что бот работает)
bot.start((ctx) => {
  console.log('Bot /start command received.');
  ctx.reply('Привет! Я бот для CosmoClick Game. Запускай игру через меню или Web App!');
});
bot.help((ctx) => {
  console.log('Bot /help command received.');
  ctx.reply('Я бот для CosmoClick Game. Запускай игру через меню или Web App. Если нужна помощь по игре, напиши в поддержку!');
});

// Обработка ошибок бота
bot.catch((err, ctx) => {
    console.error(`❌ Ошибка Telegraf для ${ctx.updateType}:`, err);
    // ctx.reply('Произошла ошибка, попробуйте позже.'); // Можно отправлять сообщение пользователю
});

// 🔥 КРИТИЧЕСКИ ВАЖНО: TON API ПЕРВЫМ! (ваш код)
console.log('🔥 Подключаем TON маршруты...');
try {
  const tonRoutes = require('./routes/ton');
  app.use('/api/ton', tonRoutes);
  console.log('✅ TON маршруты подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения TON маршрутов:', err);
}

// 🔥 ВАЖНЫЕ ИГРОВЫЕ МАРШРУТЫ из routes/index.js (содержит /api/collect, /api/safe/collect и др.) (ваш код)
console.log('🔥 Подключаем игровые маршруты из routes/index.js...');
try {
  const gameRoutes = require('./routes/index'); // Это тот файл, который вы ранее давали
  app.use('/', gameRoutes); // Подключаем ваш router из routes/index.js
  console.log('✅ Игровые маршруты подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения игровых маршрутов:', err);
}

// 🔥 БАЗОВЫЕ МАРШРУТЫ (ваш код)
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
  `);
});

// 🔥 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики TON запросов (ваш код)
app.use('/api/ton/*', (req, res, next) => {
  console.log(`💰 TON API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 TON Headers:`, req.headers);
  console.log(`📦 TON Body:`, req.body);
  next();
});

// 🔥 Обработчик ошибок с диагностикой (ваш код)
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

// 🔥 Улучшенный обработчик 404 с диагностикой (ваш код)
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

// 🔥 ЗАПУСК СЕРВЕРА с диагностикой (ваш код)
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
  console.log(`🚀 ============================================\n`);

  // 🔥 Проверяем что TON маршруты загружены
  console.log('🔍 Проверяем загруженные маршруты...');
  console.log('TON routes loaded:', app._router ? 'да' : 'нет');

  // --- >>> ВАЖНОЕ: Установка вебхука Telegram при запуске сервера <<< ---
  const webhookUrl = `${PUBLIC_URL}/webhook`; // Используем PUBLIC_URL для формирования URL
  if (PUBLIC_URL) {
    try {
      const success = await bot.telegram.setWebhook(webhookUrl);
      console.log(`📡 Установка вебхука Telegram (${webhookUrl}): ${success ? '✅ Успешно' : '❌ Ошибка'}`);
    } catch (error) {
      console.error('❌ Ошибка установки вебхука Telegram:', error.message);
      console.error('Убедитесь, что PUBLIC_URL установлен правильно и доступен извне.');
    }
  } else {
    console.warn('⚠️ PUBLIC_URL не установлен. Вебхук не будет установлен автоматически при запуске.');
    console.warn('⚠️ Пожалуйста, установите его вручную через BotFather, если вы этого не сделали: /setwebhook -> ваш бот -> https://cosmoclick-backend.onrender.com/webhook');
  }

});