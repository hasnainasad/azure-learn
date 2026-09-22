import { useEffect, useState } from 'react'
import { api } from './api'

// Only rendered for users whose /api/auth/me response says role === 'admin'.
// The server enforces this independently (requireAdmin), so hiding the button here
// is a UX nicety, not the actual security boundary.
export default function AdminKycPanel() {
  const [records, setRecords] = useState(undefined)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [reasons, setReasons] = useState({})

  const load = () => api.getPendingKyc().then((r) => setRecords(r.records)).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  async function decide(userId, decision) {
    setBusyId(userId)
    setError(null)
    try {
      await api.decideKyc(userId, decision, reasons[userId] || undefined)
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="card">
      <h2>Admin: KYC review queue</h2>
      {error && <p className="err">{error}</p>}
      {records === undefined && <p>Loading...</p>}
      {records && records.length === 0 && <p>No submissions waiting for review.</p>}
      {records && records.map((r) => (
        <div key={r.userId} className="kyc-row">
          <p><strong>{r.legalName}</strong> ({r.applicantEmail})</p>
          <p className="small">
            DOB {r.dob} &middot; {r.address.line1}, {r.address.city}, {r.address.postalCode}, {r.address.country} &middot; {r.documentType} ({r.documentFileName})
          </p>
          <label>
            Rejection reason <small>(only needed if rejecting)</small>
            <input value={reasons[r.userId] || ''} onChange={(e) => setReasons({ ...reasons, [r.userId]: e.target.value })} maxLength={500} />
          </label>
          <button disabled={busyId === r.userId} onClick={() => decide(r.userId, 'approved')}>Approve</button>{' '}
          <button disabled={busyId === r.userId} onClick={() => decide(r.userId, 'rejected')}>Reject</button>
        </div>
      ))}
    </section>
  )
}
