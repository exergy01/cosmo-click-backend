const express = require('express');
const router = express.Router();
const pool = require('../../db');
const crypto = require('crypto');

// Константы игры
const MIN_BET = 100;
const MAX_BET = 5000;
const DAILY_GAME_LIMIT = 50;
const MAX_AD_GAMES = 10;
const GAMES_PER_AD = 20;
const JACKPOT_CONTRIBUTION = 0.001; // 0.1%

// 20 линий выплат
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

// Символы и их множители
const SYMBOLS = {
  '🌟': { id: 'wild', multipliers: [0.25, 0.6, 1.2], isWild: true },
  '🚀': { id: 'ship', multipliers: [0.15, 0.4, 1.0] },
  '🌌': { id: 'galaxy', multipliers: [0.12, 0.35, 0.8] },
  '⭐': { id: 'star', multipliers: [0.08, 0.2, 0.5] },
  '🌍': { id: 'planet', multipliers: [0.06, 0.15, 0.3] },
  '☄️': { id: 'asteroid', multipliers: [0.04, 0.1, 0.2] },
  '🛸': { id: 'void', multipliers: [0, 0, 0], isDead: true }
};

const SYMBOL_KEYS = Object.keys(SYMBOLS);
const ALIVE_SYMBOLS = SYMBOL_KEYS.filter(s => !SYMBOLS[s].isDead);

// Вероятности
const WIN_PROBABILITY = 0.35; // 35% шанс выигрыша

// Логика генерации
function willHaveWin() {
  return Math.random() < WIN_PROBABILITY;
}

function selectWinningLinesCount() {
  const random = Math.random();
  if (random < 0.85) return 1;
  if (random < 0.96) return 2;
  if (random < 0.99) return 3;
  return 4;
}

function selectSymbolForLine() {
  const random = Math.random();
  if (random < 0.5) return '☄️';
  if (random < 0.75) return '🌍';
  if (random < 0.88) return '⭐';
  if (random < 0.95) return '🌌';
  if (random < 0.99) return '🚀';
  return '🌟';
}

function selectComboLength() {
  const random = Math.random();
  if (random < 0.9) return 3;
  if (random < 0.98) return 4;
  return 5;
}

// Генерация поля
function generateSmartField(betAmount) {
  const hasWin = willHaveWin();
  const field = Array(15).fill(null);
  const plannedWins = [];
  
  if (hasWin) {
    const linesCount = selectWinningLinesCount();
    
    for (let i = 0; i < linesCount; i++) {
      const symbol = selectSymbolForLine();
      const length = selectComboLength();
      
      const availableLines = PAYLINES.filter((line, index) => {
        return !line.slice(0, length).some(pos => field[pos] !== null);
      });
      
      if (availableLines.length > 0) {
        const selectedLine = availableLines[Math.floor(Math.random() * availableLines.length)];
        
        for (let j = 0; j < length; j++) {
          field[selectedLine[j]] = symbol;
        }
        
        plannedWins.push({
          line: PAYLINES.indexOf(selectedLine) + 1,
          symbol,
          length,
          positions: selectedLine.slice(0, length)
        });
      }
    }
  }
  
  // Заполняем остальные позиции
  for (let i = 0; i < 15; i++) {
    if (field[i] === null) {
      field[i] = ALIVE_SYMBOLS[Math.floor(Math.random() * ALIVE_SYMBOLS.length)];
    }
  }
  
  // Добавляем мертвые символы
  const deadSymbolsCount = 2 + Math.floor(Math.random() * 2);
  
  for (let i = 0; i < deadSymbolsCount; i++) {
    let attempts = 0;
    let placed = false;
    
    while (!placed && attempts < 20) {
      const randomPos = Math.floor(Math.random() * 15);
      if (!plannedWins.some(win => win.positions.includes(randomPos)) && field[randomPos] !== '🛸') {
        field[randomPos] = '🛸';
        placed = true;
      }
      attempts++;
    }
  }
  
  return field;
}

