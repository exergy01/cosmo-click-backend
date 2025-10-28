const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function checkReferralQuestIssue() {
  try {
    if (process.env.NODE_ENV === 'development') console.log('🔍 Проверка проблемы с квестом "Пригласи друга"...\n');

    // 1. Находим ID квеста invite_friend
    const questResult = await pool.query(
      `SELECT id, quest_key, reward_cs FROM quest_templates WHERE quest_key = 'invite_friend'`
    );

    if (questResult.rows.length === 0) {
      if (process.env.NODE_ENV === 'development') console.log('❌ Квест invite_friend не найден!');
      return;
    }

    const inviteFriendQuestId = questResult.rows[0].id;
    if (process.env.NODE_ENV === 'development') console.log(`✅ Квест "Пригласи друга" найден: ID=${inviteFriendQuestId}, награда=${questResult.rows[0].reward_cs} CS\n`);

    // 2. Находим игроков, у которых есть рефералы
    const playersWithReferrals = await pool.query(`
      SELECT
        p.telegram_id,
        p.first_name,
        p.referrals_count,
        pq.completed as quest_completed,
        pq.quest_id
      FROM players p
      LEFT JOIN player_quests pq
        ON p.telegram_id = pq.telegram_id
        AND pq.quest_id = $1
      WHERE p.referrals_count > 0
      ORDER BY p.referrals_count DESC
    `, [inviteFriendQuestId]);

    if (process.env.NODE_ENV === 'development') console.log(`📊 СТАТИСТИКА:\n`);
    if (process.env.NODE_ENV === 'development') console.log(`Всего игроков с рефералами: ${playersWithReferrals.rows.length}`);

    // 3. Разделяем на категории
    const completedQuest = playersWithReferrals.rows.filter(p => p.quest_completed === true);
    const notCompletedQuest = playersWithReferrals.rows.filter(p => !p.quest_completed);

    if (process.env.NODE_ENV === 'development') console.log(`✅ Квест выполнен: ${completedQuest.length}`);
    if (process.env.NODE_ENV === 'development') console.log(`❌ Квест НЕ выполнен (ПОТЕРЯШКИ): ${notCompletedQuest.length}\n`);

    if (notCompletedQuest.length > 0) {
      if (process.env.NODE_ENV === 'development') console.log(`🚨 ПОТЕРЯШКИ (игроки с рефералами, но без выполненного квеста):\n`);
      notCompletedQuest.forEach((player, index) => {
        if (process.env.NODE_ENV === 'development') console.log(`${index + 1}. ${player.first_name} (ID: ${player.telegram_id})`);
        if (process.env.NODE_ENV === 'development') console.log(`   Рефералов: ${player.referrals_count}`);
        if (process.env.NODE_ENV === 'development') console.log(`   Квест в БД: ${player.quest_id ? 'есть запись' : 'нет записи'}\n`);
      });

      if (process.env.NODE_ENV === 'development') console.log(`\n💡 РЕКОМЕНДАЦИЯ:`);
      if (process.env.NODE_ENV === 'development') console.log(`Найдено ${notCompletedQuest.length} игроков, которым нужно начислить награду за квест.`);
      if (process.env.NODE_ENV === 'development') console.log(`Запустите скрипт fix-referral-quest.js для автоматического исправления.`);
    } else {
      if (process.env.NODE_ENV === 'development') console.log(`✅ Потеряшек не найдено! Все игроки с рефералами имеют выполненный квест.`);
    }

    // 4. Дополнительная статистика
    if (process.env.NODE_ENV === 'development') console.log(`\n📈 ДОПОЛНИТЕЛЬНАЯ СТАТИСТИКА:\n`);

    const totalReferrals = playersWithReferrals.rows.reduce((sum, p) => sum + p.referrals_count, 0);
    if (process.env.NODE_ENV === 'development') console.log(`Всего рефералов в системе: ${totalReferrals}`);

    const maxReferrals = Math.max(...playersWithReferrals.rows.map(p => p.referrals_count));
    const topReferrer = playersWithReferrals.rows.find(p => p.referrals_count === maxReferrals);
    if (process.env.NODE_ENV === 'development') console.log(`Максимум рефералов у одного игрока: ${maxReferrals} (${topReferrer?.first_name})`);

  } catch (err) {
    console.error('❌ Ошибка:', err.message);
  } finally {
    pool.end();
  }
}

checkReferralQuestIssue();
