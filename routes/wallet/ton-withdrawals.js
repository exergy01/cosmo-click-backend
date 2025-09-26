const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { notifyWithdrawalRequest } = require('../telegramBot');

const router = express.Router();

// POST /prepare - Подготовка вывода с блокировкой баланса
router.post('/prepare', async (req, res) => {
  const { telegram_id, amount } = req.body;

  console.log('Preparing withdrawal:', { telegram_id, amount });

  if (!telegram_id || !amount) {
    return res.status(400).json({ error: 'Telegram ID and amount are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверяем дубликат заявки за последние 10 минут
    const duplicateCheck = await client.query(
      `SELECT id FROM withdrawals
       WHERE player_id = $1 AND amount = $2 AND status = 'pending'
       AND created_at > NOW() - INTERVAL '10 minutes'`,
      [telegram_id, parseFloat(amount)]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Duplicate withdrawal request detected' });
    }

    // Блокируем игрока для обновления баланса (FOR UPDATE)
    const playerResult = await client.query(
      `SELECT telegram_id, first_name, username, ton, ton_reserved
       FROM players WHERE telegram_id = $1 FOR UPDATE`,
      [telegram_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];
    const playerBalance = parseFloat(player.ton || '0');
    const reservedBalance = parseFloat(player.ton_reserved || '0');
    const availableBalance = playerBalance - reservedBalance;
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount <= 0 || withdrawAmount > availableBalance || withdrawAmount < 0.1) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Invalid amount',
        available_balance: availableBalance,
        requested_amount: withdrawAmount
      });
    }

    // Резервируем средства
    await client.query(
      'UPDATE players SET ton_reserved = ton_reserved + $1 WHERE telegram_id = $2',
      [withdrawAmount, telegram_id]
    );

    // Создаем заявку на вывод
    const withdrawalResult = await client.query(
      `INSERT INTO withdrawals (
        player_id, amount, status, created_at
      ) VALUES ($1, $2, 'pending', NOW())
      RETURNING id`,
      [telegram_id, withdrawAmount]
    );

    const withdrawalId = withdrawalResult.rows[0].id;
    await client.query('COMMIT');

    // Уведомляем администратора
    try {
      await notifyWithdrawalRequest(player, withdrawAmount, withdrawalId);
    } catch (notifyErr) {
      console.error('Withdrawal notification error:', notifyErr);
    }

    console.log('Withdrawal request created and funds reserved:', { telegram_id, amount: withdrawAmount, withdrawalId });

    res.json({
      success: true,
      withdrawal_id: withdrawalId,
      amount: withdrawAmount,
      reserved_balance: reservedBalance + withdrawAmount,
      available_balance: availableBalance - withdrawAmount,
      message: 'Withdrawal request created, funds reserved'
    });

  } catch (err) {
    console.error('Withdrawal preparation error:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /confirm - Подтверждение вывода с учетом зарезервированных средств
router.post('/confirm', async (req, res) => {
  const { telegram_id, amount, transaction_hash, wallet_address, admin_key } = req.body;

  if (admin_key !== 'cosmo_admin_2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  console.log('Confirming withdrawal:', { telegram_id, amount, transaction_hash });

  if (!telegram_id || !amount || !transaction_hash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const withdrawAmount = parseFloat(amount);

    // Блокируем игрока для обновления баланса
    const playerResult = await client.query(
      `SELECT telegram_id, ton, ton_reserved
       FROM players WHERE telegram_id = $1 FOR UPDATE`,
      [telegram_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];
    const currentBalance = parseFloat(player.ton || '0');
    const reservedBalance = parseFloat(player.ton_reserved || '0');

    // Проверяем, что сумма зарезервирована
    if (reservedBalance < withdrawAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient reserved balance',
        reserved_balance: reservedBalance,
        requested_amount: withdrawAmount
      });
    }

    const newBalance = currentBalance - withdrawAmount;
    const newReservedBalance = reservedBalance - withdrawAmount;

    // Обновляем баланс и снимаем резерв
    await client.query(
      `UPDATE players
       SET ton = $1, ton_reserved = $2
       WHERE telegram_id = $3`,
      [newBalance, newReservedBalance, telegram_id]
    );

    // Обновляем статус вывода - находим последнюю заявку
    const updateResult = await client.query(
      `UPDATE withdrawals
       SET status = 'completed',
           transaction_hash = $1,
           wallet_address = $2,
           completed_at = NOW()
       WHERE id = (
         SELECT id FROM withdrawals
         WHERE player_id = $3
           AND amount = $4
           AND status = 'pending'
         ORDER BY created_at DESC
         LIMIT 1
       )
       RETURNING id`,
      [transaction_hash, wallet_address, telegram_id, withdrawAmount]
    );

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending withdrawal not found' });
    }

    await client.query('COMMIT');

    console.log('Withdrawal confirmed with reserved balance:', {
      telegram_id,
      amount: withdrawAmount,
      newBalance,
      newReservedBalance
    });

    res.json({
      success: true,
      message: 'Withdrawal confirmed',
      new_balance: newBalance,
      reserved_balance: newReservedBalance,
      withdrawal_id: updateResult.rows[0].id
    });

  } catch (err) {
    console.error('Withdrawal confirmation error:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /cancel - Отмена заявки на вывод
router.post('/cancel', async (req, res) => {
  const { telegram_id, withdrawal_id } = req.body;

  console.log('Canceling withdrawal:', { telegram_id, withdrawal_id });

  if (!telegram_id || !withdrawal_id) {
    return res.status(400).json({ error: 'Telegram ID and withdrawal ID are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Проверяем существование заявки
    const withdrawalResult = await client.query(
      `SELECT id, player_id, amount, status
       FROM withdrawals
       WHERE id = $1 AND player_id = $2 AND status = 'pending'`,
      [withdrawal_id, telegram_id]
    );

    if (withdrawalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pending withdrawal not found' });
    }

    const withdrawal = withdrawalResult.rows[0];
    const withdrawAmount = parseFloat(withdrawal.amount);

    // Блокируем игрока для обновления баланса
    const playerResult = await client.query(
      `SELECT telegram_id, ton_reserved
       FROM players WHERE telegram_id = $1 FOR UPDATE`,
      [telegram_id]
    );

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const reservedBalance = parseFloat(playerResult.rows[0].ton_reserved || '0');
    const newReservedBalance = Math.max(0, reservedBalance - withdrawAmount);

    // Возвращаем зарезервированные средства
    await client.query(
      'UPDATE players SET ton_reserved = $1 WHERE telegram_id = $2',
      [newReservedBalance, telegram_id]
    );

    // Отменяем заявку
    await client.query(
      `UPDATE withdrawals
       SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1`,
      [withdrawal_id]
    );

    await client.query('COMMIT');

    console.log('Withdrawal cancelled:', { telegram_id, withdrawal_id, amount: withdrawAmount });

    res.json({
      success: true,
      message: 'Withdrawal cancelled, funds unreserved',
      cancelled_amount: withdrawAmount,
      reserved_balance: newReservedBalance
    });

  } catch (err) {
    console.error('Withdrawal cancellation error:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Cron job функция для очистки истекших заявок (24 часа)
async function cleanupExpiredWithdrawals() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Starting cleanup of expired withdrawals...');

    // Находим истекшие заявки
    const expiredResult = await client.query(
      `SELECT w.id, w.player_id, w.amount
       FROM withdrawals w
       WHERE w.status = 'pending'
       AND w.created_at < NOW() - INTERVAL '24 hours'
       FOR UPDATE`
    );

    if (expiredResult.rows.length === 0) {
      await client.query('COMMIT');
      console.log('No expired withdrawals found');
      return { cleaned: 0 };
    }

    console.log(`Found ${expiredResult.rows.length} expired withdrawals`);

    // Возвращаем зарезервированные средства для каждой заявки
    for (const withdrawal of expiredResult.rows) {
      const withdrawAmount = parseFloat(withdrawal.amount);

      // Обновляем зарезервированный баланс игрока
      await client.query(
        `UPDATE players
         SET ton_reserved = GREATEST(0, ton_reserved - $1)
         WHERE telegram_id = $2`,
        [withdrawAmount, withdrawal.player_id]
      );
    }

    // Отмечаем заявки как истекшие
    const cleanupResult = await client.query(
      `UPDATE withdrawals
       SET status = 'expired', completed_at = NOW()
       WHERE status = 'pending'
       AND created_at < NOW() - INTERVAL '24 hours'
       RETURNING id`
    );

    await client.query('COMMIT');

    const cleanedCount = cleanupResult.rows.length;
    console.log(`Cleaned up ${cleanedCount} expired withdrawals`);

    return { cleaned: cleanedCount };

  } catch (err) {
    console.error('Cleanup expired withdrawals error:', err);
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Запуск очистки каждый час
setInterval(async () => {
  try {
    await cleanupExpiredWithdrawals();
  } catch (err) {
    console.error('Scheduled cleanup failed:', err);
  }
}, 60 * 60 * 1000); // каждый час

// Экспортируем функцию очистки для ручного вызова
router.cleanupExpiredWithdrawals = cleanupExpiredWithdrawals;

module.exports = router;