// Расчет выигрышей
function calculateFieldWinnings(symbols, betAmount) {
  let totalWin = 0;
  const winningLines = [];
  
  for (let i = 0; i < PAYLINES.length; i++) {
    const line = PAYLINES[i];
    const lineSymbols = line.map(pos => symbols[pos]);
    
    let matchCount = 1;
    let matchSymbol = lineSymbols[0];
    let hasWild = false;
    
    if (SYMBOLS[matchSymbol]?.isDead) continue;
    
    if (SYMBOLS[matchSymbol]?.isWild) {
      hasWild = true;
      for (let j = 1; j < lineSymbols.length; j++) {
        if (!SYMBOLS[lineSymbols[j]]?.isWild && !SYMBOLS[lineSymbols[j]]?.isDead) {
          matchSymbol = lineSymbols[j];
          break;
        }
      }
    }
    
    for (let j = 1; j < lineSymbols.length; j++) {
      const currentSymbol = lineSymbols[j];
      
      if (SYMBOLS[currentSymbol]?.isDead) break;
      
      if (currentSymbol === matchSymbol || SYMBOLS[currentSymbol]?.isWild) {
        if (SYMBOLS[currentSymbol]?.isWild) hasWild = true;
        matchCount++;
      } else {
        break;
      }
    }
    
    if (matchCount >= 3 && SYMBOLS[matchSymbol] && !SYMBOLS[matchSymbol].isDead) {
      const multiplierIndex = Math.min(matchCount - 3, SYMBOLS[matchSymbol].multipliers.length - 1);
      let lineWin = betAmount * SYMBOLS[matchSymbol].multipliers[multiplierIndex];
      
      if (hasWild) {
        lineWin *= 2;
      }
      
      totalWin += lineWin;
      winningLines.push({
        line: i + 1,
        symbol: matchSymbol,
        count: matchCount,
        multiplier: SYMBOLS[matchSymbol].multipliers[multiplierIndex],
        hasWild: hasWild,
        winAmount: lineWin
      });
    }
  }
  
  return { totalWin, winningLines };
}

// Создание игры
function createSecureSlotGame(betAmount) {
  const randomBytes = crypto.randomBytes(32);
  const gameId = randomBytes.toString('hex');
  
  const symbols = generateSmartField(betAmount);
  const { totalWin, winningLines } = calculateFieldWinnings(symbols, betAmount);
  
  return {
    gameId,
    symbols,
    winningLines,
    totalWin,
    timestamp: Date.now(),
    betAmount
  };
}

