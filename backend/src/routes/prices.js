const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { FUNDS } = require('../domain/funds');

// Live pricing, like the catalog, is reference data rather than personalized advice -
// any logged-in user can see it, no risk-profile/KYC gating here. The route never has
// to think about the mock feed being flaky: priceFeedService.getPrices() already
// retried, tripped its breaker, and fallen back to a stale price if needed - by the
// time it gets here, this is just "return whatever it says".
function pricesRoutes({ priceFeedService, jwtSecret }) {
  const router = express.Router();
  router.use(requireAuth(jwtSecret));

  router.get('/', async (req, res, next) => {
    try {
      const fundIds = FUNDS.map((f) => f.id);
      const prices = await priceFeedService.getPrices(fundIds);
      res.json({ prices });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { pricesRoutes };
