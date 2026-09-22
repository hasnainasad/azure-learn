const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createMockPriceProvider, navForFundToday } = require('../src/adapters/mockPriceProvider');

// Replays a fixed sequence of "random" numbers instead of Math.random(), so a test can
// pin down exactly which branch (success vs simulated failure) the provider takes.
function queuedRandom(values) {
  let i = 0;
  return () => values[i++];
}
function fakeDelay(log) {
  return (ms) => { log.push(ms); return Promise.resolve(); };
}

describe('navForFundToday (the deterministic part of the mock)', () => {
  test('is stable for the same fund and day', () => {
    assert.equal(navForFundToday('equity-global-index', '2026-09-22'), navForFundToday('equity-global-index', '2026-09-22'));
  });

  test('differs across funds and across days (not literally always, but these two chosen cases do)', () => {
    assert.notEqual(navForFundToday('equity-global-index', '2026-09-22'), navForFundToday('bond-gov-global', '2026-09-22'));
    assert.notEqual(navForFundToday('equity-global-index', '2026-09-22'), navForFundToday('equity-global-index', '2026-09-23'));
  });

  test('lands in a plausible NAV range', () => {
    const p = navForFundToday('equity-global-index', '2026-09-22');
    assert.ok(p > 5 && p < 150, `expected a plausible unit price, got ${p}`);
  });
});

describe('createMockPriceProvider', () => {
  const FUND_IDS = ['equity-global-index', 'bond-gov-global'];
  const FIXED_NOW = new Date('2026-09-22T12:00:00.000Z').getTime();

  test('succeeds when the failure roll clears the failure rate, and waits a latency in the configured range', async () => {
    const delayLog = [];
    // sequence: [latency roll, failure roll, jitter fund1, jitter fund2]
    const provider = createMockPriceProvider({
      failureRate: 0.2,
      minLatencyMs: 40,
      maxLatencyMs: 300,
      randomFn: queuedRandom([0.5, 0.9, 0.5, 0.5]), // 0.9 >= 0.2 failure rate -> no failure
      delayFn: fakeDelay(delayLog),
      now: () => FIXED_NOW,
    });

    const prices = await provider.getPrices(FUND_IDS);

    assert.deepEqual(delayLog, [40 + 0.5 * (300 - 40)]);
    assert.equal(prices.length, 2);
    for (const p of prices) {
      assert.equal(p.asOf, '2026-09-22T12:00:00.000Z');
      assert.ok(typeof p.price === 'number' && p.price > 0);
    }
    assert.deepEqual(prices.map((p) => p.fundId), FUND_IDS);
  });

  test('throws when the failure roll lands inside the failure rate - this is the simulated outage', async () => {
    const provider = createMockPriceProvider({
      failureRate: 0.5,
      randomFn: queuedRandom([0.5, 0.1]), // 0.1 < 0.5 failure rate -> simulated failure
      delayFn: fakeDelay([]),
      now: () => FIXED_NOW,
    });

    await assert.rejects(() => provider.getPrices(FUND_IDS), /upstream timeout/);
  });

  test('a zero failure rate never fails, however unlucky the roll', async () => {
    const provider = createMockPriceProvider({
      failureRate: 0,
      randomFn: () => 0, // the unluckiest possible roll
      delayFn: fakeDelay([]),
      now: () => FIXED_NOW,
    });
    const prices = await provider.getPrices(FUND_IDS);
    assert.equal(prices.length, 2);
  });
});
