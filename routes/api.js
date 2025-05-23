const express = require('express');
const pool = require('../db');
const router = express.Router();

router.get('/exchanges', (req, res) => {
  res.json([]);
});

router.get('/quests', (req, res) => {
  res.json([]);
});

module.exports = router;