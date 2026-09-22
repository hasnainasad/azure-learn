const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { BANDS } = require('../src/domain/risk');
const { FUNDS } = require('../src/domain/funds');
const { targetMix, eligibleFunds, buildRecommendation } = require('../src/domain/allocation');

describe('fund catalog sanity', () => {
  test('every fund has a real asset class and a real minBand', () => {
    for (const f of FUNDS) {
      assert.ok(['equity', 'bond', 'cash'].includes(f.assetClass), f.id);
      assert.ok(BANDS.includes(f.minBand), f.id);
    }
  });
});

describe('eligibleFunds - eligibility is cumulative by band', () => {
  test('conservative sees only conservative-tier funds', () => {
    const ids = eligibleFunds('conservative').map((f) => f.id).sort();
    assert.deepEqual(ids, ['bond-gov-global', 'cash-money-market', 'equity-low-vol']);
  });

  test('growth sees every fund in the catalog', () => {
    assert.equal(eligibleFunds('growth').length, FUNDS.length);
  });

  test('balanced sees strictly more funds than conservative, strictly fewer than growth', () => {
    const c = eligibleFunds('conservative').length;
    const b = eligibleFunds('balanced').length;
    const g = eligibleFunds('growth').length;
    assert.ok(c < b && b < g, `${c} < ${b} < ${g}`);
  });
});

describe('targetMix', () => {
  test('a long-enough horizon uses the band mix unchanged', () => {
    const { mix, shortHorizon } = targetMix('balanced', 20);
    assert.equal(shortHorizon, false);
    assert.deepEqual(mix, { equity: 50, bond: 40, cash: 10 });
  });

  test('a goal under 5 years shifts 10 points from equity to bond+cash, for every band', () => {
    for (const band of BANDS) {
      const long = targetMix(band, 20).mix;
      const short = targetMix(band, 3).mix;
      assert.equal(long.equity - short.equity, 10, band);
      assert.equal(short.bond - long.bond, 5, band);
      assert.equal(short.cash - long.cash, 5, band);
    }
  });

  test('exactly 5 years still counts as short (uses <=)', () => {
    assert.equal(targetMix('balanced', 5).shortHorizon, true);
    assert.equal(targetMix('balanced', 6).shortHorizon, false);
  });
});

describe('buildRecommendation', () => {
  const goal = (targetYears) => ({ type: 'retirement', targetAmount: 100000, targetYears, monthlyContribution: 200 });

  test('weights always sum to exactly 100, for every band and both horizon lengths', () => {
    for (const band of BANDS) {
      for (const years of [2, 25]) {
        const r = buildRecommendation({ band, goal: goal(years) });
        const sum = r.allocation.reduce((s, a) => s + a.weightPct, 0);
        assert.equal(sum, 100, `${band} / ${years}y`);
      }
    }
  });

  test('every recommended fund is eligible for the band', () => {
    const r = buildRecommendation({ band: 'conservative', goal: goal(20) });
    const eligibleIds = new Set(eligibleFunds('conservative').map((f) => f.id));
    for (const a of r.allocation) assert.ok(eligibleIds.has(a.fundId));
  });

  test('conservative band never recommends a growth-tier fund', () => {
    const r = buildRecommendation({ band: 'conservative', goal: goal(20) });
    const ids = r.allocation.map((a) => a.fundId);
    assert.ok(!ids.includes('equity-emerging'));
    assert.ok(!ids.includes('equity-small-cap'));
  });

  test('a short goal reduces total equity weight versus a long goal, same band', () => {
    const long = buildRecommendation({ band: 'growth', goal: goal(25) });
    const short = buildRecommendation({ band: 'growth', goal: goal(3) });
    const equityWeight = (r) => r.allocation.filter((a) => a.assetClass === 'equity').reduce((s, a) => s + a.weightPct, 0);
    assert.ok(equityWeight(short) < equityWeight(long));
    assert.equal(short.shortHorizonApplied, true);
    assert.equal(long.shortHorizonApplied, false);
  });

  test('allocation is sorted largest weight first', () => {
    const r = buildRecommendation({ band: 'balanced', goal: goal(20) });
    for (let i = 1; i < r.allocation.length; i++) {
      assert.ok(r.allocation[i - 1].weightPct >= r.allocation[i].weightPct);
    }
  });

  test('every entry carries a human-readable reason and the fund\'s expense ratio', () => {
    const r = buildRecommendation({ band: 'balanced', goal: goal(20) });
    for (const a of r.allocation) {
      assert.ok(a.reason.length > 10);
      assert.equal(typeof a.expenseRatio, 'number');
    }
  });

  test('bandLabel matches the band', () => {
    const r = buildRecommendation({ band: 'growth', goal: goal(20) });
    assert.equal(r.bandLabel, 'Growth');
  });
});
