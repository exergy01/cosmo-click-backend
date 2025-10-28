const express = require('express');
const pool = require('../../db');

const router = express.Router();

// GET /:telegramId - История транзакций игрока
router.get('/:telegramId', async (req, res) => {
  const { telegramId } = req.params;
  const { limit = 20, offset = 0 } = req.query;
  
  try {
    if (process.env.NODE_ENV === 'development') console.log('Getting transaction history:', { telegramId, limit, offset });

    // TON депозиты
    const tonDeposits = await pool.query(`
      SELECT 
        'deposit' as type,
        'ton' as currency,
        amount,
        transaction_hash,
        status,
        created_at,
        'TON Deposit' as description
      FROM ton_deposits 
      WHERE player_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Stars депозиты
    const starDeposits = await pool.query(`
      SELECT 
        'deposit' as type,
        'stars' as currency,
        amount,
        telegram_payment_id as transaction_hash,
        status,
        created_at,
        description
      FROM star_transactions 
      WHERE player_id = $1 AND transaction_type = 'deposit'
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Выводы
    const withdrawals = await pool.query(`
      SELECT 
        'withdrawal' as type,
        'ton' as currency,
        amount,
        transaction_hash,
        status,
        created_at,
        'TON Withdrawal' as description
      FROM withdrawals 
      WHERE player_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Покупки премиума
    const premiumPurchases = await pool.query(`
      SELECT 
        'premium' as type,
        payment_method as currency,
        payment_amount as amount,
        transaction_id as transaction_hash,
        'completed' as status,
        created_at,
        CASE WHEN subscription_type = 'no_ads_forever' THEN 'Premium Forever' ELSE 'Premium 30 Days' END as description
      FROM premium_subscriptions 
      WHERE telegram_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [telegramId, parseInt(limit), parseInt(offset)]);
    
    // Объединяем все транзакции
    const allTransactions = [
      ...tonDeposits.rows,
      ...starDeposits.rows,
      ...withdrawals.rows,
      ...premiumPurchases.rows
    ];
    
    // Сортируем по дате
    allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Ограничиваем результат
    const limitedTransactions = allTransactions.slice(0, parseInt(limit));
    const formattedTransactions = limitedTransactions.map(tx => ({
      type: tx.type,
      currency: tx.currency,
      amount: parseFloat(tx.amount),
      hash: tx.transaction_hash ? tx.transaction_hash.substring(0, 16) + '...' : 'N/A',
      full_hash: tx.transaction_hash,
      status: tx.status,
      date: tx.created_at,
      description: tx.description || 'Transaction',
      formatted_date: new Date(tx.created_at).toLocaleString('en-US')
    }));
    
    res.json({
      success: true,
      transactions: formattedTransactions,
      total_count: allTransactions.length,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (err) {
    console.error('Transaction history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;