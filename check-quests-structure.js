const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkStructure() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📊 Проверка структуры таблицы quests...\n');

    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'quests'
      ORDER BY ordinal_position
    `);

    if (process.env.NODE_ENV === 'development') console.log('Колонки таблицы quests:');
    result.rows.forEach(row => {
      if (process.env.NODE_ENV === 'development') console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    if (process.env.NODE_ENV === 'development') console.log('\n📋 Проверка quest_key vs quest_name...\n');

    const quests = await pool.query(`
      SELECT quest_id, quest_key, quest_name, quest_type
      FROM quests
      WHERE quest_key LIKE '%roboforex%' OR quest_name LIKE '%roboforex%'
      LIMIT 5
    `);

    if (process.env.NODE_ENV === 'development') console.log('Квесты брокеров:');
    quests.rows.forEach(q => {
      if (process.env.NODE_ENV === 'development') console.log(`  ID: ${q.quest_id}`);
      if (process.env.NODE_ENV === 'development') console.log(`  Key: ${q.quest_key}`);
      if (process.env.NODE_ENV === 'development') console.log(`  Name: ${q.quest_name}`);
      if (process.env.NODE_ENV === 'development') console.log(`  Type: ${q.quest_type}`);
      if (process.env.NODE_ENV === 'development') console.log('  ---');
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkStructure();
