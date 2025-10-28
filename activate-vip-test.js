// Скрипт для активации VIP статуса для тестового аккаунта
const pool = require('./db');

async function activateVIP() {
  try {
    // Активируем VIP на 30 дней для аккаунта 123456789
    const result = await pool.query(`
      UPDATE players
      SET premium_no_ads_until = NOW() + INTERVAL '30 days',
          updated_at = NOW()
      WHERE telegram_id = '123456789'
      RETURNING telegram_id, name, premium_no_ads_until, premium_no_ads_forever
    `);

    if (result.rows.length > 0) {
      if (process.env.NODE_ENV === 'development') console.log('✅ VIP успешно активирован!');
      if (process.env.NODE_ENV === 'development') console.log('Игрок:', result.rows[0].name);
      if (process.env.NODE_ENV === 'development') console.log('Telegram ID:', result.rows[0].telegram_id);
      if (process.env.NODE_ENV === 'development') console.log('VIP до:', result.rows[0].premium_no_ads_until);
      if (process.env.NODE_ENV === 'development') console.log('VIP навсегда:', result.rows[0].premium_no_ads_forever);
    } else {
      if (process.env.NODE_ENV === 'development') console.log('❌ Игрок с ID 123456789 не найден');
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Ошибка:', error.message);
    await pool.end();
    process.exit(1);
  }
}

activateVIP();
