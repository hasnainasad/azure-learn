import { useEffect, useState } from 'react'
import { api } from './api'
import { GOAL_LABELS } from './labels'


// The questions come from the server, so the wording and scoring live in one place.
// This form only collects choices; the server works out the risk band.
export default function RiskQuestionnaire({ onSaved, onCancel }) {
  const [form, setForm] = useState(null)
  const [answers, setAnswers] = useState({})
  const [goalType, setGoalType] = useState('retirement')
  const [targetAmount, setTargetAmount] = useState('')
  const [targetYears, setTargetYears] = useState('')
  const [monthly, setMonthly] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.riskQuestionnaire().then(setForm).catch((e) => setError(e.message))
  }, [])

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const goal = {
        type: goalType,
        targetAmount: Number(targetAmount),
        targetYears: Number(targetYears),
      }
      if (monthly !== '') goal.monthlyContribution = Number(monthly)
      const { assessment } = await api.saveAssessment(answers, goal)
      onSaved(assessment)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!form) return <p>{error ? <span className="err">{error}</span> : 'Loading questions...'}</p>

  return (
    <form onSubmit={submit} className="card">
      <h2>Your goal</h2>
      <label>
        What are you investing for?
        <select value={goalType} onChange={(e) => setGoalType(e.target.value)}>
          {form.goalTypes.map((t) => (
            <option key={t} value={t}>{GOAL_LABELS[t] || t}</option>
          ))}
        </select>
      </label>
      <label>
        Target amount
        <input type="number" min="1" step="any" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} required />
      </label>
      <label>
        Years until you need it
        <input type="number" min="1" max="50" step="1" value={targetYears} onChange={(e) => setTargetYears(e.target.value)} required />
      </label>
      <label>
        Monthly saving <small>(optional)</small>
        <input type="number" min="0" step="any" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
      </label>

      <h2>About you as an investor</h2>
      {form.questions.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.text}</legend>
          {q.options.map((o) => (
            <label key={o.id} className="choice">
              <input
                type="radio"
                name={q.id}
                value={o.id}
                checked={answers[q.id] === o.id}
                onChange={() => setAnswers({ ...answers, [q.id]: o.id })}
                required
              />
              {o.label}
            </label>
          ))}
        </fieldset>
      ))}

      {error && <p className="err">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Saving...' : 'See my risk profile'}</button>
      {onCancel && (
        <button type="button" className="link" onClick={onCancel} style={{ marginLeft: '1rem' }}>Cancel</button>
      )}
    </form>
  )
}
