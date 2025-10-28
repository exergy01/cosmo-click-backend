const axios = require('axios');

const BASE_URL = 'http://localhost:5000/api/wallet/ton-withdrawals';
const TEST_TELEGRAM_ID = '123456789';

async function testWithdrawalSystem() {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Testing TON Withdrawal System...\n');

  try {
    // 1. Тест /prepare endpoint
    if (process.env.NODE_ENV === 'development') console.log('1. Testing /prepare endpoint...');
    const prepareResponse = await axios.post(`${BASE_URL}/prepare`, {
      telegram_id: TEST_TELEGRAM_ID,
      amount: 0.5
    });

    if (process.env.NODE_ENV === 'development') console.log('✅ Prepare response:', {
      success: prepareResponse.data.success,
      withdrawal_id: prepareResponse.data.withdrawal_id,
      message: prepareResponse.data.message
    });

    const withdrawalId = prepareResponse.data.withdrawal_id;

    // 2. Тест дубликата заявки
    if (process.env.NODE_ENV === 'development') console.log('\n2. Testing duplicate prevention...');
    try {
      await axios.post(`${BASE_URL}/prepare`, {
        telegram_id: TEST_TELEGRAM_ID,
        amount: 0.5
      });
      if (process.env.NODE_ENV === 'development') console.log('❌ Duplicate check failed - should have been blocked');
    } catch (err) {
      if (err.response?.status === 400 && err.response.data.error.includes('Duplicate')) {
        if (process.env.NODE_ENV === 'development') console.log('✅ Duplicate prevention works');
      } else {
        if (process.env.NODE_ENV === 'development') console.log('❌ Unexpected error:', err.response?.data?.error || err.message);
      }
    }

    // 3. Тест /cancel endpoint
    if (process.env.NODE_ENV === 'development') console.log('\n3. Testing /cancel endpoint...');
    const cancelResponse = await axios.post(`${BASE_URL}/cancel`, {
      telegram_id: TEST_TELEGRAM_ID,
      withdrawal_id: withdrawalId
    });

    if (process.env.NODE_ENV === 'development') console.log('✅ Cancel response:', {
      success: cancelResponse.data.success,
      message: cancelResponse.data.message
    });

    // 4. Тест /confirm endpoint (имитация админа)
    if (process.env.NODE_ENV === 'development') console.log('\n4. Testing /confirm endpoint...');

    // Создаем новую заявку для подтверждения (другая сумма чтобы избежать дубликата)
    const newPrepareResponse = await axios.post(`${BASE_URL}/prepare`, {
      telegram_id: TEST_TELEGRAM_ID,
      amount: 0.7
    });

    const newWithdrawalId = newPrepareResponse.data.withdrawal_id;

    const confirmResponse = await axios.post(`${BASE_URL}/confirm`, {
      telegram_id: TEST_TELEGRAM_ID,
      amount: 0.7,
      transaction_hash: 'test_hash_12345',
      wallet_address: 'UQTest...Address',
      admin_key: 'cosmo_admin_2025'
    });

    if (process.env.NODE_ENV === 'development') console.log('✅ Confirm response:', {
      success: confirmResponse.data.success,
      message: confirmResponse.data.message,
      withdrawal_id: confirmResponse.data.withdrawal_id
    });

    if (process.env.NODE_ENV === 'development') console.log('\n🎉 All tests completed successfully!');

  } catch (err) {
    console.error('❌ Test failed:', {
      status: err.response?.status,
      error: err.response?.data?.error || err.message,
      url: err.config?.url
    });
  }
}

// Запуск тестов
testWithdrawalSystem();