const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryUserRepo } = require('./memoryUserRepo');
const { FUNDS } = require('../src/domain/funds');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

// A fake priceFeedService for route-level tests: the route shouldn't care HOW the
// service got its answer (live call, retry, breaker, fallback) - that's already covered
// by priceFeedService.test.js. Here we only need to prove the route wires auth and the
// response shape correctly.
function fakePriceFeedService(pricesByFundId) {
  return {
    getPrices: async (fundIds) => fundIds.map((fundId) => ({
      fundId, price: pricesByFundId[fundId] ?? null, asOf: '2026-09-22T12:00:00.000Z', stale: false,
    })),
  };
}

describe('prices API', () => {
  let server, base, token;

  before(async () => {
    const userRepo = createMemoryUserRepo();
    const priceFeedService = fakePriceFeedService(Object.fromEntries(FUNDS.map((f, i) => [f.id, 10 + i])));
    const app = createApp({ userRepo, jwtSecret: SECRET, priceFeedService });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;

    const r = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'priceuser@example.com', password: 'correct horse battery', name: 'T' }),
    });
    token = (await r.json()).token;
  });
  after(() => server.close());

  test('requires login', async () => {
    const r = await fetch(base + '/api/prices');
    assert.equal(r.status, 401);
  });

  test('returns a price entry for every fund in the catalog, using whatever priceFeedService was given', async () => {
    const r = await fetch(base + '/api/prices', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(r.status, 200);
    const { prices } = await r.json();
    assert.equal(prices.length, FUNDS.length);
    assert.deepEqual(prices.map((p) => p.fundId).sort(), FUNDS.map((f) => f.id).sort());
    for (const p of prices) {
      assert.ok(typeof p.price === 'number');
      assert.equal(typeof p.stale, 'boolean');
      assert.ok(p.asOf);
    }
  });

  test('defaults to a real (mock) price feed when none is injected - server.js style usage', async () => {
    // No priceFeedService passed here, same as production server.js: createApp() must
    // fall back to a working default rather than crash.
    const userRepo = createMemoryUserRepo();
    const app = createApp({ userRepo, jwtSecret: SECRET });
    const s = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
    const b = `http://127.0.0.1:${s.address().port}`;
    const reg = await fetch(b + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'defaultuser@example.com', password: 'correct horse battery', name: 'T' }),
    });
    const tok = (await reg.json()).token;
    const r = await fetch(b + '/api/prices', { headers: { Authorization: `Bearer ${tok}` } });
    assert.equal(r.status, 200);
    const { prices } = await r.json();
    assert.equal(prices.length, FUNDS.length);
    s.close();
  });
});
