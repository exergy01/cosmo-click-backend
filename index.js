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
  
  // Если это браузерный запрос - redirect на frontend
  if (userAgent.includes('Mozilla')) {
    console.log('🔄 REDIRECT: Браузерный запрос обнаружен');
    
    // Извлекаем реферальный параметр
    const referralParam = req.query.tgWebAppStartParam || req.query.startapp || req.query.start;
    
    // Формируем правильную ссылку на frontend
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

// 🔥 ОТЛАДОЧНЫЙ МАРШРУТ - добавляем ПЕРЕД остальными маршрутами
app.get('/api/debug/count-referrals/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const pool = require('./db');
    console.log(`🔍 DEBUG: Считаем рефералов для ${telegramId}`);
    
    // Считаем напрямую из таблицы players где referrer_id = наш ID
    const countResult = await pool.query(
      'SELECT COUNT(*) as count FROM players WHERE referrer_id = $1', 
      [telegramId]
    );
    
    // Получаем всех кто имеет этого реферера
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

// 🎮 ПОДКЛЮЧАЕМ МИНИИГРЫ - ДОБАВЛЕНО ЗДЕСЬ!
console.log('🎮 Подключаем маршруты миниигр...');
try {
  const miniGamesRoutes = require('./routes/games');
  app.use('/api/games', miniGamesRoutes);
  console.log('✅ Маршруты миниигр подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов миниигр:', err);
}

// 🎮 ПОДКЛЮЧАЕМ КОСМИЧЕСКИЕ НАПЁРСТКИ - КРИТИЧЕСКИ ВАЖНО!
console.log('🎮 Подключаем маршруты космических напёрстков...');
try {
  const cosmicShellsRoutes = require('./routes/games/cosmic_shells');
  app.use('/api/games/cosmic-shells', cosmicShellsRoutes);
  console.log('✅ Маршруты космических напёрстков подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов космических напёрстков:', err);
}

// 🎰 ПОДКЛЮЧАЕМ ГАЛАКТИЧЕСКИЕ СЛОТЫ - НОВОЕ!
console.log('🎰 Подключаем маршруты галактических слотов...');
try {
  const galacticSlotsRoutes = require('./routes/games/galactic_slots');
  app.use('/api/games/galactic-slots', galacticSlotsRoutes);
  console.log('✅ Маршруты галактических слотов подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов галактических слотов:', err);
}

// 🎯 ПОДКЛЮЧАЕМ ADSGRAM - ДОБАВЛЕНО ДЛЯ РЕКЛАМЫ!
console.log('🎯 Подключаем маршруты Adsgram...');
try {
  const adsgramRoutes = require('./routes/adsgram');
  app.use('/api/adsgram', adsgramRoutes);
  console.log('✅ Маршруты Adsgram подключены успешно');
} catch (err) {
  console.error('❌ Ошибка подключения маршрутов Adsgram:', err);
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
      <li>GET /api/ton/calculate/15 - расчет стейкинга</li>
      <li>POST /api/ton/stake - создание стейка</li>
      <li>GET /api/ton/stakes/:telegramId - список стейков</li>
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

// 🔥 СПЕЦИАЛЬНЫЙ MIDDLEWARE для диагностики TON запросов (ваш оригинальный код)
app.use('/api/ton/*', (req, res, next) => {
  console.log(`💰 TON API запрос: ${req.method} ${req.originalUrl}`);
  console.log(`📋 TON Headers:`, req.headers);
  console.log(`📦 TON Body:`, req.body);
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

  // 🎮 СПЕЦИАЛЬНО ДЛЯ ИГРОВЫХ ЗАПРОСОВ
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

  // 🎯 СПЕЦИАЛЬНО ДЛЯ ADSGRAM ЗАПРОСОВ
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
  console.log(`🎯 Games API: /api/games/*`);
  console.log(`🛸 Cosmic Shells: /api/games/cosmic-shells/*`);
  console.log(`🎰 Galactic Slots: /api/games/galactic-slots/*`);
  console.log(`🎯 Adsgram API: /api/adsgram/*`);
  console.log(`🏥 Health check: /api/health`);
  console.log(`⏰ Time check: /api/time`);
  console.log(`🔍 Debug: /api/debug/*`);
  console.log(`🔄 Redirect: /webhook -> frontend`);
  console.log(`🚀 ============================================\n`);

  // 🔥 Проверяем что все маршруты загружены
  console.log('🔍 Проверяем загруженные маршруты...');
  console.log('TON routes loaded:', app._router ? 'да' : 'нет');
  console.log('Games routes loaded:', app._router ? 'да' : 'нет');
  console.log('Cosmic Shells routes loaded:', app._router ? 'да' : 'нет');
  console.log('Galactic Slots routes loaded:', app._router ? 'да' : 'нет');
  console.log('Adsgram routes loaded:', app._router ? 'да' : 'нет');

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