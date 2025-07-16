const express = require('express');
const router = express.Router();
const pool = require('../../db');
const crypto = require('crypto');

// Константы игры
const MIN_BET = 100;
const MAX_BET = 5000;
const DAILY_GAME_LIMIT = 50; // ИСПРАВЛЕНО: 50 базовых игр
const MAX_AD_GAMES = 200; // 200 дополнительных игр за рекламу
const JACKPOT_CONTRIBUTION = 0.001; // 0.1%

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

// ✅ ИСПРАВЛЕНО: Увеличенные коэффициенты для лучшего RTP
const SYMBOLS = {
  '🌟': { id: 'wild', multipliers: [0.3, 0.7, 1.5], isWild: true },    // WILD - увеличено
  '🚀': { id: 'ship', multipliers: [0.2, 0.5, 1.2] },                 // Корабль - увеличено
  '🌌': { id: 'galaxy', multipliers: [0.15, 0.4, 1.0] },              // Галактика - увеличено
  '⭐': { id: 'star', multipliers: [0.1, 0.25, 0.6] },                 // Звезда - увеличено
  '🌍': { id: 'planet', multipliers: [0.08, 0.2, 0.4] },              // Планета - увеличено
  '☄️': { id: 'asteroid', multipliers: [0.05, 0.15, 0.25] },          // Астероид - увеличено
  '💀': { id: 'void', multipliers: [0, 0, 0], isDead: true }           // МЕРТВЫЙ
};

const SYMBOL_KEYS = Object.keys(SYMBOLS);
const ALIVE_SYMBOLS = SYMBOL_KEYS.filter(s => !SYMBOLS[s].isDead);

// ✅ ИСПРАВЛЕНО: Снижен шанс выигрыша с 60% до 25%
const WIN_PROBABILITY = 0.25; // 25% шанс что будет ХОТЬ КАКОЙ-ТО выигрыш

// ✅ ИСПРАВЛЕНО: Определение будет ли выигрыш
function willHaveWin() {
  return Math.random() < WIN_PROBABILITY; // 25% шанс на ЛЮБОЙ выигрыш
}

// ✅ ИСПРАВЛЕНО: Выбор количества выигрышных линий (больше акцент на 1 линию)
function selectWinningLinesCount() {
  const random = Math.random();
  if (random < 0.8) return 1;      // 80% - одна линия
  if (random < 0.95) return 2;     // 15% - две линии  
  if (random < 0.99) return 3;     // 4% - три линии
  return 4;                        // 1% - четыре линии (убрали 5 линий)
}

// ✅ ИСПРАВЛЕНО: Выбор символа для линии (меньше дешевых символов)
function selectSymbolForLine() {
  const random = Math.random();
  
  // Лучший баланс символов
  if (random < 0.35) return '☄️';      // 35% - астероид (дешевый)
  if (random < 0.6) return '🌍';       // 25% - планета
  if (random < 0.8) return '⭐';       // 20% - звезда
  if (random < 0.92) return '🌌';      // 12% - галактика
  if (random < 0.98) return '🚀';      // 6% - корабль
  return '🌟';                         // 2% - WILD (дорогой)
}

// ✅ ИСПРАВЛЕНО: Выбор длины комбинации (больше коротких)
function selectComboLength() {
  const random = Math.random();
  if (random < 0.85) return 3;       // 85% - короткая комбинация (3 символа)
  if (random < 0.98) return 4;       // 13% - средняя комбинация (4 символа)
  return 5;                          // 2% - длинная комбинация (5 символов)
}

