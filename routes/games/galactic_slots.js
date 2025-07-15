const express = require('express');
const router = express.Router();
const pool = require('../../db');
const crypto = require('crypto');

// Константы игры
const MIN_BET = 100;
const MAX_BET = 5000;
const DAILY_GAME_LIMIT = 5;
const MAX_AD_GAMES = 20;
const JACKPOT_CONTRIBUTION = 0.002; // 0.2%
const RTP = 0.80; // 80% возврат игроку

// ИСПРАВЛЕНО: Символы и их коэффициенты - СБАЛАНСИРОВАННЫЕ!
const SYMBOLS = {
  '🌟': { id: 'wild', multipliers: [50, 500, 5000], probability: 0.1 },    // УМЕНЬШЕНО с 0.5
  '🚀': { id: 'ship', multipliers: [15, 75, 500], probability: 1.0 },      // УМЕНЬШЕНО с 2.0
  '🌌': { id: 'galaxy', multipliers: [10, 50, 250], probability: 2.0 },    // УМЕНЬШЕНО с 4.0
  '⭐': { id: 'star', multipliers: [8, 40, 150], probability: 3.0 },        // УМЕНЬШЕНО с 8.0
  '🌍': { id: 'planet', multipliers: [4, 15, 50], probability: 10.0 },      // УМЕНЬШЕНО с 20.0
  '☄️': { id: 'asteroid', multipliers: [2, 5, 15], probability: 40.0 }      // УВЕЛИЧЕНО с 65.5
};

const SYMBOL_KEYS = Object.keys(SYMBOLS);

// 20 линий выплат (позиции 0-14, где 0-4 первый ряд, 5-9 второй, 10-14 третий)
const PAYLINES = [
  [0, 1, 2, 3, 4],     // Линия 1: верхний ряд
  [5, 6, 7, 8, 9],     // Линия 2: средний ряд  
  [10, 11, 12, 13, 14], // Линия 3: нижний ряд
  [0, 6, 12, 8, 4],    // Линия 4: диагональ
  [10, 6, 2, 8, 14],   // Линия 5: диагональ
  [5, 1, 7, 3, 9],     // Линия 6: зигзаг
  [5, 11, 7, 13, 9],   // Линия 7: зигзаг
  [0, 1, 7, 3, 4],     // Линия 8: V-образная
  [10, 11, 7, 13, 14], // Линия 9: V-образная
  [0, 6, 7, 8, 4],     // Линия 10: волна
  [10, 6, 7, 8, 14],   // Линия 11: волна
  [5, 1, 2, 3, 9],     // Линия 12: купол
  [5, 11, 12, 13, 9],  // Линия 13: купол
  [0, 11, 2, 13, 4],   // Линия 14: зигзаг
  [10, 1, 12, 3, 14],  // Линия 15: зигзаг
  [5, 6, 2, 8, 9],     // Линия 16: стрела вверх
  [5, 6, 12, 8, 9],    // Линия 17: стрела вниз
  [0, 6, 2, 8, 14],    // Линия 18: M-образная
  [10, 6, 12, 8, 4],   // Линия 19: W-образная
  [0, 1, 12, 3, 4]     // Линия 20: дуга
];

// Генерация символа по вероятности
function generateSymbol() {
  const random = crypto.randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF * 100;
  let cumulative = 0;
  
  for (const symbol of SYMBOL_KEYS) {
    cumulative += SYMBOLS[symbol].probability;
    if (random <= cumulative) {
      return symbol;
    }
  }
  
  return '☄️'; // fallback
}

// ИСПРАВЛЕНО: Проверка выигрышной линии с правильной логикой WILD
function checkPayline(symbols, payline) {
  const lineSymbols = payline.map(pos => symbols[pos]);
  
  // Ищем комбинации слева направо
  let matchCount = 1;
  let matchSymbol = lineSymbols[0];
  let hasWild = false;
  
  for (let i = 1; i < lineSymbols.length; i++) {
    if (lineSymbols[i] === matchSymbol) {
      matchCount++;
    } else if (lineSymbols[i] === '🌟') {
      // WILD может заменить любой символ
      matchCount++;
      hasWild = true;
    } else if (matchSymbol === '🌟') {
      // Если первый символ WILD, он принимает значение следующего
      matchSymbol = lineSymbols[i];
      matchCount++;
      hasWild = true;
    } else {
      break;
    }
  }
  
  // Минимум 3 символа для выигрыша
  if (matchCount >= 3) {
    const symbol = SYMBOLS[matchSymbol];
    if (symbol) {
      const multiplierIndex = Math.min(matchCount - 3, symbol.multipliers.length - 1);
      return {
        symbol: matchSymbol,
        count: matchCount,
        multiplier: symbol.multipliers[multiplierIndex],
        hasWild: hasWild
      };
    }
  }
  
  return null;
}

