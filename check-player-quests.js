const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkStructure() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📊 Проверка структуры таблицы player_quests...\n');

    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'player_quests'
      ORDER BY ordinal_position
    `);

    if (process.env.NODE_ENV === 'development') console.log('Колонки таблицы player_quests:');
    result.rows.forEach(row => {
      if (process.env.NODE_ENV === 'development') console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkStructure();
