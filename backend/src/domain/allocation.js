// Turns a risk band + goal into a fund-by-fund allocation. Pure functions, no database,
// same reasoning as domain/risk.js: easy to test, easy to explain to a compliance person.
const { BANDS, BAND_INFO } = require('./risk');
const { FUNDS } = require('./funds');

// Target mix by asset class, per risk band. These are the "before any adjustment for
// the goal" numbers - a simplified version of a real strategic asset allocation table.
const BASE_MIX = {
  conservative: { equity: 15, bond: 60, cash: 25 },
  balanced: { equity: 50, bond: 40, cash: 10 },
  growth: { equity: 80, bond: 15, cash: 5 },
};

// If the goal is close (under this many years), shift some of the equity weight into
// bonds and cash - the same "short horizon should not ride out a market fall" idea as
// the hard cap in domain/risk.js, but applied as a tilt here rather than an override,
// since the band itself was already set with the goal date in mind.
const SHORT_HORIZON_YEARS = 5;
const SHORT_HORIZON_SHIFT = 10; // percentage points moved, split evenly to bond + cash

const ASSET_CLASS_LABEL = { equity: 'Growth-oriented equity', bond: 'Income-generating bond', cash: 'Capital-preserving cash' };

function targetMix(band, targetYears) {
  const base = { ...BASE_MIX[band] };
  const shortHorizon = targetYears <= SHORT_HORIZON_YEARS;
  if (shortHorizon) {
    const shift = Math.min(SHORT_HORIZON_SHIFT, base.equity);
    base.equity -= shift;
    base.bond += shift / 2;
    base.cash += shift / 2;
  }
  return { mix: base, shortHorizon };
}

// A client in a given band can hold any fund whose minBand is that band or lower.
function eligibleFunds(band) {
  const rank = BANDS.indexOf(band);
  return FUNDS.filter((f) => BANDS.indexOf(f.minBand) <= rank);
}

function reasonFor(fund, band, shortHorizon) {
  let text = `${ASSET_CLASS_LABEL[fund.assetClass]} holding, suitable for your ${BAND_INFO[band].label} risk band.`;
  if (shortHorizon) text += ' Weighted more conservatively because your goal is under 5 years away.';
  return text;
}

// Standard "largest remainder" rounding: split each asset class's target evenly across
// its eligible funds (which can leave fractions like 16.67%), floor everything, then
// hand the leftover whole percentage points to the funds with the largest fractional
// part. Guarantees the displayed weights always sum to exactly 100, never 99 or 101.
function buildRecommendation({ band, goal }) {
  const { mix, shortHorizon } = targetMix(band, goal.targetYears);
  const funds = eligibleFunds(band);
  const byClass = { equity: [], bond: [], cash: [] };
  for (const f of funds) byClass[f.assetClass].push(f);

  const items = [];
  for (const assetClass of Object.keys(mix)) {
    const classFunds = byClass[assetClass];
    const classTarget = mix[assetClass];
    if (classFunds.length === 0 || classTarget <= 0) continue;
    const each = classTarget / classFunds.length;
    for (const fund of classFunds) items.push({ fund, exact: each });
  }

  const floors = items.map((it) => Math.floor(it.exact));
  const remainder = 100 - floors.reduce((sum, w) => sum + w, 0);
  const byLargestFraction = items
    .map((it, i) => ({ i, frac: it.exact - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const weights = [...floors];
  for (let k = 0; k < remainder; k++) weights[byLargestFraction[k].i] += 1;

  const allocation = items
    .map((it, i) => ({
      fundId: it.fund.id,
      name: it.fund.name,
      assetClass: it.fund.assetClass,
      expenseRatio: it.fund.expenseRatio,
      weightPct: weights[i],
      reason: reasonFor(it.fund, band, shortHorizon),
    }))
    .filter((a) => a.weightPct > 0)
    .sort((a, b) => b.weightPct - a.weightPct);

  return {
    band,
    bandLabel: BAND_INFO[band].label,
    mix,
    shortHorizonApplied: shortHorizon,
    allocation,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { BASE_MIX, SHORT_HORIZON_YEARS, targetMix, eligibleFunds, buildRecommendation };