// ИСПРАВЛЕНО: Расчет всех выигрышей с ограничениями
function calculateWinnings(symbols, betAmount) {
  let totalWin = 0;
  const winningLines = [];
  
  for (let i = 0; i < PAYLINES.length; i++) {
    const win = checkPayline(symbols, PAYLINES[i]);
    if (win) {
      let lineWin = betAmount * win.multiplier;
      
      // ИЗМЕНЕНО: WILD удваивает выигрыш ТОЛЬКО если 3 символа (не больше)
      if (win.hasWild && win.count === 3) {
        lineWin *= 2;
      }
      
      totalWin += lineWin;
      winningLines.push({
        line: i + 1,
        ...win,
        winAmount: lineWin
      });
    }
  }
  
  // ДОБАВЛЕНО: Ограничение максимального выигрыша
  const maxWin = betAmount * 1000; // Максимум x1000 от ставки (было x5000)
  if (totalWin > maxWin) {
    console.log(`🎰 Limiting win: ${totalWin} -> ${maxWin}`);
    totalWin = maxWin;
    
    // Пропорционально уменьшаем все выигрышные линии
    const ratio = maxWin / (totalWin === 0 ? 1 : totalWin);
    winningLines.forEach(line => {
      line.winAmount = Math.floor(line.winAmount * ratio);
    });
  }
  
  return { totalWin, winningLines };
}

// ДОБАВЛЕНО: Функция балансировки результата
function balanceGameResult(symbols, betAmount) {
  const { totalWin } = calculateWinnings(symbols, betAmount);
  const winRatio = totalWin / betAmount;
  
  // Если выигрыш слишком большой (больше x10), снижаем вероятность
  if (winRatio > 10) {
    const shouldReduce = Math.random() < 0.7; // 70% шанс снизить большой выигрыш
    if (shouldReduce) {
      console.log(`🎰 Reducing big win: x${winRatio.toFixed(2)} -> balanced`);
      
      // Заменяем выигрышные символы на менее выгодные
      const newSymbols = [...symbols];
      const positionsToChange = Math.floor(Math.random() * 6) + 2; // 2-7 символов
      
      for (let i = 0; i < positionsToChange; i++) {
        const pos = Math.floor(Math.random() * 15);
        newSymbols[pos] = Math.random() < 0.8 ? '☄️' : '🌍'; // 80% астероид, 20% планета
      }
      
      return newSymbols;
    }
  }
  
  return symbols;
}

// ИСПРАВЛЕНО: Создание безопасной игры с балансировкой
function createSecureSlotGame(betAmount) {
  const randomBytes = crypto.randomBytes(32);
  const gameId = randomBytes.toString('hex');
  
  // Генерируем 15 символов (3x5)
  let symbols = [];
  for (let i = 0; i < 15; i++) {
    symbols.push(generateSymbol());
  }
  
  // ДОБАВЛЕНО: Балансируем результат
  symbols = balanceGameResult(symbols, betAmount);
  
  return {
    gameId,
    symbols,
    timestamp: Date.now(),
    betAmount
  };
}

