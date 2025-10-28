const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/wallet/ton-withdrawals';
const TEST_TELEGRAM_ID = Date.now().toString(); // Уникальный ID для каждого теста

async function testWithdrawalSystemSimple() {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Testing TON Withdrawal System (Simple)...\n');
  if (process.env.NODE_ENV === 'development') console.log('Using test user:', TEST_TELEGRAM_ID);

  try {
    // Настройка тестового игрока
    if (process.env.NODE_ENV === 'development') console.log('Setting up test player...');
    const pool = require('./db');
    const client = await pool.connect();

    try {
      await client.query(`
        INSERT INTO players (telegram_id, username, first_name, ton, ton_reserved, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (telegram_id) DO UPDATE SET ton = 3.0, ton_reserved = 0
      `, [TEST_TELEGRAM_ID, 'testuser', 'Test User', 3.0, 0]);

      if (process.env.NODE_ENV === 'development') console.log('✅ Test player setup complete\n');
    } finally {
      client.release();
    }

    // 1. Тест /prepare endpoint
    if (process.env.NODE_ENV === 'development') console.log('1. Testing /prepare endpoint...');
    const prepareResponse = await axios.post(`${BASE_URL}/prepare`, {
      telegram_id: TEST_TELEGRAM_ID,
      amount: 0.5
    });

    if (process.env.NODE_ENV === 'development') console.log('✅ Prepare response:', {
      success: prepareResponse.data.success,
      withdrawal_id: prepareResponse.data.withdrawal_id,
      available_balance: prepareResponse.data.available_balance,
      reserved_balance: prepareResponse.data.reserved_balance
    });

    const withdrawalId = prepareResponse.data.withdrawal_id;

    // 2. Тест /confirm endpoint
    if (process.env.NODE_ENV === 'development') console.log('\n2. Testing /confirm endpoint...');
    const confirmResponse = await axios.post(`${BASE_URL}/confirm`, {
      telegram_id: TEST_TELEGRAM_ID,
      amount: 0.5,
      transaction_hash: 'test_hash_' + Date.now(),
      wallet_address: 'UQTest...Address',
      admin_key: 'cosmo_admin_2025'
    });

    if (process.env.NODE_ENV === 'development') console.log('✅ Confirm response:', {
      success: confirmResponse.data.success,
      message: confirmResponse.data.message,
      new_balance: confirmResponse.data.new_balance,
      reserved_balance: confirmResponse.data.reserved_balance
    });

    if (process.env.NODE_ENV === 'development') console.log('\n🎉 Simple test completed successfully!');

  } catch (err) {
    console.error('❌ Test failed:', {
      status: err.response?.status,
      error: err.response?.data?.error || err.message,
      url: err.config?.url
    });
  }
}

// Запуск теста
testWithdrawalSystemSimple();