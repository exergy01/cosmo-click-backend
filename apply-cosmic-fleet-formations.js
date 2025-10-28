const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function applyMigration() {
  if (process.env.NODE_ENV === 'development') console.log('🚀 === ПРИМЕНЕНИЕ МИГРАЦИИ 009: COSMIC FLEET FORMATIONS & BATTLES ===\n');

  try {
    // Читаем файл миграции
    const migrationPath = path.join(__dirname, 'migrations', '009_cosmic_fleet_formations_battles.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    if (process.env.NODE_ENV === 'development') console.log('📄 Файл миграции загружен');
    if (process.env.NODE_ENV === 'development') console.log('⚙️ Применяем миграцию...\n');

    // Применяем миграцию
    await pool.query(migrationSQL);

    if (process.env.NODE_ENV === 'development') console.log('✅ Миграция применена успешно!\n');

    // Проверяем созданные таблицы
    const tablesCheck = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'cosmic_fleet_%'
      ORDER BY table_name
    `);

    if (process.env.NODE_ENV === 'development') console.log('📊 Таблицы Cosmic Fleet в БД:');
    tablesCheck.rows.forEach(row => {
      if (process.env.NODE_ENV === 'development') console.log(`   ✓ ${row.table_name}`);
    });

    // Статистика
    if (process.env.NODE_ENV === 'development') console.log('\n📈 Статистика:');

    const formationsCount = await pool.query('SELECT COUNT(*) as count FROM cosmic_fleet_formations');
    if (process.env.NODE_ENV === 'development') console.log(`   • Флотилий создано: ${formationsCount.rows[0].count}`);

    const statsCount = await pool.query('SELECT COUNT(*) as count FROM cosmic_fleet_ship_stats');
    if (process.env.NODE_ENV === 'development') console.log(`   • Статистика кораблей: ${statsCount.rows[0].count}`);

    const battlesCount = await pool.query('SELECT COUNT(*) as count FROM cosmic_fleet_battle_history');
    if (process.env.NODE_ENV === 'development') console.log(`   • Боёв в истории: ${battlesCount.rows[0].count}`);

    const rankingCount = await pool.query('SELECT COUNT(*) as count FROM cosmic_fleet_pvp_ranking');
    if (process.env.NODE_ENV === 'development') console.log(`   • Игроков в PvP рейтинге: ${rankingCount.rows[0].count}`);

    if (process.env.NODE_ENV === 'development') console.log('\n🎉 ГОТОВО! Cosmic Fleet Formations & Battles готов к работе!');

  } catch (error) {
    console.error('❌ Ошибка при применении миграции:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();
