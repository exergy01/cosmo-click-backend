const express = require('express');
const router = express.Router();
const pool = require('../../db');
const crypto = require('crypto');

// ✅ ИСПРАВЛЕНО: Константы игры как в слотах
const MIN_BET = 100;
const MAX_BET = 5000; // ✅ ИСПРАВЛЕНО: Как в слотах (было 100000)
const WIN_MULTIPLIER = 2;
const DAILY_GAME_LIMIT = 25; // ✅ ИСПРАВЛЕНО: 25 базовых игр как в слотах (было 5)
const MAX_AD_GAMES = 10; // ✅ ИСПРАВЛЕНО: 10 реклам как в слотах (было 20)
const GAMES_PER_AD = 20; // ✅ ИСПРАВЛЕНО: 20 игр за рекламу как в слотах (было 1)
const JACKPOT_CONTRIBUTION = 0.001; // 0.1%

// Утилита для создания безопасной игры
function createSecureGame(betAmount) {
    // Генерируем криптографически безопасный результат
    const randomBytes = crypto.randomBytes(4);
    const randomNumber = randomBytes.readUInt32BE(0);
    
    // 1 из 3 позиций содержит галактику (33.33% шанс выигрыша)
    const winningPosition = randomNumber % 3;
    const positions = [0, 1, 2];
    
    // Создаем расклад: 1 галактика + 2 черные дыры
    const gameLayout = ['blackhole', 'blackhole', 'blackhole'];
    gameLayout[winningPosition] = 'galaxy';
    
    // Создаем хеш для проверки целостности
    const gameData = {
        positions: gameLayout,
        winningPosition,
        betAmount,
        timestamp: Date.now()
    };
    
    const gameHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(gameData))
        .digest('hex');
    
    return {
        gameId: gameHash,
        positions: gameLayout,
        winningPosition,
        encrypted: true
    };
}

