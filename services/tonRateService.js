// ===== services/tonRateService.js =====
const pool = require('../db');
const axios = require('axios');

class TonRateService {
  constructor() {
    this.isUpdating = false;
    this.lastUpdate = null;
    this.updateInterval = 60 * 60 * 1000; // 1 час
    
    // Источники курсов TON (в порядке приоритета)
    this.rateSources = [
      {
        name: 'coingecko',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd',
        headers: {},
        transform: (data) => data['the-open-network']?.usd
      },
      {
        name: 'coinapi',
        url: 'https://rest.coinapi.io/v1/exchangerate/TON/USD',
        headers: { 'X-CoinAPI-Key': process.env.COINAPI_KEY },
        transform: (data) => data.rate
      }
    ];
  }

  // 🌟 Получение курса TON из внешних API
  async fetchTonRateFromAPI() {
    console.log('🔍 Получаем курс TON из внешних источников...');
    
    for (const source of this.rateSources) {
      try {
        // Если нет API ключа для CoinAPI - пропускаем
        if (source.name === 'coinapi' && !process.env.COINAPI_KEY) {
          console.log('⚠️ CoinAPI: ключ не найден, пропускаем');
          continue;
        }
        
        console.log(`📡 Запрос к ${source.name}: ${source.url}`);
        
        const response = await axios.get(source.url, {
          headers: source.headers,
          timeout: 10000
        });
        
        const rate = source.transform(response.data);
        
        if (rate && rate > 0) {
          console.log(`✅ Курс TON от ${source.name}: $${rate}`);
          return {
            rate: parseFloat(rate),
            source: source.name,
            timestamp: new Date()
          };
        } else {
          console.log(`⚠️ ${source.name}: некорректный курс`);
        }
        
      } catch (error) {
        console.log(`❌ Ошибка ${source.name}:`, error.message);
        continue;
      }
    }
    
    console.log('❌ Не удалось получить курс TON ни из одного источника');
    return null;
  }

  // 🛡️ Проверка защиты от резких скачков
  async checkRateProtection(newRate) {
    const client = await pool.connect();
    try {
      // Получаем последний курс
      const lastRateResult = await client.query(`
        SELECT rate, last_updated 
        FROM exchange_rates 
        WHERE currency_pair = 'TON_USD' 
        ORDER BY last_updated DESC 
        LIMIT 1
      `);
      
      if (lastRateResult.rows.length === 0) {
        return { allowed: true, reason: 'First rate update' };
      }
      
      const lastRate = parseFloat(lastRateResult.rows[0].rate);
      const changePercent = Math.abs((newRate - lastRate) / lastRate * 100);
      
      console.log(`📊 Анализ изменения курса: ${lastRate} → ${newRate} (${changePercent.toFixed(2)}%)`);
      
      // Если изменение больше 10% - блокируем обмен при падении
      if (changePercent > 10) {
        console.log('⚠️ Резкое изменение курса TON > 10%');
        
        // Если TON падает - блокируем обмен (невыгодно для игроков)
        if (newRate < lastRate) {
          console.log('📉 TON падает - блокируем обмен Stars');
          
          // Блокируем обмен на 24 часа
          await client.query(`
            INSERT INTO exchange_blocks (exchange_type, blocked_until, reason, ton_rate_when_blocked)
            VALUES ($1, $2, $3, $4)
          `, [
            'stars_to_cs',
            new Date(Date.now() + 24 * 60 * 60 * 1000), // +24 часа
            `TON rate dropped ${changePercent.toFixed(2)}% (${lastRate} → ${newRate})`,
            newRate
          ]);
          
          return { 
            allowed: false, 
            reason: `Rate drop protection: ${changePercent.toFixed(2)}%`,
            blocked: true
          };
        } else {
          console.log('📈 TON растет - обмен остается доступным');
          return { 
            allowed: true, 
            reason: `Rate increase: ${changePercent.toFixed(2)}%`,
            spike: true 
          };
        }
      }
      
      return { allowed: true, reason: 'Normal rate change' };
      
    } finally {
      client.release();
    }
  }

