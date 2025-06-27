const express = require('express');
const pool = require('../db');
const { getPlayer } = require('./shared/getPlayer');
const { getPlayerStatistics } = require('./shared/logger');

const router = express.Router();

// POST /api/player/language
router.post('/language', async (req, res) => {
  const { telegramId, language, isFirstLanguageSelection } = req.body;
  
  // ДИАГНОСТИКА
  console.log('=== LANGUAGE ENDPOINT ===');
  console.log('Request body:', req.body);
  console.log('telegramId:', telegramId);
  console.log('language:', language);
  console.log('isFirstLanguageSelection:', isFirstLanguageSelection);
  console.log('========================');
  
  if (!telegramId || !language) return res.status(400).json({ error: 'Telegram ID and language are required' });

  try {
    const player = await getPlayer(telegramId);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    // Записываем registration_language при первом выборе
    if (isFirstLanguageSelection) {
      console.log('📝 Обновляем registration_language:', language);
      await pool.query(
        'UPDATE players SET language = $1, registration_language = COALESCE(registration_language, $2) WHERE telegram_id = $3',
        [language, language, telegramId]
      );
    } else {
      console.log('📝 Обновляем только language:', language);
      await pool.query(
        'UPDATE players SET language = $1 WHERE telegram_id = $2',
        [language, telegramId]
      );
    }

    const updatedPlayer = await getPlayer(telegramId);
    console.log('✅ Обновленный игрок:', {
      telegram_id: updatedPlayer.telegram_id,
      language: updatedPlayer.language,
      registration_language: updatedPlayer.registration_language
    });
    res.json(updatedPlayer);
  } catch (err) {
    console.error('Error updating language:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/player/color
router.post('/color', async (req, res) => {
  const { telegramId, color } = req.body;
  if (!telegramId || !color) return res.status(400).json({ error: 'Telegram ID and color are required' });

  try {
    const player = await getPlayer(telegramId);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    await pool.query(
      'UPDATE players SET color = $1 WHERE telegram_id = $2',
      [color, telegramId]
    );

    const updatedPlayer = await getPlayer(telegramId);
    res.json({ color: updatedPlayer.color });
  } catch (err) {
    console.error('Error updating color:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/player/:telegramId
router.get('/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  try {
    const player = await getPlayer(telegramId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.json(player);
  } catch (err) {
    console.error('Error fetching player data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/player/:telegramId
router.post('/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  const updates = req.body;
  if (!telegramId || !updates) return res.status(400).json({ error: 'Telegram ID and updates are required' });
  try {
    const player = await getPlayer(telegramId);
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    for (const key in updates) {
      if (updates.hasOwnProperty(key)) {
        updateFields.push(`${key} = $${paramIndex}`);
        updateValues.push(updates[key]);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const updateQuery = `UPDATE players SET ${updateFields.join(', ')} WHERE telegram_id = $${paramIndex} RETURNING *`;
    updateValues.push(telegramId);

    const result = await pool.query(updateQuery, updateValues);
    const updatedPlayer = result.rows[0];
    const finalPlayer = await getPlayer(updatedPlayer.telegram_id);
    res.json(finalPlayer);
  } catch (err) {
    console.error('Error updating player:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/player/stats/:telegramId - ENDPOINT ДЛЯ СТАТИСТИКИ
router.get('/stats/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  
  try {
    if (!telegramId) {
      return res.status(400).json({ error: 'telegramId is required' });
    }

    // Получаем основную информацию об игроке
    const player = await getPlayer(telegramId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    // Получаем статистику из логов (если таблица существует)
    let logStats = { weekly: [], total: {} };
    try {
      logStats = await getPlayerStatistics(telegramId);
    } catch (err) {
      console.log('Player actions table not found, using calculated stats');
    }

    // Рассчитываем общую статистику
    const totalResourcesCollected = {
      ccc: player.ccc_lifetime || parseFloat(player.ccc) || 0,
      cs: player.cs_lifetime || parseFloat(player.cs) || 0,
      ton: player.ton_lifetime || parseFloat(player.ton) || 0
    };

    // Рассчитываем время игры
    const registrationDate = new Date(player.created_at || Date.now());
    const now = new Date();
    const totalPlayTime = Math.max(1, Math.floor((now - registrationDate) / (1000 * 60))); // в минутах

    // Эффективность (ресурсы в час)
    const hoursPlayed = Math.max(1, totalPlayTime / 60);
    const resourcesPerHour = {
      ccc: Math.round(totalResourcesCollected.ccc / hoursPlayed),
      cs: Math.round(totalResourcesCollected.cs / hoursPlayed),
      ton: Math.round((totalResourcesCollected.ton / hoursPlayed) * 100) / 100
    };

    // Прогресс по системам
    const systemProgress = {};
    for (let systemId = 1; systemId <= 7; systemId++) {
      const systemDrones = player.drones.filter(d => d.system === systemId);
      const systemCargo = player.cargo_levels.filter(c => c.system === systemId);
      const systemAsteroids = player.asteroids.filter(a => a.system === systemId);
      
      // Максимальный уровень карго
      const maxCargoLevel = systemCargo.reduce((max, c) => Math.max(max, c.id || 0), 0);
      
      systemProgress[systemId] = {
        cargoLevel: maxCargoLevel,
        dronesCount: systemDrones.length,
        asteroidsOwned: systemAsteroids.length,
        systemUnlocked: player.unlocked_systems.includes(systemId)
      };
    }

    // Достижения
    const totalDrones = Object.values(systemProgress).reduce((sum, sys) => sum + sys.dronesCount, 0);
    const unlockedSystemsCount = Object.values(systemProgress).filter(sys => sys.systemUnlocked).length;
    
    const achievements = {
      firstMillion: totalResourcesCollected.ccc >= 1000000,
      hundredDrones: totalDrones >= 100,
      allSystemsUnlocked: unlockedSystemsCount >= 7,
      speedRunner: totalPlayTime < 1440 && totalResourcesCollected.ccc > 100000 // меньше дня, но много ресурсов
    };

    // Рейтинги (пока заглушки, но структура готова для реального рейтинга)
    const ranking = {
      totalResources: Math.floor(Math.random() * 1000) + 1,
      efficiency: Math.floor(Math.random() * 1000) + 1,
      progress: Math.floor(Math.random() * 1000) + 1
    };

    // Финансовая статистика
    const totalSpent = {
      ccc: player.ccc_spent || 0,
      cs: player.cs_spent || 0,
      ton: player.ton_spent || 0
    };

    // ROI - возврат инвестиций
    const totalInvested = totalSpent.ccc + totalSpent.cs * 100 + totalSpent.ton * 10000;
    const currentValue = parseFloat(player.ccc) + parseFloat(player.cs) * 100 + parseFloat(player.ton) * 10000;
    const roi = totalInvested > 0 ? Math.round(((currentValue / totalInvested) - 1) * 100) : 0;

    // История (из логов или заглушка)
    let history = [];
    if (logStats.weekly.length > 0) {
      history = logStats.weekly.map(day => ({
        date: day.date,
        cccCollected: parseFloat(day.ccc_collected) || 0,
        csCollected: parseFloat(day.cs_collected) || 0,
        tonCollected: parseFloat(day.ton_collected) || 0,
        purchases: parseInt(day.purchases) || 0
      }));
    } else {
      // Заглушка на 7 дней
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        history.push({
          date: date.toISOString().split('T')[0],
          cccCollected: 0,
          csCollected: 0,
          tonCollected: 0,
          purchases: 0
        });
      }
    }

    // Формируем итоговую статистику
    const stats = {
      totalPlayTime,
      totalResourcesCollected,
      totalPurchases: player.total_purchases || logStats.total.total_purchases || 0,
      resourcesPerHour,
      systemProgress,
      achievements,
      ranking,
      financial: {
        totalSpent,
        roi,
        bestInvestment: 'Дроны' // заглушка
      },
      history
    };

    res.json(stats);

  } catch (error) {
    console.error('Error fetching player stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;