// ===== routes/exchange.js =====
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { logPlayerAction, detectSuspiciousActivity, updateLifetimeStats, logBalanceChange } = require('./shared/logger');

const router = express.Router();

// GET /api/exchange/list
router.get('/list', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM exchanges ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching exchanges:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/exchange/buy
router.post('/buy', async (req, res) => {
  const { telegramId, exchangeId, amount } = req.body;
  if (!telegramId || !exchangeId || amount === undefined || amount <= 0) return res.status(400).json({ error: 'Missing required fields or invalid amount' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    // 🛡️ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
    const suspicious = await detectSuspiciousActivity(telegramId, 'exchange_buy', amount, null);
    if (suspicious) {
      console.log(`🚨 Подозрительная активность при обмене: ${telegramId}`);
    }

    const exchangeResult = await client.query('SELECT * FROM exchanges WHERE id = $1', [exchangeId]);
    const exchange = exchangeResult.rows[0];
    if (!exchange) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Exchange not found' });
    }

    // 📊 СОХРАНЯЕМ БАЛАНС ДО ОПЕРАЦИИ
    const balanceBefore = {
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton)
    };

    let updatedCcc = parseFloat(player.ccc);
    let updatedCs = parseFloat(player.cs);
    let updatedTon = parseFloat(player.ton);
    const cost = amount;
    
    switch (exchange.from_currency) {
      case 'ccc': 
        if (updatedCcc < cost) { 
          await client.query('ROLLBACK'); 
          return res.status(400).json({ error: 'Not enough CCC' }); 
        } 
        updatedCcc -= cost; 
        break;
      case 'cs': 
        if (updatedCs < cost) { 
          await client.query('ROLLBACK'); 
          return res.status(400).json({ error: 'Not enough CS' }); 
        } 
        updatedCs -= cost; 
        break;
      case 'ton': 
        if (updatedTon < cost) { 
          await client.query('ROLLBACK'); 
          return res.status(400).json({ error: 'Not enough TON' }); 
        } 
        updatedTon -= cost; 
        break;
      default: 
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Invalid from currency' });
    }

    switch (exchange.to_currency) {
      case 'ccc': updatedCcc += amount * exchange.rate; break;
      case 'cs': updatedCs += amount * exchange.rate; break;
      case 'ton': updatedTon += amount * exchange.rate; break;
      default: 
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Invalid to currency' });
    }

    await client.query('UPDATE players SET ccc = $1, cs = $2, ton = $3 WHERE telegram_id = $4', [updatedCcc, updatedCs, updatedTon, telegramId]);

    // 📝 ЛОГИРОВАНИЕ ОБМЕНА
    const actionId = await logPlayerAction(
      telegramId, 
      'exchange_buy', 
      amount, 
      null, 
      exchangeId, 
      {
        exchangeData: exchange,
        fromCurrency: exchange.from_currency,
        toCurrency: exchange.to_currency,
        rate: exchange.rate,
        costAmount: cost,
        receivedAmount: amount * exchange.rate
      }, 
      req
    );

    // 📊 ЛОГИРУЕМ ИЗМЕНЕНИЕ БАЛАНСА
    const balanceAfter = {
      ccc: updatedCcc,
      cs: updatedCs,
      ton: updatedTon
    };

    if (actionId) {
      await logBalanceChange(telegramId, actionId, balanceBefore, balanceAfter);
    }

    // 📊 ОБНОВЛЯЕМ СТАТИСТИКУ
    await updateLifetimeStats(telegramId, 'exchange_buy', 1);

    await client.query('COMMIT');
    const updatedPlayer = await getPlayer(telegramId);
    res.json(updatedPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error buying exchange:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/exchange/convert
router.post('/convert', async (req, res) => {
  const { telegramId, fromCurrency, toCurrency, amount } = req.body;
  if (!telegramId || !fromCurrency || !toCurrency || amount === undefined || amount <= 0) return res.status(400).json({ error: 'Missing required fields or invalid amount' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    // 🛡️ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
    const suspicious = await detectSuspiciousActivity(telegramId, 'currency_convert', amount, null);
    if (suspicious) {
      console.log(`🚨 Подозрительная активность при конвертации: ${telegramId}`);
    }

    // 📊 СОХРАНЯЕМ БАЛАНС ДО ОПЕРАЦИИ
    const balanceBefore = {
      ccc: parseFloat(player.ccc),
      cs: parseFloat(player.cs),
      ton: parseFloat(player.ton)
    };

    let updatedCcc = parseFloat(player.ccc);
    let updatedCs = parseFloat(player.cs);
    let updatedTon = parseFloat(player.ton);
    const rates = { ccc_to_cs: 0.001, cs_to_ton: 0.0001, ton_to_cs: 10000, cs_to_ccc: 1000, ton_to_ccc: 1000 * 10000 };
    let convertedAmount = 0;
    let conversionPair = `${fromCurrency}_to_${toCurrency}`;

    if (fromCurrency === 'ccc' && toCurrency === 'cs') {
      if (updatedCcc < amount) { 
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough CCC' }); 
      }
      convertedAmount = amount * rates.ccc_to_cs;
      updatedCcc -= amount;
      updatedCs += convertedAmount;
    } else if (fromCurrency === 'cs' && toCurrency === 'ton') {
      if (updatedCs < amount) { 
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough CS' }); 
      }
      convertedAmount = amount * rates.cs_to_ton;
      updatedCs -= amount;
      updatedTon += convertedAmount;
    } else if (fromCurrency === 'ton' && toCurrency === 'cs') {
      if (updatedTon < amount) { 
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough TON' }); 
      }
      convertedAmount = amount * rates.ton_to_cs;
      updatedTon -= amount;
      updatedCs += convertedAmount;
    } else if (fromCurrency === 'cs' && toCurrency === 'ccc') {
      if (updatedCs < amount) { 
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough CS' }); 
      }
      convertedAmount = amount * rates.cs_to_ccc;
      updatedCs -= amount;
      updatedCcc += convertedAmount;
    } else if (fromCurrency === 'ton' && toCurrency === 'ccc') {
      if (updatedTon < amount) { 
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough TON' }); 
      }
      convertedAmount = amount * rates.ton_to_ccc;
      updatedTon -= amount;
      updatedCcc += convertedAmount;
    } else {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid conversion pair' });
    }

    await client.query('UPDATE players SET ccc = $1, cs = $2, ton = $3 WHERE telegram_id = $4', [updatedCcc, updatedCs, updatedTon, telegramId]);

    // 📝 ЛОГИРОВАНИЕ КОНВЕРТАЦИИ
    const actionId = await logPlayerAction(
      telegramId, 
      'currency_convert', 
      amount, 
      null, 
      null, 
      {
        fromCurrency,
        toCurrency,
        inputAmount: amount,
        outputAmount: convertedAmount,
        conversionPair,
        rate: rates[conversionPair] || 0
      }, 
      req
    );

    // 📊 ЛОГИРУЕМ ИЗМЕНЕНИЕ БАЛАНСА
    const balanceAfter = {
      ccc: updatedCcc,
      cs: updatedCs,
      ton: updatedTon
    };

    if (actionId) {
      await logBalanceChange(telegramId, actionId, balanceBefore, balanceAfter);
    }

    // 📊 ОБНОВЛЯЕМ СТАТИСТИКУ
    await updateLifetimeStats(telegramId, 'currency_convert', 1);

    await client.query('COMMIT');
    const updatedPlayer = await getPlayer(telegramId);
    res.json(updatedPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error converting currency:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;