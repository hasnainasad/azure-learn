const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { DuplicateEmailError } = require('../repositories/errors');
const { requireAuth } = require('../middleware/requireAuth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_COST = 10; // higher = slower for attackers AND for our small VM

// A real-looking hash to compare against when the email is unknown, so that
// "no such user" and "wrong password" take about the same time (no user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

// Never send the password hash to the browser
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt };
}

function authRoutes({ userRepo, jwtSecret, jwtExpiresIn = '1h' }) {
  const router = express.Router();

  const issueToken = (user) =>
    jwt.sign({ sub: user.id }, jwtSecret, { algorithm: 'HS256', expiresIn: jwtExpiresIn });

  router.post('/register', async (req, res, next) => {
    try {
      const { email, password, name } = req.body || {};
      if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
        return res.status(400).json({ error: 'A valid email is required' });
      }
      if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
        // bcrypt only uses the first 72 bytes, so we cap it instead of silently truncating
        return res.status(400).json({ error: 'Password must be 8 to 72 characters' });
      }
      if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 100) {
        return res.status(400).json({ error: 'Name is required' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      const user = await userRepo.create({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        passwordHash,
      });
      res.status(201).json({ token: issueToken(user), user: publicUser(user) });
    } catch (err) {
      if (err instanceof DuplicateEmailError) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Email and password are required' });
      }
      const user = await userRepo.findByEmail(email.trim().toLowerCase());
      const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
      if (!user || !ok) {
        // Same message for both cases on purpose
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      res.json({ token: issueToken(user), user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth(jwtSecret), async (req, res, next) => {
    try {
      const user = await userRepo.findById(req.userId);
      if (!user) return res.status(401).json({ error: 'User no longer exists' });
      res.json({ user: publicUser(user) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { authRoutes };
