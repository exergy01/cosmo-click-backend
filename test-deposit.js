// test-deposit.js - ТЕСТОВЫЕ СКРИПТЫ ДЛЯ ПРОВЕРКИ ДЕПОЗИТОВ
const axios = require('axios');

const BASE_URL = 'https://cosmoclick-backend.onrender.com'; // или 'http://localhost:5000'
const TEST_PLAYER_ID = '850758749'; // ID тестового игрока

// 🧪 ТЕСТОВЫЕ ФУНКЦИИ ДЛЯ ДЕПОЗИТОВ

// 1. Тест проверки депозитов по адресу
async function testCheckDepositByAddress() {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Тест: Проверка депозитов по адресу');
  
  try {
    const response = await axios.post(`${BASE_URL}/api/wallet/check-deposit-by-address`, {
      player_id: TEST_PLAYER_ID,
      expected_amount: null, // Не указываем сумму - ищем любые
      sender_address: null, // Не указываем отправителя - ищем от любого
      game_wallet: 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60'
    });
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Ответ:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

// 2. Тест универсального поиска депозитов
async function testCheckAllDeposits() {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Тест: Универсальный поиск депозитов');
  
  try {
    const response = await axios.post(`${BASE_URL}/api/wallet/check-all-deposits`, {
      player_id: TEST_PLAYER_ID,
      sender_address: null // Не указываем отправителя
    });
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Ответ:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

// 3. Тест диагностики депозитов
async function testDebugDeposits() {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Тест: Диагностика депозитов');
  
  try {
    const response = await axios.post(`${BASE_URL}/api/wallet/debug-deposits`, {
      player_id: TEST_PLAYER_ID
    });
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Ответ:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

// 4. Мануальное добавление депозита (ТОЛЬКО ДЛЯ ЭКСТРЕННЫХ СЛУЧАЕВ!)
async function testManualAddDeposit() {
  if (process.env.NODE_ENV === 'development') console.log('🚨 Тест: Мануальное добавление депозита');
  if (process.env.NODE_ENV === 'development') console.log('⚠️  ВНИМАНИЕ: Используйте только в экстренных случаях!');
  
  const fakeTransactionHash = `manual_${Date.now()}_${TEST_PLAYER_ID}`;
  
  try {
    const response = await axios.post(`${BASE_URL}/api/wallet/manual-add-deposit`, {
      player_id: TEST_PLAYER_ID,
      amount: 1.0, // 1 TON для теста
      transaction_hash: fakeTransactionHash,
      admin_key: 'cosmo_admin_2025' // Админ ключ из .env
    });
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Ответ:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Ошибка:', error.response?.data || error.message);
  }
}

// 5. Проверка баланса игрока
async function checkPlayerBalance() {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Проверка баланса игрока');
  
  try {
    // Этот эндпоинт нужно добавить в основное API, если его нет
    const response = await axios.get(`${BASE_URL}/api/players/${TEST_PLAYER_ID}`);
    
    if (process.env.NODE_ENV === 'development') console.log('✅ Баланс игрока:', {
      telegram_id: response.data.telegram_id,
      ton: parseFloat(response.data.ton || '0'),
      stars: parseInt(response.data.telegram_stars || '0')
    });
    
  } catch (error) {
    console.error('❌ Ошибка получения баланса:', error.response?.data || error.message);
  }
}

// 🚀 ОСНОВНАЯ ФУНКЦИЯ ЗАПУСКА ТЕСТОВ
async function runAllTests() {
  if (process.env.NODE_ENV === 'development') console.log('🚀 Запуск всех тестов депозитов...\n');
  
  // 1. Проверяем текущий баланс
  await checkPlayerBalance();
  if (process.env.NODE_ENV === 'development') console.log('\n' + '='.repeat(50) + '\n');
  
  // 2. Диагностика (самый информативный тест)
  await testDebugDeposits();
  if (process.env.NODE_ENV === 'development') console.log('\n' + '='.repeat(50) + '\n');
  
  // 3. Универсальный поиск
  await testCheckAllDeposits();
  if (process.env.NODE_ENV === 'development') console.log('\n' + '='.repeat(50) + '\n');
  
  // 4. Проверка по адресу
  await testCheckDepositByAddress();
  if (process.env.NODE_ENV === 'development') console.log('\n' + '='.repeat(50) + '\n');
  
  if (process.env.NODE_ENV === 'development') console.log('🏁 Все тесты завершены!');
}

// 🎯 ФУНКЦИЯ ДЛЯ ПРОВЕРКИ TON API
async function testTonApis() {
  if (process.env.NODE_ENV === 'development') console.log('🧪 Тест доступности TON API...\n');
  
  const gameWallet = 'UQCOZZx-3RSxIVS2QFcuMBwDUZPWgh8FhRT7I6Qo_pqT-h60';
  
// Замените массив apis в функции check-deposit-by-address на этот:

const apis = [
    {
      name: 'TonScan API',
      getData: async () => {
        logDeposit('INFO', 'Запрос к TonScan API', { gameWalletAddress });
        const response = await axios.get(`https://tonscan.org/api/v2/getTransactions?address=${gameWalletAddress}&limit=50`, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CosmoClick/1.0)'
          }
        });
        
        if (response.data && response.data.result) {
          logDeposit('SUCCESS', 'TonScan API успешный ответ', { 
            transactions_count: response.data.result.length 
          });
          return response.data.result;
        }
        throw new Error('Invalid response format');
      }
    },
    {
      name: 'TON Center API (backup)',
      getData: async () => {
        logDeposit('INFO', 'Запрос к TON Center API (backup)', { gameWalletAddress });
        
        // Используем публичный endpoint без ключа
        const response = await axios.get('https://toncenter.com/api/v2/getTransactions', {
          params: {
            address: gameWalletAddress,
            limit: 50,
            archival: false
          },
          timeout: 20000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; CosmoClick/1.0)'
          }
        });
  
        if (response.data && response.data.result) {
          logDeposit('SUCCESS', 'TON Center API (backup) успешный ответ', { 
            transactions_count: response.data.result.length 
          });
          return response.data.result;
        }
        throw new Error(response.data.error || 'API Error');
      }
    },
    {
      name: 'Direct TON RPC',
      getData: async () => {
        logDeposit('INFO', 'Запрос к Direct TON RPC', { gameWalletAddress });
        
        const response = await axios.post('https://toncenter.com/api/v2/jsonRPC', {
          method: 'getTransactions',
          params: {
            address: gameWalletAddress,
            limit: 50
          },
          id: 1,
          jsonrpc: '2.0'
        }, {
          timeout: 20000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; CosmoClick/1.0)'
          }
        });
        
        if (response.data && response.data.result) {
          logDeposit('SUCCESS', 'Direct TON RPC успешный ответ', { 
            transactions_count: response.data.result.length 
          });
          return response.data.result;
        }
        throw new Error('RPC Error');
      }
    }
  ];
    
  for (const api of apis) {
    try {
      const result = await api.test();
      if (process.env.NODE_ENV === 'development') console.log(`${api.name}: ${result}`);
    } catch (error) {
      if (process.env.NODE_ENV === 'development') console.log(`${api.name}: ❌ Недоступен (${error.message})`);
    }
  }
}

