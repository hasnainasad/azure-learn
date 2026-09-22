const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { validateKycSubmission, validateDecision, ValidationError } = require('../domain/kyc');

// What the SUBMITTING user is allowed to see about their own record (no need to hide
// anything from themselves, but keep the shape explicit rather than "whatever's in Mongo").
function publicRecord(r) {
  if (!r) return null;
  const { userId, applicantEmail, applicantName, history, ...rest } = r;
  return rest;
}

function kycRoutes({ kycRepo, userRepo, jwtSecret }) {
  const router = express.Router();
  router.use(requireAuth(jwtSecret));

  router.get('/status', async (req, res, next) => {
    try {
      const record = await kycRepo.getByUserId(req.userId);
      res.json({ kyc: publicRecord(record) || { status: 'not_submitted' } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/submit', async (req, res, next) => {
    try {
      const existing = await kycRepo.getByUserId(req.userId);
      if (existing && existing.status === 'approved') {
        return res.status(409).json({ error: 'Your identity is already verified' });
      }
      const clean = validateKycSubmission(req.body);
      const user = await userRepo.findById(req.userId);
      const record = await kycRepo.submit(req.userId, clean, { email: user.email, name: user.name });
      res.status(201).json({ kyc: publicRecord(record) });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  // --- Admin only, from here down ---
  router.use('/admin', requireAdmin(userRepo));

  router.get('/admin/pending', async (req, res, next) => {
    try {
      const records = await kycRepo.listByStatus('pending');
      res.json({ records });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/:userId/decision', async (req, res, next) => {
    try {
      const { decision, reason } = validateDecision(req.body);
      const ok = await kycRepo.decide(req.params.userId, { decision, reviewedBy: req.adminUser.id, reason });
      if (!ok) return res.status(409).json({ error: 'No pending submission found for that user' });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  return router;
}

module.exports = { kycRoutes };
