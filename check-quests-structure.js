const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkStructure() {
  try {
    console.log('📊 Проверка структуры таблицы quests...\n');

    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'quests'
      ORDER BY ordinal_position
    `);

    console.log('Колонки таблицы quests:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    console.log('\n📋 Проверка quest_key vs quest_name...\n');

    const quests = await pool.query(`
      SELECT quest_id, quest_key, quest_name, quest_type
      FROM quests
      WHERE quest_key LIKE '%roboforex%' OR quest_name LIKE '%roboforex%'
      LIMIT 5
    `);

    console.log('Квесты брокеров:');
    quests.rows.forEach(q => {
      console.log(`  ID: ${q.quest_id}`);
      console.log(`  Key: ${q.quest_key}`);
      console.log(`  Name: ${q.quest_name}`);
      console.log(`  Type: ${q.quest_type}`);
      console.log('  ---');
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkStructure();
