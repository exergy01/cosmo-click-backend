// routes/admin/index.js - Главный роутер админ-панели (ПРОСТОЕ ИСПРАВЛЕНИЕ)
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
// 📋 УПРАВЛЕНИЕ ЗАДАНИЯМИ - ИСПРАВЛЕНО ПРОСТО
// ===============================

// ИСПРАВЛЕНО: Подключаем управление заданиями БЕЗ префикса, как все остальные модули
router.use('/', questsManagementModule);

console.log('✅ Модуль заданий подключен: /list, /create, /update, /delete, /toggle-status (БЕЗ префикса /quests)');

// ===============================
// 📅 ПЛАНИРОВЩИК ЗАДАНИЙ - ИСПРАВЛЕНО ПРОСТО
// ===============================

// Подключаем планировщик заданий с префиксом /scheduler (как в оригинале)
router.use('/scheduler', questsSchedulerModule);

console.log('✅ Модуль планировщика подключен: /scheduler/overview, /scheduler/create-schedule');

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
    admin_panel_version: '2.0.2-simple-fix',
    total_modules: 8,
    modules: [
      {
        name: 'Authentication',
        file: 'auth.js',
        endpoints: ['/check/:telegramId', '/debug/:telegramId'],
        description: 'Проверка админских прав и отладка'
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
        endpoints: ['/grant-premium-30days/:telegramId', '/grant-premium-forever/:telegramId', '/revoke-premium/:telegramId', '/grant-basic-verification/:telegramId', '/premium-overview/:telegramId', '/test-premium-cleanup/:telegramId'],
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
        endpoints: ['/update-ton-rate/:telegramId', '/unblock-exchange/:telegramId', '/cleanup-expired-premium/:telegramId', '/system-status/:telegramId', '/clear-logs/:telegramId'],
        description: 'Системные функции: курсы, разблокировки'
      },
      {
        name: 'Quests Management',
        file: 'quests/management.js',
        endpoints: ['/list/:telegramId', '/get/:questKey/:telegramId', '/create/:telegramId', '/update/:questKey/:telegramId', '/delete/:questKey/:telegramId', '/toggle-status/:questKey/:telegramId'],
        description: 'CRUD операции с заданиями и переводами (ИСПРАВЛЕНО - БЕЗ префикса)'
      },
      {
        name: 'Quests Scheduler',
        file: 'quests/scheduler.js',
        endpoints: ['/scheduler/overview/:telegramId', '/scheduler/create-schedule/:telegramId', '/scheduler/toggle-schedule/:telegramId', '/scheduler/list/:telegramId', '/scheduler/test-activation/:telegramId', '/scheduler/history/:telegramId'],
        description: 'Планировщик автоматической активации заданий'
      }
    ],
    architecture: {
      old_file_size: '1200+ lines',
      new_structure: 'Modular architecture',
      quest_routing_fix: 'Убран конфликтующий префикс /quests - теперь квесты подключены напрямую как все остальные модули',
      benefits: [
        'Легче поддерживать код',
        'Проще добавлять новые функции', 
        'Лучше организован код',
        'Возможность независимого тестирования модулей',
        'Команда может работать с разными модулями'
      ]
    },
    migration_status: 'Completed',
    quest_endpoints_fixed: true,
    timestamp: new Date().toISOString()
  };
  
  res.json(modulesInfo);
});

// ===============================
// 🚀 ЭКСПОРТ РОУТЕРА
// ===============================

console.log('🚀 Модульная админ-панель готова к работе!');
console.log('📊 Всего модулей: 8');
console.log('🔗 Всего endpoints: ~25');
console.log('🔧 Квесты: убран префикс /quests, подключены напрямую');

module.exports = router;