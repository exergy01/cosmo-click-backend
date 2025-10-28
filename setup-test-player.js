const pool = require('./db');

async function setupTestPlayer() {
  const client = await pool.connect();
  try {
    const testTelegramId = '123456789';

    if (process.env.NODE_ENV === 'development') console.log('Setting up test player...');

    // Проверяем, есть ли уже такой игрок
    const existingPlayer = await client.query(
      'SELECT telegram_id, ton, ton_reserved FROM players WHERE telegram_id = $1',
      [testTelegramId]
    );

    if (existingPlayer.rows.length > 0) {
      // Обновляем баланс существующего игрока
      await client.query(`
        UPDATE players
        SET ton = 5.0, ton_reserved = 0
        WHERE telegram_id = $1
      `, [testTelegramId]);

      if (process.env.NODE_ENV === 'development') console.log('✅ Test player updated:', {
        telegram_id: testTelegramId,
        ton_balance: 5.0,
        ton_reserved: 0
      });
    } else {
      // Создаем нового тестового игрока
      await client.query(`
        INSERT INTO players (
          telegram_id, username, first_name, ton, ton_reserved, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
      `, [testTelegramId, 'testuser', 'Test User', 5.0, 0]);

      if (process.env.NODE_ENV === 'development') console.log('✅ Test player created:', {
        telegram_id: testTelegramId,
        username: 'testuser',
        ton_balance: 5.0,
        ton_reserved: 0
      });
    }

    // Проверяем финальное состояние
    const finalCheck = await client.query(
      'SELECT telegram_id, ton, ton_reserved FROM players WHERE telegram_id = $1',
      [testTelegramId]
    );

    if (process.env.NODE_ENV === 'development') console.log('Final player state:', finalCheck.rows[0]);

  } catch (err) {
    console.error('Setup error:', err);
    throw err;
  } finally {
    client.release();
    pool.end();
  }
}

setupTestPlayer().catch(console.error);