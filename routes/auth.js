import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/db.js';

const router = express.Router();

// Middleware to verify JWT token
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET || 'MAA_SITUATION_ROOM_SECRET_KEY');
    req.user = verified;
    next();
  } catch (err) {
    res.status(403).json({ message: 'Invalid or expired token.' });
  }
};

// Middleware to enforce specific roles
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden. You do not have permission to perform this action.' });
    }
    next();
  };
};

// Login User (via email + password)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Please provide email and password.' });
  }

  try {
    const users = await db.query('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!users || users.length === 0) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const user = users[0];

    // Check status
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ message: 'Your account is currently inactive or suspended.' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        fullname: user.fullname,
        role: user.role,
        lga_id: user.lga_id,
        ward_id: user.ward_id,
        polling_unit_id: user.polling_unit_id
      },
      process.env.JWT_SECRET || 'MAA_SITUATION_ROOM_SECRET_KEY',
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullname: user.fullname,
        role: user.role,
        lga_id: user.lga_id,
        ward_id: user.ward_id,
        polling_unit_id: user.polling_unit_id
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
});

// Get Current User Profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const users = await db.query(
      `SELECT u.id, u.email, u.fullname, u.phone, u.role, u.lga_id, u.ward_id, u.polling_unit_id, u.status, u.created_at,
              l.name as lga_name, w.name as ward_name, pu.name as polling_unit_name, pu.code as polling_unit_code
       FROM users u
       LEFT JOIN lgas l ON u.lga_id = l.id
       LEFT JOIN wards w ON u.ward_id = w.id
       LEFT JOIN polling_units pu ON u.polling_unit_id = pu.id
       WHERE u.id = ?`,
      [req.user.id]
    );
    if (users.length === 0) {
      return res.status(404).json({ message: 'User not found.' });
    }
    res.json(users[0]);
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({ message: 'Internal Server Error.' });
  }
});

export default router;
