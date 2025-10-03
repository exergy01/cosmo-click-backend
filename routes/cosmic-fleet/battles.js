/**
 * ⚔️ COSMIC FLEET - BATTLES API
 *
 * API для боёв с ботами и PvP
 */

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const shipsConfig = require('../../config/cosmic-fleet/ships.config');
const battleConfig = require('../../config/cosmic-fleet/battle.config');
const botsConfig = require('../../config/cosmic-fleet/bots.config');
const rewardsConfig = require('../../config/cosmic-fleet/rewards.config');

// Боевой движок
class BattleEngine {
  constructor(playerFleet, enemyFleet, aiStrategy = 'random') {
    this.playerFleet = JSON.parse(JSON.stringify(playerFleet)); // deep copy
    this.enemyFleet = JSON.parse(JSON.stringify(enemyFleet));
    this.aiStrategy = aiStrategy;
    this.battleLog = [];
    this.round = 0;
  }

  // Запуск боя
  fight() {
    while (this.round < battleConfig.victory.maxRounds) {
      this.round++;
      this.battleLog.push({ round: this.round, events: [] });

      // Проверка победы
      if (this.checkVictory()) break;

      // Раунд боя
      this.executeRound();
    }

    // Финальная проверка
    const result = this.getResult();

    return {
      winner: result.winner,
      rounds: this.round,
      playerFleet: this.playerFleet,
      enemyFleet: this.enemyFleet,
      battleLog: this.battleLog,
      stats: result.stats
    };
  }

  executeRound() {
    // Объединяем все корабли и сортируем по скорости
    const allShips = [
      ...this.playerFleet.map(s => ({ ...s, side: 'player' })),
      ...this.enemyFleet.map(s => ({ ...s, side: 'enemy' }))
    ].filter(s => s.hp > 0);

    // Сортировка по скорости (first strike учитывается)
    allShips.sort((a, b) => {
      const aFirstStrike = battleConfig.turnOrder.firstStrikeTypes.includes(a.type);
      const bFirstStrike = battleConfig.turnOrder.firstStrikeTypes.includes(b.type);

      if (aFirstStrike && !bFirstStrike) return -1;
      if (!aFirstStrike && bFirstStrike) return 1;

      return b.speed - a.speed; // больше скорость = раньше ходит
    });

    // Каждый корабль атакует
    for (const attacker of allShips) {
      if (attacker.hp <= 0) continue; // мёртвый не атакует

      const enemies = attacker.side === 'player' ? this.enemyFleet : this.playerFleet;
      const aliveEnemies = enemies.filter(e => e.hp > 0);

      if (aliveEnemies.length === 0) break; // враги побеждены

      // Выбор цели по стратегии AI
      const target = this.selectTarget(aliveEnemies, attacker);

      // Атака
      const isCrit = battleConfig.rollCrit();
      const damage = battleConfig.calculateDamage(attacker, target, isCrit, false);

      target.hp = Math.max(0, target.hp - damage);

      // Лог
      this.battleLog[this.battleLog.length - 1].events.push({
        attacker: { id: attacker.id, name: attacker.ship_name, side: attacker.side },
        target: { id: target.id, name: target.ship_name, side: target.side },
        damage,
        isCrit,
        targetHp: target.hp,
        killed: target.hp === 0
      });

      // Контратака (если цель выжила)
      if (battleConfig.turnOrder.counterAttack && target.hp > 0) {
        const counterDamage = battleConfig.calculateDamage(target, attacker, false, true);
        attacker.hp = Math.max(0, attacker.hp - counterDamage);

        this.battleLog[this.battleLog.length - 1].events.push({
          attacker: { id: target.id, name: target.ship_name, side: target.side },
          target: { id: attacker.id, name: attacker.ship_name, side: attacker.side },
          damage: counterDamage,
          isCrit: false,
          isCounter: true,
          targetHp: attacker.hp,
          killed: attacker.hp === 0
        });
      }
    }
  }

  selectTarget(enemies, attacker) {
    const strategy = battleConfig.targeting.strategies[this.aiStrategy];
    if (strategy) {
      return strategy.selectTarget(enemies, attacker);
    }
    // Случайная цель по умолчанию
    return enemies[Math.floor(Math.random() * enemies.length)];
  }

