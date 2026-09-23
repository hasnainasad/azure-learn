// One place that talks to the backend. Relative URLs: in dev Vite proxies /api to localhost:3000,
// in Azure nginx on the web VM forwards /api to the private-subnet VM.
const TOKEN_KEY = 'ra_token';

// localStorage is the simplest place for the token while learning. Trade-off to revisit later:
// any XSS bug could read it; an httpOnly cookie set by the server is safer.
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage blocked: user just has to log in again next visit */
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {}
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  // For a file upload, the browser sets Content-Type itself (multipart/form-data with the
  // right boundary) - setting it by hand here would break the boundary and the upload.
  if (body && !isFormData) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { method, headers, body: body ? (isFormData ? body : JSON.stringify(body)) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data // some routes (e.g. /api/recommendation) send extra fields like `reason`
    throw err
  }
  return data
}

// Fetches a binary endpoint (a KYC document, not JSON) and hands back an object URL the
// caller can point an <a>/window to. Needs its own fetch (not request()) because the
// response isn't JSON, and it needs the auth header attached, which a plain <a href>
// pointed straight at the API can't do.
async function fetchDocumentUrl(path) {
  const token = getToken()
  const res = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    throw err
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob) // caller is responsible for URL.revokeObjectURL when done
}

// Builds the multipart form the backend expects: flat text fields plus the file itself
// under "document" (nested JSON isn't natively representable in form-data, so the address
// fields are sent flat and the server reassembles them - see routes/kyc.js).
function kycSubmissionForm({ legalName, dob, address, documentType }, file) {
  const form = new FormData()
  form.append('legalName', legalName)
  form.append('dob', dob)
  form.append('line1', address.line1)
  form.append('city', address.city)
  form.append('postalCode', address.postalCode)
  form.append('country', address.country)
  form.append('documentType', documentType)
  if (file) form.append('document', file)
  return form
}

export const api = {
  register: (email, password, name) => request('/api/auth/register', { method: 'POST', body: { email, password, name } }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/api/auth/me'),
  riskQuestionnaire: () => request('/api/risk/questionnaire'),
  getAssessment: () => request('/api/risk/assessment'),
  saveAssessment: (answers, goal) => request('/api/risk/assessment', { method: 'POST', body: { answers, goal } }),
  getKycStatus: () => request('/api/kyc/status'),
  submitKyc: (fields, file) => request('/api/kyc/submit', { method: 'POST', body: kycSubmissionForm(fields, file) }),
  getOwnKycDocumentUrl: () => fetchDocumentUrl('/api/kyc/document'),
  getPendingKyc: () => request('/api/kyc/admin/pending'),
  getKycDocumentUrl: (userId) => fetchDocumentUrl(`/api/kyc/admin/${userId}/document`),
  decideKyc: (userId, decision, reason) => request(`/api/kyc/admin/${userId}/decision`, { method: 'POST', body: { decision, reason } }),
  getFundCatalog: () => request('/api/funds/catalog'),
  getRecommendation: () => request('/api/recommendation'),
  getPrices: () => request('/api/prices'),
  info: () => request('/api/info'),
}
