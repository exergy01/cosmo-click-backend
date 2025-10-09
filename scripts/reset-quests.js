// scripts/reset-quests.js - Скрипт для сброса всех выполненных заданий
const pool = require('../db');

async function resetAllQuests() {
  try {
    console.log('🔄 Начинаем сброс всех выполненных заданий...');

    // 1. Удаляем все выполненные задания из player_quests
    const deletePlayerQuests = await pool.query(`
      DELETE FROM player_quests WHERE completed = true
    `);
    console.log(`✅ Удалено выполненных заданий из player_quests: ${deletePlayerQuests.rowCount}`);

    // 2. Удаляем все записи о просмотре заданий с таймером
    const deleteTimerQuests = await pool.query(`
      DELETE FROM player_quests WHERE completed = false
    `);
    console.log(`✅ Удалено незавершённых заданий (таймеры): ${deleteTimerQuests.rowCount}`);

    // 3. Очищаем quest_link_states у всех игроков
    const updateLinkStates = await pool.query(`
      UPDATE players
      SET quest_link_states = '{}'::jsonb
      WHERE quest_link_states IS NOT NULL AND quest_link_states::text != '{}'
    `);
    console.log(`✅ Очищено состояний ссылок у игроков: ${updateLinkStates.rowCount}`);

    // 4. Сбрасываем счётчик просмотров рекламы
    const resetAdViews = await pool.query(`
      UPDATE players
      SET quest_ad_views = 0
      WHERE quest_ad_views > 0
    `);
    console.log(`✅ Сброшено счётчиков рекламы: ${resetAdViews.rowCount}`);

    // 5. Удаляем все заявки на ручную проверку
    const deleteManualSubmissions = await pool.query(`
      DELETE FROM manual_quest_submissions
    `);
    console.log(`✅ Удалено заявок на ручную проверку: ${deleteManualSubmissions.rowCount}`);

    console.log('\n🎉 Сброс заданий завершён успешно!\n');

    // Статистика
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM player_quests) as total_player_quests,
        (SELECT COUNT(*) FROM players WHERE quest_ad_views > 0) as players_with_ad_views,
        (SELECT COUNT(*) FROM manual_quest_submissions) as manual_submissions
    `);

    console.log('📊 Текущее состояние:');
    console.log(`   - Заданий у игроков: ${stats.rows[0].total_player_quests}`);
    console.log(`   - Игроков с просмотрами рекламы: ${stats.rows[0].players_with_ad_views}`);
    console.log(`   - Заявок на проверку: ${stats.rows[0].manual_submissions}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при сбросе заданий:', error);
    process.exit(1);
  }
}

resetAllQuests();
