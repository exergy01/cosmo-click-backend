const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkAfterApprove() {
  try {
    const telegramId = '850758749'; // ID игрока из заявки 10

    console.log(`🔍 Проверка данных для игрока ${telegramId}\n`);

    // Проверяем заявки
    console.log('📋 Заявки в manual_quest_submissions:');
    const submissions = await pool.query(
      'SELECT id, quest_key, status, reviewed_at FROM manual_quest_submissions WHERE telegram_id = $1 ORDER BY id DESC',
      [telegramId]
    );
    submissions.rows.forEach(s => {
      console.log(`  ID: ${s.id}, Quest: ${s.quest_key}, Status: ${s.status}, Reviewed: ${s.reviewed_at || 'not yet'}`);
    });

    // Проверяем player_quests
    console.log('\n📊 Записи в player_quests:');
    const playerQuests = await pool.query(
      'SELECT telegram_id, quest_id, quest_key, completed, reward_cs FROM player_quests WHERE telegram_id = $1',
      [telegramId]
    );

    if (playerQuests.rows.length === 0) {
      console.log('  ❌ НЕТ ЗАПИСЕЙ! Одобрение не создало запись в player_quests!');
    } else {
      playerQuests.rows.forEach(pq => {
        console.log(`  Quest ID: ${pq.quest_id}, Key: ${pq.quest_key}, Completed: ${pq.completed}, Reward: ${pq.reward_cs}`);
      });
    }

    // Проверяем какой quest_id должен быть
    console.log('\n🔍 Quest template для roboforex_trade:');
    const template = await pool.query(
      'SELECT id, quest_key, reward_cs FROM quest_templates WHERE quest_key = $1',
      ['roboforex_trade']
    );
    if (template.rows.length > 0) {
      console.log(`  Template ID: ${template.rows[0].id}, Reward: ${template.rows[0].reward_cs}`);
    }

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    await pool.end();
  }
}

checkAfterApprove();
