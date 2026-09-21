import { GOAL_LABELS } from './labels'

const LIMIT_TEXT = {
  capacity: 'Your finances (time, income stability or the size of this investment) limit how much risk is suitable, even though you are comfortable with more.',
  tolerance: 'Your comfort with losses limits the band, even though your finances could support more risk.',
  horizon: 'You need this money within 3 years, so we keep it in the cautious band whatever your other answers.',
}

const BANDS = ['conservative', 'balanced', 'growth']

export default function RiskResult({ assessment, previousCount, onRetake }) {
  const { band, bandLabel, summary, limitedBy, goal, bands, createdAt } = assessment
  return (
    <section className="card">
      <h2>Your risk profile</h2>
      <p className={`band band-${band}`}>{bandLabel}</p>
      <div className={`meter band-${band}`} aria-hidden="true">
        {BANDS.map((b) => (
          <span key={b} className={b === band ? 'on' : ''} />
        ))}
      </div>
      <p>{summary}</p>
      {limitedBy && <p><strong>Why not higher?</strong> {LIMIT_TEXT[limitedBy]}</p>}
      <p className="small">
        Capacity to take risk: {bands.capacity}. Comfort with risk: {bands.tolerance}. The lower of the two decides the band.
      </p>

      <h3>Your goal</h3>
      <p>
        {GOAL_LABELS[goal.type] || goal.type}: {goal.targetAmount.toLocaleString()} in {goal.targetYears}{' '}
        {goal.targetYears === 1 ? 'year' : 'years'}
        {goal.monthlyContribution > 0 && `, saving ${goal.monthlyContribution.toLocaleString()} a month`}.
      </p>

      <p className="small">
        Assessed on {new Date(createdAt).toLocaleDateString()}.
        {previousCount > 0 && ` ${previousCount} earlier assessment${previousCount === 1 ? '' : 's'} kept on record.`}
      </p>
      <button onClick={onRetake}>Retake</button>
    </section>
  )
}
