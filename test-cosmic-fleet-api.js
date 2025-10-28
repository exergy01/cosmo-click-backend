const axios = require('axios');

const API_BASE = 'http://localhost:5002';
const DEBUG_TELEGRAM_ID = 123456789; // Локальный тестовый ID

async function testCosmicFleetAPI() {
  if (process.env.NODE_ENV === 'development') console.log('🚀 === ТЕСТИРОВАНИЕ COSMIC FLEET API ===');
  if (process.env.NODE_ENV === 'development') console.log('⏰ Время:', new Date().toISOString());

  try {
    // 1. Тест инициализации игрока
    if (process.env.NODE_ENV === 'development') console.log('\n1. 🎯 Тестируем инициализацию игрока...');
    const initResponse = await axios.post(`${API_BASE}/api/cosmic-fleet/user/${DEBUG_TELEGRAM_ID}/init`);
    if (process.env.NODE_ENV === 'development') console.log('✅ Инициализация успешна:', initResponse.data);

    // 2. Тест получения профиля
    if (process.env.NODE_ENV === 'development') console.log('\n2. 🎯 Тестируем получение профиля...');
    const profileResponse = await axios.get(`${API_BASE}/api/cosmic-fleet/user/${DEBUG_TELEGRAM_ID}`);
    if (process.env.NODE_ENV === 'development') console.log('✅ Профиль получен:', profileResponse.data);

    // 3. Тест получения флота
    if (process.env.NODE_ENV === 'development') console.log('\n3. 🎯 Тестируем получение флота...');
    const fleetResponse = await axios.get(`${API_BASE}/api/cosmic-fleet/fleet/${DEBUG_TELEGRAM_ID}`);
    if (process.env.NODE_ENV === 'development') console.log('✅ Флот получен:', fleetResponse.data);

    if (fleetResponse.data.length > 0) {
      const shipId = fleetResponse.data[0].id;

      // 4. Тест PvE боя
      if (process.env.NODE_ENV === 'development') console.log('\n4. 🎯 Тестируем PvE бой...');
      const battleResponse = await axios.post(`${API_BASE}/api/cosmic-fleet/battle/pve`, {
        telegramId: DEBUG_TELEGRAM_ID,
        shipId: shipId
      });
      if (process.env.NODE_ENV === 'development') console.log('✅ PvE бой проведен:', battleResponse.data);
    }

    // 5. Тест баланса Luminios
    if (process.env.NODE_ENV === 'development') console.log('\n5. 🎯 Тестируем баланс Luminios...');
    const balanceResponse = await axios.get(`${API_BASE}/api/luminios/balance/${DEBUG_TELEGRAM_ID}`);
    if (process.env.NODE_ENV === 'development') console.log('✅ Баланс Luminios:', balanceResponse.data);

    // 6. Тест шаблонов кораблей (GET endpoint для магазина)
    if (process.env.NODE_ENV === 'development') console.log('\n6. 🎯 Тестируем доступность API кораблей...');
    try {
      const shipsResponse = await axios.get(`${API_BASE}/api/cosmic-fleet/ships`);
      if (process.env.NODE_ENV === 'development') console.log('ℹ️ Ships endpoint:', shipsResponse.status);
    } catch (err) {
      if (process.env.NODE_ENV === 'development') console.log('ℹ️ Ships endpoint не найден (ожидаемо)');
    }

    if (process.env.NODE_ENV === 'development') console.log('\n🎉 === ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО ===');
    return {
      success: true,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('\n❌ === ОШИБКА ТЕСТИРОВАНИЯ ===');
    console.error('❌ URL:', error.config?.url);
    console.error('❌ Method:', error.config?.method);
    console.error('❌ Status:', error.response?.status);
    console.error('❌ Data:', error.response?.data);
    console.error('❌ Message:', error.message);

    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Запускаем тесты
if (require.main === module) {
  testCosmicFleetAPI()
    .then((result) => {
      if (result.success) {
        if (process.env.NODE_ENV === 'development') console.log('🎊 Тестирование завершено успешно!');
        process.exit(0);
      } else {
        console.error('💥 Тестирование провалено:', result.error);
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('💥 Критическая ошибка тестирования:', error.message);
      process.exit(1);
    });
}

module.exports = { testCosmicFleetAPI };