import { useEffect, useState } from 'react'
import './App.css'

// Relative URL: in dev, Vite proxies /api to localhost:3000;
// in Azure, nginx on the web VM proxies /api to the private-subnet VM.
export default function App() {
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('/api/info')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setInfo)
      .catch((e) => setError(e.message))
  }, [])

  return (
    <main className="wrap">
      <h1>Azure learning project</h1>
      <p>React frontend served from the public subnet.</p>
      <h2>Backend response</h2>
      {error && <p className="err">Could not reach the API: {error}</p>}
      {!info && !error && <p>Loading...</p>}
      {info && <pre>{JSON.stringify(info, null, 2)}</pre>}
    </main>
  )
}
