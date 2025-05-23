const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
  console.log('Log received:', req.body);
  res.status(200).json({ message: 'Log received' });
});

module.exports = router;