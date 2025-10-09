// routes/admin/auth.js - Модуль аутентификации и проверки прав (ИСПРАВЛЕНО)
const express = require('express');
const router = express.Router();

// 🔐 АДМИНСКИЙ ID ИЗ ПЕРЕМЕННЫХ ОКРУЖЕНИЯ
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

console.log('🔧 Модуль аутентификации загружен. ADMIN_TELEGRAM_ID:', ADMIN_TELEGRAM_ID, 'тип:', typeof ADMIN_TELEGRAM_ID);

// 🛡️ Middleware для проверки админских прав - ИСПРАВЛЕНО
const adminAuth = (req, res, next) => {
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
  
  console.log('🔐 Проверка админских прав:', { 
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
    console.log('🚫 Telegram ID не предоставлен ни в URL параметрах, ни в частях URL');
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
    console.log('🚫 Доступ запрещен - не админ:', {
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
  
  console.log('✅ Админ права подтверждены для ID:', telegramIdStr);
  
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

// 🔍 GET /check/:telegramId - проверка админского статуса
router.get('/check/:telegramId', (req, res) => {
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
  
  console.log('🔧 Debug запрос:', debugInfo);
  
  res.json(debugInfo);
});

// 🧪 GET /test-middleware/:telegramId - тест middleware
router.get('/test-middleware/:telegramId', adminAuth, (req, res) => {
  console.log('🧪 Тест middleware прошел успешно');
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
  ADMIN_TELEGRAM_ID
};