  checkVictory() {
    const playerAlive = this.playerFleet.filter(s => s.hp > 0).length;
    const enemyAlive = this.enemyFleet.filter(s => s.hp > 0).length;

    return playerAlive === 0 || enemyAlive === 0;
  }

  getResult() {
    const playerAlive = this.playerFleet.filter(s => s.hp > 0);
    const enemyAlive = this.enemyFleet.filter(s => s.hp > 0);

    const playerDamageDealt = this.enemyFleet.reduce((sum, s) => sum + (s.maxHp - s.hp), 0);
    const playerDamageReceived = this.playerFleet.reduce((sum, s) => sum + (s.maxHp - s.hp), 0);

    let winner = 'draw';
    if (playerAlive.length > 0 && enemyAlive.length === 0) winner = 'player';
    if (enemyAlive.length > 0 && playerAlive.length === 0) winner = 'enemy';

    // Если ничья или достигнут лимит раундов - по HP
    if (winner === 'draw' && battleConfig.victory.tiebreaker === 'total_hp') {
      const playerTotalHp = playerAlive.reduce((sum, s) => sum + s.hp, 0);
      const enemyTotalHp = enemyAlive.reduce((sum, s) => sum + s.hp, 0);
      winner = playerTotalHp > enemyTotalHp ? 'player' : 'enemy';
    }

    return {
      winner,
      stats: {
        playerDamageDealt,
        playerDamageReceived,
        playerShipsLost: this.playerFleet.length - playerAlive.length,
        isPerfectWin: playerAlive.length === this.playerFleet.length && winner === 'player'
      }
    };
  }
}

