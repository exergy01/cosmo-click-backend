// stats.js - Очищенная версия
const express = require('express');
const router = express.Router();
const pool = require('../../db');

// Получить общую статистику игрока
router.get('/stats/:telegramId', async (req, res) => {
    try {
        const { telegramId } = req.params;

        // Общая статистика по всем играм
        const statsResult = await pool.query(`
            SELECT 
                COALESCE(SUM(total_games), 0) as total_games,
                COALESCE(SUM(total_wins), 0) as total_wins,
                COALESCE(SUM(total_losses), 0) as total_losses,
                COALESCE(SUM(total_bet), 0) as total_bet,
                COALESCE(SUM(total_won), 0) as total_won
            FROM minigames_stats 
            WHERE telegram_id = $1
        `, [telegramId]);

        // Текущий джекпот
        const jackpotResult = await pool.query(
            'SELECT current_amount FROM jackpot ORDER BY id DESC LIMIT 1'
        );

        const stats = statsResult.rows[0];
        const jackpotAmount = jackpotResult.rows[0]?.current_amount || 0;

        res.json({
            totalGames: parseInt(stats.total_games) || 0,
            totalWins: parseInt(stats.total_wins) || 0,
            totalLosses: parseInt(stats.total_losses) || 0,
            totalBet: parseInt(stats.total_bet) || 0,
            totalWon: parseInt(stats.total_won) || 0,
            jackpotAmount: parseInt(jackpotAmount) || 0,
            winRate: stats.total_games > 0 ? 
                Math.round((stats.total_wins / stats.total_games) * 100) : 0,
            profit: parseInt(stats.total_won) - parseInt(stats.total_bet)
        });

    } catch (error) {
        console.error('Get game stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

// Получить статистику по конкретной игре
router.get('/stats/:telegramId/:gameType', async (req, res) => {
    try {
        const { telegramId, gameType } = req.params;

        const result = await pool.query(`
            SELECT * FROM minigames_stats 
            WHERE telegram_id = $1 AND game_type = $2
        `, [telegramId, gameType]);

        if (result.rows.length === 0) {
            return res.json({
                totalGames: 0, totalWins: 0, totalLosses: 0,
                totalBet: 0, totalWon: 0, bestStreak: 0, 
                worstStreak: 0, winRate: 0, profit: 0
            });
        }

        const stats = result.rows[0];
        res.json({
            totalGames: stats.total_games,
            totalWins: stats.total_wins,
            totalLosses: stats.total_losses,
            totalBet: stats.total_bet,
            totalWon: stats.total_won,
            bestStreak: stats.best_streak,
            worstStreak: stats.worst_streak,
            winRate: stats.total_games > 0 ? 
                Math.round((stats.total_wins / stats.total_games) * 100) : 0,
            profit: stats.total_won - stats.total_bet
        });

    } catch (error) {
        console.error('Get specific game stats error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

// Получить топ игроков
router.get('/leaderboard/:period', async (req, res) => {
    try {
        const { period } = req.params;
        
        let timeFilter = '';
        switch (period) {
            case 'day':
                timeFilter = "AND DATE(created_at) = CURRENT_DATE";
                break;
            case 'week':
                timeFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
                break;
            case 'month':
                timeFilter = "AND created_at >= NOW() - INTERVAL '30 days'";
                break;
            default:
                timeFilter = '';
        }

        const result = await pool.query(`
            SELECT 
                p.telegram_id,
                p.first_name,
                p.username,
                SUM(h.win_amount - h.bet_amount) as profit,
                SUM(h.win_amount) as total_won,
                COUNT(*) as games_played
            FROM minigames_history h
            JOIN players p ON h.telegram_id = p.telegram_id
            WHERE h.win_amount > h.bet_amount ${timeFilter}
            GROUP BY p.telegram_id, p.first_name, p.username
            ORDER BY profit DESC
            LIMIT 10
        `);

        const leaderboard = result.rows.map((row, index) => ({
            position: index + 1,
            playerName: row.first_name || row.username || `Player ${row.telegram_id}`,
            profit: row.profit,
            totalWon: row.total_won,
            gamesPlayed: row.games_played
        }));

        res.json(leaderboard);

    } catch (error) {
        console.error('Get leaderboard error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

// Получить текущий джекпот
router.get('/jackpot', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT current_amount, last_winner_id, last_win_amount, last_win_date FROM jackpot ORDER BY id DESC LIMIT 1'
        );

        if (result.rows.length === 0) {
            return res.json({
                currentAmount: 0, lastWinner: null,
                lastWinAmount: 0, lastWinDate: null
            });
        }

        const jackpot = result.rows[0];
        let lastWinnerName = null;

        if (jackpot.last_winner_id) {
            const winnerResult = await pool.query(
                'SELECT first_name, username FROM players WHERE telegram_id = $1',
                [jackpot.last_winner_id]
            );
            
            if (winnerResult.rows.length > 0) {
                const winner = winnerResult.rows[0];
                lastWinnerName = winner.first_name || winner.username || `Player ${jackpot.last_winner_id}`;
            }
        }

        res.json({
            currentAmount: jackpot.current_amount,
            lastWinner: lastWinnerName,
            lastWinAmount: jackpot.last_win_amount,
            lastWinDate: jackpot.last_win_date
        });

    } catch (error) {
        console.error('Get jackpot error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Server error' 
        });
    }
});

module.exports = router;