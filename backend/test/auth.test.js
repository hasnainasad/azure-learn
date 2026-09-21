// Run with:  npm test      (uses Node's built-in test runner, no extra packages)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { createMemoryUserRepo } = require('./memoryUserRepo');

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
let server;
let base;
let repo;

before(async () => {
  repo = createMemoryUserRepo();
  const app = createApp({ userRepo: repo, jwtSecret: SECRET });
  await new Promise((resolve) => {
    server = app.listen(0, resolve); // port 0 = pick any free port
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const post = (path, body, headers = {}) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const good = { email: 'Asad@Example.com ', password: 'correct horse battery', name: 'Asad' };

test('register creates a user, normalises email, hides the hash', async () => {
  const res = await post('/api/auth/register', good);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.user.email, 'asad@example.com');
  assert.ok(data.token);
  assert.equal(data.user.passwordHash, undefined);
  // and the stored password is a bcrypt hash, not the plain text
  const stored = await repo.findByEmail('asad@example.com');
  assert.match(stored.passwordHash, /^\$2[aby]\$10\$/);
  assert.notEqual(stored.passwordHash, good.password);
});

test('registering the same email again (any case) gives 409', async () => {
  const res = await post('/api/auth/register', { ...good, email: 'ASAD@example.com' });
  assert.equal(res.status, 409);
});

test('register validates input', async () => {
  assert.equal((await post('/api/auth/register', { ...good, email: 'nope' })).status, 400);
  assert.equal((await post('/api/auth/register', { ...good, email: 'a@b.co', password: 'short' })).status, 400);
  assert.equal((await post('/api/auth/register', { ...good, email: 'a@b.co', name: '' })).status, 400);
  assert.equal((await post('/api/auth/register', {})).status, 400);
});

test('login works with the right password, and the token opens /me', async () => {
  const res = await post('/api/auth/login', { email: 'asad@example.com', password: good.password });
  assert.equal(res.status, 200);
  const { token } = await res.json();
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.name, 'Asad');
});

test('login gives the same 401 for wrong password and unknown email', async () => {
  const wrongPw = await post('/api/auth/login', { email: 'asad@example.com', password: 'wrong-password' });
  const noUser = await post('/api/auth/login', { email: 'ghost@example.com', password: 'whatever123' });
  assert.equal(wrongPw.status, 401);
  assert.equal(noUser.status, 401);
  assert.deepEqual(await wrongPw.json(), await noUser.json());
});

test('/me rejects missing, garbage, wrongly-signed and expired tokens', async () => {
  const me = (h) => fetch(base + '/api/auth/me', { headers: h });
  assert.equal((await me({})).status, 401);
  assert.equal((await me({ Authorization: 'Bearer garbage' })).status, 401);

  const forged = jwt.sign({ sub: '1' }, 'a-different-secret-that-is-long-enough-xx');
  assert.equal((await me({ Authorization: `Bearer ${forged}` })).status, 401);

  const expired = jwt.sign({ sub: '1' }, SECRET, { expiresIn: -10 });
  assert.equal((await me({ Authorization: `Bearer ${expired}` })).status, 401);

  const noneAlg = jwt.sign({ sub: '1' }, '', { algorithm: 'none' });
  assert.equal((await me({ Authorization: `Bearer ${noneAlg}` })).status, 401);
});

test('malformed JSON gives a clean 400 and unknown API paths a JSON 404', async () => {
  const bad = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);
  const nf = await fetch(base + '/api/nope');
  assert.equal(nf.status, 404);
  assert.deepEqual(await nf.json(), { error: 'Not found' });
});
