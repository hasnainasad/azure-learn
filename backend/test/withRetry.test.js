const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { withRetry } = require('../src/adapters/withRetry');

// A fake delay that resolves instantly but still records what it was asked to wait, so
// tests can assert on backoff timing without a single real setTimeout.
function fakeDelay(log) {
  return (ms) => { log.push(ms); return Promise.resolve(); };
}

describe('withRetry', () => {
  test('returns the result immediately when the first attempt succeeds, no delay used', async () => {
    const log = [];
    const result = await withRetry(async () => 'ok', { delayFn: fakeDelay(log) });
    assert.equal(result, 'ok');
    assert.deepEqual(log, []);
  });

  test('retries after a failure and returns the eventual success', async () => {
    const log = [];
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'ok after retries';
    };
    const result = await withRetry(fn, { attempts: 5, baseDelayMs: 100, delayFn: fakeDelay(log) });
    assert.equal(result, 'ok after retries');
    assert.equal(calls, 3);
    // Two failures before success -> two backoff waits, exponential from baseDelayMs.
    assert.deepEqual(log, [100, 200]);
  });

  test('gives up after the configured attempts and throws the last error', async () => {
    const log = [];
    let calls = 0;
    const fn = async () => {
      calls += 1;
      throw new Error(`fail #${calls}`);
    };
    await assert.rejects(
      () => withRetry(fn, { attempts: 3, baseDelayMs: 50, delayFn: fakeDelay(log) }),
      /fail #3/,
    );
    assert.equal(calls, 3);
    // No wait is scheduled after the final (3rd) failed attempt - nothing more to try.
    assert.deepEqual(log, [50, 100]);
  });

  test('passes the attempt number through, in case a caller wants it for logging', async () => {
    const seen = [];
    let calls = 0;
    await withRetry(async (attempt) => {
      calls += 1;
      seen.push(attempt);
      if (calls < 2) throw new Error('retry me');
      return 'done';
    }, { attempts: 3, delayFn: () => Promise.resolve() });
    assert.deepEqual(seen, [1, 2]);
  });
});
