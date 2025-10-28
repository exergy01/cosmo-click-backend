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

    // 🔒 SECURITY: Lock player row to prevent race conditions
    const playerResult = await client.query(`
      SELECT * FROM players WHERE telegram_id = $1 FOR UPDATE
    `, [telegramId]);

    if (playerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }

    const player = playerResult.rows[0];

    // 🛡️ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
    const suspicious = await detectSuspiciousActivity(telegramId, 'exchange_buy', amount, null);
    if (suspicious) {
      if (process.env.NODE_ENV === 'development') console.log(`🚨 Подозрительная активность при обмене: ${telegramId}`);
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

// POST /api/exchange/convert - ИСПРАВЛЕННАЯ ВЕРСИЯ
router.post('/convert', async (req, res) => {
  if (process.env.NODE_ENV === 'development') console.log('🔄 ПОЛУЧЕН ЗАПРОС НА ОБМЕН:', req.body); // ⬅️ ПЕРВЫЙ ЛОГ
  
  const { telegramId, fromCurrency, toCurrency, amount } = req.body;
  
  if (process.env.NODE_ENV === 'development') console.log('📋 ИЗВЛЕЧЕННЫЕ ПАРАМЕТРЫ:', { telegramId, fromCurrency, toCurrency, amount });
  
  if (!telegramId || !fromCurrency || !toCurrency || amount === undefined || amount <= 0) {
    if (process.env.NODE_ENV === 'development') console.log('❌ ВАЛИДАЦИЯ НЕ ПРОШЛА');
    return res.status(400).json({ error: 'Missing required fields or invalid amount' });
  }
  
  if (process.env.NODE_ENV === 'development') console.log('✅ ВАЛИДАЦИЯ ПРОШЛА, ПОДКЛЮЧАЕМСЯ К БД...');
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (process.env.NODE_ENV === 'development') console.log('✅ ТРАНЗАКЦИЯ НАЧАТА');
    
    const player = await getPlayer(telegramId);
    if (!player) {
      if (process.env.NODE_ENV === 'development') console.log('❌ ИГРОК НЕ НАЙДЕН');
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Player not found' });
    }
    
    if (process.env.NODE_ENV === 'development') console.log('✅ ИГРОК НАЙДЕН:', {
      ccc: player.ccc, 
      cs: player.cs, 
      ton: player.ton, 
      verified: player.verified 
    });

    // 🛡️ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
    const suspicious = await detectSuspiciousActivity(telegramId, 'currency_convert', amount, null);
    if (suspicious) {
      if (process.env.NODE_ENV === 'development') console.log(`🚨 Подозрительная активность при конвертации: ${telegramId}`);
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
    
    // 🎯 ПРАВИЛЬНЫЕ КУРСЫ ОБМЕНА
    const rates = {
      ccc_to_cs: 1/200,      // 200 CCC = 1 CS -> 0.005
      cs_to_ccc: 200,        // 1 CS = 200 CCC
      cs_to_ton: 1/100,      // 100 CS = 1 TON -> 0.01
      ton_to_cs: 100         // 1 TON = 100 CS
    };
    
    let convertedAmount = 0;
    let conversionPair = `${fromCurrency}_to_${toCurrency}`;
    const isVerified = player.verified || false;

    if (process.env.NODE_ENV === 'development') console.log('💱 НАЧИНАЕМ РАСЧЕТ ОБМЕНА:', { conversionPair, isVerified });

    // 🔄 ЛОГИКА ОБМЕНА С ПРАВИЛЬНЫМИ КУРСАМИ
    if (fromCurrency === 'ccc' && toCurrency === 'cs') {
      // 200 CCC = 1 CS
      if (process.env.NODE_ENV === 'development') console.log('🔄 CCC → CS');
      if (updatedCcc < amount) { 
        if (process.env.NODE_ENV === 'development') console.log('❌ НЕДОСТАТОЧНО CCC');
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough CCC' }); 
      }
      convertedAmount = amount * rates.ccc_to_cs; // amount / 200
      updatedCcc -= amount;
      updatedCs += convertedAmount;
      if (process.env.NODE_ENV === 'development') console.log(`✅ ${amount} CCC → ${convertedAmount} CS`);
      
    } else if (fromCurrency === 'cs' && toCurrency === 'ccc') {
      // 1 CS = 200 CCC
      if (process.env.NODE_ENV === 'development') console.log('🔄 CS → CCC');
      if (updatedCs < amount) { 
        if (process.env.NODE_ENV === 'development') console.log('❌ НЕДОСТАТОЧНО CS');
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough CS' }); 
      }
      convertedAmount = amount * rates.cs_to_ccc; // amount * 200
      updatedCs -= amount;
      updatedCcc += convertedAmount;
      if (process.env.NODE_ENV === 'development') console.log(`✅ ${amount} CS → ${convertedAmount} CCC`);
      
    } else if (fromCurrency === 'cs' && toCurrency === 'ton') {
      // 100 CS = 1 TON + комиссия 2% если не верифицирован
      if (process.env.NODE_ENV === 'development') console.log('🔄 CS → TON');
      if (updatedCs < amount) { 
        if (process.env.NODE_ENV === 'development') console.log('❌ НЕДОСТАТОЧНО CS');
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough CS' }); 
      }
      convertedAmount = amount * rates.cs_to_ton; // amount / 100
      
      // Применяем комиссию 2% если не верифицирован
      if (!isVerified) {
        if (process.env.NODE_ENV === 'development') console.log('⚠️ ПРИМЕНЯЕМ КОМИССИЮ 2%');
        convertedAmount = convertedAmount * 0.98; // -2%
      }
      
      updatedCs -= amount;
      updatedTon += convertedAmount;
      if (process.env.NODE_ENV === 'development') console.log(`✅ ${amount} CS → ${convertedAmount} TON (комиссия: ${!isVerified ? '2%' : '0%'})`);
      
    } else if (fromCurrency === 'ton' && toCurrency === 'cs') {
      // 1 TON = 100 CS + комиссия 2% если не верифицирован
      if (process.env.NODE_ENV === 'development') console.log('🔄 TON → CS');
      if (updatedTon < amount) { 
        if (process.env.NODE_ENV === 'development') console.log('❌ НЕДОСТАТОЧНО TON');
        await client.query('ROLLBACK'); 
        return res.status(400).json({ error: 'Not enough TON' }); 
      }
      convertedAmount = amount * rates.ton_to_cs; // amount * 100
      
      // Применяем комиссию 2% если не верифицирован
      if (!isVerified) {
        if (process.env.NODE_ENV === 'development') console.log('⚠️ ПРИМЕНЯЕМ КОМИССИЮ 2%');
        convertedAmount = convertedAmount * 0.98; // -2%
      }
      
      updatedTon -= amount;
      updatedCs += convertedAmount;
      if (process.env.NODE_ENV === 'development') console.log(`✅ ${amount} TON → ${convertedAmount} CS (комиссия: ${!isVerified ? '2%' : '0%'})`);
      
    } else {
      if (process.env.NODE_ENV === 'development') console.log('❌ НЕДОПУСТИМАЯ ВАЛЮТНАЯ ПАРА');
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid conversion pair' });
    }

    if (process.env.NODE_ENV === 'development') console.log('💾 ОБНОВЛЯЕМ БАЛАНС В БД...');
    if (process.env.NODE_ENV === 'development') console.log('📊 НОВЫЕ БАЛАНСЫ:', {
      ccc: updatedCcc, 
      cs: updatedCs, 
      ton: updatedTon 
    });

    // Обновляем баланс игрока с таймаутом
    try {
      await Promise.race([
        client.query(
          'UPDATE players SET ccc = $1, cs = $2, ton = $3 WHERE telegram_id = $4', 
          [updatedCcc, updatedCs, updatedTon, telegramId]
        ),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database query timeout after 10 seconds')), 10000)
        )
      ]);
      if (process.env.NODE_ENV === 'development') console.log('✅ БАЛАНС ОБНОВЛЕН В БД');
    } catch (queryError) {
      console.error('❌ ОШИБКА ОБНОВЛЕНИЯ БАЛАНСА:', queryError.message);
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Database timeout or error' });
    }

    // 📝 ВРЕМЕННО ОТКЛЮЧАЕМ ЛОГИРОВАНИЕ
    if (process.env.NODE_ENV === 'development') console.log('📝 ПРОПУСКАЕМ ЛОГИРОВАНИЕ (временно)...');
    /*
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
        rate: rates[conversionPair] || 0,
        commission: !isVerified && (fromCurrency === 'cs' || fromCurrency === 'ton') ? 2 : 0,
        verified: isVerified
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
    */

    if (process.env.NODE_ENV === 'development') console.log('✅ КОММИТИМ ТРАНЗАКЦИЮ...');
    await client.query('COMMIT');
    if (process.env.NODE_ENV === 'development') console.log('✅ ТРАНЗАКЦИЯ ЗАВЕРШЕНА');
    
    // Возвращаем обновленные данные игрока
    if (process.env.NODE_ENV === 'development') console.log('🔄 ПОЛУЧАЕМ ОБНОВЛЕННЫЕ ДАННЫЕ ИГРОКА...');
    const updatedPlayer = await getPlayer(telegramId);
    
    if (process.env.NODE_ENV === 'development') console.log(`🎉 ОБМЕН УСПЕШНО ВЫПОЛНЕН: ${amount} ${fromCurrency} → ${convertedAmount.toFixed(8)} ${toCurrency} (игрок: ${telegramId})`);
    
    const response = {
      success: true,
      player: updatedPlayer,
      exchange: {
        from: fromCurrency,
        to: toCurrency,
        inputAmount: amount,
        outputAmount: convertedAmount,
        commission: !isVerified && (fromCurrency === 'cs' || fromCurrency === 'ton') ? 2 : 0
      }
    };
    
    if (process.env.NODE_ENV === 'development') console.log('📤 ОТПРАВЛЯЕМ ОТВЕТ КЛИЕНТУ:', { success: true, exchange: response.exchange });
    res.json(response);
    if (process.env.NODE_ENV === 'development') console.log('✅ ОТВЕТ ОТПРАВЛЕН!');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ ОШИБКА ПРИ ОБМЕНЕ:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
    if (process.env.NODE_ENV === 'development') console.log('🔒 СОЕДИНЕНИЕ С БД ЗАКРЫТО');
  }
});

module.exports = router;