// Функция получения лимитов (как в космических напёрстках)
async function getGameLimits(telegramId) {
  console.log('🎰 Getting slot game limits for:', telegramId);
  
  const telegramIdBigInt = parseInt(telegramId);
  
  let limitsResult = await pool.query(`
    SELECT daily_games, daily_ads_watched, last_reset_date 
    FROM player_game_limits 
    WHERE telegram_id = $1 AND game_type = 'galactic_slots'
  `, [telegramIdBigInt]);

  if (limitsResult.rows.length === 0) {
    await pool.query(`
      INSERT INTO player_game_limits (telegram_id, game_type, daily_games, daily_ads_watched, last_reset_date)
      VALUES ($1, 'galactic_slots', 0, 0, CURRENT_DATE)
    `, [telegramIdBigInt]);
    console.log('🎰 Created new slot limits record for player:', telegramId);
    return { dailyGames: 0, dailyAds: 0 };
  }

  const limits = limitsResult.rows[0];
  const lastResetDate = limits.last_reset_date;
  
  const needsReset = await pool.query(`
    SELECT CASE 
      WHEN $1::date < CURRENT_DATE THEN true 
      ELSE false 
    END as needs_reset
  `, [lastResetDate]);
  
  const shouldReset = needsReset.rows[0].needs_reset;
  
  if (shouldReset) {
    console.log('🎰 Resetting slot limits - detected new day');
    await pool.query(`
      UPDATE player_game_limits 
      SET daily_games = 0, daily_ads_watched = 0, last_reset_date = CURRENT_DATE
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramIdBigInt]);
    return { dailyGames: 0, dailyAds: 0 };
  }

  console.log('🎰 Same day - using existing slot limits:', { 
    dailyGames: limits.daily_games, 
    dailyAds: limits.daily_ads_watched 
  });
  
  return { 
    dailyGames: limits.daily_games, 
    dailyAds: limits.daily_ads_watched 
  };
}

// Расчет доступных игр
function calculateGamesAvailable(dailyGames, dailyAds) {
  const totalGamesAvailable = DAILY_GAME_LIMIT + Math.min(dailyAds, MAX_AD_GAMES);
  const gamesLeft = Math.max(0, totalGamesAvailable - dailyGames);
  const canPlayFree = gamesLeft > 0;
  const canWatchAd = dailyAds < MAX_AD_GAMES && gamesLeft === 0;
  
  console.log('🎰 Slots games calculation:', {
    dailyGames,
    dailyAds,
    totalGamesAvailable,
    gamesLeft,
    canPlayFree,
    canWatchAd
  });
  
  return { gamesLeft, canPlayFree, canWatchAd };
}

// Получить статус игры
router.get('/status/:telegramId', async (req, res) => {
  try {
    console.log('🎰 Galactic slots status request for:', req.params.telegramId);
    const { telegramId } = req.params;
    
    const telegramIdBigInt = parseInt(telegramId);
    
    const { dailyGames, dailyAds } = await getGameLimits(telegramId);
    const { gamesLeft, canPlayFree, canWatchAd } = calculateGamesAvailable(dailyGames, dailyAds);

    // Получаем статистику игрока
    const statsResult = await pool.query(`
      SELECT total_games, total_wins, total_losses, total_bet, total_won, best_streak, worst_streak
      FROM minigames_stats 
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramIdBigInt]);

    const stats = statsResult.rows[0] || {
      total_games: 0,
      total_wins: 0,
      total_losses: 0,
      total_bet: 0,
      total_won: 0,
      best_streak: 0,
      worst_streak: 0
    };

    // Получаем баланс игрока
    const balanceResult = await pool.query(
      'SELECT ccc FROM players WHERE telegram_id = $1',
      [telegramId]
    );

    const balance = balanceResult.rows[0]?.ccc || 0;

    console.log('🎰 Galactic slots status response:', { 
      balance: parseFloat(balance), 
      dailyGames, 
      dailyAds,
      gamesLeft,
      canPlayFree,
      canWatchAd
    });

    res.json({
      success: true,
      balance: parseFloat(balance),
      dailyGames,
      dailyAds,
      canPlayFree,
      canWatchAd,
      gamesLeft,
      adsLeft: Math.max(0, MAX_AD_GAMES - dailyAds),
      minBet: MIN_BET,
      maxBet: MAX_BET,
      stats
    });

  } catch (error) {
    console.error('🎰❌ Galactic slots status error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Крутить слоты
router.post('/spin/:telegramId', async (req, res) => {
  try {
    console.log('🎰 Starting galactic slots spin for:', req.params.telegramId, 'Bet:', req.body.betAmount);
    const { telegramId } = req.params;
    const { betAmount } = req.body;

    // Валидация ставки
    if (!betAmount || betAmount < MIN_BET || betAmount > MAX_BET) {
      console.log('🎰❌ Invalid bet amount:', betAmount);
      return res.status(400).json({
        success: false,
        error: `Ставка должна быть от ${MIN_BET} до ${MAX_BET} CCC`
      });
    }

    const telegramIdBigInt = parseInt(telegramId);

    await pool.query('BEGIN');

    try {
      // Проверка баланса и списание ставки
      const balanceResult = await pool.query(
        'SELECT ccc FROM players WHERE telegram_id = $1',
        [telegramId]
      );

      if (balanceResult.rows.length === 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Игрок не найден'
        });
      }

      const currentBalance = parseFloat(balanceResult.rows[0].ccc);
      console.log('🎰 Player balance:', currentBalance, 'Bet:', betAmount);
      
      if (currentBalance < betAmount) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Недостаточно средств'
        });
      }

      // Проверяем лимиты
      const { dailyGames, dailyAds } = await getGameLimits(telegramId);
      const { canPlayFree } = calculateGamesAvailable(dailyGames, dailyAds);
      
      if (!canPlayFree) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Лимит игр исчерпан. Посмотрите рекламу для получения дополнительных игр.'
        });
      }

      // Списываем ставку
      await pool.query(
        'UPDATE players SET ccc = ccc - $1 WHERE telegram_id = $2',
        [betAmount, telegramId]
      );

      // ИСПРАВЛЕНО: Создаем сбалансированную игру
      const game = createSecureSlotGame(betAmount);
      const { totalWin, winningLines } = calculateWinnings(game.symbols, betAmount);
      
      const isWin = totalWin > 0;
      const profit = totalWin - betAmount;

      console.log('🎰 Slot result (BALANCED):', { 
        symbols: game.symbols,
        totalWin,
        profit,
        multiplier: (totalWin / betAmount).toFixed(2),
        winningLines: winningLines.length
      });

      // Начисляем выигрыш если есть
      if (isWin) {
        await pool.query(
          'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2',
          [totalWin, telegramId]
        );
        console.log('🎰✅ Win! Added to balance:', totalWin);
      }

      // Обновляем джекпот при проигрыше
      let jackpotContribution = 0;
      if (!isWin) {
        jackpotContribution = Math.floor(betAmount * JACKPOT_CONTRIBUTION);
        
        await pool.query(`
          UPDATE jackpot 
          SET current_amount = current_amount + $1, 
              total_contributed = total_contributed + $1, 
              updated_at = CURRENT_TIMESTAMP
          WHERE id = 1
        `, [jackpotContribution]);
        
        console.log('🎰💰 Added to jackpot:', jackpotContribution);
      }

      // Сохраняем в историю
      await pool.query(`
        INSERT INTO minigames_history (telegram_id, game_type, bet_amount, win_amount, game_result, jackpot_contribution)
        VALUES ($1, 'galactic_slots', $2, $3, $4, $5)
      `, [telegramIdBigInt, betAmount, totalWin, JSON.stringify({
        gameId: game.gameId,
        symbols: game.symbols,
        winningLines,
        totalWin,
        profit,
        timestamp: game.timestamp
      }), jackpotContribution]);

      // Обновляем статистику
      await pool.query(`
        INSERT INTO minigames_stats (telegram_id, game_type, total_games, total_wins, total_losses, total_bet, total_won, best_streak, worst_streak)
        VALUES ($1, 'galactic_slots', 1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (telegram_id, game_type)
        DO UPDATE SET
          total_games = minigames_stats.total_games + 1,
          total_wins = minigames_stats.total_wins + $2,
          total_losses = minigames_stats.total_losses + $3,
          total_bet = minigames_stats.total_bet + $4,
          total_won = minigames_stats.total_won + $5,
          best_streak = GREATEST(minigames_stats.best_streak, $6),
          worst_streak = LEAST(minigames_stats.worst_streak, $7),
          updated_at = CURRENT_TIMESTAMP
      `, [telegramIdBigInt, isWin ? 1 : 0, isWin ? 0 : 1, betAmount, totalWin, 0, 0]);

      // Обновляем лимиты игр
      await pool.query(`
        UPDATE player_game_limits 
        SET daily_games = daily_games + 1
        WHERE telegram_id = $1 AND game_type = 'galactic_slots'
      `, [telegramIdBigInt]);

      await pool.query('COMMIT');

      console.log('🎰✅ Slot spin completed successfully');
      res.json({
        success: true,
        result: {
          gameId: game.gameId,
          symbols: game.symbols,
          winningLines,
          totalWin,
          profit,
          isWin,
          betAmount
        }
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('🎰❌ Galactic slots spin error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Посмотреть рекламу за дополнительную игру
router.post('/watch-ad/:telegramId', async (req, res) => {
  try {
    console.log('🎰 Watch ad request for slots:', req.params.telegramId);
    const { telegramId } = req.params;

    const { dailyGames, dailyAds } = await getGameLimits(telegramId);
    
    console.log('🎰 Current slot limits before ad:', { dailyGames, dailyAds });
    
    if (dailyAds >= MAX_AD_GAMES) {
      console.log('🎰❌ Slot ad limit exceeded:', dailyAds, '>=', MAX_AD_GAMES);
      return res.status(400).json({
        success: false,
        error: 'Дневной лимит рекламы исчерпан (20/20)',
        adsRemaining: 0
      });
    }
    
    const totalGamesPlayed = dailyGames;
    const maxTotalGames = DAILY_GAME_LIMIT + MAX_AD_GAMES;
    
    if (totalGamesPlayed >= maxTotalGames) {
      console.log('🎰❌ Total slot games limit exceeded:', totalGamesPlayed, '>=', maxTotalGames);
      return res.status(400).json({
        success: false,
        error: 'Максимальный дневной лимит игр исчерпан (25 игр)',
        adsRemaining: 0
      });
    }

    // Увеличиваем счетчик рекламы
    const telegramIdBigInt = parseInt(telegramId);
    await pool.query(`
      UPDATE player_game_limits 
      SET daily_ads_watched = daily_ads_watched + 1
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramIdBigInt]);

    const newAdsWatched = dailyAds + 1;
    const adsRemaining = MAX_AD_GAMES - newAdsWatched;

    console.log('🎰✅ Slot ad watched successfully! New stats:', {
      adsWatched: newAdsWatched,
      adsRemaining,
      maxAds: MAX_AD_GAMES
    });

    res.json({
      success: true,
      adsRemaining,
      adsWatched: newAdsWatched,
      maxAds: MAX_AD_GAMES,
      message: `Получена дополнительная игра в слоты! (${newAdsWatched}/${MAX_AD_GAMES})`
    });

  } catch (error) {
    console.error('🎰❌ Watch ad slots error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Получить историю игр
router.get('/history/:telegramId', async (req, res) => {
  try {
    console.log('🎰 Getting slot history for:', req.params.telegramId);
    const { telegramId } = req.params;
    const { limit = 20, offset = 0 } = req.query;

    const telegramIdBigInt = parseInt(telegramId);

    const historyResult = await pool.query(`
      SELECT 
        id,
        bet_amount,
        win_amount,
        game_result,
        jackpot_contribution,
        created_at,
        CASE 
          WHEN win_amount > bet_amount THEN 'win'
          ELSE 'loss'
        END as result_type
      FROM minigames_history 
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
      ORDER BY created_at DESC 
      LIMIT $2 OFFSET $3
    `, [telegramIdBigInt, limit, offset]);

    const formattedHistory = historyResult.rows.map(game => {
      const gameData = game.game_result;
      return {
        id: game.id,
        date: game.created_at,
        betAmount: parseInt(game.bet_amount),
        winAmount: parseInt(game.win_amount || 0),
        profit: parseInt(game.win_amount || 0) - parseInt(game.bet_amount),
        result: game.result_type,
        symbols: gameData.symbols || [],
        winningLines: gameData.winningLines || [],
        jackpotContribution: parseInt(game.jackpot_contribution || 0)
      };
    });

    const totalResult = await pool.query(`
      SELECT COUNT(*) as total_games
      FROM minigames_history 
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramIdBigInt]);

    console.log('🎰 Slot history response:', { 
      total: parseInt(totalResult.rows[0].total_games),
      games: formattedHistory.length 
    });

    res.json({
      success: true,
      history: formattedHistory,
      total: parseInt(totalResult.rows[0].total_games),
      hasMore: (parseInt(offset) + formattedHistory.length) < parseInt(totalResult.rows[0].total_games)
    });

  } catch (error) {
    console.error('🎰❌ Slot history error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;