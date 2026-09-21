const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { publicQuestionnaire, scoreAssessment, ValidationError } = require('../domain/risk');

function riskRoutes({ profileRepo, jwtSecret }) {
  const router = express.Router();

  // The questions themselves are not secret, so no login needed
  router.get('/questionnaire', (req, res) => {
    res.json(publicQuestionnaire());
  });

  router.use(requireAuth(jwtSecret));

  // Latest assessment for the logged-in user (assessment is null if they have not done one)
  router.get('/assessment', async (req, res, next) => {
    try {
      const profile = await profileRepo.getByUserId(req.userId);
      res.json({
        assessment: profile ? profile.current : null,
        previousCount: profile ? Math.max(profile.history.length - 1, 0) : 0,
      });
    } catch (err) {
      next(err);
    }
  });

  // Score on the SERVER. The browser only sends answers, never a score or a band.
  router.post('/assessment', async (req, res, next) => {
    try {
      const { answers, goal } = req.body || {};
      const assessment = scoreAssessment({ answers, goal });
      await profileRepo.save(req.userId, assessment);
      res.status(201).json({ assessment });
    } catch (err) {
      if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
      next(err);
    }
  });

  return router;
}

module.exports = { riskRoutes };
