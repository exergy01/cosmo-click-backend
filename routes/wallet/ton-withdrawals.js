const express = require('express');
const pool = require('../../db');
const { getPlayer } = require('../shared/getPlayer');
const { notifyWithdrawalRequest } = require('../telegramBot');

const router = express.Router();

// POST /prepare - Подготовка вывода
router.post('/prepare', async (req, res) => {
  const { telegram_id, amount } = req.body;
  
  console.log('Preparing withdrawal:', { telegram_id, amount });
  
  if (!telegram_id || !amount) {
    return res.status(400).json({ error: 'Telegram ID and amount are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const playerResult = await client.query(
      'SELECT telegram_id, first_name, username, ton FROM players WHERE telegram_id = $1',
      [telegram_id]
    );
    
    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];
    const playerBalance = parseFloat(player.ton || '0');
    const withdrawAmount = parseFloat(amount);

    if (withdrawAmount <= 0 || withdrawAmount > playerBalance || withdrawAmount < 0.1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid amount' });
    }

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

    console.log('Withdrawal request created:', { telegram_id, amount: withdrawAmount, withdrawalId });

    res.json({
      success: true,
      withdrawal_id: withdrawalId,
      amount: withdrawAmount,
      message: 'Withdrawal request created and sent to administrator'
    });

  } catch (err) {
    console.error('Withdrawal preparation error:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /confirm - Подтверждение вывода (для админов)
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

    const player = await getPlayer(telegram_id);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const withdrawAmount = parseFloat(amount);
    const currentBalance = parseFloat(player.ton || '0');

    if (withdrawAmount > currentBalance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    const newBalance = currentBalance - withdrawAmount;
    
    // Обновляем баланс игрока
    await client.query(
      'UPDATE players SET ton = $1 WHERE telegram_id = $2',
      [newBalance, telegram_id]
    );

    // Обновляем статус вывода
    await client.query(
      `UPDATE withdrawals 
       SET status = 'completed', 
           transaction_hash = $1,
           wallet_address = $2,
           completed_at = NOW()
       WHERE player_id = $3 
         AND amount = $4 
         AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [transaction_hash, wallet_address, telegram_id, withdrawAmount]
    );

    await client.query('COMMIT');

    console.log('Withdrawal confirmed:', { telegram_id, amount: withdrawAmount, newBalance });

    res.json({
      success: true,
      message: 'Withdrawal confirmed',
      new_balance: newBalance
    });

  } catch (err) {
    console.error('Withdrawal confirmation error:', err);
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;