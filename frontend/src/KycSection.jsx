import { useEffect, useState } from 'react'
import { api } from './api'
import KycForm from './KycForm'

const STATUS_LABEL = {
  not_submitted: 'Not submitted',
  pending: 'Pending review',
  approved: 'Verified',
  rejected: 'Rejected',
}

export default function KycSection() {
  // undefined = loading
  const [kyc, setKyc] = useState(undefined)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(false)

  const load = () => api.getKycStatus().then((r) => setKyc(r.kyc)).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  function handleSubmitted(record) {
    setKyc(record)
    setEditing(false)
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
      <p className={`kyc-status kyc-${kyc.status}`}>{STATUS_LABEL[kyc.status]}</p>
      {kyc.status === 'pending' && <p>Submitted {new Date(kyc.submittedAt).toLocaleDateString()}. An admin will review it shortly.</p>}
      {kyc.status === 'approved' && <p>Verified on {new Date(kyc.reviewedAt).toLocaleDateString()}. No further action needed.</p>}
    </section>
  )
}