// Получение лимитов
async function getGameLimits(telegramId) {
  let limitsResult = await pool.query(`
    SELECT daily_games, daily_ads_watched, last_reset_date 
    FROM player_game_limits 
    WHERE telegram_id = $1 AND game_type = 'galactic_slots'
  `, [telegramId]);

  if (limitsResult.rows.length === 0) {
    await pool.query(`
      INSERT INTO player_game_limits (telegram_id, game_type, daily_games, daily_ads_watched, last_reset_date)
      VALUES ($1, 'galactic_slots', 0, 0, CURRENT_DATE)
    `, [telegramId]);
    return { dailyGames: 0, dailyAds: 0 };
  }

  const limits = limitsResult.rows[0];
  const needsReset = await pool.query(`
    SELECT CASE 
      WHEN $1::date < CURRENT_DATE THEN true 
      ELSE false 
    END as needs_reset
  `, [limits.last_reset_date]);
  
  if (needsReset.rows[0].needs_reset) {
    await pool.query(`
      UPDATE player_game_limits 
      SET daily_games = 0, daily_ads_watched = 0, last_reset_date = CURRENT_DATE
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramId]);
    return { dailyGames: 0, dailyAds: 0 };
  }
  
  return { 
    dailyGames: limits.daily_games, 
    dailyAds: limits.daily_ads_watched 
  };
}

// Расчет доступных игр
function calculateGamesAvailable(dailyGames, dailyAds) {
  const totalGamesAvailable = DAILY_GAME_LIMIT + (dailyAds * GAMES_PER_AD);
  const gamesLeft = Math.max(0, totalGamesAvailable - dailyGames);
  const canPlayFree = gamesLeft > 0;
  const canWatchAd = dailyAds < MAX_AD_GAMES && gamesLeft === 0;
  
  return { gamesLeft, canPlayFree, canWatchAd };
}

// Получить статус игры
router.get('/status/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    const { dailyGames, dailyAds } = await getGameLimits(telegramId);
    const { gamesLeft, canPlayFree, canWatchAd } = calculateGamesAvailable(dailyGames, dailyAds);

    // Получаем статистику
    const statsResult = await pool.query(`
      SELECT total_games, total_wins, total_losses, total_bet, total_won, best_streak, worst_streak
      FROM minigames_stats 
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramId]);

    const stats = statsResult.rows[0] || {
      total_games: 0, total_wins: 0, total_losses: 0,
      total_bet: 0, total_won: 0, best_streak: 0, worst_streak: 0
    };

    // Получаем баланс
    const balanceResult = await pool.query(
      'SELECT ccc FROM players WHERE telegram_id = $1',
      [telegramId]
    );

    const balance = balanceResult.rows[0]?.ccc || 0;

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
    console.error('Galactic slots status error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Крутить слоты
router.post('/spin/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { betAmount } = req.body;

    const parsedBetAmount = Number(betAmount);
    if (!parsedBetAmount || isNaN(parsedBetAmount) || parsedBetAmount < MIN_BET || parsedBetAmount > MAX_BET) {
      return res.status(400).json({
        success: false,
        error: `Ставка должна быть от ${MIN_BET} до ${MAX_BET} CCC`
      });
    }

    await pool.query('BEGIN');

    try {
      // Проверка баланса
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
      
      if (currentBalance < parsedBetAmount) {
        await pool.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'Недостаточно средств'
        });
      }

      // Проверка лимитов
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
        [parsedBetAmount, telegramId]
      );

      // Создаем игру
      const game = createSecureSlotGame(parsedBetAmount);
      const totalWin = game.totalWin;
      const winningLines = game.winningLines;
      
      const isWin = totalWin > 0;
      const profit = totalWin - parsedBetAmount;

      // Начисляем выигрыш
      if (isWin) {
        await pool.query(
          'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2',
          [totalWin, telegramId]
        );
      }

      // Вклад в джекпот при проигрыше
      let jackpotContribution = 0;
      if (!isWin) {
        jackpotContribution = Math.floor(parsedBetAmount * JACKPOT_CONTRIBUTION);
        
        await pool.query(`
          UPDATE jackpot 
          SET current_amount = current_amount + $1, 
              total_contributed = total_contributed + $1, 
              updated_at = CURRENT_TIMESTAMP
          WHERE id = 1
        `, [jackpotContribution]);
      }

      // Сохраняем в историю
      await pool.query(`
        INSERT INTO minigames_history (telegram_id, game_type, bet_amount, win_amount, game_result, jackpot_contribution, created_at)
        VALUES ($1, 'galactic_slots', $2, $3, $4, $5, CURRENT_TIMESTAMP)
      `, [telegramId, parsedBetAmount, totalWin, JSON.stringify({
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
      `, [telegramId, isWin ? 1 : 0, isWin ? 0 : 1, parsedBetAmount, totalWin, 0, 0]);

      // Обновляем лимиты
      await pool.query(`
        UPDATE player_game_limits 
        SET daily_games = daily_games + 1
        WHERE telegram_id = $1 AND game_type = 'galactic_slots'
      `, [telegramId]);

      await pool.query('COMMIT');

      res.json({
        success: true,
        result: {
          gameId: game.gameId,
          symbols: game.symbols,
          winningLines,
          totalWin,
          profit,
          isWin,
          betAmount: parsedBetAmount
        }
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('Galactic slots spin error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Просмотр рекламы
router.post('/watch-ad/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;

    const { dailyGames, dailyAds } = await getGameLimits(telegramId);
    
    if (dailyAds >= MAX_AD_GAMES) {
      return res.status(400).json({
        success: false,
        error: `Дневной лимит рекламы исчерпан (${MAX_AD_GAMES}/${MAX_AD_GAMES})`,
        adsRemaining: 0
      });
    }
    
    const totalGamesPlayed = dailyGames;
    const maxTotalGames = DAILY_GAME_LIMIT + (MAX_AD_GAMES * GAMES_PER_AD);
    
    if (totalGamesPlayed >= maxTotalGames) {
      return res.status(400).json({
        success: false,
        error: `Максимальный дневной лимит игр исчерпан (${maxTotalGames} игр)`,
        adsRemaining: 0
      });
    }

    // Увеличиваем счетчик рекламы
    await pool.query(`
      UPDATE player_game_limits 
      SET daily_ads_watched = daily_ads_watched + 1
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramId]);

    const newAdsWatched = dailyAds + 1;
    const adsRemaining = MAX_AD_GAMES - newAdsWatched;

    res.json({
      success: true,
      adsRemaining,
      adsWatched: newAdsWatched,
      maxAds: MAX_AD_GAMES,
      message: `Получено ${GAMES_PER_AD} дополнительных игр в слоты! (${newAdsWatched}/${MAX_AD_GAMES})`
    });

  } catch (error) {
    console.error('Watch ad slots error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// История игр
router.get('/history/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    
    const historyResult = await pool.query(`
      SELECT 
        id, bet_amount, win_amount, game_result, jackpot_contribution, created_at,
        CASE WHEN win_amount > bet_amount THEN 'win' ELSE 'loss' END as result_type
      FROM minigames_history 
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
      ORDER BY created_at DESC
    `, [telegramId]);

    const totalResult = await pool.query(`
      SELECT COUNT(*) as total_games
      FROM minigames_history 
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramId]);

    const totalGames = parseInt(totalResult.rows[0].total_games);
    const history = historyResult.rows.map(game => ({
      id: game.id,
      date: game.created_at,
      betAmount: parseInt(game.bet_amount),
      winAmount: parseInt(game.win_amount || 0),
      profit: parseInt(game.win_amount || 0) - parseInt(game.bet_amount),
      result: game.result_type,
      symbols: game.game_result?.symbols || [],
      winningLines: game.game_result?.winningLines || [],
      jackpotContribution: parseInt(game.jackpot_contribution || 0)
    }));

    res.json({
      success: true,
      history,
      total: totalGames
    });

  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;