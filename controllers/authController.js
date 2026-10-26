const bcrypt = require('bcrypt');
const db = require('../models/db');

// Register a new user
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).send('Name, email, and password are required.');
    }

    // Enforce minimum password length before any DB or hashing work
    if (password.length < 8) {
      return res.redirect('/register?error=Password+must+be+at+least+8+characters+long.');
    }

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existingUser) {
      return res.status(400).send('Email already exists.');
    }

    // Hash the password using bcrypt with 10 salt rounds
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user into the database
    const stmt = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)');
    stmt.run(name, email, hashedPassword);

    return res.redirect('/login');
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || (error.message && error.message.includes('UNIQUE constraint failed'))) {
      return res.redirect('/register?error=Email+already+registered');
    }
    console.error('Registration error:', error);
    return res.status(500).render('500');
  }
};

// Log in an existing user
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send('Email and password are required.');
    }

    // Query user by email
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) {
      return res.status(400).send('Invalid email or password.');
    }

    // Compare passwords with bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).send('Invalid email or password.');
    }

    // Save userId and role in req.session
    req.session.userId = user.id;
    req.session.role = user.role;

    const auditController = require('./auditController');
    auditController.logAction(user.id, 'LOGIN', `User ${user.email} logged in successfully as ${user.role}.`);

    return res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).render('500');
  }
};

// Log out user and destroy session
const logout = async (req, res) => {
  try {
    req.session.destroy((err) => {
      // Clear the session cookie from the client regardless of destroy outcome
      res.clearCookie('connect.sid', { path: '/' });
      if (err) {
        console.error('Logout error:', err);
        return res.status(500).send('Failed to log out.');
      }
      return res.redirect('/login');
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).render('500');
  }
};

module.exports = {
  register,
  login,
  logout
};
