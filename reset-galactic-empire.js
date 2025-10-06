/**
 * 🔄 СБРОС И ПЕРЕСОЗДАНИЕ ТАБЛИЦ GALACTIC EMPIRE
 *
 * ВНИМАНИЕ: Это удалит ВСЕ данные Galactic Empire!
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function resetAndMigrate() {
  try {
    console.log('🔄 Сброс и пересоздание Galactic Empire...\n');

    // Удаляем все таблицы Galactic Empire
    console.log('❌ Удаление старых таблиц...');
    await pool.query(`
      DROP TABLE IF EXISTS galactic_empire_daily_logins CASCADE;
      DROP TABLE IF EXISTS galactic_empire_loot CASCADE;
      DROP TABLE IF EXISTS galactic_empire_battles CASCADE;
      DROP TABLE IF EXISTS galactic_empire_formations CASCADE;
      DROP TABLE IF EXISTS galactic_empire_ships CASCADE;
      DROP TABLE IF EXISTS galactic_empire_players CASCADE;
      DROP TABLE IF EXISTS galactic_empire_build_queue CASCADE;
    `);
    console.log('✅ Старые таблицы удалены\n');

    // Читаем и применяем новую миграцию
    console.log('📄 Чтение миграции...');
    const migrationPath = path.join(__dirname, 'migrations', 'galactic-empire', '001_initial_setup.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    console.log('⚙️  Применение новой миграции...');
    await pool.query(sql);

    console.log('✅ Миграция применена успешно!\n');

    // Проверяем созданные таблицы
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'galactic_empire%'
      ORDER BY table_name;
    `);

    console.log('📊 Созданные таблицы:');
    tablesResult.rows.forEach(row => {
      console.log('  ✓', row.table_name);
    });

    console.log('\n🎉 Сброс и миграция завершены успешно!');
    console.log('📌 Теперь можно тестировать игру.\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error('📝 Полная ошибка:', error);
    process.exit(1);
  }
}

resetAndMigrate();
