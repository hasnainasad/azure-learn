// A generic "try again if it fails" wrapper for calling something unreliable, like a
// third-party API. Not specific to price feeds on purpose - slice 6+ integrations (e.g.
// a real KYC-verification API) can reuse this instead of each writing their own retry
// loop.
//
// `delayFn` defaults to a real setTimeout-based sleep, but tests pass a fake that
// resolves instantly, so a test exercising "3 attempts with backoff" takes
// milliseconds, not seconds.
function realDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { attempts = 3, baseDelayMs = 100, delayFn = realDelay } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === attempts;
      if (!isLastAttempt) {
        // Simple exponential backoff: 100ms, 200ms, 400ms, ... - gives a flaky
        // dependency a moment to recover instead of hammering it immediately.
        await delayFn(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }
  throw lastErr;
}

module.exports = { withRetry };
