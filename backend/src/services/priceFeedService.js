// Wires the flaky mock NAV provider up to the two resilience adapters (retry, circuit
// breaker) and adds one more thing a real integration always needs: something to show
// the user when the live call genuinely can't be completed. Rather than a 500 error, a
// failed price fetch falls back to the last prices we successfully fetched, clearly
// marked `stale: true` - a stale price is far more useful to show than nothing, as long
// as it's honestly labelled as stale.
//
// Everything is injectable (provider, retry/breaker options) so this can be composed
// once for the real server and differently for tests.
const { withRetry } = require('../adapters/withRetry');
const { createCircuitBreaker } = require('../adapters/circuitBreaker');
const { createMockPriceProvider } = require('../adapters/mockPriceProvider');

function createPriceFeedService({ provider, retryOptions = {}, breakerOptions = {} } = {}) {
  const priceProvider = provider || createMockPriceProvider();
  const breaker = createCircuitBreaker({ name: 'price-feed', failureThreshold: 3, cooldownMs: 5000, ...breakerOptions });

  // The last successful fetch, kept in memory only (this is a learning-project mock, not
  // a durable cache - restarting the server just means "no fallback yet" again, same as
  // a real cache would look on a cold start).
  let lastGood = null; // { prices: Map<fundId, {fundId, price, asOf}> }

  async function getPrices(fundIds) {
    try {
      const fresh = await breaker.exec(() => withRetry(() => priceProvider.getPrices(fundIds), { attempts: 3, baseDelayMs: 50, ...retryOptions }));
      lastGood = { prices: new Map(fresh.map((p) => [p.fundId, p])) };
      return fundIds.map((fundId) => ({ ...lastGood.prices.get(fundId), stale: false }));
    } catch {
      // Retries exhausted, or the breaker is open and didn't even try - either way, the
      // live feed is unavailable right now. Fall back to whatever we last knew.
      return fundIds.map((fundId) => {
        const cached = lastGood && lastGood.prices.get(fundId);
        return cached
          ? { fundId, price: cached.price, asOf: cached.asOf, stale: true }
          : { fundId, price: null, asOf: null, stale: true };
      });
    }
  }

  return { getPrices, _breakerState: () => breaker.getState() };
}

module.exports = { createPriceFeedService };
