// scripts/clear-manual-submissions.js - Очистка заявок на ручную проверку
const pool = require('../db');

async function clearManualSubmissions() {
  try {
    console.log('🗑️  Очистка заявок на ручную проверку...');

    const result = await pool.query('DELETE FROM manual_quest_submissions');

    console.log(`✅ Удалено заявок: ${result.rowCount}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error);
    process.exit(1);
  }
}

clearManualSubmissions();
