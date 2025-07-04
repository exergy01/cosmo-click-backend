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
    
    // 🔥 ИСПРАВЛЕНО: Записываем в таблицу рефералов БЕЗ НАГРАДЫ (0, 0)
    await client.query('INSERT INTO referrals (referrer_id, referred_id, cs_earned, ton_earned, timestamp) VALUES ($1, $2, $3, $4, NOW())', [referrerId, telegramId, 0, 0]);

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

// GET /api/referrals/honor-board
router.get('/honor-board', async (req, res) => {
  try {
    const honorBoardResult = await pool.query('SELECT telegram_id, username, referrals_count FROM players ORDER BY referrals_count DESC LIMIT 10');
    res.json(honorBoardResult.rows);
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

module.exports = router;