// 📋 МЕНЮ ДЛЯ ЗАПУСКА ОТДЕЛЬНЫХ ТЕСТОВ
function showMenu() {
  if (process.env.NODE_ENV === 'development') console.log('\n🔧 МЕНЮ ТЕСТИРОВАНИЯ ДЕПОЗИТОВ:');
  if (process.env.NODE_ENV === 'development') console.log('1. runAllTests() - Запустить все тесты');
  if (process.env.NODE_ENV === 'development') console.log('2. testDebugDeposits() - Диагностика депозитов');
  if (process.env.NODE_ENV === 'development') console.log('3. testCheckAllDeposits() - Универсальный поиск');
  if (process.env.NODE_ENV === 'development') console.log('4. testCheckDepositByAddress() - Поиск по адресу');
  if (process.env.NODE_ENV === 'development') console.log('5. testTonApis() - Проверить TON API');
  if (process.env.NODE_ENV === 'development') console.log('6. checkPlayerBalance() - Проверить баланс');
  if (process.env.NODE_ENV === 'development') console.log('7. testManualAddDeposit() - 🚨 Мануальное добавление\n');
  
  if (process.env.NODE_ENV === 'development') console.log('💡 Для запуска в консоли Node.js:');
  if (process.env.NODE_ENV === 'development') console.log('   node test-deposit.js');
  if (process.env.NODE_ENV === 'development') console.log('   или вызывайте функции по отдельности\n');
}

// Экспорт функций для использования
module.exports = {
  testCheckDepositByAddress,
  testCheckAllDeposits,
  testDebugDeposits,
  testManualAddDeposit,
  checkPlayerBalance,
  testTonApis,
  runAllTests,
  showMenu
};

// Если файл запускается напрямую
if (require.main === module) {
  showMenu();
  
  // Запускаем основные тесты
  runAllTests().catch(console.error);
}