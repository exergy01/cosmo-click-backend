const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkTemplates() {
  try {
    console.log('📋 Проверка quest_templates:\n');

    const result = await pool.query(`
      SELECT id, quest_key, quest_type, reward_cs, is_active
      FROM quest_templates
      WHERE quest_key ILIKE '%roboforex%' OR quest_key ILIKE '%instaforex%' OR quest_key ILIKE '%exness%'
      ORDER BY id
    `);

    if (result.rows.length === 0) {
      console.log('❌ Квесты брокеров НЕ НАЙДЕНЫ в quest_templates!\n');

      // Показываем все квесты
      const all = await pool.query('SELECT id, quest_key, quest_type FROM quest_templates LIMIT 10');
      console.log('Все квесты в quest_templates:');
      all.rows.forEach(q => console.log(`  ID: ${q.id}, Key: ${q.quest_key}, Type: ${q.quest_type}`));
    } else {
      console.log(`✅ Найдено ${result.rows.length} квестов брокеров:`);
      result.rows.forEach(q => {
        console.log(`\n  ID: ${q.id}`);
        console.log(`  Key: ${q.quest_key}`);
        console.log(`  Type: ${q.quest_type}`);
        console.log(`  Reward: ${q.reward_cs} CS`);
        console.log(`  Active: ${q.is_active}`);
      });
    }

    console.log('\n📊 Проверка Foreign Key constraint:\n');

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

    console.log('Foreign keys на player_quests:');
    constraints.rows.forEach(c => {
      console.log(`  ${c.column_name} → ${c.foreign_table_name}.${c.foreign_column_name}`);
    });

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkTemplates();
