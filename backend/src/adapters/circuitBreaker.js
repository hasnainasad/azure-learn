// A minimal circuit breaker: the classic pattern for not hammering a dependency that is
// already down. Three states:
//   closed     - normal operation; calls go through.
//   open       - too many recent failures; calls are rejected immediately, without
//                even attempting the underlying call, until the cooldown passes.
//   half-open  - the cooldown has passed; the NEXT call is let through as a trial. If it
//                succeeds we go back to closed, if it fails we go back to open.
//
// This is deliberately hand-rolled rather than an npm package: the app stays free of
// new dependencies (see the "no new npm packages" note in allocation.js/funds.js), and
// the whole pattern is small enough to read end to end, which is the point of a
// learning project.
//
// `clock` defaults to Date.now but tests inject a fake so "wait for the cooldown" is
// instant instead of a real sleep.
class CircuitOpenError extends Error {
  constructor(name) {
    super(`Circuit "${name}" is open - not attempting the call`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
  }
}

function createCircuitBreaker({ name = 'default', failureThreshold = 3, cooldownMs = 5000, clock = Date.now } = {}) {
  let state = 'closed';
  let consecutiveFailures = 0;
  let openedAt = null;

  function maybeRecoverFromOpen() {
    if (state === 'open' && clock() - openedAt >= cooldownMs) {
      state = 'half-open';
    }
  }

  async function exec(fn) {
    maybeRecoverFromOpen();

    if (state === 'open') {
      throw new CircuitOpenError(name);
    }

    try {
      const result = await fn();
      // Any success, whether we were closed or trialing in half-open, clears the slate.
      state = 'closed';
      consecutiveFailures = 0;
      openedAt = null;
      return result;
    } catch (err) {
      consecutiveFailures += 1;
      if (state === 'half-open' || consecutiveFailures >= failureThreshold) {
        state = 'open';
        openedAt = clock();
      }
      throw err;
    }
  }

  return {
    exec,
    getState: () => {
      maybeRecoverFromOpen();
      return state;
    },
  };
}

module.exports = { createCircuitBreaker, CircuitOpenError };
