const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createMemoryUserRepo } = require('./memoryUserRepo');
const { createMemoryProfileRepo } = require('./memoryProfileRepo');
const { scoreAssessment, ValidationError, publicQuestionnaire } = require('../src/domain/risk');

const goal = { type: 'retirement', targetAmount: 500000, targetYears: 25, monthlyContribution: 400 };
const all = (letter) => ({ horizon: letter, income: letter, share: letter, drop: letter, experience: letter, tradeoff: letter });

describe('scoring rules (pure functions)', () => {
  test('all cautious answers -> conservative', () => {
    const r = scoreAssessment({ answers: all('a'), goal });
    assert.equal(r.band, 'conservative');
    assert.deepEqual(r.scores, { capacity: 3, tolerance: 3 });
  });

  test('all adventurous answers with a long horizon -> growth', () => {
    const r = scoreAssessment({ answers: all('d'), goal });
    assert.equal(r.band, 'growth');
    assert.equal(r.limitedBy, null);
  });

  test('capacity below tolerance is reported as the limiting factor', () => {
    const answers = { horizon: 'b', income: 'a', share: 'a', drop: 'd', experience: 'd', tradeoff: 'd' }; // capacity 4, tolerance 12
    const r = scoreAssessment({ answers, goal });
    assert.equal(r.bands.capacity, 'conservative');
    assert.equal(r.bands.tolerance, 'growth');
    assert.equal(r.band, 'conservative');
    assert.equal(r.limitedBy, 'capacity');
  });

  test('tolerance below capacity is reported as the limiting factor', () => {
    const answers = { horizon: 'd', income: 'd', share: 'd', drop: 'a', experience: 'a', tradeoff: 'a' }; // capacity 12, tolerance 3
    const r = scoreAssessment({ answers, goal });
    assert.equal(r.band, 'conservative');
    assert.equal(r.limitedBy, 'tolerance');
  });

  test('money needed within 3 years is capped at conservative (answer)', () => {
    const answers = { ...all('d'), horizon: 'a' };
    const r = scoreAssessment({ answers, goal });
    assert.equal(r.band, 'conservative');
    assert.equal(r.limitedBy, 'horizon');
  });

  test('money needed within 3 years is capped at conservative (goal date)', () => {
    const r = scoreAssessment({ answers: all('d'), goal: { ...goal, targetYears: 2 } });
    assert.equal(r.band, 'conservative');
    assert.equal(r.limitedBy, 'horizon');
  });

  test('band boundaries: sum 6 is conservative, sum 9 is balanced, sum 10 is growth', () => {
    assert.equal(scoreAssessment({ answers: all('b'), goal }).band, 'conservative'); // 6 and 6
    assert.equal(scoreAssessment({ answers: all('c'), goal }).band, 'balanced'); // 9 and 9
    const ten = { horizon: 'd', income: 'd', share: 'b', drop: 'd', experience: 'd', tradeoff: 'b' }; // 10 and 10
    assert.equal(scoreAssessment({ answers: ten, goal }).band, 'growth');
  });

  test('rejects missing or unknown answers and bad goals', () => {
    const { tradeoff, ...missing } = all('b');
    assert.throws(() => scoreAssessment({ answers: missing, goal }), ValidationError);
    assert.throws(() => scoreAssessment({ answers: { ...all('b'), drop: 'z' }, goal }), ValidationError);
    assert.throws(() => scoreAssessment({ answers: all('b'), goal: { ...goal, type: 'yacht' } }), ValidationError);
    assert.throws(() => scoreAssessment({ answers: all('b'), goal: { ...goal, targetAmount: -5 } }), ValidationError);
    assert.throws(() => scoreAssessment({ answers: all('b'), goal: { ...goal, targetYears: 2.5 } }), ValidationError);
    assert.throws(() => scoreAssessment({ answers: all('b'), goal: { ...goal, targetYears: 99 } }), ValidationError);
    assert.throws(() => scoreAssessment({ answers: all('b'), goal: { ...goal, monthlyContribution: -1 } }), ValidationError);
  });

  test('the public questionnaire never leaks points', () => {
    assert.ok(!JSON.stringify(publicQuestionnaire()).includes('points'));
  });
});

describe('risk API', () => {
  const SECRET = 'test-secret-that-is-at-least-32-characters-long';
  let server, base, token, token2;

  before(async () => {
    const app = createApp({
      userRepo: createMemoryUserRepo(),
      profileRepo: createMemoryProfileRepo(),
      jwtSecret: SECRET,
    });
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://127.0.0.1:${server.address().port}`;
    const reg = async (email) => {
      const r = await fetch(base + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'correct horse battery', name: 'T' }),
      });
      return (await r.json()).token;
    };
    token = await reg('one@example.com');
    token2 = await reg('two@example.com');
  });
  after(() => server.close());

  const call = (path, { method = 'GET', body, tok } = {}) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  test('questionnaire is public', async () => {
    const r = await call('/api/risk/questionnaire');
    assert.equal(r.status, 200);
    const q = await r.json();
    assert.equal(q.questions.length, 6);
  });

  test('assessment endpoints need a login', async () => {
    assert.equal((await call('/api/risk/assessment')).status, 401);
    assert.equal((await call('/api/risk/assessment', { method: 'POST', body: {} })).status, 401);
  });

  test('no assessment yet -> null', async () => {
    const r = await call('/api/risk/assessment', { tok: token });
    assert.deepEqual(await r.json(), { assessment: null, previousCount: 0 });
  });

  test('server ignores a band or score sent by the browser', async () => {
    const r = await call('/api/risk/assessment', {
      method: 'POST', tok: token,
      body: { answers: all('a'), goal, band: 'growth', score: 999, scores: { capacity: 12 } },
    });
    assert.equal(r.status, 201);
    const { assessment } = await r.json();
    assert.equal(assessment.band, 'conservative');
  });

  test('invalid submission gives a clear 400', async () => {
    const r = await call('/api/risk/assessment', { method: 'POST', tok: token, body: { answers: { horizon: 'a' }, goal } });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /answer the question/i);
  });

  test('retake replaces current and keeps history; users are isolated', async () => {
    await call('/api/risk/assessment', { method: 'POST', tok: token, body: { answers: all('c'), goal } });
    const mine = await (await call('/api/risk/assessment', { tok: token })).json();
    assert.equal(mine.assessment.band, 'balanced');
    assert.equal(mine.previousCount, 1); // the first submission (conservative) is kept as history

    const theirs = await (await call('/api/risk/assessment', { tok: token2 })).json();
    assert.equal(theirs.assessment, null);
  });
});
