const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createCircuitBreaker, CircuitOpenError } = require('../src/adapters/circuitBreaker');

// A controllable fake clock: tests advance it explicitly instead of waiting on a real
// timer, so "the cooldown has passed" is instant and exact.
function fakeClock(startAt = 0) {
  let now = startAt;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  return clock;
}

describe('createCircuitBreaker', () => {
  test('starts closed and stays closed while calls succeed', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 });
    assert.equal(breaker.getState(), 'closed');
    await breaker.exec(async () => 'ok');
    await breaker.exec(async () => 'ok');
    assert.equal(breaker.getState(), 'closed');
  });

  test('opens after reaching the failure threshold, and stops calling the function while open', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 });
    const failing = async () => { throw new Error('down'); };

    await assert.rejects(() => breaker.exec(failing));
    await assert.rejects(() => breaker.exec(failing));
    assert.equal(breaker.getState(), 'closed'); // 2 failures, threshold is 3 - not open yet
    await assert.rejects(() => breaker.exec(failing));
    assert.equal(breaker.getState(), 'open'); // 3rd failure trips it

    let calledWhileOpen = false;
    await assert.rejects(
      () => breaker.exec(async () => { calledWhileOpen = true; return 'unreachable'; }),
      CircuitOpenError,
    );
    assert.equal(calledWhileOpen, false, 'the underlying call must not run while the breaker is open');
  });

  test('a success before the threshold resets the consecutive-failure count', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 });
    const failing = async () => { throw new Error('down'); };

    await assert.rejects(() => breaker.exec(failing));
    await assert.rejects(() => breaker.exec(failing));
    await breaker.exec(async () => 'ok'); // resets the streak
    await assert.rejects(() => breaker.exec(failing));
    await assert.rejects(() => breaker.exec(failing));
    // Only 2 consecutive failures since the reset - still below threshold 3.
    assert.equal(breaker.getState(), 'closed');
  });

  test('after the cooldown, lets one trial call through (half-open) and closes again on success', async () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker({ failureThreshold: 1, cooldownMs: 5000, clock });
    await assert.rejects(() => breaker.exec(async () => { throw new Error('down'); }));
    assert.equal(breaker.getState(), 'open');

    clock.advance(4999);
    assert.equal(breaker.getState(), 'open', 'cooldown has not fully elapsed yet');

    clock.advance(1);
    assert.equal(breaker.getState(), 'half-open');

    const result = await breaker.exec(async () => 'recovered');
    assert.equal(result, 'recovered');
    assert.equal(breaker.getState(), 'closed');
  });

  test('a failed half-open trial goes straight back to open (does not need to re-earn the full threshold)', async () => {
    const clock = fakeClock();
    const breaker = createCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000, clock });
    const failing = async () => { throw new Error('down'); };

    await assert.rejects(() => breaker.exec(failing));
    await assert.rejects(() => breaker.exec(failing));
    await assert.rejects(() => breaker.exec(failing));
    assert.equal(breaker.getState(), 'open');

    clock.advance(1000);
    assert.equal(breaker.getState(), 'half-open');
    await assert.rejects(() => breaker.exec(failing)); // the trial call itself fails
    assert.equal(breaker.getState(), 'open', 'one failed trial is enough to re-open, not another 3 failures');
  });
});
