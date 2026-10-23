import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/db.js';
import { config } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    if (password.length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters long.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await db.createUser({
      email: normalizedEmail,
      passwordHash
    });

    const token = generateToken(newUser);

    return res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: {
        id: newUser.id,
        email: newUser.email,
        createdAt: newUser.created_at
      }
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    return res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (typeof email !== 'string' || typeof password !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || Buffer.byteLength(password) > 72) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await db.findUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    return res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        email: user.email,
        createdAt: user.created_at
      }
    });
  } catch (err) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  return res.json({
    user: req.user
  });
});

export default router;