// Функция получения лимитов с правильной логикой дат
async function getGameLimits(telegramId) {
    if (process.env.NODE_ENV === 'development') console.log('🛸 Getting game limits for:', telegramId);
    
    let limitsResult = await pool.query(`
        SELECT daily_games, daily_ads_watched, last_reset_date 
        FROM player_game_limits 
        WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
    `, [telegramId]);

    if (limitsResult.rows.length === 0) {
        // Создаем запись для нового игрока
        await pool.query(`
            INSERT INTO player_game_limits (telegram_id, game_type, daily_games, daily_ads_watched, last_reset_date)
            VALUES ($1, 'cosmic_shells', 0, 0, CURRENT_DATE)
        `, [telegramId]);
        if (process.env.NODE_ENV === 'development') console.log('🛸 Created new limits record for player:', telegramId);
        return { dailyGames: 0, dailyAds: 0 };
    }

    const limits = limitsResult.rows[0];
    const lastResetDate = limits.last_reset_date;
    
    // Проверяем СТРОГО меньше (вчерашняя дата)
    const needsReset = await pool.query(`
        SELECT 
            $1::date as last_reset,
            CURRENT_DATE as current_date,
            CASE 
                WHEN $1::date < CURRENT_DATE THEN true 
                ELSE false 
            END as needs_reset
    `, [lastResetDate]);
    
    const resetInfo = needsReset.rows[0];
    const shouldReset = resetInfo.needs_reset;
    
    if (process.env.NODE_ENV === 'development') console.log('🛸 DETAILED Date check:', {
        lastResetDate: resetInfo.last_reset,
        currentDate: resetInfo.current_date,
        shouldReset: shouldReset,
        comparison: resetInfo.last_reset + ' < ' + resetInfo.current_date + ' = ' + shouldReset,
        currentLimits: { dailyGames: limits.daily_games, dailyAds: limits.daily_ads_watched }
    });
    
    if (shouldReset) {
        if (process.env.NODE_ENV === 'development') console.log('🛸 RESETTING limits - detected new day');
        
        await pool.query(`
            UPDATE player_game_limits 
            SET daily_games = 0, daily_ads_watched = 0, last_reset_date = CURRENT_DATE
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);
        
        return { dailyGames: 0, dailyAds: 0 };
    }

    // Тот же день - используем существующие значения
    if (process.env.NODE_ENV === 'development') console.log('🛸 SAME DAY - using existing limits:', {
        dailyGames: limits.daily_games, 
        dailyAds: limits.daily_ads_watched 
    });
    
    return { 
        dailyGames: limits.daily_games, 
        dailyAds: limits.daily_ads_watched 
    };
}

// ✅ ИСПРАВЛЕНО: Функция расчета доступных игр как в слотах (25 + 10*20 = 250)
function calculateGamesAvailable(dailyGames, dailyAds) {
    const totalGamesAvailable = DAILY_GAME_LIMIT + (dailyAds * GAMES_PER_AD);
    const gamesLeft = Math.max(0, totalGamesAvailable - dailyGames);
    const canPlayFree = gamesLeft > 0;
    const canWatchAd = dailyAds < MAX_AD_GAMES && gamesLeft === 0;
    
    if (process.env.NODE_ENV === 'development') console.log('🛸 ИСПРАВЛЕННЫЙ расчет игр (25 + 10*20 = 250 MAX):', {
        dailyGames,
        dailyAds,
        totalGamesAvailable,
        gamesLeft,
        canPlayFree,
        canWatchAd,
        maxTotalGames: DAILY_GAME_LIMIT + (MAX_AD_GAMES * GAMES_PER_AD)
    });
    
    return { gamesLeft, canPlayFree, canWatchAd };
}

// Получить статус игры (лимиты, статистика)
router.get('/status/:telegramId', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'development') console.log('🛸 Cosmic shells status request for:', req.params.telegramId);
        const { telegramId } = req.params;
        
        const { dailyGames, dailyAds } = await getGameLimits(telegramId);
        const { gamesLeft, canPlayFree, canWatchAd } = calculateGamesAvailable(dailyGames, dailyAds);

        // Получаем статистику игрока
        const statsResult = await pool.query(`
            SELECT total_games, total_wins, total_losses, total_bet, total_won, best_streak, worst_streak
            FROM minigames_stats 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
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

        if (process.env.NODE_ENV === 'development') console.log('🛸 Cosmic shells status response:', {
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
            winMultiplier: WIN_MULTIPLIER,
            stats
        });

    } catch (error) {
        console.error('🛸❌ Cosmic shells status error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Начать новую игру
router.post('/start-game/:telegramId', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'development') console.log('🛸 Starting new cosmic shells game for:', req.params.telegramId, 'Bet:', req.body.betAmount);
        const { telegramId } = req.params;
        const { betAmount } = req.body;

        // Валидация ставки
        if (!betAmount || betAmount < MIN_BET || betAmount > MAX_BET) {
            if (process.env.NODE_ENV === 'development') console.log('🛸❌ Invalid bet amount:', betAmount);
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
            if (process.env.NODE_ENV === 'development') console.log('🛸 Player balance:', currentBalance, 'Bet:', betAmount);
            
            if (currentBalance < betAmount) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Недостаточно средств'
                });
            }

            // Проверяем лимиты с новой логикой
            const { dailyGames, dailyAds } = await getGameLimits(telegramId);
            const { canPlayFree } = calculateGamesAvailable(dailyGames, dailyAds);
            
            if (!canPlayFree) {
                await pool.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'Лимит игр исчерпан. Посмотрите рекламу для получения дополнительных игр.'
                });
            }

            // Списываем ставку сразу
            await pool.query(
                'UPDATE players SET ccc = ccc - $1 WHERE telegram_id = $2',
                [betAmount, telegramId]
            );

            // Создаем безопасную игру
            const game = createSecureGame(betAmount);
            if (process.env.NODE_ENV === 'development') console.log('🛸 Created game:', { gameId: game.gameId, winningPosition: game.winningPosition, positions: game.positions });

            // Сохраняем игру в базе
            await pool.query(`
                INSERT INTO minigames_history (telegram_id, game_type, bet_amount, game_result)
                VALUES ($1, 'cosmic_shells', $2, $3)
            `, [telegramId, betAmount, JSON.stringify({
                gameId: game.gameId,
                positions: game.positions,
                winningPosition: game.winningPosition,
                status: 'started',
                timestamp: Date.now()
            })]);

            await pool.query('COMMIT');

            if (process.env.NODE_ENV === 'development') console.log('🛸✅ Game started successfully:', game.gameId);
            res.json({
                success: true,
                gameId: game.gameId,
                message: 'Игра создана. Выберите тарелку после перемешивания!'
            });

        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('🛸❌ Start cosmic shells game error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Сделать выбор тарелки
router.post('/make-choice/:telegramId', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'development') console.log('🛸 Making choice for:', req.params.telegramId, 'Body:', req.body);
        const { telegramId } = req.params;
        const { gameId, chosenPosition } = req.body;

        // Валидация выбора
        if (chosenPosition < 0 || chosenPosition > 2) {
            if (process.env.NODE_ENV === 'development') console.log('🛸❌ Invalid position:', chosenPosition);
            return res.status(400).json({
                success: false,
                error: 'Неверная позиция тарелки'
            });
        }

        // Находим игру в истории
        if (process.env.NODE_ENV === 'development') console.log('🛸 Looking for game:', gameId);
        const gameResult = await pool.query(`
            SELECT * FROM minigames_history 
            WHERE telegram_id = $1 AND game_result->>'gameId' = $2 
            ORDER BY created_at DESC LIMIT 1
        `, [telegramId, gameId]);

        if (gameResult.rows.length === 0) {
            if (process.env.NODE_ENV === 'development') console.log('🛸❌ Game not found:', gameId);
            return res.status(400).json({
                success: false,
                error: 'Игра не найдена'
            });
        }

        const gameData = gameResult.rows[0].game_result;
        const betAmount = gameResult.rows[0].bet_amount;
        if (process.env.NODE_ENV === 'development') console.log('🛸 Found game data:', gameData);

        // Проверяем что игра еще не завершена
        if (gameData.status !== 'started') {
            if (process.env.NODE_ENV === 'development') console.log('🛸❌ Game already completed:', gameData.status);
            return res.status(400).json({
                success: false,
                error: 'Игра уже завершена'
            });
        }

        // Определяем результат
        const isWin = chosenPosition === gameData.winningPosition;
        const winAmount = isWin ? betAmount * WIN_MULTIPLIER : 0;
        const profit = winAmount - betAmount;

        if (process.env.NODE_ENV === 'development') console.log('🛸 Game result:', {
            chosenPosition, 
            winningPosition: gameData.winningPosition, 
            isWin, 
            winAmount, 
            profit 
        });

        await pool.query('BEGIN');

        try {
            // Обновляем баланс игрока
            if (isWin) {
                // При выигрыше начисляем выигрыш (ставка уже списана)
                await pool.query(
                    'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2',
                    [winAmount, telegramId]
                );
                if (process.env.NODE_ENV === 'development') console.log('🛸✅ Win! Added to balance:', winAmount);
            } else {
                if (process.env.NODE_ENV === 'development') console.log('🛸💀 Loss! No money returned');
            }

            // Обновляем джекпот при проигрыше
            let jackpotContribution = 0;
            if (!isWin) {
                jackpotContribution = Math.floor(betAmount * JACKPOT_CONTRIBUTION);
                
                // Обновляем джекпот
                await pool.query(`
                    UPDATE jackpot 
                    SET current_amount = current_amount + $1, 
                        total_contributed = total_contributed + $1, 
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                `, [jackpotContribution]);
                
                if (process.env.NODE_ENV === 'development') console.log('🛸💰 Added to jackpot:', jackpotContribution, 'from bet:', betAmount);
            } else {
                if (process.env.NODE_ENV === 'development') console.log('🛸🎉 Win! No jackpot contribution');
            }

            // Обновляем историю игры
            const finalGameData = {
                ...gameData,
                chosenPosition,
                isWin,
                winAmount,
                profit,
                status: 'completed',
                completedAt: Date.now()
            };

            await pool.query(`
                UPDATE minigames_history 
                SET win_amount = $1, game_result = $2, jackpot_contribution = $3
                WHERE id = $4
            `, [winAmount, JSON.stringify(finalGameData), jackpotContribution, gameResult.rows[0].id]);

            // Обновляем статистику игрока
            await pool.query(`
                INSERT INTO minigames_stats (telegram_id, game_type, total_games, total_wins, total_losses, total_bet, total_won)
                VALUES ($1, 'cosmic_shells', 1, $2, $3, $4, $5)
                ON CONFLICT (telegram_id, game_type)
                DO UPDATE SET
                    total_games = minigames_stats.total_games + 1,
                    total_wins = minigames_stats.total_wins + $2,
                    total_losses = minigames_stats.total_losses + $3,
                    total_bet = minigames_stats.total_bet + $4,
                    total_won = minigames_stats.total_won + $5,
                    updated_at = CURRENT_TIMESTAMP
            `, [telegramId, isWin ? 1 : 0, isWin ? 0 : 1, betAmount, winAmount]);

            // Обновляем лимиты игр ТОЛЬКО ЗДЕСЬ
            await pool.query(`
                UPDATE player_game_limits 
                SET daily_games = daily_games + 1
                WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
            `, [telegramId]);

            if (process.env.NODE_ENV === 'development') console.log('🛸🎮 Increased daily_games counter for player:', telegramId);

            await pool.query('COMMIT');

            if (process.env.NODE_ENV === 'development') console.log('🛸✅ Choice processed successfully');
            res.json({
                success: true,
                result: {
                    isWin,
                    chosenPosition,
                    winningPosition: gameData.winningPosition,
                    positions: gameData.positions,
                    betAmount,
                    winAmount,
                    profit
                }
            });

        } catch (error) {
            await pool.query('ROLLBACK');
            throw error;
        }

    } catch (error) {
        console.error('🛸❌ Make choice cosmic shells error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Получить историю игр
router.get('/history/:telegramId', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'development') console.log('🛸 Getting game history for:', req.params.telegramId);
        const { telegramId } = req.params;
        const { limit = 1000, offset = 0 } = req.query; // ✅ ИСПРАВЛЕНО: по умолчанию 1000 вместо 20

        // Получаем историю игр
        const historyResult = await pool.query(`
            SELECT 
                id,
                bet_amount,
                win_amount,
                game_result,
                jackpot_contribution,
                created_at,
                CASE 
                    WHEN win_amount > 0 THEN 'win'
                    ELSE 'loss'
                END as result_type
            FROM minigames_history 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
            ORDER BY created_at DESC 
            LIMIT $2 OFFSET $3
        `, [telegramId, limit, offset]);

        // Форматируем данные для фронтенда
        const formattedHistory = historyResult.rows.map(game => {
            const gameData = game.game_result;
            return {
                id: game.id,
                date: game.created_at,
                betAmount: parseInt(game.bet_amount),
                winAmount: parseInt(game.win_amount || 0),
                profit: parseInt(game.win_amount || 0) - parseInt(game.bet_amount),
                result: game.result_type,
                chosenPosition: gameData.chosenPosition || null,
                winningPosition: gameData.winningPosition || null,
                positions: gameData.positions || [],
                jackpotContribution: parseInt(game.jackpot_contribution || 0),
                isCompleted: gameData.status === 'completed'
            };
        });

        // Получаем общую статистику
        const totalResult = await pool.query(`
            SELECT COUNT(*) as total_games
            FROM minigames_history 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        if (process.env.NODE_ENV === 'development') console.log('🛸 Game history response:', {
            total: parseInt(totalResult.rows[0].total_games),
            games: formattedHistory.length,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

        res.json({
            success: true,
            history: formattedHistory,
            total: parseInt(totalResult.rows[0].total_games),
            hasMore: (parseInt(offset) + formattedHistory.length) < parseInt(totalResult.rows[0].total_games)
        });

    } catch (error) {
        console.error('🛸❌ Game history error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ✅ ИСПРАВЛЕНО: Реклама дает 20 игр за раз (как в слотах)
router.post('/watch-ad/:telegramId', async (req, res) => {
    try {
        if (process.env.NODE_ENV === 'development') console.log('🛸 Watch ad request for shells:', req.params.telegramId);
        const { telegramId } = req.params;

        const { dailyGames, dailyAds } = await getGameLimits(telegramId);
        
        if (process.env.NODE_ENV === 'development') console.log('🛸 Current shell limits before ad:', { dailyGames, dailyAds });
        
        if (dailyAds >= MAX_AD_GAMES) {
            if (process.env.NODE_ENV === 'development') console.log('🛸❌ Shell ad limit exceeded:', dailyAds, '>=', MAX_AD_GAMES);
            return res.status(400).json({
                success: false,
                error: `Дневной лимит рекламы исчерпан (${MAX_AD_GAMES}/${MAX_AD_GAMES})`,
                adsRemaining: 0
            });
        }
        
        const totalGamesPlayed = dailyGames;
        const maxTotalGames = DAILY_GAME_LIMIT + (MAX_AD_GAMES * GAMES_PER_AD);
        
        if (totalGamesPlayed >= maxTotalGames) {
            if (process.env.NODE_ENV === 'development') console.log('🛸❌ Total shell games limit exceeded:', totalGamesPlayed, '>=', maxTotalGames);
            return res.status(400).json({
                success: false,
                error: `Максимальный дневной лимит игр исчерпан (${maxTotalGames} игр)`,
                adsRemaining: 0
            });
        }

        // Увеличиваем счетчик рекламы на 1
        await pool.query(`
            UPDATE player_game_limits 
            SET daily_ads_watched = daily_ads_watched + 1
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        const newAdsWatched = dailyAds + 1;
        const adsRemaining = MAX_AD_GAMES - newAdsWatched;

        if (process.env.NODE_ENV === 'development') console.log('🛸✅ Shell ad watched successfully! New stats:', {
            adsWatched: newAdsWatched,
            adsRemaining,
            maxAds: MAX_AD_GAMES,
            gamesGranted: GAMES_PER_AD
        });

        res.json({
            success: true,
            adsRemaining,
            adsWatched: newAdsWatched,
            maxAds: MAX_AD_GAMES,
            message: `Получено ${GAMES_PER_AD} дополнительных игр в напёрстки! (${newAdsWatched}/${MAX_AD_GAMES})`
        });

    } catch (error) {
        console.error('🛸❌ Watch ad shells error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

module.exports = router;