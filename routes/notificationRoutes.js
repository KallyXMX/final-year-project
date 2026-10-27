const express = require('express');
const router = express.Router();
const c = require('../controllers/notificationController');
const { requireAuth } = require('../middlewares/auth');

router.get('/notifications', requireAuth, c.list);
router.post('/notifications/read-all', requireAuth, c.markAllRead);

module.exports = router;
