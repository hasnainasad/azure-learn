import { useEffect, useState } from 'react'
import { api } from './api'

// Live pricing is its own small card, separate from the recommendation card: it comes
// from a DIFFERENT (mock) third-party integration with its own failure mode, and the
// whole point of this slice is to show that failure mode honestly rather than bury it
// inside another card. A "stale" price - the mock feed simulated as down, so we fell
// back to the last price we successfully fetched - is labelled clearly rather than
// silently passed off as live. Available to any logged-in user, same as the fund
// catalog: pricing isn't personalized advice, so it isn't gated on risk profile or KYC.
export default function PricesSection() {
  const [funds, setFunds] = useState(null) // {fundId: name}, fetched once for nicer labels
  const [state, setState] = useState(undefined) // undefined = loading, else {ok, items|message}
  const [refreshing, setRefreshing] = useState(false)

  const fetchPrices = () => api.getPrices()
    .then((r) => setState({ ok: true, items: r.prices }))
    .catch((e) => setState({ ok: false, message: e.message }))

  useEffect(() => {
    api.getFundCatalog()
      .then((r) => setFunds(Object.fromEntries(r.funds.map((f) => [f.id, f.name]))))
      .catch(() => {}) // names are a nicety - prices still render fine by fund id without them
    fetchPrices()
  }, [])

  // Separate from the initial load: this one drives the "refreshing" spinner, and that
  // setState has to happen from the click event, not synchronously inside the effect
  // above (which would risk a cascading render on mount).
  function handleRefresh() {
    setRefreshing(true)
    fetchPrices().finally(() => setRefreshing(false))
  }

  return (
    <section className="card">
      <h2>Live fund prices</h2>
      <p className="small">
        Pulled from a simulated third-party NAV feed, which is built to occasionally time
        out. A price marked <strong>stale</strong> means the feed was unavailable just
        now and this is the last price we successfully fetched - the retry and fallback
        logic working as intended, not a bug.
      </p>

      {state === undefined && <p>Loading prices...</p>}
      {state && !state.ok && <p className="err">Could not load prices: {state.message}</p>}

      {state && state.ok && (
        <>
          <table className="price-table">
            <thead>
              <tr><th>Fund</th><th>Price</th><th>As of</th></tr>
            </thead>
            <tbody>
              {state.items.map((p) => (
                <tr key={p.fundId}>
                  <td>{(funds && funds[p.fundId]) || p.fundId}</td>
                  <td>{p.price != null ? `£${p.price.toFixed(2)}` : '—'}</td>
                  <td>
                    {p.asOf ? new Date(p.asOf).toLocaleTimeString() : 'never'}
                    {p.stale && <span className="stale-badge">stale</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="link" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh prices'}
          </button>
        </>
      )}
    </section>
  )
}
