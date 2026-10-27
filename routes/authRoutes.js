const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.render('login', { errorMessage: null, values: {} });
});
router.post('/login', authController.login);
router.get('/register', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.render('register', { errorMessage: null, values: {} });
});
router.post('/register', authController.register);
router.get('/logout', authController.logout);

module.exports = router;
