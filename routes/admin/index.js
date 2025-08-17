// routes/admin/index.js - Главный роутер админ-панели (ИСПРАВЛЕНО)
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
// 📋 УПРАВЛЕНИЕ ЗАДАНИЯМИ - ИСПРАВЛЕНО
// ===============================

// ИСПРАВЛЕНО: Подключаем управление заданиями БЕЗ префикса /quests
// Теперь endpoints будут: /api/admin/quests-list/1222791281 вместо /api/admin/quests/list/1222791281

// 📋 GET /quests-list/:telegramId - список заданий
router.get('/quests-list/:telegramId', (req, res) => {
  // Перенаправляем на правильный обработчик
  req.url = `/list/${req.params.telegramId}`;
  questsManagementModule(req, res);
});

// ✏️ GET /quests-get/:questKey/:telegramId - детали задания  
router.get('/quests-get/:questKey/:telegramId', (req, res) => {
  req.url = `/get/${req.params.questKey}/${req.params.telegramId}`;
  questsManagementModule(req, res);
});

// ➕ POST /quests-create/:telegramId - создать задание
router.post('/quests-create/:telegramId', (req, res) => {
  req.url = `/create/${req.params.telegramId}`;
  questsManagementModule(req, res);
});

// ✏️ PUT /quests-update/:questKey/:telegramId - обновить задание
router.put('/quests-update/:questKey/:telegramId', (req, res) => {
  req.url = `/update/${req.params.questKey}/${req.params.telegramId}`;
  questsManagementModule(req, res);
});

// 🗑️ DELETE /quests-delete/:questKey/:telegramId - удалить задание
router.delete('/quests-delete/:questKey/:telegramId', (req, res) => {
  req.url = `/delete/${req.params.questKey}/${req.params.telegramId}`;
  questsManagementModule(req, res);
});

// 🔄 POST /quests-toggle/:questKey/:telegramId - переключить статус
router.post('/quests-toggle/:questKey/:telegramId', (req, res) => {
  req.url = `/toggle-status/${req.params.questKey}/${req.params.telegramId}`;
  questsManagementModule(req, res);
});

// 📊 GET /quests-stats/:telegramId - статистика заданий
router.get('/quests-stats/:telegramId', (req, res) => {
  req.url = `/stats/${req.params.telegramId}`;
  questsManagementModule(req, res);
});

console.log('✅ Модуль заданий подключен: /quests-list, /quests-create, /quests-update, /quests-delete, /quests-toggle');

// ===============================
// 📅 ПЛАНИРОВЩИК ЗАДАНИЙ - ИСПРАВЛЕНО
// ===============================

// Подключаем планировщик БЕЗ префикса /scheduler для совместимости
router.get('/scheduler-overview/:telegramId', (req, res) => {
  req.url = `/overview/${req.params.telegramId}`;
  questsSchedulerModule(req, res);
});

router.post('/scheduler-create/:telegramId', (req, res) => {
  req.url = `/create-schedule/${req.params.telegramId}`;
  questsSchedulerModule(req, res);
});

router.post('/scheduler-toggle/:telegramId', (req, res) => {
  req.url = `/toggle-schedule/${req.params.telegramId}`;
  questsSchedulerModule(req, res);
});

router.get('/scheduler-list/:telegramId', (req, res) => {
  req.url = `/list/${req.params.telegramId}`;
  questsSchedulerModule(req, res);
});

router.post('/scheduler-test/:telegramId', (req, res) => {
  req.url = `/test-activation/${req.params.telegramId}`;
  questsSchedulerModule(req, res);
});

router.get('/scheduler-history/:telegramId', (req, res) => {
  req.url = `/history/${req.params.telegramId}`;
  questsSchedulerModule(req, res);
});

console.log('✅ Модуль планировщика подключен: /scheduler-overview, /scheduler-create, /scheduler-list');

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
    admin_panel_version: '2.0.1-fixed',
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
        endpoints: ['/update-ton-rate/:telegramId', '/unblock-exchange/:telegramId', '/system-status/:telegramId', '/cleanup-expired-premium/:telegramId'],
        description: 'Системные функции: курсы, разблокировки, очистка'
      },
      {
        name: 'Quests Management',
        file: 'quests/management.js',
        endpoints: ['/quests-list/:telegramId', '/quests-get/:questKey/:telegramId', '/quests-create/:telegramId', '/quests-update/:questKey/:telegramId', '/quests-delete/:questKey/:telegramId', '/quests-toggle/:questKey/:telegramId', '/quests-stats/:telegramId'],
        description: 'CRUD операции с заданиями и переводами (ИСПРАВЛЕНО)'
      },
      {
        name: 'Quests Scheduler',
        file: 'quests/scheduler.js',
        endpoints: ['/scheduler-overview/:telegramId', '/scheduler-create/:telegramId', '/scheduler-toggle/:telegramId', '/scheduler-list/:telegramId', '/scheduler-test/:telegramId', '/scheduler-history/:telegramId'],
        description: 'Планировщик автоматической активации заданий (ИСПРАВЛЕНО)'
      }
    ],
    architecture: {
      old_file_size: '1200+ lines',
      new_structure: 'Modular architecture',
      quest_routing_fix: 'Изменены endpoints квестов для совместимости с middleware',
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
console.log('🔗 Всего endpoints: ~30');
console.log('🔧 Квесты: endpoints изменены для совместимости');

module.exports = router;