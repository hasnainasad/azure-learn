const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryUserRepo } = require('./memoryUserRepo');
const { createMemoryKycRepo } = require('./memoryKycRepo');
const { validateKycSubmission, validateDecision, ValidationError, ageFromDob } = require('../src/domain/kyc');

const goodSubmission = {
  legalName: 'Asad Hasnain',
  dob: '1990-06-15',
  address: { line1: '1 High Street', city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom' },
  documentType: 'passport',
  documentFileName: 'passport-scan.pdf',
};

describe('KYC validation (pure functions)', () => {
  test('accepts a well-formed submission', () => {
    const clean = validateKycSubmission(goodSubmission);
    assert.equal(clean.legalName, 'Asad Hasnain');
    assert.equal(clean.documentType, 'passport');
  });

  test('rejects someone under 18', () => {
    const dob18Minus1Day = new Date();
    dob18Minus1Day.setUTCFullYear(dob18Minus1Day.getUTCFullYear() - 18);
    dob18Minus1Day.setUTCDate(dob18Minus1Day.getUTCDate() + 1); // one day short of 18
    const iso = dob18Minus1Day.toISOString().slice(0, 10);
    assert.throws(() => validateKycSubmission({ ...goodSubmission, dob: iso }), ValidationError);
  });

  test('accepts someone exactly 18 today', () => {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - 18);
    const iso = d.toISOString().slice(0, 10);
    assert.doesNotThrow(() => validateKycSubmission({ ...goodSubmission, dob: iso }));
  });

  test('rejects a future date of birth and a bogus date', () => {
    assert.throws(() => validateKycSubmission({ ...goodSubmission, dob: '2999-01-01' }), ValidationError);
    assert.throws(() => validateKycSubmission({ ...goodSubmission, dob: 'not-a-date' }), ValidationError);
    assert.throws(() => validateKycSubmission({ ...goodSubmission, dob: '1990-13-40' }), ValidationError);
  });

  test('rejects a bad document type and missing address fields', () => {
    assert.throws(() => validateKycSubmission({ ...goodSubmission, documentType: 'napkin' }), ValidationError);
    assert.throws(() => validateKycSubmission({ ...goodSubmission, address: { ...goodSubmission.address, city: '' } }), ValidationError);
    assert.throws(() => validateKycSubmission({ ...goodSubmission, address: null }), ValidationError);
  });

  test('rejects an empty legal name or missing file name', () => {
    assert.throws(() => validateKycSubmission({ ...goodSubmission, legalName: '  ' }), ValidationError);
    assert.throws(() => validateKycSubmission({ ...goodSubmission, documentFileName: '' }), ValidationError);
  });

  test('ageFromDob counts whole years, respecting the birthday', () => {
    const tenYearsAgoTomorrow = new Date();
    tenYearsAgoTomorrow.setUTCFullYear(tenYearsAgoTomorrow.getUTCFullYear() - 10);
    tenYearsAgoTomorrow.setUTCDate(tenYearsAgoTomorrow.getUTCDate() + 1);
    assert.equal(ageFromDob(tenYearsAgoTomorrow.toISOString().slice(0, 10)), 9);
  });

  test('decisions: rejected needs a reason, approved does not', () => {
    assert.throws(() => validateDecision({ decision: 'rejected' }), ValidationError);
    assert.throws(() => validateDecision({ decision: 'rejected', reason: '' }), ValidationError);
    const ok = validateDecision({ decision: 'rejected', reason: 'Document photo is blurry' });
    assert.equal(ok.reason, 'Document photo is blurry');
    assert.deepEqual(validateDecision({ decision: 'approved' }), { decision: 'approved', reason: null });
    assert.throws(() => validateDecision({ decision: 'maybe' }), ValidationError);
  });
});

