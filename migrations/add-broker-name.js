// migrations/add-broker-name.js - Добавление поля broker_name в manual_quest_submissions
const pool = require('../db');

async function migrate() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📝 Добавляем поле broker_name в manual_quest_submissions...');

    // Добавляем колонку broker_name
    await pool.query(`
      ALTER TABLE manual_quest_submissions
      ADD COLUMN IF NOT EXISTS broker_name VARCHAR(100)
    `);

    if (process.env.NODE_ENV === 'development') console.log('✅ Поле broker_name добавлено');

    // Обновляем существующие записи
    await pool.query(`
      UPDATE manual_quest_submissions
      SET broker_name = 'RoboForex'
      WHERE quest_key = 'roboforex_trade' AND broker_name IS NULL
    `);

    if (process.env.NODE_ENV === 'development') console.log('✅ Существующие записи обновлены');

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка миграции:', error);
    process.exit(1);
  }
}

migrate();
