import { useEffect, useState } from 'react'
import { api } from './api'
import KycForm from './KycForm'
import { KYC_STATUS_LABEL } from './labels'

// onChanged: called with the new record right after a submission, so a parent that
// shows something gated on KYC status (the fund recommendation) can refresh in the same
// session instead of showing a status that was only true before this submission.
export default function KycSection({ onChanged }) {
  // undefined = loading
  const [kyc, setKyc] = useState(undefined)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)

  const load = () => api.getKycStatus().then((r) => setKyc(r.kyc)).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  function handleSubmitted(record) {
    setKyc(record)
    setEditing(false)
    onChanged?.(record)
  }

  // Same "open a blank tab first, fill it in once the authenticated fetch resolves"
  // pattern as AdminKycPanel, so this isn't blocked as an unrequested popup.
  async function viewDocument() {
    setError(null)
    const win = window.open('', '_blank')
    try {
      const url = await api.getOwnKycDocumentUrl()
      if (win) win.location.href = url
      else setError('Please allow pop-ups to view the document')
    } catch (err) {
      if (win) win.close()
      setError(err.message)
    }
  }

  if (error) return <section className="card"><p className="err">Could not load KYC status: {error}</p></section>
  if (kyc === undefined) return <section className="card"><p>Loading identity verification status...</p></section>

  const showForm = editing || kyc.status === 'not_submitted' || kyc.status === 'rejected'

  if (showForm) {
    return <KycForm initial={kyc.status === 'rejected' || editing ? kyc : null} rejectionReason={kyc.status === 'rejected' ? kyc.rejectionReason : null} onSubmitted={handleSubmitted} />
  }

  return (
    <section className="card">
      <h2>Identity verification (KYC)</h2>
      <p className={`kyc-status kyc-${kyc.status}`}>{KYC_STATUS_LABEL[kyc.status]}</p>
      {kyc.status === 'pending' && <p>Submitted {new Date(kyc.submittedAt).toLocaleDateString()}. An admin will review it shortly.</p>}
      {kyc.status === 'approved' && <p>Verified on {new Date(kyc.reviewedAt).toLocaleDateString()}. No further action needed.</p>}
      <button onClick={viewDocument}>View your submitted document</button>
    </section>
  )
}
