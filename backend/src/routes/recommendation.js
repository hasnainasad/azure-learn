const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { buildRecommendation } = require('../domain/allocation');

// A recommendation is derived, not stored: it's recomputed from whatever the user's
// CURRENT risk profile and goal are, so retaking the questionnaire changes it
// immediately with nothing to keep in sync. Gated on two things a real advisor would
// also require before giving advice: a completed risk profile, and approved identity
// verification (slices 2 and 3).
function recommendationRoutes({ profileRepo, kycRepo, jwtSecret }) {
  const router = express.Router();
  router.use(requireAuth(jwtSecret));

  router.get('/', async (req, res, next) => {
    try {
      const profile = await profileRepo.getByUserId(req.userId);
      if (!profile || !profile.current) {
        return res.status(409).json({ error: 'Complete your risk profile first', reason: 'risk_profile_required' });
      }

      const kyc = await kycRepo.getByUserId(req.userId);
      if (!kyc || kyc.status !== 'approved') {
        return res.status(403).json({
          error: 'Identity verification must be approved before we can recommend funds',
          reason: 'kyc_required',
          kycStatus: kyc ? kyc.status : 'not_submitted',
        });
      }

      const recommendation = buildRecommendation({ band: profile.current.band, goal: profile.current.goal });
      res.json({ recommendation });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { recommendationRoutes };
