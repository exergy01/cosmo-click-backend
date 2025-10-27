// Простой скрипт для активации VIP без лишних полей
const pool = require('./db');

async function grantVIP() {
  try {
    console.log('🎯 Активируем VIP для аккаунта 123456789...');

    const result = await pool.query(`
      UPDATE players
      SET premium_no_ads_until = NOW() + INTERVAL '30 days',
          updated_at = NOW()
      WHERE telegram_id = '123456789'
      RETURNING telegram_id, first_name, premium_no_ads_until, premium_no_ads_forever
    `);

    if (result.rows.length > 0) {
      const player = result.rows[0];
      console.log('✅ VIP УСПЕШНО АКТИВИРОВАН!');
      console.log('📋 Детали:');
      console.log(`   Имя: ${player.first_name}`);
      console.log(`   Telegram ID: ${player.telegram_id}`);
      console.log(`   VIP до: ${player.premium_no_ads_until}`);
      console.log(`   VIP навсегда: ${player.premium_no_ads_forever}`);
    } else {
      console.log('❌ Игрок с ID 123456789 не найден в БД');
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    await pool.end();
    process.exit(1);
  }
}

grantVIP();
