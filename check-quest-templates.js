const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkTemplates() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📋 Проверка quest_templates:\n');

    const result = await pool.query(`
      SELECT id, quest_key, quest_type, reward_cs, is_active
      FROM quest_templates
      WHERE quest_key ILIKE '%roboforex%' OR quest_key ILIKE '%instaforex%' OR quest_key ILIKE '%exness%'
      ORDER BY id
    `);

    if (result.rows.length === 0) {
      if (process.env.NODE_ENV === 'development') console.log('❌ Квесты брокеров НЕ НАЙДЕНЫ в quest_templates!\n');

      // Показываем все квесты
      const all = await pool.query('SELECT id, quest_key, quest_type FROM quest_templates LIMIT 10');
      if (process.env.NODE_ENV === 'development') console.log('Все квесты в quest_templates:');
      if (process.env.NODE_ENV === 'development') all.rows.forEach(q => console.log(`  ID: ${q.id}, Key: ${q.quest_key}, Type: ${q.quest_type}`));
    } else {
      if (process.env.NODE_ENV === 'development') console.log(`✅ Найдено ${result.rows.length} квестов брокеров:`);
      result.rows.forEach(q => {
        if (process.env.NODE_ENV === 'development') console.log(`\n  ID: ${q.id}`);
        if (process.env.NODE_ENV === 'development') console.log(`  Key: ${q.quest_key}`);
        if (process.env.NODE_ENV === 'development') console.log(`  Type: ${q.quest_type}`);
        if (process.env.NODE_ENV === 'development') console.log(`  Reward: ${q.reward_cs} CS`);
        if (process.env.NODE_ENV === 'development') console.log(`  Active: ${q.is_active}`);
      });
    }

    if (process.env.NODE_ENV === 'development') console.log('\n📊 Проверка Foreign Key constraint:\n');

    // Проверяем какие constraints есть на player_quests
    const constraints = await pool.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.table_name = 'player_quests' AND tc.constraint_type = 'FOREIGN KEY'
    `);

    if (process.env.NODE_ENV === 'development') console.log('Foreign keys на player_quests:');
    constraints.rows.forEach(c => {
      if (process.env.NODE_ENV === 'development') console.log(`  ${c.column_name} → ${c.foreign_table_name}.${c.foreign_column_name}`);
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkTemplates();
