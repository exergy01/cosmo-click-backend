const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { logPlayerAction, detectSuspiciousActivity, updateLifetimeStats, logBalanceChange } = require('./shared/logger');

const router = express.Router();

// POST /api/referrals/register - БЕЗ ФИКСИРОВАННЫХ НАГРАД
router.post('/register', async (req, res) => {
  const { telegramId, referrerId } = req.body;
  if (!telegramId || !referrerId) return res.status(400).json({ error: 'Telegram ID and Referrer ID are required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const playerResult = await client.query('SELECT referrer_id FROM players WHERE telegram_id = $1', [telegramId]);
    const player = playerResult.rows[0];
    if (player && player.referrer_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Player already has a referrer' });
    }

    // 🛡️ ПРОВЕРКА НА ПОДОЗРИТЕЛЬНУЮ АКТИВНОСТЬ
    const suspicious = await detectSuspiciousActivity(telegramId, 'register_referral', 0, null);
    if (suspicious) {
      console.log(`🚨 Подозрительная активность при регистрации реферала: ${telegramId}`);
    }

    // Получаем данные реферера для проверки
    const referrer = await getPlayer(referrerId);
    if (!referrer) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Referrer not found' });
    }

    // 🔥 ИСПРАВЛЕНО: Только записываем связь И увеличиваем счетчик рефералов
    await client.query('UPDATE players SET referrer_id = $1 WHERE telegram_id = $2', [referrerId, telegramId]);
    await client.query('UPDATE players SET referrals_count = referrals_count + 1 WHERE telegram_id = $1', [referrerId]);
    
    // 🔥 ИСПРАВЛЕНО: Записываем в таблицу рефералов БЕЗ НАГРАДЫ (0, 0) - ИСПОЛЬЗУЕМ created_at
    await client.query('INSERT INTO referrals (referrer_id, referred_id, cs_earned, ton_earned, created_at) VALUES ($1, $2, $3, $4, NOW())', [referrerId, telegramId, 0, 0]);

    // 📝 ЛОГИРОВАНИЕ РЕГИСТРАЦИИ РЕФЕРАЛА ДЛЯ НОВОГО ИГРОКА
    await logPlayerAction(
      telegramId, 
      'register_as_referral', 
      0, 
      null, 
      null, 
      {
        referrerId: referrerId,
        action: 'became_referral'
      }, 
      req
    );

    // 📝 ЛОГИРОВАНИЕ РЕГИСТРАЦИИ РЕФЕРАЛА ДЛЯ РЕФЕРЕРА (БЕЗ НАГРАДЫ)
    await logPlayerAction(
      referrerId, 
      'referral_registered', 
      0, 
      null, 
      null, 
      {
        referredId: telegramId,
        action: 'new_referral_registered'
      }, 
      req
    );

    // 📊 ОБНОВЛЯЕМ LIFETIME СТАТИСТИКУ РЕФЕРЕРА (только счетчик рефералов)
    await updateLifetimeStats(referrerId, 'referral_registered', 1);

    await client.query('COMMIT');
    const updatedPlayer = await getPlayer(telegramId);
    res.json(updatedPlayer);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error registering referral:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/referrals/list/:telegramId - ИСПРАВЛЕННЫЙ
router.get('/list/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    console.log(`🔍 Загружаем рефералов для: ${telegramId}`);
    
    // 🔥 ИСПРАВЛЕННЫЙ ЗАПРОС: правильные поля + JOIN для получения username
    const referrals = await pool.query(`
      SELECT 
        r.referred_id,
        r.referrer_id,
        r.cs_earned,
        r.ton_earned,
        r.created_at,
        p.username,
        p.first_name
      FROM referrals r
      LEFT JOIN players p ON r.referred_id = p.telegram_id
      WHERE r.referrer_id = $1
      ORDER BY r.created_at DESC
    `, [telegramId]);
    
    console.log(`✅ Найдено рефералов: ${referrals.rows.length}`);
    console.log('📋 Данные рефералов:', referrals.rows);
    
    res.json(referrals.rows);
  } catch (err) {
    console.error('❌ Ошибка загрузки рефералов:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/referrals/honor-board - ИСПРАВЛЕННЫЙ (считаем из players.referrer_id)
router.get('/honor-board', async (req, res) => {
  try {
    console.log('🏆 Загружаем доску почета...');
    
    // 🔥 ПРАВИЛЬНЫЙ ПОДСЧЕТ: считаем сколько раз каждый ID встречается в поле referrer_id
    const honorBoardResult = await pool.query(`
      SELECT 
        p.telegram_id,
        p.username,
        p.first_name,
        COUNT(ref.referrer_id) as actual_referrals_count
      FROM players p
      LEFT JOIN players ref ON ref.referrer_id = p.telegram_id
      GROUP BY p.telegram_id, p.username, p.first_name
      HAVING COUNT(ref.referrer_id) > 0
      ORDER BY actual_referrals_count DESC
      LIMIT 10
    `);
    
    // Формируем результат с правильным полем
    const result = honorBoardResult.rows.map(row => ({
      telegram_id: row.telegram_id,
      username: row.username || row.first_name,
      referrals_count: parseInt(row.actual_referrals_count)
    }));
    
    console.log('🏆 Доска почета:', result);
    res.json(result);
  } catch (err) {
    console.error('Error fetching honor board:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/referrals/create - 🔥 ИСПРАВЛЕНО: правильная генерация ссылок
router.post('/create', async (req, res) => {
  const { telegramId } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'Telegram ID is required' });
  const player = await getPlayer(telegramId);
  if (!player) return res.status(404).json({ error: 'Player not found' });
  
  // Если ссылка уже есть, проверяем формат
  if (player.referral_link) {
    // Если старый формат - обновляем
    if (player.referral_link.includes('?start=')) {
      const newReferralLink = player.referral_link.replace('?start=', '?startapp=');
      await pool.query('UPDATE players SET referral_link = $1 WHERE telegram_id = $2', [newReferralLink, telegramId]);
      console.log(`🔄 Обновлена реферальная ссылка: ${telegramId} -> ${newReferralLink}`);
      
      const updatedPlayer = await getPlayer(telegramId);
      return res.json({ referral_link: updatedPlayer.referral_link });
    }
    return res.json({ referral_link: player.referral_link });
  }
  
  // 🔥 ИСПРАВЛЕНО: создаем ссылку с startapp
  const referralLink = `https://t.me/CosmoClickBot?startapp=${telegramId}`;
  await pool.query('UPDATE players SET referral_link = $1 WHERE telegram_id = $2', [referralLink, telegramId]);

  // 📝 ЛОГИРОВАНИЕ СОЗДАНИЯ РЕФЕРАЛЬНОЙ ССЫЛКИ
  await logPlayerAction(
    telegramId, 
    'create_referral_link', 
    0, 
    null, 
    null, 
    {
      referralLink: referralLink,
      action: 'generated_referral_link'
    }, 
    req
  );

  const updatedPlayer = await getPlayer(telegramId);
  res.json({ referral_link: updatedPlayer.referral_link });
});

// POST /api/referrals/collect-rewards - СБОР РЕФЕРАЛЬНЫХ НАГРАД
router.post('/collect-rewards', async (req, res) => {
  const { telegramId } = req.body;
  if (!telegramId) return res.status(400).json({ error: 'Telegram ID is required' });
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Получаем все несобранные награды
    const referrals = await client.query(
      'SELECT cs_earned, ton_earned FROM referrals WHERE referrer_id = $1',
      [telegramId]
    );
    
    if (referrals.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Нет наград для сбора' });
    }
    
    // Подсчитываем общую сумму
    const totalCS = referrals.rows.reduce((sum, row) => sum + parseFloat(row.cs_earned || 0), 0);
    const totalTON = referrals.rows.reduce((sum, row) => sum + parseFloat(row.ton_earned || 0), 0);
    
    if (totalCS <= 0 && totalTON <= 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Нет наград для сбора' });
    }
    
    // Добавляем к балансу игрока
    await client.query(
      'UPDATE players SET cs = cs + $1, ton = ton + $2 WHERE telegram_id = $3',
      [totalCS, totalTON, telegramId]
    );
    
    // Обнуляем собранные награды
    await client.query(
      'UPDATE referrals SET cs_earned = 0, ton_earned = 0 WHERE referrer_id = $1',
      [telegramId]
    );
    
    await client.query('COMMIT');
    res.json({ success: true, collected: { cs: totalCS, ton: totalTON } });
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error collecting rewards:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;