// ✅ ИСПРАВЛЕНО: Умная генерация поля с правильной экономикой
function generateSmartField(betAmount) {
  console.log('🎰 ИСПРАВЛЕННАЯ ЛОГИКА: Starting smart field generation...');
  
  // Шаг 1: Решаем будет ли выигрыш (25% шанс)
  const hasWin = willHaveWin();
  console.log('🎰 Will have win:', hasWin, '(25% chance)');
  
  // Инициализируем пустое поле
  const field = Array(15).fill(null);
  const plannedWins = [];
  
  if (hasWin) {
    // Шаг 2: Выбираем количество линий (1-4, акцент на 1)
    const linesCount = selectWinningLinesCount();
    console.log('🎰 Winning lines count:', linesCount);
    
    // Шаг 3: Для каждой линии выбираем символ и длину
    for (let i = 0; i < linesCount; i++) {
      const symbol = selectSymbolForLine();
      const length = selectComboLength();
      
      console.log(`🎰 Line ${i + 1}: ${symbol} x${length}`);
      
      // Шаг 4: Размещаем выигрышные символы на линиях
      const availableLines = PAYLINES.filter((line, index) => {
        // Проверяем что линия не пересекается с уже размещенными
        return !line.slice(0, length).some(pos => field[pos] !== null);
      });
      
      if (availableLines.length > 0) {
        const selectedLine = availableLines[Math.floor(Math.random() * availableLines.length)];
        
        // Размещаем символы
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
  
  // Шаг 5: Заполняем остальные позиции безопасными символами
  for (let i = 0; i < 15; i++) {
    if (field[i] === null) {
      field[i] = getSecureSymbol(field, i);
    }
  }
  
  // Шаг 6: Добавляем 1-2 мертвых символа (меньше чем было)
  const deadSymbolsCount = 1 + Math.floor(Math.random() * 2); // 1 или 2 (было 2-4)
  
  console.log('🎰 Adding dead symbols:', deadSymbolsCount);
  
  for (let i = 0; i < deadSymbolsCount; i++) {
    let attempts = 0;
    let placed = false;
    
    while (!placed && attempts < 20) {
      const randomPos = Math.floor(Math.random() * 15);
      // НЕ размещаем на выигрышных позициях
      if (!plannedWins.some(win => win.positions.includes(randomPos)) && field[randomPos] !== '💀') {
        field[randomPos] = '💀';
        console.log('🎰 Placed dead symbol at position:', randomPos);
        placed = true;
      }
      attempts++;
    }
  }
  
  console.log('🎰 Generated field:', field);
  console.log('🎰 Planned wins:', plannedWins);
  
  return field;
}

// Безопасный выбор символа
function getSecureSymbol(field, position) {
  return ALIVE_SYMBOLS[Math.floor(Math.random() * ALIVE_SYMBOLS.length)];
}

// Проверка выигрышей на готовом поле
function calculateFieldWinnings(symbols, betAmount) {
  let totalWin = 0;
  const winningLines = [];
  
  for (let i = 0; i < PAYLINES.length; i++) {
    const line = PAYLINES[i];
    const lineSymbols = line.map(pos => symbols[pos]);
    
    // Проверяем комбинацию слева направо
    let matchCount = 1;
    let matchSymbol = lineSymbols[0];
    let hasWild = false;
    
    // Пропускаем мертвые символы
    if (SYMBOLS[matchSymbol]?.isDead) continue;
    
    // Если первый символ WILD
    if (SYMBOLS[matchSymbol]?.isWild) {
      hasWild = true;
      // Ищем первый не-WILD символ
      for (let j = 1; j < lineSymbols.length; j++) {
        if (!SYMBOLS[lineSymbols[j]]?.isWild && !SYMBOLS[lineSymbols[j]]?.isDead) {
          matchSymbol = lineSymbols[j];
          break;
        }
      }
    }
    
    // Считаем совпадения
    for (let j = 1; j < lineSymbols.length; j++) {
      const currentSymbol = lineSymbols[j];
      
      if (SYMBOLS[currentSymbol]?.isDead) break; // Мертвый символ прерывает линию
      
      if (currentSymbol === matchSymbol || SYMBOLS[currentSymbol]?.isWild) {
        if (SYMBOLS[currentSymbol]?.isWild) hasWild = true;
        matchCount++;
      } else {
        break;
      }
    }
    
    // Проверяем выигрыш (минимум 3 символа)
    if (matchCount >= 3 && SYMBOLS[matchSymbol] && !SYMBOLS[matchSymbol].isDead) {
      const multiplierIndex = Math.min(matchCount - 3, SYMBOLS[matchSymbol].multipliers.length - 1);
      let lineWin = betAmount * SYMBOLS[matchSymbol].multipliers[multiplierIndex];
      
      // WILD удваивает выигрыш
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

// Создание игры с умной логикой
function createSecureSlotGame(betAmount) {
  const randomBytes = crypto.randomBytes(32);
  const gameId = randomBytes.toString('hex');
  
  console.log('🎰 Creating secure slot game for bet:', betAmount);
  
  // Генерируем умное поле
  const symbols = generateSmartField(betAmount);
  
  // Проверяем итоговые выигрыши
  const { totalWin, winningLines } = calculateFieldWinnings(symbols, betAmount);
  
  console.log('🎰 Final game result:', {
    gameId: gameId.substring(0, 8),
    totalWin,
    winRatio: (totalWin / betAmount).toFixed(2),
    winningLines: winningLines.length,
    symbols: symbols,
    expectedRTP: '~75%'
  });
  
  return {
    gameId,
    symbols,
    winningLines,
    totalWin,
    timestamp: Date.now(),
    betAmount
  };
}

// Безопасное получение лимитов
async function getGameLimits(telegramId) {
  console.log('🎰 Getting slot game limits for:', telegramId);
  
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
    `, [telegramId]);
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

// ✅ ИСПРАВЛЕНО: Правильный расчет доступных игр
function calculateGamesAvailable(dailyGames, dailyAds) {
  const totalGamesAvailable = DAILY_GAME_LIMIT + Math.min(dailyAds, MAX_AD_GAMES);
  const gamesLeft = Math.max(0, totalGamesAvailable - dailyGames);
  const canPlayFree = gamesLeft > 0;
  const canWatchAd = dailyAds < MAX_AD_GAMES && gamesLeft === 0;
  
  console.log('🎰 ИСПРАВЛЕННЫЙ расчет игр (250 MAX):', {
    dailyGames,
    dailyAds,
    totalGamesAvailable,
    gamesLeft,
    canPlayFree,
    canWatchAd,
    maxTotalGames: DAILY_GAME_LIMIT + MAX_AD_GAMES
  });
  
  return { gamesLeft, canPlayFree, canWatchAd };
}

// Получить статус игры
router.get('/status/:telegramId', async (req, res) => {
  try {
    console.log('🎰 Galactic slots status request for:', req.params.telegramId);
    const { telegramId } = req.params;
    
    const { dailyGames, dailyAds } = await getGameLimits(telegramId);
    const { gamesLeft, canPlayFree, canWatchAd } = calculateGamesAvailable(dailyGames, dailyAds);

    // Получаем статистику игрока
    const statsResult = await pool.query(`
      SELECT total_games, total_wins, total_losses, total_bet, total_won, best_streak, worst_streak
      FROM minigames_stats 
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramId]);

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
      canWatchAd,
      expectedRTP: '~75%'
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

// Крутить слоты с улучшенной валидацией
router.post('/spin/:telegramId', async (req, res) => {
  try {
    console.log('🎰 Starting galactic slots spin for:', req.params.telegramId, 'Bet:', req.body.betAmount);
    const { telegramId } = req.params;
    const { betAmount } = req.body;

    const parsedBetAmount = Number(betAmount);
    if (!parsedBetAmount || isNaN(parsedBetAmount) || parsedBetAmount < MIN_BET || parsedBetAmount > MAX_BET) {
      console.log('🎰❌ Invalid bet amount:', betAmount, 'parsed:', parsedBetAmount);
      return res.status(400).json({
        success: false,
        error: `Ставка должна быть от ${MIN_BET} до ${MAX_BET} CCC`
      });
    }

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
      console.log('🎰 Player balance:', currentBalance, 'Bet:', parsedBetAmount);
      
      if (currentBalance < parsedBetAmount) {
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
        [parsedBetAmount, telegramId]
      );

      // ✅ ИСПРАВЛЕНО: Создаем игру с новой экономикой
      const game = createSecureSlotGame(parsedBetAmount);
      const totalWin = game.totalWin;
      const winningLines = game.winningLines;
      
      const isWin = totalWin > 0;
      const profit = totalWin - parsedBetAmount;

      console.log('🎰 ИСПРАВЛЕННЫЙ slot result:', { 
        symbols: game.symbols,
        totalWin,
        profit,
        multiplier: (totalWin / parsedBetAmount).toFixed(2),
        winningLines: winningLines.length,
        expectedRTP: '~75%'
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
        jackpotContribution = Math.floor(parsedBetAmount * JACKPOT_CONTRIBUTION);
        
        await pool.query(`
          UPDATE jackpot 
          SET current_amount = current_amount + $1, 
              total_contributed = total_contributed + $1, 
              updated_at = CURRENT_TIMESTAMP
          WHERE id = 1
        `, [jackpotContribution]);
        
        console.log('🎰💰 Added to jackpot:', jackpotContribution);
      }

      // Сохраняем в историю с серверным временем
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

      // Обновляем лимиты игр
      await pool.query(`
        UPDATE player_game_limits 
        SET daily_games = daily_games + 1
        WHERE telegram_id = $1 AND game_type = 'galactic_slots'
      `, [telegramId]);

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
          betAmount: parsedBetAmount
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

// Посмотреть рекламу
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
        error: 'Дневной лимит рекламы исчерпан (200/200)',
        adsRemaining: 0
      });
    }
    
    const totalGamesPlayed = dailyGames;
    const maxTotalGames = DAILY_GAME_LIMIT + MAX_AD_GAMES;
    
    if (totalGamesPlayed >= maxTotalGames) {
      console.log('🎰❌ Total slot games limit exceeded:', totalGamesPlayed, '>=', maxTotalGames);
      return res.status(400).json({
        success: false,
        error: 'Максимальный дневной лимит игр исчерпан (250 игр)',
        adsRemaining: 0
      });
    }

    // Увеличиваем счетчик рекламы на 1
    await pool.query(`
      UPDATE player_game_limits 
      SET daily_ads_watched = daily_ads_watched + 1
      WHERE telegram_id = $1 AND game_type = 'galactic_slots'
    `, [telegramId]);

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
    `, [telegramId, limit, offset]);

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
    `, [telegramId]);

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