// A small static reference catalog: mutual funds don't belong to any one user, so this
// is plain data in code, not a database collection - nothing here is ever written to,
// only read. `minBand` is the least risk tolerance a client needs to be offered the
// fund; someone in a higher band can still hold a lower-band fund (growth investors are
// a superset of balanced investors, who are a superset of conservative ones).
const FUNDS = [
  {
    id: 'bond-gov-global',
    name: 'Global Government Bond Fund',
    assetClass: 'bond',
    minBand: 'conservative',
    expenseRatio: 0.35,
    description: 'Investment-grade government bonds from developed markets. Low volatility, modest income.',
  },
  {
    id: 'cash-money-market',
    name: 'Money Market Fund',
    assetClass: 'cash',
    minBand: 'conservative',
    expenseRatio: 0.15,
    description: 'Short-term, high-quality cash instruments. Capital preservation, minimal growth.',
  },
  {
    id: 'equity-low-vol',
    name: 'Low-Volatility Equity Fund',
    assetClass: 'equity',
    minBand: 'conservative',
    expenseRatio: 0.50,
    description: 'Large, stable companies chosen for smaller price swings than the broader market.',
  },
  {
    id: 'bond-corp-income',
    name: 'Corporate Bond Income Fund',
    assetClass: 'bond',
    minBand: 'balanced',
    expenseRatio: 0.45,
    description: 'Investment-grade corporate bonds. More income than government bonds, slightly more risk.',
  },
  {
    id: 'equity-global-index',
    name: 'Global Large-Cap Index Fund',
    assetClass: 'equity',
    minBand: 'balanced',
    expenseRatio: 0.20,
    description: 'Tracks a broad index of large companies worldwide. Diversified and low cost.',
  },
  {
    id: 'equity-dividend',
    name: 'Blue-Chip Dividend Equity Fund',
    assetClass: 'equity',
    minBand: 'balanced',
    expenseRatio: 0.55,
    description: 'Established companies with a long history of paying dividends.',
  },
  {
    id: 'equity-emerging',
    name: 'Emerging Markets Equity Fund',
    assetClass: 'equity',
    minBand: 'growth',
    expenseRatio: 0.85,
    description: 'Companies in developing economies. Higher growth potential, higher volatility.',
  },
  {
    id: 'equity-small-cap',
    name: 'Small-Cap Growth Equity Fund',
    assetClass: 'equity',
    minBand: 'growth',
    expenseRatio: 0.95,
    description: 'Smaller, faster-growing companies. The most volatile fund in the catalog.',
  },
];

module.exports = { FUNDS };
