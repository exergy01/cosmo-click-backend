// routes/admin/auth.js - Модуль аутентификации и проверки прав (ИСПРАВЛЕНО)
const express = require('express');
const router = express.Router();

console.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');
console.log('🚀 AUTH.JS FILE LOADED - NEW VERSION WITH DEBUGGING! 🚀');
console.log('🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀');

// 🔐 АДМИНСКИЙ ID ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

// 🧪 ТЕСТОВЫЕ ПОЛЬЗОВАТЕЛИ (для доступа к фичам в разработке)
const TEST_USERS_IDS = process.env.TEST_USERS_IDS
  ? process.env.TEST_USERS_IDS.split(',').map(id => id.trim())
  : [];

console.log('🔧 Модуль аутентификации загружен. ADMIN_TELEGRAM_ID:', ADMIN_TELEGRAM_ID, 'тип:', typeof ADMIN_TELEGRAM_ID);
console.log('🧪 Тестовые пользователи:', TEST_USERS_IDS);

// 🛡️ Middleware для проверки админских прав - ИСПРАВЛЕНО
const adminAuth = (req, res, next) => {
  // КРИТИЧЕСКОЕ ИСКЛЮЧЕНИЕ: пропускаем запросы к /test-access без проверки прав
  if (req.url.includes('/test-access') || req.originalUrl.includes('/test-access')) {
    console.log('⚠️ Запрос к /test-access - пропускаем adminAuth middleware');
    return next();
  }

  // ИСПРАВЛЕНО: Ищем telegramId в разных местах URL
  let telegramId = req.params.telegramId;
  
  // Если не найден в прямых параметрах, ищем в разных частях URL
  if (!telegramId) {
    const urlParts = req.url.split('/');
    // Ищем число в URL (telegram ID всегда числовой)
    for (const part of urlParts) {
      // Убираем query string если есть (например "1222791281?status=all" -> "1222791281")
      const cleanPart = part.split('?')[0];
      if (/^\d+$/.test(cleanPart)) {
        telegramId = cleanPart;
        break;
      }
    }
  }
  
  // Если всё ещё не найден, пробуем альтернативные параметры
  if (!telegramId) {
    telegramId = req.params.adminId || req.query.telegramId || req.body.telegramId;
  }
  
  if (process.env.NODE_ENV === 'development') console.log('🔐 Проверка админских прав:', {
    telegramId, 
    telegramIdType: typeof telegramId,
    adminId: ADMIN_TELEGRAM_ID, 
    adminIdType: typeof ADMIN_TELEGRAM_ID,
    telegramIdStr: String(telegramId),
    adminIdStr: String(ADMIN_TELEGRAM_ID),
    stringMatch: String(telegramId) === String(ADMIN_TELEGRAM_ID),
    urlParams: req.params,
    urlPath: req.url,
    method: req.method,
    allUrlParts: req.url.split('/')
  });
  
  if (!telegramId) {
    if (process.env.NODE_ENV === 'development') console.log('🚫 Telegram ID не предоставлен ни в URL параметрах, ни в частях URL');
    return res.status(400).json({ 
      error: 'Telegram ID is required',
      debug: {
        url: req.url,
        params: req.params,
        method: req.method,
        urlParts: req.url.split('/'),
        help: 'Убедитесь что URL содержит telegram ID'
      }
    });
  }
  
  // Приводим оба значения к строкам для правильного сравнения
  const telegramIdStr = String(telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  
  if (telegramIdStr !== adminIdStr) {
    if (process.env.NODE_ENV === 'development') console.log('🚫 Доступ запрещен - не админ:', {
      received: telegramIdStr,
      expected: adminIdStr,
      match: telegramIdStr === adminIdStr
    });
    return res.status(403).json({ 
      error: 'Access denied',
      debug: {
        receivedId: telegramIdStr,
        expectedId: adminIdStr.substring(0, 4) + '***', // Частично скрываем ID в логах
        isMatch: telegramIdStr === adminIdStr
      }
    });
  }
  
  if (process.env.NODE_ENV === 'development') console.log('✅ Админ права подтверждены для ID:', telegramIdStr);
  
  // ИСПРАВЛЕНО: Сохраняем найденный telegramId в req.params для дальнейшего использования
  req.params.telegramId = telegramIdStr;
  
  next();
};

// 🔍 Функция проверки админа (без middleware)
const isAdmin = (telegramId) => {
  if (!telegramId) return false;

  const telegramIdStr = String(telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  return telegramIdStr === adminIdStr;
};

// 🧪 Функция проверки тестового пользователя
const isTestUser = (telegramId) => {
  if (!telegramId) return false;

  const telegramIdStr = String(telegramId).trim();
  return TEST_USERS_IDS.some(id => String(id).trim() === telegramIdStr);
};

// 🧪 GET /test-access/:telegramId - проверка тестового доступа
console.log('📝📝📝 REGISTERING ROUTE: GET /test-access/:telegramId 📝📝📝');
router.get('/test-access/:telegramId', (req, res) => {
  console.log('✅✅✅ ROUTE /test-access/:telegramId WAS CALLED! ✅✅✅');
  const { telegramId } = req.params;

  const hasTestAccess = isTestUser(telegramId);

  console.log('🧪 Проверка тестового доступа:', {
    telegramId,
    hasAccess: hasTestAccess,
    testUsers: TEST_USERS_IDS
  });

  res.json({
    hasTestAccess,
    timestamp: new Date().toISOString()
  });
});
console.log('✅✅✅ ROUTE /test-access/:telegramId REGISTERED! ✅✅✅');

// 🔍 GET /check/:telegramId - проверка админского статуса
router.get('/check/:telegramId', (req, res) => {
  console.log('❌❌❌ ROUTE /check/:telegramId WAS CALLED! ❌❌❌');
  console.log('Request URL:', req.url);
  console.log('Request originalUrl:', req.originalUrl);
  console.log('Request path:', req.path);
  console.log('Request params:', req.params);
  console.log('telegramId value:', req.params.telegramId);

  // КРИТИЧЕСКАЯ ПРОВЕРКА: если это запрос к check-test-access, не обрабатывать!
  if (req.params.telegramId && req.params.telegramId.includes('test-access')) {
    console.log('⚠️⚠️⚠️ This is actually a check-test-access request! Skipping...');
    return res.status(404).json({ error: 'Route mismatch detected' });
  }

  const { telegramId } = req.params;

  const telegramIdStr = String(telegramId).trim();
  const adminIdStr = String(ADMIN_TELEGRAM_ID).trim();
  const isAdminUser = telegramIdStr === adminIdStr;

  console.log('🔍 Проверка админского статуса:', {
    telegramId: telegramIdStr,
    adminId: adminIdStr,
    isAdmin: isAdminUser,
    receivedType: typeof telegramId,
    adminType: typeof ADMIN_TELEGRAM_ID
  });

  res.json({
    isAdmin: isAdminUser,
    timestamp: new Date().toISOString(),
    debug: {
      receivedId: telegramIdStr,
      expectedId: adminIdStr,
      typesMatch: typeof telegramId === typeof ADMIN_TELEGRAM_ID,
      stringMatch: telegramIdStr === adminIdStr
    }
  });
});

// 🔧 GET /debug/:telegramId - отладочная информация
router.get('/debug/:telegramId', (req, res) => {
  const { telegramId } = req.params;

  const debugInfo = {
    received_telegram_id: telegramId,
    received_type: typeof telegramId,
    admin_telegram_id: ADMIN_TELEGRAM_ID,
    admin_type: typeof ADMIN_TELEGRAM_ID,
    string_comparison: String(telegramId) === String(ADMIN_TELEGRAM_ID),
    direct_comparison: telegramId === ADMIN_TELEGRAM_ID,
    env_vars: {
      NODE_ENV: process.env.NODE_ENV,
      ADMIN_TELEGRAM_ID: process.env.ADMIN_TELEGRAM_ID
    },
    url_info: {
      full_url: req.url,
      params: req.params,
      query: req.query,
      method: req.method
    },
    timestamp: new Date().toISOString()
  };

  if (process.env.NODE_ENV === 'development') console.log('🔧 Debug запрос:', debugInfo);

  res.json(debugInfo);
});

// 🧪 GET /test-middleware/:telegramId - тест middleware
router.get('/test-middleware/:telegramId', adminAuth, (req, res) => {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Тест middleware прошел успешно');
  res.json({
    success: true,
    message: 'Middleware test passed',
    telegramId: req.params.telegramId,
    timestamp: new Date().toISOString()
  });
});

module.exports = {
  router,
  adminAuth,
  isAdmin,
  isTestUser,
  ADMIN_TELEGRAM_ID,
  TEST_USERS_IDS
};