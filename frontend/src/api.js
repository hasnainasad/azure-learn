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
  if (body) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.data = data // some routes (e.g. /api/recommendation) send extra fields like `reason`
    throw err
  }
  return data
}

export const api = {
  register: (email, password, name) => request('/api/auth/register', { method: 'POST', body: { email, password, name } }),
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/api/auth/me'),
  riskQuestionnaire: () => request('/api/risk/questionnaire'),
  getAssessment: () => request('/api/risk/assessment'),
  saveAssessment: (answers, goal) => request('/api/risk/assessment', { method: 'POST', body: { answers, goal } }),
  getKycStatus: () => request('/api/kyc/status'),
  submitKyc: (data) => request('/api/kyc/submit', { method: 'POST', body: data }),
  getPendingKyc: () => request('/api/kyc/admin/pending'),
  decideKyc: (userId, decision, reason) => request(`/api/kyc/admin/${userId}/decision`, { method: 'POST', body: { decision, reason } }),
  getFundCatalog: () => request('/api/funds/catalog'),
  getRecommendation: () => request('/api/recommendation'),
  info: () => request('/api/info'),
}