describe('KYC API', () => {
  const SECRET = 'test-secret-that-is-at-least-32-characters-long';
  let server, base, userRepo, kycRepo, userToken, userId, adminToken;

  before(async () => {
    userRepo = createMemoryUserRepo();
    kycRepo = createMemoryKycRepo();
    const app = createApp({ userRepo, profileRepo: null, kycRepo, jwtSecret: SECRET });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;

    const reg = async (email) => {
      const r = await fetch(base + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'correct horse battery', name: 'T' }),
      });
      return r.json();
    };
    const u = await reg('applicant@example.com');
    userToken = u.token;
    userId = u.user.id;
    const a = await reg('admin@example.com');
    userRepo._setRole(a.user.id, 'admin');
    // log in again so the token payload story is realistic (role isn't in the token anyway,
    // requireAdmin re-checks the database every time - but this keeps intent clear)
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

  test('status requires login and starts as not_submitted', async () => {
    assert.equal((await call('/api/kyc/status')).status, 401);
    const r = await call('/api/kyc/status', { tok: userToken });
    assert.deepEqual(await r.json(), { kyc: { status: 'not_submitted' } });
  });

  test('an ordinary user cannot reach the admin routes', async () => {
    assert.equal((await call('/api/kyc/admin/pending', { tok: userToken })).status, 403);
    assert.equal((await call(`/api/kyc/admin/${userId}/decision`, { method: 'POST', tok: userToken, body: { decision: 'approved' } })).status, 403);
  });

  test('submitting bad data gives 400 and does not create a record', async () => {
    const r = await call('/api/kyc/submit', { method: 'POST', tok: userToken, body: { ...goodSubmission, documentType: 'napkin' } });
    assert.equal(r.status, 400);
    const status = await (await call('/api/kyc/status', { tok: userToken })).json();
    assert.equal(status.kyc.status, 'not_submitted');
  });

  test('submitting good data moves status to pending and shows up for admin', async () => {
    const r = await call('/api/kyc/submit', { method: 'POST', tok: userToken, body: goodSubmission });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).kyc.status, 'pending');

    const mine = await (await call('/api/kyc/status', { tok: userToken })).json();
    assert.equal(mine.kyc.status, 'pending');
    // the applicant should never see the admin-only fields on their own status view
    assert.equal(mine.kyc.applicantEmail, undefined);

    const pending = await (await call('/api/kyc/admin/pending', { tok: adminToken })).json();
    assert.equal(pending.records.length, 1);
    assert.equal(pending.records[0].applicantEmail, 'applicant@example.com');
  });

  // Regression test for a real bug hit in deployment: Cosmos DB for MongoDB rejects a
  // server-side ORDER BY on a field its default indexing policy doesn't cover (it fails
  // with "The index path corresponding to the specified order-by item is excluded"),
  // so listByStatus sorts in JavaScript instead of with Mongo's .sort(). This proves the
  // queue still comes back oldest-submitted-first.
  test('admin queue returns pending submissions oldest first', async () => {
    const submitAs = async (email) => {
      const r = await fetch(base + '/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'correct horse battery', name: 'T' }),
      });
      const { token } = await r.json();
      await call('/api/kyc/submit', { method: 'POST', tok: token, body: goodSubmission });
    };
    const emails = ['queue-1@example.com', 'queue-2@example.com', 'queue-3@example.com'];
    for (const email of emails) await submitAs(email); // sequential, so timestamps are non-decreasing

    const pending = await (await call('/api/kyc/admin/pending', { tok: adminToken })).json();
    const orderSeen = pending.records.map((r) => r.applicantEmail).filter((e) => emails.includes(e));
    assert.deepEqual(orderSeen, emails);
  });

  test('admin rejection requires a reason and updates status', async () => {
    const bad = await call(`/api/kyc/admin/${userId}/decision`, { method: 'POST', tok: adminToken, body: { decision: 'rejected' } });
    assert.equal(bad.status, 400);

    const ok = await call(`/api/kyc/admin/${userId}/decision`, { method: 'POST', tok: adminToken, body: { decision: 'rejected', reason: 'Blurry photo' } });
    assert.equal(ok.status, 200);

    const mine = await (await call('/api/kyc/status', { tok: userToken })).json();
    assert.equal(mine.kyc.status, 'rejected');
    assert.equal(mine.kyc.rejectionReason, 'Blurry photo');
  });

  test('a rejected user can resubmit, moving back to pending', async () => {
    const r = await call('/api/kyc/submit', { method: 'POST', tok: userToken, body: goodSubmission });
    assert.equal(r.status, 201);
    assert.equal((await r.json()).kyc.status, 'pending');
  });

  test('approving locks the record: resubmission is blocked, re-deciding fails', async () => {
    const approve = await call(`/api/kyc/admin/${userId}/decision`, { method: 'POST', tok: adminToken, body: { decision: 'approved' } });
    assert.equal(approve.status, 200);

    const blocked = await call('/api/kyc/submit', { method: 'POST', tok: userToken, body: goodSubmission });
    assert.equal(blocked.status, 409);

    const again = await call(`/api/kyc/admin/${userId}/decision`, { method: 'POST', tok: adminToken, body: { decision: 'rejected', reason: 'x' } });
    assert.equal(again.status, 409); // no longer pending, so there's nothing to decide
  });

  test('deciding on someone with no submission gives 409, not a crash', async () => {
    const r = await call('/api/kyc/admin/000000000000000000000000/decision', { method: 'POST', tok: adminToken, body: { decision: 'approved' } });
    assert.equal(r.status, 409);
  });
});
