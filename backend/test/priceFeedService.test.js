const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createPriceFeedService } = require('../src/services/priceFeedService');

// A scripted stand-in for the real (mock) NAV provider: each call to getPrices()
// consumes the next entry in `outcomes`, either returning a price for every requested
// fund or throwing. This lets each test dictate exactly which attempts succeed or fail,
// instead of depending on the real mock provider's randomness.
function makeFakeProvider(outcomes) {
  let callCount = 0;
  return {
    callCount: () => callCount,
    getPrices: async (fundIds) => {
      const outcome = outcomes[callCount];
      callCount += 1;
      if (!outcome) throw new Error('fake provider: ran out of scripted outcomes');
      if (outcome.fail) throw new Error(outcome.fail);
      return fundIds.map((fundId) => ({ fundId, price: outcome.price, asOf: outcome.asOf }));
    },
  };
}
const NO_DELAY = { delayFn: () => Promise.resolve() };

describe('createPriceFeedService', () => {
  test('returns fresh, non-stale prices when the provider succeeds', async () => {
    const provider = makeFakeProvider([{ price: 42, asOf: 't1' }]);
    const service = createPriceFeedService({ provider, retryOptions: { attempts: 1, ...NO_DELAY } });
    const prices = await service.getPrices(['fund-a', 'fund-b']);
    assert.deepEqual(prices, [
      { fundId: 'fund-a', price: 42, asOf: 't1', stale: false },
      { fundId: 'fund-b', price: 42, asOf: 't1', stale: false },
    ]);
  });

  test('reports "unavailable" (null price, stale) when the provider fails and there is no prior cache', async () => {
    const provider = makeFakeProvider([{ fail: 'down' }]);
    const service = createPriceFeedService({ provider, retryOptions: { attempts: 1, ...NO_DELAY } });
    const prices = await service.getPrices(['fund-a']);
    assert.deepEqual(prices, [{ fundId: 'fund-a', price: null, asOf: null, stale: true }]);
  });

  test('falls back to the last known-good price, marked stale, when a later call fails', async () => {
    const provider = makeFakeProvider([{ price: 10, asOf: 't1' }, { fail: 'down' }]);
    const service = createPriceFeedService({ provider, retryOptions: { attempts: 1, ...NO_DELAY } });
    await service.getPrices(['fund-a']); // primes the cache with a real success
    const prices = await service.getPrices(['fund-a']);
    assert.deepEqual(prices, [{ fundId: 'fund-a', price: 10, asOf: 't1', stale: true }]);
  });

  test('retries transient failures within a single call before giving up', async () => {
    const provider = makeFakeProvider([{ fail: 'blip' }, { fail: 'blip' }, { price: 7, asOf: 't3' }]);
    const service = createPriceFeedService({ provider, retryOptions: { attempts: 3, baseDelayMs: 0, ...NO_DELAY } });
    const prices = await service.getPrices(['fund-a']);
    assert.deepEqual(prices, [{ fundId: 'fund-a', price: 7, asOf: 't3', stale: false }]);
    assert.equal(provider.callCount(), 3);
  });

  test('opens the circuit breaker after repeated call failures, and stops invoking the provider while open', async () => {
    const provider = makeFakeProvider([
      { fail: 'down' }, { fail: 'down' }, { fail: 'down' }, // 3 failed calls trips a threshold-3 breaker
      { price: 99, asOf: 'unreached' }, // scripted but must never be reached while the breaker is open
    ]);
    const service = createPriceFeedService({
      provider,
      retryOptions: { attempts: 1, ...NO_DELAY },
      breakerOptions: { failureThreshold: 3, cooldownMs: 5000 },
    });

    await service.getPrices(['fund-a']);
    await service.getPrices(['fund-a']);
    await service.getPrices(['fund-a']);
    assert.equal(service._breakerState(), 'open');

    const prices = await service.getPrices(['fund-a']); // 4th call: breaker is open
    assert.deepEqual(prices, [{ fundId: 'fund-a', price: null, asOf: null, stale: true }]);
    assert.equal(provider.callCount(), 3, 'the provider must not be called again while the breaker is open');
  });

  test('recovers after the cooldown: a successful trial call closes the breaker and clears staleness', async () => {
    let now = 0;
    const clock = () => now;
    const provider = makeFakeProvider([{ fail: 'down' }, { price: 55, asOf: 't2' }]);
    const service = createPriceFeedService({
      provider,
      retryOptions: { attempts: 1, ...NO_DELAY },
      breakerOptions: { failureThreshold: 1, cooldownMs: 1000, clock },
    });

    await service.getPrices(['fund-a']);
    assert.equal(service._breakerState(), 'open');

    now += 1000; // cooldown elapses
    const prices = await service.getPrices(['fund-a']);
    assert.deepEqual(prices, [{ fundId: 'fund-a', price: 55, asOf: 't2', stale: false }]);
    assert.equal(service._breakerState(), 'closed');
  });
});
