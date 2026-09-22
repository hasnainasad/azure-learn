const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { FUNDS } = require('../domain/funds');

// The catalog is reference data, not personalized advice, so any logged-in user can
// browse it - the gating (risk profile + approved KYC) only applies to the
// PERSONALIZED recommendation in routes/recommendation.js.
function fundsRoutes({ jwtSecret }) {
  const router = express.Router();
  router.use(requireAuth(jwtSecret));

  router.get('/catalog', (req, res) => {
    res.json({ funds: FUNDS });
  });

  return router;
}

module.exports = { fundsRoutes };