  // 🔄 Обновление курса TON в базе
  async updateTonRate(rateData) {
    if (!rateData || !rateData.rate) {
      console.log('❌ Некорректные данные курса');
      return false;
    }
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Проверяем защиту от скачков
      const protection = await this.checkRateProtection(rateData.rate);
      
      // Получаем предыдущий курс
      const prevResult = await client.query(
        'SELECT rate FROM exchange_rates WHERE currency_pair = $1 ORDER BY last_updated DESC LIMIT 1',
        ['TON_USD']
      );
      
      const previousRate = prevResult.rows[0]?.rate || 3.30;
      
      // Вставляем новый курс TON
      await client.query(`
        INSERT INTO exchange_rates (currency_pair, rate, previous_rate, source, status, metadata)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        'TON_USD',
        rateData.rate,
        previousRate,
        rateData.source,
        protection.allowed ? 'active' : 'blocked',
        JSON.stringify({
          protection_check: protection,
          rate_change_percent: ((rateData.rate - previousRate) / previousRate * 100).toFixed(2),
          api_timestamp: rateData.timestamp,
          auto_update: true
        })
      ]);
      
      // Обновляем курс Stars → CS только если разрешено
      if (protection.allowed) {
        await client.query('SELECT update_stars_cs_rate()');
        console.log('✅ Курс Stars → CS обновлен');
      } else {
        console.log('🚫 Курс Stars → CS не обновлен (заблокирован)');
      }
      
      await client.query('COMMIT');
      
      console.log(`💰 Курс TON обновлен: ${previousRate} → ${rateData.rate} (${rateData.source})`);
      console.log(`🛡️ Защита: ${protection.reason}`);
      
      this.lastUpdate = new Date();
      
      return true;
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Ошибка обновления курса TON:', error);
      return false;
    } finally {
      client.release();
    }
  }

  // 🚀 Запуск автоматического обновления курсов
  async startAutoUpdate() {
    console.log('🚀 Запуск автоматического обновления курсов TON...');
    
    // Первое обновление сразу
    await this.updateRatesCycle();
    
    // Затем каждый час
    setInterval(async () => {
      await this.updateRatesCycle();
    }, this.updateInterval);
    
    console.log(`⏰ Автообновление настроено каждые ${this.updateInterval / 1000 / 60} минут`);
  }

  // 🔄 Цикл обновления курсов
  async updateRatesCycle() {
    if (this.isUpdating) {
      console.log('⏳ Обновление курсов уже выполняется...');
      return;
    }
    
    this.isUpdating = true;
    
    try {
      console.log(`\n🔄 [${new Date().toISOString()}] Начало цикла обновления курсов`);
      
      // Получаем курс TON из API
      const rateData = await this.fetchTonRateFromAPI();
      
      if (rateData) {
        const success = await this.updateTonRate(rateData);
        if (success) {
          console.log('✅ Цикл обновления курсов завершен успешно');
        } else {
          console.log('❌ Ошибка при обновлении курсов в базе');
        }
      } else {
        console.log('❌ Не удалось получить курс TON из API');
        await this.useBackupRate();
      }
      
    } catch (error) {
      console.error('❌ Критическая ошибка в цикле обновления:', error);
    } finally {
      this.isUpdating = false;
      console.log('🏁 Цикл обновления курсов завершен\n');
    }
  }

  // 🆘 Использование резервного курса при ошибках API
  async useBackupRate() {
    console.log('🆘 Используем резервный механизм курсов...');
    
    const client = await pool.connect();
    try {
      // Проверяем, когда было последнее обновление
      const lastUpdate = await client.query(`
        SELECT last_updated, rate 
        FROM exchange_rates 
        WHERE currency_pair = 'TON_USD' 
        ORDER BY last_updated DESC 
        LIMIT 1
      `);
      
      if (lastUpdate.rows.length > 0) {
        const timeSinceUpdate = Date.now() - new Date(lastUpdate.rows[0].last_updated).getTime();
        const hoursOld = timeSinceUpdate / (1000 * 60 * 60);
        
        console.log(`📊 Последний курс: ${lastUpdate.rows[0].rate} (${hoursOld.toFixed(1)} часов назад)`);
        
        // Если курс старше 6 часов - используем резервный
        if (hoursOld > 6) {
          const backupRate = 3.30; // Резервный курс
          
          await client.query(`
            INSERT INTO exchange_rates (currency_pair, rate, previous_rate, source, metadata)
            VALUES ($1, $2, $3, $4, $5)
          `, [
            'TON_USD',
            backupRate,
            lastUpdate.rows[0].rate,
            'backup_fallback',
            JSON.stringify({
              reason: 'API unavailable, using backup rate',
              hours_since_last_update: hoursOld,
              auto_update: true,
              backup_rate: true
            })
          ]);
          
          // Обновляем курс Stars → CS с резервным курсом
          await client.query('SELECT update_stars_cs_rate()');
          
          console.log(`🆘 Установлен резервный курс TON: $${backupRate}`);
        }
      }
      
    } catch (error) {
      console.error('❌ Ошибка установки резервного курса:', error);
    } finally {
      client.release();
    }
  }
}

// Экспортируем синглтон сервиса
const tonRateService = new TonRateService();

module.exports = tonRateService;