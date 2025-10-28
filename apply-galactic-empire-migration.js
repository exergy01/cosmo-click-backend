/**
 * 🌌 ПРИМЕНЕНИЕ МИГРАЦИИ GALACTIC EMPIRE v2.0
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function applyMigration() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('🌌 Применение миграции Galactic Empire v2.0...\n');

    // Читаем SQL файл
    const migrationPath = path.join(__dirname, 'migrations', 'galactic-empire', '001_initial_setup.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    // Выполняем миграцию
    const result = await pool.query(sql);

    if (process.env.NODE_ENV === 'development') console.log('✅ Миграция применена успешно!');
    if (result && result.rows && result.rows.length > 0) {
      if (process.env.NODE_ENV === 'development') console.log(result.rows[result.rows.length - 1]); // Покажет сообщение об успехе
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка применения миграции:', error);
    process.exit(1);
  }
}

applyMigration();
