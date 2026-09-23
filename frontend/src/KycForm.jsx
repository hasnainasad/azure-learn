import { useState } from 'react'
import { api } from './api'

const DOCUMENT_LABELS = {
  passport: 'Passport',
  driving_licence: 'Driving licence',
  national_id: 'National ID card',
  utility_bill: 'Utility bill',
}

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024

// As of the Blob Storage slice, the file itself is uploaded (previously only its name
// was recorded - see git history if curious what that looked like). A file input can
// never be pre-filled for security reasons, so resubmitting (e.g. after rejection)
// always requires picking the file again, even though the other fields are pre-filled
// from the previous submission.
export default function KycForm({ initial, onSubmitted, rejectionReason }) {
  const [legalName, setLegalName] = useState(initial?.legalName || '')
  const [dob, setDob] = useState(initial?.dob || '')
  const [line1, setLine1] = useState(initial?.address?.line1 || '')
  const [city, setCity] = useState(initial?.address?.city || '')
  const [postalCode, setPostalCode] = useState(initial?.address?.postalCode || '')
  const [country, setCountry] = useState(initial?.address?.country || '')
  const [documentType, setDocumentType] = useState(initial?.documentType || 'passport')
  const [file, setFile] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const maxDob = new Date().toISOString().slice(0, 10)

  function onFileChange(e) {
    const picked = e.target.files[0] || null
    if (picked && picked.size > MAX_DOCUMENT_BYTES) {
      setError('Document must be 5MB or smaller')
      setFile(null)
      e.target.value = ''
      return
    }
    setError(null)
    setFile(picked)
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { kyc } = await api.submitKyc(
        { legalName, dob, address: { line1, city, postalCode, country }, documentType },
        file,
      )
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
        <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={onFileChange} required={!file} />
        <small>JPEG, PNG, or PDF, up to 5MB. {file ? `Selected: ${file.name}` : 'No file selected.'}</small>
      </label>

      {error && <p className="err">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? 'Submitting...' : 'Submit for review'}</button>
    </form>
  )
}