// POST /api/cosmic-fleet/battle/bot
// Бой с ботом
router.post('/bot', async (req, res) => {
  try {
    const { telegramId, difficulty, adaptive = false } = req.body;  // 🔥 НОВОЕ: adaptive mode

    // Валидация
    if (!adaptive && !botsConfig.difficulties[difficulty]) {
      return res.status(400).json({ error: 'Invalid difficulty' });
    }

    // Загружаем флот игрока
    const formationResult = await pool.query(`
      SELECT slot_1_ship_id, slot_2_ship_id, slot_3_ship_id, slot_4_ship_id, slot_5_ship_id
      FROM cosmic_fleet_formations
      WHERE telegram_id = $1
    `, [telegramId]);

    if (formationResult.rows.length === 0) {
      return res.status(404).json({ error: 'Formation not found' });
    }

    const formation = formationResult.rows[0];
    const shipIds = Object.values(formation).filter(id => id !== null);

    if (shipIds.length === 0) {
      return res.status(400).json({ error: 'No ships in formation' });
    }

    // Загружаем корабли с характеристиками
    const shipsResult = await pool.query(`
      SELECT
        s.*,
        st.level,
        st.upgrade_weapon,
        st.upgrade_shield,
        st.upgrade_engine
      FROM cosmic_fleet_ships s
      LEFT JOIN cosmic_fleet_ship_stats st ON s.id = st.ship_id
      WHERE s.id = ANY($1)
    `, [shipIds]);

    const playerFleet = shipsResult.rows.map(ship => ({
      id: ship.id,
      ship_name: ship.ship_name,
      hp: ship.health,
      maxHp: ship.max_health,
      damage: ship.damage,
      armor: 10, // TODO: из конфига
      speed: ship.speed,
      level: ship.level || 1,
      type: 'FIGHTER' // TODO: из ship_template
    }));

    // Генерируем бота
    let botFleet;
    let botConfig;
    let aiStrategy;

    if (adaptive) {
      // 🔥 АДАПТИВНЫЙ БОТ: ±5% от силы игрока
      const adaptiveBot = botsConfig.generateAdaptiveBot(playerFleet, 0.05);
      botFleet = adaptiveBot.fleet;
      aiStrategy = adaptiveBot.aiStrategy;
      botConfig = {
        name: adaptiveBot.name,
        rewardDifficulty: 'medium'  // средняя награда для адаптивных
      };
    } else {
      // 🔥 ОБЫЧНЫЙ БОТ: по сложности
      botConfig = botsConfig.difficulties[difficulty];
      botFleet = botConfig.fleet.map((template, index) => {
        const stats = shipsConfig.calculateShipStats(template.tier, template.type, template.level);
        const modified = botsConfig.applyDifficultyModifier(stats, botConfig.difficultyMultiplier);

        return {
          id: `bot_${index}`,
          ship_name: `${botConfig.name} ${index + 1}`,
          ...modified,
          maxHp: modified.hp
        };
      });
      aiStrategy = botConfig.aiStrategy;
    }

    // БИТВА!
    const battle = new BattleEngine(playerFleet, botFleet, aiStrategy);
    const battleResult = battle.fight();

    // Расчёт награды
    const isWin = battleResult.winner === 'player';
    const reward = rewardsConfig.calculateBotReward(
      botConfig.rewardDifficulty,
      battleResult.stats.playerDamageDealt,
      battleResult.stats.isPerfectWin,
      isWin
    );

    // Сохранение в БД
    await pool.query('BEGIN');

    try {
      // Начисляем Luminios
      if (reward > 0) {
        await pool.query(`
          UPDATE cosmic_fleet_players
          SET balance = balance + $1
          WHERE telegram_id = $2
        `, [reward, telegramId]);
      }

      // Обновляем HP кораблей
      for (const ship of battleResult.playerFleet) {
        await pool.query(`
          UPDATE cosmic_fleet_ships
          SET health = $1
          WHERE id = $2
        `, [ship.hp, ship.id]);
      }

      // Сохраняем историю боя
      await pool.query(`
        INSERT INTO cosmic_fleet_battle_history (
          telegram_id, battle_type, bot_difficulty,
          player_fleet, opponent_fleet,
          result, rounds_count,
          damage_dealt, damage_received, ships_lost, is_perfect_win,
          reward_luminios, battle_log
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `, [
        telegramId, 'bot', adaptive ? 'adaptive' : difficulty,
        JSON.stringify(playerFleet), JSON.stringify(botFleet),
        isWin ? 'win' : 'loss', battleResult.rounds,
        battleResult.stats.playerDamageDealt,
        battleResult.stats.playerDamageReceived,
        battleResult.stats.playerShipsLost,
        battleResult.stats.isPerfectWin,
        reward,
        JSON.stringify(battleResult.battleLog)
      ]);

      await pool.query('COMMIT');

      res.json({
        success: true,
        result: isWin ? 'win' : 'loss',
        rounds: battleResult.rounds,
        playerFleet: battleResult.playerFleet,
        enemyFleet: battleResult.enemyFleet,
        stats: battleResult.stats,
        reward_luminios: reward,
        battleLog: battleResult.battleLog
      });

    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('❌ Ошибка боя с ботом:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cosmic-fleet/battle/history/:telegramId
// История боёв игрока
router.get('/history/:telegramId', async (req, res) => {
  try {
    const { telegramId } = req.params;
    const { limit = 10 } = req.query;

    const result = await pool.query(`
      SELECT
        battle_id, battle_type, bot_difficulty, result, rounds_count,
        damage_dealt, damage_received, ships_lost, is_perfect_win,
        reward_luminios, created_at
      FROM cosmic_fleet_battle_history
      WHERE telegram_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [telegramId, limit]);

    res.json({
      battles: result.rows,
      total: result.rows.length
    });

  } catch (error) {
    console.error('❌ Ошибка загрузки истории:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/cosmic-fleet/battle/replay/:battleId
// Получить полный лог боя для replay
router.get('/replay/:battleId', async (req, res) => {
  try {
    const { battleId } = req.params;

    const result = await pool.query(`
      SELECT
        battle_id, battle_type, bot_difficulty, result, rounds_count,
        player_fleet, opponent_fleet, battle_log,
        damage_dealt, damage_received, ships_lost, is_perfect_win,
        reward_luminios, created_at
      FROM cosmic_fleet_battle_history
      WHERE battle_id = $1
    `, [battleId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Battle not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('❌ Ошибка загрузки replay:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
