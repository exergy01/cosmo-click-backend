// routes/admin/migrate.js - ЭНДПОИНТ ДЛЯ МИГРАЦИЙ
const express = require('express');
const router = express.Router();
const pool = require('../../db');

// 🔐 Только для админа
const ADMIN_KEY = process.env.MANUAL_DEPOSIT_ADMIN_KEY || 'cosmo_admin_2025';

router.post('/run-battle-v2-migration/:telegramId?', async (req, res) => {
  try {
    const { adminKey } = req.body;

    if (adminKey !== ADMIN_KEY) {
      return res.status(403).json({ success: false, error: 'Доступ запрещён' });
    }

    console.log('🚀 Запуск миграции Battle System V2...');

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Добавляем поля к таблице кораблей
      await client.query(`
        ALTER TABLE galactic_empire_ships
        ADD COLUMN IF NOT EXISTS weapon_type VARCHAR(50) DEFAULT 'laser',
        ADD COLUMN IF NOT EXISTS current_cooldown INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS torpedoes INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS ew_system VARCHAR(50)
      `);

      // 2. Добавляем поля к таблице игроков
      await client.query(`
        ALTER TABLE galactic_empire_players
        ADD COLUMN IF NOT EXISTS ai_purchased BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS ai_purchased_at TIMESTAMP
      `);

      // 3. Добавляем поля к таблице боёв
      await client.query(`
        ALTER TABLE galactic_empire_battles
        ADD COLUMN IF NOT EXISTS battle_mode VARCHAR(20) DEFAULT 'auto'
      `);

      // 4. Создаём индексы
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ships_weapon_type ON galactic_empire_ships(weapon_type)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_players_ai ON galactic_empire_players(ai_purchased)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_battles_mode ON galactic_empire_battles(battle_mode)
      `);

      // 5. Устанавливаем тип оружия для существующих кораблей
      await client.query(`
        UPDATE galactic_empire_ships
        SET weapon_type = CASE
          WHEN race = 'amarr' THEN 'laser'
          WHEN race = 'caldari' THEN 'missile'
          WHEN race = 'gallente' THEN 'plasma'
          WHEN race = 'minmatar' THEN 'projectile'
          ELSE 'laser'
        END
        WHERE weapon_type = 'laser'
      `);

      await client.query('COMMIT');

      console.log('✅ Миграция Battle System V2 успешно применена!');

      res.json({
        success: true,
        message: 'Миграция успешно применена',
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;
