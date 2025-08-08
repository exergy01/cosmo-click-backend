const express = require('express');
const router = express.Router();
const pool = require('../../db');
const crypto = require('crypto');

// Константы игры
const MIN_BET = 100;
const MAX_BET = 5000;
const WIN_MULTIPLIER = 2;
const DAILY_GAME_LIMIT = 25;
const MAX_AD_GAMES = 10;
const GAMES_PER_AD = 20;
const JACKPOT_CONTRIBUTION = 0.001; // 0.1%

// Создание безопасной игры
function createSecureGame(betAmount) {
    const randomBytes = crypto.randomBytes(4);
    const randomNumber = randomBytes.readUInt32BE(0);
    
    // 1 из 3 позиций содержит галактику (33.33% шанс выигрыша)
    const winningPosition = randomNumber % 3;
    const gameLayout = ['blackhole', 'blackhole', 'blackhole'];
    gameLayout[winningPosition] = 'galaxy';
    
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
        winningPosition
    };
}

// Получение лимитов игр
async function getGameLimits(telegramId) {
    let limitsResult = await pool.query(`
        SELECT daily_games, daily_ads_watched, last_reset_date 
        FROM player_game_limits 
        WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
    `, [telegramId]);

    if (limitsResult.rows.length === 0) {
        await pool.query(`
            INSERT INTO player_game_limits (telegram_id, game_type, daily_games, daily_ads_watched, last_reset_date)
            VALUES ($1, 'cosmic_shells', 0, 0, CURRENT_DATE)
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
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
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
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
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
            winMultiplier: WIN_MULTIPLIER,
            stats
        });

    } catch (error) {
        console.error('Cosmic shells status error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Начать новую игру
router.post('/start-game/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { betAmount } = req.body;

        if (!betAmount || betAmount < MIN_BET || betAmount > MAX_BET) {
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
            
            if (currentBalance < betAmount) {
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
                [betAmount, telegramId]
            );

            // Создаем игру
            const game = createSecureGame(betAmount);

            // Сохраняем в историю
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
        console.error('Start cosmic shells game error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Сделать выбор тарелки
router.post('/make-choice/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { gameId, chosenPosition } = req.body;

        if (chosenPosition < 0 || chosenPosition > 2) {
            return res.status(400).json({
                success: false,
                error: 'Неверная позиция тарелки'
            });
        }

        // Находим игру
        const gameResult = await pool.query(`
            SELECT * FROM minigames_history 
            WHERE telegram_id = $1 AND game_result->>'gameId' = $2 
            ORDER BY created_at DESC LIMIT 1
        `, [telegramId, gameId]);

        if (gameResult.rows.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Игра не найдена'
            });
        }

        const gameData = gameResult.rows[0].game_result;
        const betAmount = gameResult.rows[0].bet_amount;

        if (gameData.status !== 'started') {
            return res.status(400).json({
                success: false,
                error: 'Игра уже завершена'
            });
        }

        // Определяем результат
        const isWin = chosenPosition === gameData.winningPosition;
        const winAmount = isWin ? betAmount * WIN_MULTIPLIER : 0;
        const profit = winAmount - betAmount;

        await pool.query('BEGIN');

        try {
            // Начисляем выигрыш
            if (isWin) {
                await pool.query(
                    'UPDATE players SET ccc = ccc + $1 WHERE telegram_id = $2',
                    [winAmount, telegramId]
                );
            }

            // Вклад в джекпот при проигрыше
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
            }

            // Обновляем историю
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

            // Обновляем статистику
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

            // Обновляем лимиты
            await pool.query(`
                UPDATE player_game_limits 
                SET daily_games = daily_games + 1
                WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
            `, [telegramId]);

            await pool.query('COMMIT');

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
        console.error('Make choice cosmic shells error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// История игр
router.get('/history/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;
        const { limit = 1000, offset = 0 } = req.query;

        const historyResult = await pool.query(`
            SELECT 
                id, bet_amount, win_amount, game_result, jackpot_contribution, created_at,
                CASE WHEN win_amount > 0 THEN 'win' ELSE 'loss' END as result_type
            FROM minigames_history 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
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
                chosenPosition: gameData.chosenPosition || null,
                winningPosition: gameData.winningPosition || null,
                positions: gameData.positions || [],
                jackpotContribution: parseInt(game.jackpot_contribution || 0),
                isCompleted: gameData.status === 'completed'
            };
        });

        const totalResult = await pool.query(`
            SELECT COUNT(*) as total_games
            FROM minigames_history 
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        res.json({
            success: true,
            history: formattedHistory,
            total: parseInt(totalResult.rows[0].total_games),
            hasMore: (parseInt(offset) + formattedHistory.length) < parseInt(totalResult.rows[0].total_games)
        });

    } catch (error) {
        console.error('Game history error:', error);
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
            WHERE telegram_id = $1 AND game_type = 'cosmic_shells'
        `, [telegramId]);

        const newAdsWatched = dailyAds + 1;
        const adsRemaining = MAX_AD_GAMES - newAdsWatched;

        res.json({
            success: true,
            adsRemaining,
            adsWatched: newAdsWatched,
            maxAds: MAX_AD_GAMES,
            message: `Получено ${GAMES_PER_AD} дополнительных игр в напёрстки! (${newAdsWatched}/${MAX_AD_GAMES})`
        });

    } catch (error) {
        console.error('Watch ad shells error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

module.exports = router;