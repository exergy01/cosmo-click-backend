// test-admin-endpoints.js - Test admin finance endpoints
const axios = require('axios');

async function testEndpoints() {
  const adminId = '1222791281';
  const baseUrl = 'http://localhost:5002/api/admin';

  console.log('🧪 Testing admin endpoints locally...\n');

  // Test 1: Withdrawals
  try {
    console.log('1️⃣ Testing /withdrawals/pending...');
    const withdrawals = await axios.get(`${baseUrl}/withdrawals/pending?admin_id=${adminId}`);
    console.log('✅ Withdrawals response:', JSON.stringify(withdrawals.data, null, 2), '\n');
  } catch (error) {
    console.error('❌ Withdrawals error status:', error.response?.status);
    console.error('❌ Withdrawals error data:', error.response?.data);
    console.error('❌ Withdrawals error message:', error.message, '\n');
  }

  // Test 2: Deposits
  try {
    console.log('2️⃣ Testing /ton-deposits...');
    const deposits = await axios.get(`${baseUrl}/ton-deposits?admin_id=${adminId}&status=confirmed`);
    console.log('✅ Deposits response:', JSON.stringify(deposits.data, null, 2), '\n');
  } catch (error) {
    console.error('❌ Deposits error status:', error.response?.status);
    console.error('❌ Deposits error data:', error.response?.data);
    console.error('❌ Deposits error message:', error.message, '\n');
  }

  // Test 3: Check admin status
  try {
    console.log('3️⃣ Testing /auth/check...');
    const auth = await axios.get(`${baseUrl}/auth/check/${adminId}`);
    console.log('✅ Auth response:', JSON.stringify(auth.data, null, 2), '\n');
  } catch (error) {
    console.error('❌ Auth error status:', error.response?.status);
    console.error('❌ Auth error data:', error.response?.data);
    console.error('❌ Auth error message:', error.message, '\n');
  }
}

testEndpoints().then(() => {
  console.log('🏁 Tests complete!');
  process.exit(0);
}).catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
