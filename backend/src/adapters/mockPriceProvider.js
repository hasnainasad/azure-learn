// Simulates calling a real third-party market-data API for fund NAV/prices. A real feed
// like this is notoriously unreliable to integrate against - rate limits, timeouts,
// maintenance windows - so this mock reproduces both traits (latency + occasional
// failure) rather than just returning a canned number, giving the rest of the app
// something realistic to build resilience against without needing a paid data
// subscription for a learning project.
//
// Everything that would make a real integration non-deterministic (network latency,
// occasional failures, "today's" date) is injectable here, so unit tests can pin it
// down exactly instead of asserting on randomness.

// FNV-1a: a small, fast, dependency-free string hash. Used only to turn a fund id (and
// a fund id + date) into a number to seed the PRNG below - not for anything
// security-sensitive.
function fnv1aHash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // force unsigned 32-bit
}

// mulberry32: a tiny seeded PRNG. Same seed -> same sequence, which is what makes
// "today's price" reproducible across multiple calls on the same day without storing
// anything - without pulling in a random-number npm package for it.
function mulberry32(seed) {
  let t = seed;
  return function next() {
    t |= 0;
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function dayStamp(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

// Deterministic "settled NAV for today" for one fund: a base price derived from the
// fund id (so different funds land in different plausible ranges) shifted a bit by
// today's date (so it looks like the fund actually moved since yesterday) - both
// without any database or file to keep in sync.
function navForFundToday(fundId, today) {
  const fundBase = 10 + (fnv1aHash(fundId) % 9000) / 100; // roughly $10 - $100, stable forever
  const dailyDrift = mulberry32(fnv1aHash(`${fundId}:${today}`))(); // 0..1, changes once a day
  const price = fundBase * (0.94 + dailyDrift * 0.12); // +/- ~6% day to day
  return Math.round(price * 100) / 100;
}

function realDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createMockPriceProvider({
  failureRate = 0.2,
  minLatencyMs = 40,
  maxLatencyMs = 300,
  randomFn = Math.random,
  delayFn = realDelay,
  now = () => Date.now(),
} = {}) {
  async function getPrices(fundIds) {
    const latency = minLatencyMs + randomFn() * (maxLatencyMs - minLatencyMs);
    await delayFn(latency);

    if (randomFn() < failureRate) {
      throw new Error('Mock NAV provider: upstream timeout');
    }

    const nowMs = now();
    const asOf = new Date(nowMs).toISOString();
    const today = dayStamp(nowMs);
    return fundIds.map((fundId) => {
      const settled = navForFundToday(fundId, today);
      // A little live jitter on top of today's settled NAV - the way a real quote
      // wobbles a few cents between two calls seconds apart.
      const jitter = 1 + (randomFn() - 0.5) * 0.004;
      return { fundId, price: Math.round(settled * jitter * 100) / 100, asOf };
    });
  }

  return { getPrices };
}

module.exports = { createMockPriceProvider, navForFundToday };
