// ===== routes/stars.js =====
const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');

const router = express.Router();

// 🌟 GET /api/stars/rates - получить текущие курсы
router.get('/rates', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'development') console.log('📊 Запрос курсов Stars');
    
    const result = await pool.query(`
      SELECT 
        currency_pair,
        rate,
        previous_rate,
        last_updated,
        status,
        metadata
      FROM exchange_rates 
      WHERE currency_pair IN ('TON_USD', 'STARS_CS')
      ORDER BY currency_pair, last_updated DESC
    `);
    
    const rates = {};
    for (const row of result.rows) {
      if (!rates[row.currency_pair]) {
        rates[row.currency_pair] = row;
      }
    }
    
    // Проверяем блокировку обмена
    const blockResult = await pool.query(
      'SELECT * FROM exchange_blocks WHERE exchange_type = $1 AND blocked_until > NOW() ORDER BY created_at DESC LIMIT 1',
      ['stars_to_cs']
    );
    
    const isBlocked = blockResult.rows.length > 0;
    const blockInfo = isBlocked ? blockResult.rows[0] : null;
    
    if (process.env.NODE_ENV === 'development') console.log('📊 Курсы получены:', { rates, isBlocked });
    
    res.json({
      rates,
      exchange_available: !isBlocked,
      block_info: blockInfo,
      last_updated: new Date().toISOString()
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения курсов:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🌟 POST /api/stars/exchange - обмен Stars → CS
router.post('/exchange', async (req, res) => {
  const { telegramId, starsAmount } = req.body;
  
  if (process.env.NODE_ENV === 'development') console.log('🌟 ЗАПРОС НА ОБМЕН STARS:', { telegramId, starsAmount });
  
  if (!telegramId || !starsAmount || starsAmount < 10) {
    return res.status(400).json({ 
      error: 'Invalid request',
      details: 'telegramId и starsAmount обязательны, минимум 10 Stars'
    });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Получаем игрока
    const player = await getPlayer(telegramId);
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Игрок найден:', {
      telegram_id: player.telegram_id,
      telegram_stars: player.telegram_stars,
      cs: player.cs
    });
    
    // Проверяем достаточность Stars
    const currentStars = parseInt(player.telegram_stars) || 0;
    if (currentStars < starsAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: 'Not enough Stars',
        available: currentStars,
        requested: starsAmount
      });
    }
    
    // Проверяем блокировку обмена
    const blockCheck = await client.query(
      'SELECT is_exchange_blocked($1) as blocked',
      ['stars_to_cs']
    );
    
    if (blockCheck.rows[0].blocked) {
      await client.query('ROLLBACK');
      const blockInfo = await client.query(
        'SELECT * FROM exchange_blocks WHERE exchange_type = $1 AND blocked_until > NOW() ORDER BY created_at DESC LIMIT 1',
        ['stars_to_cs']
      );
      
      return res.status(423).json({ 
        error: 'Exchange temporarily blocked',
        reason: blockInfo.rows[0]?.reason || 'Rate protection',
        blocked_until: blockInfo.rows[0]?.blocked_until
      });
    }
    
    // Получаем текущий курс Stars → CS
    const rateResult = await client.query(`
      SELECT rate, metadata, last_updated
      FROM exchange_rates 
      WHERE currency_pair = 'STARS_CS' 
      ORDER BY last_updated DESC 
      LIMIT 1
    `);
    
    if (rateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Exchange rate not available' });
    }
    
    const starsToCs = parseFloat(rateResult.rows[0].rate);
    const rateMetadata = rateResult.rows[0].metadata;
    const csAmount = starsAmount * starsToCs;
    
    if (process.env.NODE_ENV === 'development') console.log('💱 РАСЧЕТ ОБМЕНА:', {
      starsAmount,
      starsToCs,
      csAmount,
      metadata: rateMetadata
    });
    
    // Сохраняем баланс до операции
    const balanceBefore = {
      telegram_stars: currentStars,
      cs: parseFloat(player.cs)
    };
    
    // Обновляем балансы
    const newStars = currentStars - starsAmount;
    const newCs = parseFloat(player.cs) + csAmount;
    
    await client.query(
      'UPDATE players SET telegram_stars = $1, cs = $2 WHERE telegram_id = $3',
      [newStars, newCs, telegramId]
    );
    
    if (process.env.NODE_ENV === 'development') console.log('💾 БАЛАНСЫ ОБНОВЛЕНЫ:', {
      старые_stars: currentStars,
      новые_stars: newStars,
      старые_cs: parseFloat(player.cs),
      новые_cs: newCs
    });
    
    // Логируем в star_transactions
    await client.query(`
      INSERT INTO star_transactions (
        player_id, 
        amount, 
        transaction_type, 
        description,
        status,
        exchange_rate,
        cs_amount,
        ton_rate_at_time,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      telegramId,
      -starsAmount, // отрицательное значение = потрачено
      'stars_to_cs_exchange',
      `Exchange ${starsAmount} Stars to ${csAmount.toFixed(4)} CS`,
      'completed',
      starsToCs,
      csAmount,
      rateMetadata?.ton_rate_used || 3.30,
      JSON.stringify({
        rate_metadata: rateMetadata,
        balance_before: balanceBefore,
        balance_after: { telegram_stars: newStars, cs: newCs },
        exchange_type: 'stars_to_cs'
      })
    ]);
    
    await client.query('COMMIT');
    
    // Получаем обновленные данные игрока
    const updatedPlayer = await getPlayer(telegramId);
    
    if (process.env.NODE_ENV === 'development') console.log('🎉 ОБМЕН STARS ВЫПОЛНЕН:', {
      telegramId,
      exchanged: `${starsAmount} Stars → ${csAmount.toFixed(4)} CS`,
      rate: starsToCs,
      newBalances: {
        stars: newStars,
        cs: newCs
      }
    });
    
    res.json({
      success: true,
      player: updatedPlayer,
      exchange: {
        stars_amount: starsAmount,
        cs_amount: csAmount,
        exchange_rate: starsToCs,
        ton_rate_used: rateMetadata?.ton_rate_used || 3.30
      }
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка обмена Stars:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// 🌟 GET /api/stars/history/:telegramId - история обменов
router.get('/history/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const offset = parseInt(req.query.offset) || 0;
  
  try {
    const result = await pool.query(`
      SELECT 
        amount,
        cs_amount,
        exchange_rate,
        ton_rate_at_time,
        status,
        created_at,
        description,
        metadata
      FROM star_transactions 
      WHERE player_id = $1 
        AND transaction_type = 'stars_to_cs_exchange'
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `, [telegramId, limit, offset]);
    
    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM star_transactions WHERE player_id = $1 AND transaction_type = $2',
      [telegramId, 'stars_to_cs_exchange']
    );
    
    res.json({
      history: result.rows.map(row => ({
        stars_amount: Math.abs(row.amount),
        cs_amount: row.cs_amount,
        exchange_rate: row.exchange_rate,
        ton_rate_at_time: row.ton_rate_at_time,
        status: row.status,
        created_at: row.created_at,
        description: row.description,
        metadata: row.metadata
      })),
      total: parseInt(countResult.rows[0].total),
      limit,
      offset
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения истории Stars:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🌟 POST /api/stars/update-ton-rate - обновить курс TON (админ)
router.post('/update-ton-rate', async (req, res) => {
  const { newRate, source = 'manual' } = req.body;
  
  if (!newRate || newRate <= 0) {
    return res.status(400).json({ error: 'Invalid rate' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Получаем предыдущий курс
    const prevResult = await client.query(
      'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY last_updated DESC LIMIT 1',
      ['TON_USD']
    );
    
    const previousRate = prevResult.rows[0]?.rate || 3.30;
    
    // Вставляем новый курс TON
    await client.query(`
      INSERT INTO exchange_rates (currency_pair, rate, previous_rate, source, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      'TON_USD',
      newRate,
      previousRate,
      source,
      JSON.stringify({
        manual_update: true,
        rate_change_percent: ((newRate - previousRate) / previousRate * 100).toFixed(2)
      })
    ]);
    
    // Обновляем курс Stars → CS
    await client.query('SELECT update_stars_cs_rate()');
    
    await client.query('COMMIT');
    
    if (process.env.NODE_ENV === 'development') console.log(`💰 Курс TON обновлен: ${previousRate} → ${newRate} (${source})`);
    
    res.json({
      success: true,
      previous_rate: previousRate,
      new_rate: newRate,
      source
    });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка обновления курса TON:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;