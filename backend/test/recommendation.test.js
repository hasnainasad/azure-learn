const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryUserRepo } = require('./memoryUserRepo');
const { createMemoryProfileRepo } = require('./memoryProfileRepo');
const { createMemoryKycRepo } = require('./memoryKycRepo');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const goal = { type: 'retirement', targetAmount: 200000, targetYears: 20, monthlyContribution: 300 };
const kycSubmission = {
  legalName: 'Asad Hasnain',
  dob: '1990-06-15',
  address: { line1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom' },
  documentType: 'passport',
  documentFileName: 'passport.pdf',
};

describe('funds and recommendation API', () => {
  let server, base, userRepo, profileRepo, kycRepo, userToken, userId, adminToken;

  before(async () => {
    userRepo = createMemoryUserRepo();
    profileRepo = createMemoryProfileRepo();
    kycRepo = createMemoryKycRepo();
    const app = createApp({ userRepo, profileRepo, kycRepo, jwtSecret: SECRET });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;

    const reg = async (email) => {
      const r = await fetch(base + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'correct horse battery', name: 'T' }),
      });
      return r.json();
    };
    const u = await reg('client@example.com');
    userToken = u.token;
    userId = u.user.id;
    const a = await reg('admin@example.com');
    userRepo._setRole(a.user.id, 'admin');
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'correct horse battery' }),
    });
    adminToken = (await login.json()).token;
  });
  after(() => server.close());

  const call = (path, { method = 'GET', body, tok } = {}) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  test('catalog requires login but no risk profile or KYC', async () => {
    assert.equal((await call('/api/funds/catalog')).status, 401);
    const r = await call('/api/funds/catalog', { tok: userToken });
    assert.equal(r.status, 200);
    const { funds } = await r.json();
    assert.ok(funds.length >= 8);
    assert.ok(funds.every((f) => f.expenseRatio > 0));
  });

  test('recommendation requires login', async () => {
    assert.equal((await call('/api/recommendation')).status, 401);
  });

  test('recommendation is blocked before a risk profile exists', async () => {
    const r = await call('/api/recommendation', { tok: userToken });
    assert.equal(r.status, 409);
    assert.equal((await r.json()).reason, 'risk_profile_required');
  });

  test('recommendation is still blocked after a risk profile but before KYC approval', async () => {
    await call('/api/risk/assessment', {
      method: 'POST', tok: userToken,
      body: { answers: { horizon: 'd', income: 'd', share: 'd', drop: 'd', experience: 'd', tradeoff: 'd' }, goal },
    });
    const r = await call('/api/recommendation', { tok: userToken });
    assert.equal(r.status, 403);
    const body = await r.json();
    assert.equal(body.reason, 'kyc_required');
    assert.equal(body.kycStatus, 'not_submitted');
  });

  test('still blocked while KYC is pending review', async () => {
    await call('/api/kyc/submit', { method: 'POST', tok: userToken, body: kycSubmission });
    const r = await call('/api/recommendation', { tok: userToken });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).kycStatus, 'pending');
  });

  test('still blocked after a rejection, with the right status reported', async () => {
    await call(`/api/kyc/admin/${userId}/decision`, { method: 'POST', tok: adminToken, body: { decision: 'rejected', reason: 'blurry' } });
    const r = await call('/api/recommendation', { tok: userToken });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).kycStatus, 'rejected');
  });

  test('unblocked once KYC is approved: returns a growth-band recommendation summing to 100', async () => {
    await call('/api/kyc/submit', { method: 'POST', tok: userToken, body: kycSubmission });
    await call(`/api/kyc/admin/${userId}/decision`, { method: 'POST', tok: adminToken, body: { decision: 'approved' } });

    const r = await call('/api/recommendation', { tok: userToken });
    assert.equal(r.status, 200);
    const { recommendation } = await r.json();
    assert.equal(recommendation.band, 'growth'); // all-'d' answers, 20-year goal from above
    const sum = recommendation.allocation.reduce((s, a) => s + a.weightPct, 0);
    assert.equal(sum, 100);
  });

  test('recommendation follows a retake: switching to a conservative profile changes it immediately', async () => {
    await call('/api/risk/assessment', {
      method: 'POST', tok: userToken,
      body: { answers: { horizon: 'a', income: 'a', share: 'a', drop: 'a', experience: 'a', tradeoff: 'a' }, goal },
    });
    const r = await call('/api/recommendation', { tok: userToken });
    assert.equal(r.status, 200);
    const { recommendation } = await r.json();
    assert.equal(recommendation.band, 'conservative');
    const ids = recommendation.allocation.map((a) => a.fundId);
    assert.ok(!ids.includes('equity-emerging'));
  });
});
