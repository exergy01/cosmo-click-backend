// routes/luminios.js - API для валютной системы Luminios
const express = require('express');
const router = express.Router();
const db = require('../db');

// Константы
const EXCHANGE_RATE_COSMIC_FLEET = 10; // 1 CS = 10 Luminios (Cosmic Fleet)
const EXCHANGE_RATE_GALACTIC_EMPIRE = 100; // 1 CS = 100 Luminios (Galactic Empire)
const EXCHANGE_RATE = EXCHANGE_RATE_GALACTIC_EMPIRE; // Используем курс Galactic Empire по умолчанию
const DEBUG_TELEGRAM_IDS = [2097930691, 850758749, 1222791281, 123456789];

// Middleware для проверки доступа к Luminios
const checkLuminiosAccess = (req, res, next) => {
  const telegramId = parseInt(req.params.telegramId || req.body.telegramId);

  if (!DEBUG_TELEGRAM_IDS.includes(telegramId)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Luminios currency is in development.'
    });
  }

  next();
};

// 🎯 GET /api/luminios/balance/:telegramId - Получить баланс Luminios
router.get('/balance/:telegramId', checkLuminiosAccess, async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId);

    const balanceQuery = `
      SELECT luminios_balance FROM cosmic_fleet_players
      WHERE telegram_id = $1
    `;
    const balanceResult = await db.query(balanceQuery, [telegramId]);

    if (balanceResult.rows.length === 0) {
      return res.json({ balance: 0 }); // Новый игрок
    }

    res.json({
      balance: balanceResult.rows[0].luminios_balance
    });
  } catch (error) {
    console.error('Error getting Luminios balance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// 🎯 POST /api/luminios/exchange - Обмен CS на Luminios
router.post('/exchange', checkLuminiosAccess, async (req, res) => {
  try {
    const { telegramId, csAmount } = req.body;

    console.log('💱 Exchange request:', { telegramId, csAmount, type: typeof telegramId });

    // Преобразуем telegramId в число если нужно
    const telegramIdNum = parseInt(telegramId);
    const csAmountNum = parseFloat(csAmount);

    if (!telegramIdNum || isNaN(telegramIdNum) || !csAmountNum || isNaN(csAmountNum) || csAmountNum <= 0) {
      console.log('❌ Invalid data:', { telegramIdNum, csAmountNum });
      return res.status(400).json({
        success: false,
        error: 'Invalid request data'
      });
    }

    const luminiosAmount = csAmountNum * EXCHANGE_RATE;

    // Начинаем транзакцию
    await db.query('BEGIN');

    try {
      // 1. Проверяем баланс CS в основной таблице
      const csCheckQuery = `
        SELECT cs FROM players WHERE telegram_id = $1
      `;
      const csCheckResult = await db.query(csCheckQuery, [telegramIdNum]);

      if (csCheckResult.rows.length === 0 || parseFloat(csCheckResult.rows[0].cs) < csAmountNum) {
        await db.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Insufficient CS balance'
        });
      }

      // 2. Списываем CS
      const deductCsQuery = `
        UPDATE players SET cs = cs - $1 WHERE telegram_id = $2 RETURNING cs
      `;
      const deductResult = await db.query(deductCsQuery, [csAmountNum, telegramIdNum]);
      const newCsBalance = parseFloat(deductResult.rows[0].cs);

      // 3. Проверяем/создаем игрока galactic empire
      const checkPlayerQuery = `
        SELECT telegram_id, luminios_balance FROM galactic_empire_players
        WHERE telegram_id = $1
      `;
      const checkPlayerResult = await db.query(checkPlayerQuery, [telegramIdNum]);

      let newLuminiosBalance;

      if (checkPlayerResult.rows.length === 0) {
        // Создаем нового игрока
        const createPlayerQuery = `
          INSERT INTO galactic_empire_players (telegram_id, luminios_balance, race)
          VALUES ($1, $2, 'human')
          RETURNING luminios_balance
        `;
        const createResult = await db.query(createPlayerQuery, [telegramIdNum, luminiosAmount]);
        newLuminiosBalance = createResult.rows[0].luminios_balance;
      } else {
        // Обновляем существующего игрока
        const updateLuminiosQuery = `
          UPDATE galactic_empire_players
          SET luminios_balance = luminios_balance + $1
          WHERE telegram_id = $2
          RETURNING luminios_balance
        `;
        const updateResult = await db.query(updateLuminiosQuery, [luminiosAmount, telegramIdNum]);
        newLuminiosBalance = updateResult.rows[0].luminios_balance;
      }

      // 4. Записываем транзакцию
      const transactionQuery = `
        INSERT INTO luminios_transactions (
          telegram_id, transaction_type, ccc_amount, luminios_amount,
          exchange_rate, description
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const transactionResult = await db.query(transactionQuery, [
        telegramIdNum,
        'exchange',
        csAmountNum,
        luminiosAmount,
        EXCHANGE_RATE,
        `Exchange ${csAmountNum} CS to ${luminiosAmount} Luminios`
      ]);

      await db.query('COMMIT');

      res.json({
        success: true,
        newLuminiosBalance,
        newCsBalance,
        transaction: {
          id: transactionResult.rows[0].id.toString(),
          type: 'exchange',
          amount: luminiosAmount,
          cccAmount: csAmountNum,
          exchangeRate: EXCHANGE_RATE,
          description: transactionResult.rows[0].description,
          timestamp: transactionResult.rows[0].created_at.getTime()
        }
      });

    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Error in Luminios exchange:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// 🎯 GET /api/luminios/transactions/:telegramId - История транзакций
router.get('/transactions/:telegramId', checkLuminiosAccess, async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const transactionsQuery = `
      SELECT * FROM luminios_transactions
      WHERE telegram_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;
    const transactionsResult = await db.query(transactionsQuery, [telegramId, limit, offset]);

    const transactions = transactionsResult.rows.map(tx => ({
      id: tx.id.toString(),
      type: tx.transaction_type,
      amount: tx.luminios_amount,
      cccAmount: tx.ccc_amount,
      exchangeRate: tx.exchange_rate ? parseFloat(tx.exchange_rate) : null,
      description: tx.description,
      timestamp: tx.created_at.getTime()
    }));

    res.json(transactions);
  } catch (error) {
    console.error('Error getting Luminios transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

module.exports = router;