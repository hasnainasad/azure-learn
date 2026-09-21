// Risk-profiling rules. Pure functions: no database, no HTTP, so they are easy to test
// and easy to explain to a compliance person ("here is exactly how the band is decided").
//
// Two ideas real suitability frameworks use:
//  - Risk CAPACITY  = how much loss you could afford (time, income, size of the investment)
//  - Risk TOLERANCE = how much loss you would accept emotionally and by experience
// The final band is the LOWER of the two: a nervous rich person and a brave person
// with no savings cushion both get the cautious answer.

const QUESTIONNAIRE_VERSION = 1;

const BANDS = ['conservative', 'balanced', 'growth']; // ordered low -> high risk

const BAND_INFO = {
  conservative: {
    label: 'Conservative',
    summary: 'You prefer protecting your money over chasing growth. Expect small ups and downs and modest long-term returns.',
  },
  balanced: {
    label: 'Balanced',
    summary: 'You can accept moderate swings in value in return for reasonable growth over the medium to long term.',
  },
  growth: {
    label: 'Growth',
    summary: 'You have the time and comfort to ride out large falls in exchange for higher long-term growth potential.',
  },
};

const GOAL_TYPES = ['retirement', 'home', 'education', 'wealth', 'other'];

// group: 'capacity' or 'tolerance'. points: 1 (cautious) to 4 (adventurous).
const QUESTIONS = [
  {
    id: 'horizon', group: 'capacity',
    text: 'When will you need most of this money?',
    options: [
      { id: 'a', label: 'Within 3 years', points: 1 },
      { id: 'b', label: 'In 3 to 7 years', points: 2 },
      { id: 'c', label: 'In 7 to 15 years', points: 3 },
      { id: 'd', label: 'In more than 15 years', points: 4 },
    ],
  },
  {
    id: 'income', group: 'capacity',
    text: 'How stable is your income?',
    options: [
      { id: 'a', label: 'Uncertain or irregular', points: 1 },
      { id: 'b', label: 'Fairly stable, but I have little spare cash', points: 2 },
      { id: 'c', label: 'Stable, with 3 to 6 months of expenses saved', points: 3 },
      { id: 'd', label: 'Very stable, with more than 6 months of expenses saved', points: 4 },
    ],
  },
  {
    id: 'share', group: 'capacity',
    text: 'What share of your total savings is this investment?',
    options: [
      { id: 'a', label: 'More than 75%', points: 1 },
      { id: 'b', label: '50% to 75%', points: 2 },
      { id: 'c', label: '25% to 50%', points: 3 },
      { id: 'd', label: 'Less than 25%', points: 4 },
    ],
  },
  {
    id: 'drop', group: 'tolerance',
    text: 'Your investments fall 20% in three months. What would you do?',
    options: [
      { id: 'a', label: 'Sell everything to stop the losses', points: 1 },
      { id: 'b', label: 'Sell some to reduce the worry', points: 2 },
      { id: 'c', label: 'Do nothing and wait for a recovery', points: 3 },
      { id: 'd', label: 'Invest more while prices are low', points: 4 },
    ],
  },
  {
    id: 'experience', group: 'tolerance',
    text: 'How much investing experience do you have?',
    options: [
      { id: 'a', label: 'None', points: 1 },
      { id: 'b', label: 'Only savings accounts or fixed deposits', points: 2 },
      { id: 'c', label: 'Some mutual funds or shares', points: 3 },
      { id: 'd', label: 'Experienced: I have been through several market falls', points: 4 },
    ],
  },
  {
    id: 'tradeoff', group: 'tolerance',
    text: 'Which range of yearly results would you accept?',
    options: [
      { id: 'a', label: 'Between 0% and +4%', points: 1 },
      { id: 'b', label: 'Between -5% and +8%', points: 2 },
      { id: 'c', label: 'Between -12% and +14%', points: 3 },
      { id: 'd', label: 'Between -25% and +25%', points: 4 },
    ],
  },
];

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// What the browser is allowed to see: questions and option labels, never the points.
function publicQuestionnaire() {
  return {
    version: QUESTIONNAIRE_VERSION,
    goalTypes: GOAL_TYPES,
    questions: QUESTIONS.map((q) => ({
      id: q.id,
      text: q.text,
      options: q.options.map((o) => ({ id: o.id, label: o.label })),
    })),
  };
}

