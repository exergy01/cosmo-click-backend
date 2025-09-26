// routes/admin/index.js - С АЛИАСАМИ для обратной совместимости
const express = require('express');

const router = express.Router();

console.log('🏗️ Инициализация модульной админ-панели...');

// Импортируем все модули
const authModule = require('./auth');
const statsModule = require('./stats');
const playersModule = require('./players');
const premiumModule = require('./premium');
const messagingModule = require('./messaging');
const systemModule = require('./system');

// Модули заданий
const questsManagementModule = require('./quests/management');
const questsSchedulerModule = require('./quests/scheduler');

// Финансовый модуль
const financeModule = require('./finance');

// Аналитика и расследования
const analyticsModule = require('./analytics');
const investigationModule = require('./investigation');

console.log('📦 Все модули админ-панели загружены');

// ===============================
// 🔐 АУТЕНТИФИКАЦИЯ И ПРОВЕРКИ
// ===============================

// Подключаем роуты аутентификации (БЕЗ middleware, так как они сами проверяют права)
router.use('/', authModule.router);

console.log('✅ Модуль аутентификации подключен: /check, /debug');

// ===============================
// 📊 СТАТИСТИКА
// ===============================

// Подключаем статистику (проверка прав внутри модуля)
router.use('/', statsModule);

console.log('✅ Модуль статистики подключен: /stats');

// ===============================
// 👥 УПРАВЛЕНИЕ ИГРОКАМИ
// ===============================

// Подключаем управление игроками (middleware внутри модуля)
router.use('/', playersModule);

console.log('✅ Модуль игроков подключен: /player, /update-balance, /verify-player, /search');

// ===============================
// 🏆 ПРЕМИУМ ФУНКЦИИ
// ===============================

// Подключаем премиум функции (middleware внутри модуля)
router.use('/', premiumModule);

console.log('✅ Модуль премиум подключен: /grant-premium-*, /revoke-premium, /premium-overview');

// ===============================
// 📱 СООБЩЕНИЯ И РАССЫЛКИ
// ===============================

// Подключаем модуль сообщений (middleware внутри модуля)
router.use('/', messagingModule);

console.log('✅ Модуль сообщений подключен: /send-message, /broadcast-message');

// ===============================
// 🔧 СИСТЕМНЫЕ ФУНКЦИИ
// ===============================

// Подключаем системные функции (middleware внутри модуля)
router.use('/', systemModule);

console.log('✅ Модуль системы подключен: /update-ton-rate, /unblock-exchange');

// ===============================
// 📋 УПРАВЛЕНИЕ ЗАДАНИЯМИ - НОВЫЕ + АЛИАСЫ
// ===============================

// Подключаем управление заданиями БЕЗ префикса (новые URL)
router.use('/', questsManagementModule);

// АЛИАСЫ для обратной совместимости с фронтендом
router.use('/quests', questsManagementModule);

console.log('✅ Модуль заданий подключен: /list + /quests/list (алиас для совместимости)');

// ===============================
// 📅 ПЛАНИРОВЩИК ЗАДАНИЙ
// ===============================

// Подключаем планировщик заданий с префиксом /scheduler
router.use('/scheduler', questsSchedulerModule);

console.log('✅ Модуль планировщика подключен: /scheduler/overview, /scheduler/create-schedule');

// ===============================
// 💰 ФИНАНСОВОЕ УПРАВЛЕНИЕ
// ===============================

// Подключаем финансовый модуль
router.use('/', financeModule);

console.log('✅ Модуль финансов подключен: /ton-deposits, /ton-stats, /process-ton-deposit');

// ===============================
// 📊 АНАЛИТИКА
// ===============================

// Подключаем модуль аналитики
router.use('/analytics', analyticsModule);

console.log('✅ Модуль аналитики подключен: /analytics/daily-finance, /analytics/top-players');

// ===============================
// 🕵️ РАССЛЕДОВАНИЯ
// ===============================

// Подключаем модуль расследований
router.use('/investigation', investigationModule);

console.log('✅ Модуль расследований подключен: /investigation/search, /investigation/player-analysis');

// ===============================
// 📋 ИНФОРМАЦИЯ О МОДУЛЯХ
// ===============================

