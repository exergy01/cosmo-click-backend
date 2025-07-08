const express = require('express');
const router = express.Router();

// Подключаем маршруты отдельных игр
router.use('/tapper', require('./tapper'));
router.use('/cosmic-shells', require('./cosmic_shells')); // ← ДОБАВИТЬ ЭТУ СТРОКУ
router.use('/', require('./stats')); // Статистика доступна напрямую

// Middleware для проверки пользователя
router.use('*', (req, res, next) => {
    // Добавляем базовую проверку телеграм ID
    const telegramId = req.params.telegramId;
    if (telegramId && isNaN(parseInt(telegramId))) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid telegram ID' 
        });
    }
    next();
});

module.exports = router;