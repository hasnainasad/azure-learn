import { useEffect, useState } from 'react'
import { api } from './api'
import { KYC_STATUS_LABEL } from './labels'

// No charting library here on purpose: a set of CSS bars is plenty to show percentages,
// and it keeps this slice free of new npm packages (which would mean the app VM needs
// internet access again, i.e. the NAT gateway). A real chart library comes later, when
// the market-data dashboard work actually calls for one.
function AllocationBar({ entry }) {
  return (
    <div className="alloc-row">
      <div className="alloc-bar-label">
        <strong>{entry.name}</strong>
        <span>{entry.weightPct}%</span>
      </div>
      <div className="alloc-bar"><div className={`alloc-bar-fill alloc-${entry.assetClass}`} style={{ width: `${entry.weightPct}%` }} /></div>
      <p className="small">{entry.reason} Expense ratio {entry.expenseRatio}%.</p>
    </div>
  )
}

function FundCatalogTable({ funds }) {
  return (
    <table className="fund-table">
      <thead>
        <tr><th>Fund</th><th>Asset class</th><th>Min. risk band</th><th>Expense ratio</th></tr>
      </thead>
      <tbody>
        {funds.map((f) => (
          <tr key={f.id}>
            <td><strong>{f.name}</strong><br /><span className="small">{f.description}</span></td>
            <td>{f.assetClass}</td>
            <td>{f.minBand}</td>
            <td>{f.expenseRatio}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// The caller passes `key={riskVersion}` (something that changes when the risk
// assessment is saved, e.g. its createdAt) so React remounts this component fresh on a
// retake - the standard way to reset state for a changed input, without a synchronous
// setState inside the effect. See it refetch immediately without a page reload,
// matching what the backend already does the moment it's asked.
export default function RecommendationSection() {
  // undefined = loading. Otherwise { ok: true, recommendation } or { ok: false, ... }
  const [state, setState] = useState(undefined)
  const [catalog, setCatalog] = useState(null)
  const [showCatalog, setShowCatalog] = useState(false)

  useEffect(() => {
    api
      .getRecommendation()
      .then((r) => setState({ ok: true, recommendation: r.recommendation }))
      .catch((e) => setState({ ok: false, status: e.status, reason: e.data?.reason, kycStatus: e.data?.kycStatus, message: e.message }))
  }, [])

  function toggleCatalog() {
    if (catalog) return setShowCatalog((s) => !s)
    api.getFundCatalog().then((r) => {
      setCatalog(r.funds)
      setShowCatalog(true)
    })
  }

  return (
    <section className="card">
      <h2>Fund recommendation</h2>

      {state === undefined && <p>Loading your fund recommendation...</p>}

      {state && !state.ok && state.reason === 'risk_profile_required' && (
        <p>Complete your risk profile above to see a personalized recommendation.</p>
      )}
      {state && !state.ok && state.reason === 'kyc_required' && (
        <p>
          Your fund recommendation will appear once identity verification is approved
          (current status: {KYC_STATUS_LABEL[state.kycStatus] || 'not submitted'}).
        </p>
      )}
      {state && !state.ok && !state.reason && <p className="err">{state.message}</p>}

      {state && state.ok && (
        <>
          <p>
            Based on your <strong>{state.recommendation.bandLabel}</strong> risk band
            {state.recommendation.shortHorizonApplied && ', weighted more conservatively because your goal is under 5 years away'}.
          </p>
          {state.recommendation.allocation.map((entry) => <AllocationBar key={entry.fundId} entry={entry} />)}
        </>
      )}

      <button type="button" className="link" onClick={toggleCatalog}>
        {showCatalog ? 'Hide' : 'Browse'} full fund catalog
      </button>
      {showCatalog && catalog && <FundCatalogTable funds={catalog} />}
    </section>
  )
}
