// routes/wallet.js - ИСПРАВЛЕННЫЙ главный роутер кошелька
const express = require('express');
const router = express.Router();

// Импортируем все подроутеры
const tonDepositsRouter = require('./wallet/ton-deposits');
const starsPaymentsRouter = require('./wallet/stars-payments');
const premiumSystemRouter = require('./wallet/premium-system');
const tonWithdrawalsRouter = require('./wallet/ton-withdrawals');
const transactionHistoryRouter = require('./wallet/transaction-history');
const walletConnectionRouter = require('./wallet/wallet-connection');

// ИСПРАВЛЕНИЕ: Правильно подключаем все роутеры
router.use('/ton-deposits', tonDepositsRouter);
router.use('/stars-payments', starsPaymentsRouter);
router.use('/premium-system', premiumSystemRouter);
router.use('/ton-withdrawals', tonWithdrawalsRouter);
router.use('/transaction-history', transactionHistoryRouter);
router.use('/wallet-connection', walletConnectionRouter);

// LEGACY ENDPOINTS для обратной совместимости
// Переадресация старых endpoint'ов на новые

// Stars invoice creation (legacy)
router.post('/create-stars-invoice', (req, res) => {
  if (process.env.NODE_ENV === 'development') console.log('Legacy Stars endpoint called, redirecting...');
  req.originalUrl = '/api/wallet/stars-payments/create-invoice';
  starsPaymentsRouter(req, res);
});

// Stars webhook (legacy)
router.post('/stars-webhook', (req, res) => {
  if (process.env.NODE_ENV === 'development') console.log('Legacy Stars webhook called, redirecting...');
  req.originalUrl = '/api/wallet/stars-payments/webhook';
  starsPaymentsRouter(req, res);
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Wallet system is operational',
    timestamp: new Date().toISOString(),
    modules: [
      'ton-deposits',
      'stars-payments', 
      'premium-system',
      'ton-withdrawals',
      'transaction-history',
      'wallet-connection'
    ]
  });
});

module.exports = router;