// 📋 GET /modules-info/:telegramId - информация о подключенных модулях
router.get('/modules-info/:telegramId', (req, res) => {
  const { telegramId } = req.params;
  
  // Проверяем админа
  if (!authModule.isAdmin(telegramId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  console.log(`📋 Админ ${telegramId} запросил информацию о модулях`);
  
  const modulesInfo = {
    success: true,
    admin_panel_version: '2.0.3-backward-compatible',
    total_modules: 9,
    modules: [
      {
        name: 'Authentication',
        file: 'auth.js',
        endpoints: ['/check/:telegramId', '/debug/:telegramId', '/test-middleware/:telegramId'],
        description: 'Проверка админских прав и отладка (ИСПРАВЛЕНО middleware)'
      },
      {
        name: 'Statistics',
        file: 'stats.js', 
        endpoints: ['/stats/:telegramId'],
        description: 'Полная статистика системы'
      },
      {
        name: 'Players Management',
        file: 'players.js',
        endpoints: ['/player/:telegramId/:playerId', '/update-balance/:telegramId', '/verify-player/:telegramId', '/search/:telegramId'],
        description: 'Управление игроками и их балансами'
      },
      {
        name: 'Premium Management', 
        file: 'premium.js',
        endpoints: ['/grant-premium-30days/:telegramId', '/grant-premium-forever/:telegramId', '/revoke-premium/:telegramId', '/grant-basic-verification/:telegramId', '/premium-overview/:telegramId'],
        description: 'Управление премиум статусами и верификацией'
      },
      {
        name: 'Messaging System',
        file: 'messaging.js', 
        endpoints: ['/send-message/:telegramId', '/broadcast-message/:telegramId'],
        description: 'Отправка сообщений и массовые рассылки'
      },
      {
        name: 'System Functions',
        file: 'system.js',
        endpoints: ['/update-ton-rate/:telegramId', '/unblock-exchange/:telegramId', '/cleanup-expired-premium/:telegramId', '/system-status/:telegramId'],
        description: 'Системные функции: курсы, разблокировки'
      },
      {
        name: 'Quests Management',
        file: 'quests/management.js',
        endpoints: [
          '/list/:telegramId', 
          '/get/:questKey/:telegramId', 
          '/create/:telegramId', 
          '/update/:questKey/:telegramId', 
          '/delete/:questKey/:telegramId', 
          '/toggle-status/:questKey/:telegramId',
          // Алиасы для совместимости
          '/quests/list/:telegramId',
          '/quests/get/:questKey/:telegramId', 
          '/quests/create/:telegramId',
          '/quests/update/:questKey/:telegramId',
          '/quests/delete/:questKey/:telegramId',
          '/quests/toggle-status/:questKey/:telegramId'
        ],
        description: 'CRUD операции с заданиями (ИСПРАВЛЕНО + алиасы для совместимости)'
      },
      {
        name: 'Quests Scheduler',
        file: 'quests/scheduler.js',
        endpoints: ['/scheduler/overview/:telegramId', '/scheduler/create-schedule/:telegramId', '/scheduler/toggle-schedule/:telegramId', '/scheduler/list/:telegramId', '/scheduler/test-activation/:telegramId'],
        description: 'Планировщик автоматической активации заданий'
      },
      {
        name: 'Finance Management',
        file: 'finance.js',
        endpoints: ['/ton-deposits', '/ton-stats', '/process-ton-deposit'],
        description: 'Управление TON депозитами и финансовой статистикой'
      }
    ],
    architecture: {
      old_file_size: '1200+ lines',
      new_structure: 'Modular architecture',
      middleware_fix: 'Исправлен adminAuth для работы с любыми URL структурами',
      backward_compatibility: 'Добавлены алиасы /quests/* для старых URL фронтенда',
      benefits: [
        'Middleware работает корректно',
        'Обратная совместимость с фронтендом',
        'Легко поддерживать код',
        'Проще добавлять новые функции'
      ]
    },
    migration_status: 'Completed',
    middleware_fixed: true,
    backward_compatible: true,
    timestamp: new Date().toISOString()
  };
  
  res.json(modulesInfo);
});

// ===============================
// 🚀 ЭКСПОРТ РОУТЕРА
// ===============================

console.log('🚀 Модульная админ-панель готова к работе!');
console.log('📊 Всего модулей: 9');
console.log('🔗 Всего endpoints: ~35');
console.log('🔄 Middleware исправлен + алиасы для совместимости + финансы');

module.exports = router;