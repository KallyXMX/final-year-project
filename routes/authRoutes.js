const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Authentication routes
router.get('/login', (req, res) => res.render('login'));
router.post('/login', authController.login);
router.get('/register', (req, res) => res.render('register', { errorMessage: req.query.error || null }));
router.post('/register', authController.register);
router.get('/logout', authController.logout);

module.exports = router;
