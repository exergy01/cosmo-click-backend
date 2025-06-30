const express = require('express');
const cors = require('cors');

const app = express();

// 🔥 РАСШИРЕННЫЙ CORS для Telegram WebApp
app.use(cors({
  origin: '*', // Разрешаем все домены
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Authorization'],
  credentials: false
}));

// 🔥 ДОПОЛНИТЕЛЬНЫЕ CORS заголовки для Telegram
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Логируем все запросы для отладки
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

// 🔥 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: TON МАРШРУТЫ ДОЛЖНЫ БЫТЬ ПЕРВЫМИ!
const tonRoutes = require('./routes/ton');
app.use('/api/ton', tonRoutes);

// 🔥 ОСТАЛЬНЫЕ API МАРШРУТЫ (КОНКРЕТНЫЕ ПЕРВЫМИ)
const playerRoutes = require('./routes/player');
const shopRoutes = require('./routes/shop');
app.use('/api/player', playerRoutes);
app.use('/api/shop', shopRoutes);

// 🔥 ДОПОЛНИТЕЛЬНЫЕ МАРШРУТЫ
app.get('/api/time', (req, res) => {
  res.json({ serverTime: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('CosmoClick Backend');
});

// 🔥 ОБЩИЕ МАРШРУТЫ В КОНЦЕ (чтобы не перехватывали API)
const routes = require('./routes/index');
app.use('/', routes);

// 🔥 Обработчик ошибок
app.use((err, req, res, next) => {
  console.error('🚨 ОШИБКА СЕРВЕРА:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message,
    path: req.path,
    method: req.method
  });
});

// 🔥 Обработчик 404
app.use((req, res) => {
  console.log('❌ 404 NOT FOUND:', req.method, req.path);
  res.status(404).json({ 
    error: 'Not found',
    path: req.path,
    method: req.method,
    message: 'Проверьте правильность URL',
    availableRoutes: [
      'GET /',
      'GET /api/time',
      'GET /api/ton/stakes/:telegramId',
      'POST /api/ton/stake',
      'POST /api/ton/withdraw',
      'POST /api/ton/cancel',
      'GET /api/ton/calculate/:amount',
      'GET /api/player/:telegramId',
      'POST /api/player/language',
      'GET /api/shop/asteroids',
      'POST /api/shop/buy'
    ]
  });
});

// 🔥 ЗАПУСК СЕРВЕРА (В КОНЦЕ)
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`🌐 CORS настроен для всех доменов`);
  console.log(`📡 API доступен на http://localhost:${PORT}/api`);
  console.log(`💰 TON API доступен на http://localhost:${PORT}/api/ton`);
  console.log(`🎮 Player API доступен на http://localhost:${PORT}/api/player`);
  console.log(`🛒 Shop API доступен на http://localhost:${PORT}/api/shop`);
});