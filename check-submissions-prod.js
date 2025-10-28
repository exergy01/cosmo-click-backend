const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkSubmissions() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📋 Последние заявки на production:\n');

    const result = await pool.query(`
      SELECT id, telegram_id, quest_key, status, created_at
      FROM manual_quest_submissions
      ORDER BY id DESC
      LIMIT 10
    `);

    result.rows.forEach(q => {
      if (process.env.NODE_ENV === 'development') console.log(`ID: ${q.id} | User: ${q.telegram_id} | Quest: ${q.quest_key} | Status: ${q.status}`);
    });

    if (process.env.NODE_ENV === 'development') console.log(`\n📊 Всего: ${result.rows.length} заявок`);

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkSubmissions();