// Sum 3..12 for three questions
function bandFromSum(sum) {
  if (sum <= 6) return 'conservative';
  if (sum <= 9) return 'balanced';
  return 'growth';
}

const lower = (a, b) => (BANDS.indexOf(a) <= BANDS.indexOf(b) ? a : b);

function validateGoal(goal) {
  if (!goal || typeof goal !== 'object') throw new ValidationError('Goal is required');
  const { type, targetAmount, targetYears, monthlyContribution } = goal;
  if (!GOAL_TYPES.includes(type)) throw new ValidationError('Goal type is not valid');
  if (typeof targetAmount !== 'number' || !Number.isFinite(targetAmount) || targetAmount <= 0 || targetAmount > 1e9) {
    throw new ValidationError('Target amount must be a positive number');
  }
  if (!Number.isInteger(targetYears) || targetYears < 1 || targetYears > 50) {
    throw new ValidationError('Target years must be a whole number from 1 to 50');
  }
  let monthly = 0;
  if (monthlyContribution !== undefined && monthlyContribution !== null && monthlyContribution !== '') {
    if (typeof monthlyContribution !== 'number' || !Number.isFinite(monthlyContribution) || monthlyContribution < 0 || monthlyContribution > 1e7) {
      throw new ValidationError('Monthly contribution must be zero or a positive number');
    }
    monthly = monthlyContribution;
  }
  return { type, targetAmount, targetYears, monthlyContribution: monthly };
}

// answers: { horizon: 'b', income: 'c', ... }  ->  full assessment record (not yet saved)
function scoreAssessment({ answers, goal }) {
  if (!answers || typeof answers !== 'object') throw new ValidationError('Answers are required');
  const cleanGoal = validateGoal(goal);

  const sums = { capacity: 0, tolerance: 0 };
  const cleanAnswers = {};
  for (const q of QUESTIONS) {
    const chosen = q.options.find((o) => o.id === answers[q.id]);
    if (!chosen) throw new ValidationError(`Please answer the question: ${q.text}`);
    cleanAnswers[q.id] = chosen.id;
    sums[q.group] += chosen.points;
  }

  const capacityBand = bandFromSum(sums.capacity);
  const toleranceBand = bandFromSum(sums.tolerance);
  let band = lower(capacityBand, toleranceBand);
  let limitedBy = capacityBand === toleranceBand ? null : capacityBand === band ? 'capacity' : 'tolerance';

  // Hard rule: money needed within 3 years should not be taken into growth investments,
  // whatever else the answers say. Either the answer or the goal date can trigger it.
  const shortHorizon = cleanAnswers.horizon === 'a' || cleanGoal.targetYears < 3;
  if (shortHorizon && band !== 'conservative') {
    band = 'conservative';
    limitedBy = 'horizon';
  }

  return {
    questionnaireVersion: QUESTIONNAIRE_VERSION,
    answers: cleanAnswers,
    scores: { capacity: sums.capacity, tolerance: sums.tolerance },
    bands: { capacity: capacityBand, tolerance: toleranceBand },
    band,
    bandLabel: BAND_INFO[band].label,
    summary: BAND_INFO[band].summary,
    limitedBy, // 'capacity' | 'tolerance' | 'horizon' | null
    goal: cleanGoal,
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  QUESTIONNAIRE_VERSION,
  BANDS,
  BAND_INFO,
  GOAL_TYPES,
  ValidationError,
  publicQuestionnaire,
  scoreAssessment,
};
