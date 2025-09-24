const express = require('express');
const router = express.Router();

// Подключаем модули
const tonDeposits = require('./wallet/ton-deposits');
const walletConnection = require('./wallet/wallet-connection');
const starsPayments = require('./wallet/stars-payments');
const premiumSystem = require('./wallet/premium-system');
const tonWithdrawals = require('./wallet/ton-withdrawals');
const transactionHistory = require('./wallet/transaction-history');

// Маршруты
router.use('/ton-deposits', tonDeposits);
router.use('/wallet-connection', walletConnection);
router.use('/stars-payments', starsPayments);
router.use('/premium-system', premiumSystem);
router.use('/ton-withdrawals', tonWithdrawals);
router.use('/transaction-history', transactionHistory);

// Совместимость со старыми маршрутами
router.use('/connect', walletConnection);
router.use('/disconnect', walletConnection);
router.use('/check-deposit-by-address', tonDeposits);
router.use('/check-all-deposits', tonDeposits);
router.use('/debug-deposits', tonDeposits);
router.use('/manual-add-deposit', tonDeposits);
router.use('/prepare-withdrawal', tonWithdrawals);
router.use('/confirm-withdrawal', tonWithdrawals);
router.use('/create-stars-invoice', starsPayments);
router.use('/webhook-stars', starsPayments);
router.use('/premium-status', premiumSystem);
router.use('/purchase-premium', premiumSystem);
router.use('/history', transactionHistory);

module.exports = router;