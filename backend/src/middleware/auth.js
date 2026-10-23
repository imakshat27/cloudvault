import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { db } from '../db/db.js';

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret);

    // Verify user still exists
    const user = await db.findUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found or session expired.' });
    }

    req.user = {
      id: user.id,
      email: user.email
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session token expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
}
