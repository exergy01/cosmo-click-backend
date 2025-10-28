const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function testApprove() {
  try {
    const submissionId = 10; // pending заявка

    if (process.env.NODE_ENV === 'development') console.log(`🧪 Тестируем одобрение заявки ID: ${submissionId}\n`);

    // Получаем заявку
    const submissionResult = await pool.query(
      'SELECT * FROM manual_quest_submissions WHERE id = $1',
      [submissionId]
    );

    if (submissionResult.rows.length === 0) {
      if (process.env.NODE_ENV === 'development') console.log('❌ Заявка не найдена');
      return;
    }

    const submission = submissionResult.rows[0];
    if (process.env.NODE_ENV === 'development') console.log('📋 Заявка:');
    if (process.env.NODE_ENV === 'development') console.log(`  telegram_id: ${submission.telegram_id}`);
    if (process.env.NODE_ENV === 'development') console.log(`  quest_key: ${submission.quest_key}`);
    if (process.env.NODE_ENV === 'development') console.log(`  status: ${submission.status}\n`);

    // Маппинг quest_key → quest_name
    const questKeyToName = {
      'roboforex_registration': 'RoboForex регистрация',
      'roboforex_trade': 'RoboForex сделка',
      'instaforex_registration': 'InstaForex регистрация',
      'instaforex_trade': 'InstaForex сделка',
      'exness_registration': 'Exness регистрация',
      'exness_trade': 'Exness сделка'
    };

    const questName = questKeyToName[submission.quest_key] || submission.quest_key;
    if (process.env.NODE_ENV === 'development') console.log(`🔄 Маппинг: "${submission.quest_key}" → "${questName}"\n`);

    // Ищем квест в таблице quests
    const questResult = await pool.query(
      'SELECT quest_id, quest_name, reward_cs FROM quests WHERE quest_name = $1',
      [questName]
    );

    if (questResult.rows.length === 0) {
      if (process.env.NODE_ENV === 'development') console.log(`❌ Квест "${questName}" НЕ НАЙДЕН в таблице quests!`);
      if (process.env.NODE_ENV === 'development') console.log('\n📝 Доступные квесты брокеров:');
      const allQuests = await pool.query(`
        SELECT quest_id, quest_name, quest_type
        FROM quests
        WHERE quest_name ILIKE '%roboforex%' OR quest_name ILIKE '%instaforex%' OR quest_name ILIKE '%exness%'
      `);
      allQuests.rows.forEach(q => {
        if (process.env.NODE_ENV === 'development') console.log(`  - ID: ${q.quest_id}, Name: "${q.quest_name}", Type: ${q.quest_type}`);
      });
      return;
    }

    const quest = questResult.rows[0];
    if (process.env.NODE_ENV === 'development') console.log('✅ Квест найден:');
    if (process.env.NODE_ENV === 'development') console.log(`  quest_id: ${quest.quest_id}`);
    if (process.env.NODE_ENV === 'development') console.log(`  quest_name: ${quest.quest_name}`);
    if (process.env.NODE_ENV === 'development') console.log(`  reward_cs: ${quest.reward_cs}\n`);

    // Проверяем есть ли уже выполненное задание
    const existingQuest = await pool.query(`
      SELECT pq.telegram_id, pq.quest_id
      FROM player_quests pq
      JOIN quests q ON q.quest_id = pq.quest_id
      WHERE pq.telegram_id = $1 AND q.quest_name = $2 AND pq.completed = true
    `, [submission.telegram_id, questName]);

    if (existingQuest.rows.length > 0) {
      if (process.env.NODE_ENV === 'development') console.log('⚠️ Игрок уже выполнил это задание!');
      return;
    }

    if (process.env.NODE_ENV === 'development') console.log('✅ Игрок ещё не выполнял это задание\n');

    if (process.env.NODE_ENV === 'development') console.log('📝 Симуляция INSERT в player_quests:');
    if (process.env.NODE_ENV === 'development') console.log(`  telegram_id: ${submission.telegram_id}`);
    if (process.env.NODE_ENV === 'development') console.log(`  quest_id: ${quest.quest_id}`);
    if (process.env.NODE_ENV === 'development') console.log(`  completed: false`);
    if (process.env.NODE_ENV === 'development') console.log(`  quest_key: ${submission.quest_key}`);
    if (process.env.NODE_ENV === 'development') console.log(`  reward_cs: ${quest.reward_cs}`);

    if (process.env.NODE_ENV === 'development') console.log('\n✅ ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ! Одобрение должно работать.');

  } catch (err) {
    console.error('\n❌ ОШИБКА:', err.message);
    console.error('Детали:', err);
  } finally {
    await pool.end();
  }
}

testApprove();
