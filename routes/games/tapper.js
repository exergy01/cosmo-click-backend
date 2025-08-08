const express = require('express');
const router = express.Router();
const pool = require('../../db');

// Константы тапалки
const MAX_ENERGY = 500;
const ENERGY_RESTORE_TIME = 43200; // 12 часов в секундах
const ENERGY_PER_SECOND = MAX_ENERGY / ENERGY_RESTORE_TIME;
const CCC_PER_TAP = 0.01;
const MAX_TAPS_PER_REQUEST = 10; // Защита от читерства

// Получить состояние тапалки
router.get('/status/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        
        // Проверяем есть ли запись в таблице энергии
        let result = await pool.query(`
            SELECT energy, last_update, ads_watched_today, last_ad_reset, pending_ccc 
            FROM tapper_energy 
            WHERE telegram_id = $1
        `, [telegramId]);

        let energy, lastUpdate, adsWatched, pendingCcc;
        const now = Date.now();

        if (result.rows.length === 0) {
            // Создаем новую запись
            energy = MAX_ENERGY;
            pendingCcc = 0;
            await pool.query(`
                INSERT INTO tapper_energy (telegram_id, energy, last_update, ads_watched_today, last_ad_reset, pending_ccc)
                VALUES ($1, $2, $3, 0, CURRENT_DATE, 0)
            `, [telegramId, energy, now]);
            adsWatched = 0;
        } else {
            const row = result.rows[0];
            lastUpdate = row.last_update;
            adsWatched = row.ads_watched_today;
            pendingCcc = parseFloat(row.pending_ccc) || 0;

            // Проверяем нужно ли сбросить счетчик рекламы
            const today = new Date().toDateString();
            const lastAdReset = new Date(row.last_ad_reset).toDateString();
            
            if (lastAdReset !== today) {
                adsWatched = 0;
                await pool.query(`
                    UPDATE tapper_energy 
                    SET ads_watched_today = 0, last_ad_reset = CURRENT_DATE
                    WHERE telegram_id = $1
                `, [telegramId]);
            }

            // Восстанавливаем энергию
            const timePassed = (now - lastUpdate) / 1000;
            const energyRestored = Math.floor(timePassed * ENERGY_PER_SECOND);
            energy = Math.min(MAX_ENERGY, row.energy + energyRestored);

            // Обновляем в базе если энергия изменилась
            if (energyRestored > 0) {
                await pool.query(`
                    UPDATE tapper_energy 
                    SET energy = $1, last_update = $2 
                    WHERE telegram_id = $3
                `, [energy, now, telegramId]);
            }
        }

        res.json({
            success: true,
            energy,
            maxEnergy: MAX_ENERGY,
            cccPerTap: CCC_PER_TAP,
            adsWatched,
            canWatchAd: adsWatched < 20,
            pendingCcc: pendingCcc
        });

    } catch (error) {
        console.error('Tapper status error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Тап по астероиду (с защитой от читерства)
router.post('/tap/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { taps = 1 } = req.body;

        // 🛡️ ЗАЩИТА ОТ ЧИТЕРСТВА
        if (!Number.isInteger(taps) || taps < 1 || taps > MAX_TAPS_PER_REQUEST) {
            return res.status(400).json({ 
                success: false, 
                error: `Invalid taps amount. Must be 1-${MAX_TAPS_PER_REQUEST}` 
            });
        }

        // Получаем текущую энергию с проверкой времени
        const result = await pool.query(`
            SELECT energy, last_update FROM tapper_energy WHERE telegram_id = $1
        `, [telegramId]);

        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Player not found' });
        }

        const row = result.rows[0];
        const now = Date.now();
        
        // Восстанавливаем энергию по серверному времени
        const timePassed = (now - row.last_update) / 1000;
        const energyRestored = Math.floor(timePassed * ENERGY_PER_SECOND);
        const currentEnergy = Math.min(MAX_ENERGY, row.energy + energyRestored);
        
        // 🛡️ СЕРВЕРНАЯ ПРОВЕРКА ЭНЕРГИИ
        if (currentEnergy < taps) {
            return res.status(400).json({ 
                success: false, 
                error: 'Not enough energy',
                energy: currentEnergy,
                serverTime: now
            });
        }

        // Рассчитываем новые значения
        const newEnergy = currentEnergy - taps;
        const cccEarned = taps * CCC_PER_TAP;

        await pool.query('BEGIN');

        try {
            // Обновляем энергию и добавляем к pending_ccc
            await pool.query(`
                UPDATE tapper_energy 
                SET energy = $1, last_update = $2, pending_ccc = pending_ccc + $3
                WHERE telegram_id = $4
            `, [newEnergy, now, cccEarned, telegramId]);

            await pool.query('COMMIT');

            res.json({
                success: true,
                energy: newEnergy,
                cccEarned: cccEarned,
                totalTaps: taps,
                serverTime: now
            });

        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        await pool.query('ROLLBACK');
        console.error('Tapper tap error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Собрать накопленные CCC
router.post('/collect/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;

        await pool.query('BEGIN');

        try {
            // Получаем накопленные CCC
            const result = await pool.query(`
                SELECT pending_ccc FROM tapper_energy WHERE telegram_id = $1
            `, [telegramId]);

            if (result.rows.length === 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ success: false, error: 'Player not found' });
            }

            const pendingCcc = parseFloat(result.rows[0].pending_ccc) || 0;

            if (pendingCcc <= 0) {
                await pool.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false, 
                    error: 'No CCC to collect' 
                });
            }

            // Переводим pending_ccc в основной баланс
            await pool.query(`
                UPDATE players 
                SET ccc = ccc + $1 
                WHERE telegram_id = $2
            `, [pendingCcc, telegramId]);

            // Обнуляем pending_ccc
            await pool.query(`
                UPDATE tapper_energy 
                SET pending_ccc = 0 
                WHERE telegram_id = $1
            `, [telegramId]);

            await pool.query('COMMIT');

            res.json({
                success: true,
                collectedAmount: pendingCcc,
                message: `Collected ${pendingCcc.toFixed(2)} CCC`
            });

        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('Collect CCC error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Посмотреть рекламу за энергию
router.post('/watch-ad/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;

        const result = await pool.query(`
            SELECT ads_watched_today FROM tapper_energy WHERE telegram_id = $1
        `, [telegramId]);

        if (result.rows.length === 0) {
            return res.status(400).json({ success: false, error: 'Player not found' });
        }

        const adsWatched = result.rows[0].ads_watched_today;
        
        // 🛡️ СЕРВЕРНАЯ ПРОВЕРКА ЛИМИТА РЕКЛАМЫ
        if (adsWatched >= 20) {
            return res.status(400).json({ 
                success: false, 
                error: 'Daily ad limit reached' 
            });
        }

        // Добавляем энергию и увеличиваем счетчик рекламы
        await pool.query(`
            UPDATE tapper_energy 
            SET energy = LEAST(energy + 100, $1), 
                ads_watched_today = ads_watched_today + 1,
                last_update = $2
            WHERE telegram_id = $3
        `, [MAX_ENERGY, Date.now(), telegramId]);

        res.json({
            success: true,
            energyAdded: 100,
            adsRemaining: 19 - adsWatched
        });

    } catch (error) {
        console.error('Watch ad error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

module.exports = router;