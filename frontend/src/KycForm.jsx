import { useState } from 'react'
import { api } from './api'

const DOCUMENT_LABELS = {
  passport: 'Passport',
  driving_licence: 'Driving licence',
  national_id: 'National ID card',
  utility_bill: 'Utility bill',
}

// Static KYC: no real document scanning yet. We only record the file NAME the user
// picked, as proof something was selected - the actual bytes are stored from the
// Blob Storage slice onward. This is called out on screen too, not hidden.
export default function KycForm({ initial, onSubmitted, rejectionReason }) {
  const [legalName, setLegalName] = useState(initial?.legalName || '')
  const [dob, setDob] = useState(initial?.dob || '')
  const [line1, setLine1] = useState(initial?.address?.line1 || '')
  const [city, setCity] = useState(initial?.address?.city || '')
  const [postalCode, setPostalCode] = useState(initial?.address?.postalCode || '')
  const [country, setCountry] = useState(initial?.address?.country || '')
  const [documentType, setDocumentType] = useState(initial?.documentType || 'passport')
  const [fileName, setFileName] = useState(initial?.documentFileName || '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const maxDob = new Date().toISOString().slice(0, 10)

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { kyc } = await api.submitKyc({
        legalName,
        dob,
        address: { line1, city, postalCode, country },
        documentType,
        documentFileName: fileName,
      })
      onSubmitted(kyc)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <h2>Identity verification (KYC)</h2>
      {rejectionReason && (
        <p className="err">Your previous submission was rejected: {rejectionReason}. Please correct it and resubmit.</p>
      )}
      <label>
        Legal name (as it appears on your ID)
        <input value={legalName} onChange={(e) => setLegalName(e.target.value)} required maxLength={150} />
      </label>
      <label>
        Date of birth
        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={maxDob} required />
      </label>
      <label>
        Address line 1
        <input value={line1} onChange={(e) => setLine1(e.target.value)} required maxLength={200} />
      </label>
      <label>
        City
        <input value={city} onChange={(e) => setCity(e.target.value)} required maxLength={100} />
      </label>
      <label>
        Postal code
        <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required maxLength={20} />
      </label>
      <label>
        Country
        <input value={country} onChange={(e) => setCountry(e.target.value)} required maxLength={100} />
      </label>
      <label>
        Document type
        <select value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
          {Object.entries(DOCUMENT_LABELS).map(([id, label]) => (
            <option key={id} value={id}>{label}</option>
          ))}
        </select>
      </label>
      <label>
        Upload document
        <input
          type="file"
          onChange={(e) => setFileName(e.target.files[0]?.name || '')}
          required={!fileName}
        />
        <small>
          Learning build: only the file name is recorded ({fileName || 'none selected'}). The file itself is not
          uploaded yet - that comes with the Blob Storage step.
        </small>
      </label>

      {error && <p className="err">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Submitting...' : 'Submit for review'}</button>
    </form>
  )
}
