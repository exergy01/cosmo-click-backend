const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkQuests() {
  try {
    console.log('📋 Проверка квестов брокеров в таблице quests...\n');

    const result = await pool.query(`
      SELECT quest_id, quest_name, quest_type, reward_cs, is_active
      FROM quests
      WHERE quest_name ILIKE '%roboforex%' OR quest_name ILIKE '%instaforex%' OR quest_name ILIKE '%exness%'
      ORDER BY quest_id
    `);

    if (result.rows.length === 0) {
      console.log('❌ Квесты брокеров НЕ НАЙДЕНЫ в таблице quests!');
      console.log('\n📝 Это означает что квесты нужно создать.');
    } else {
      console.log(`✅ Найдено ${result.rows.length} квестов:`);
      result.rows.forEach(q => {
        console.log(`\n  ID: ${q.quest_id}`);
        console.log(`  Name: ${q.quest_name}`);
        console.log(`  Type: ${q.quest_type}`);
        console.log(`  Reward: ${q.reward_cs} CS`);
        console.log(`  Active: ${q.is_active}`);
      });
    }

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkQuests();
