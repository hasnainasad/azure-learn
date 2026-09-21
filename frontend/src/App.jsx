import { useEffect, useState } from "react";
import "./App.css";
import { api, getToken, setToken } from "./api";
import AuthForm from "./AuthForm";

export default function App() {
  const [user, setUser] = useState(null);
  // 'checking' while we ask the server whether a saved token is still valid
  const [checking, setChecking] = useState(() => Boolean(getToken()));
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState(null);

  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null)) // expired or invalid: forget it
      .finally(() => setChecking(false));
  }, []);

  function logout() {
    setToken(null);
    setUser(null);
  }

  function loadInfo() {
    setInfoError(null);
    api
      .info()
      .then(setInfo)
      .catch((e) => setInfoError(e.message));
  }

  return (
    <main className="wrap">
      <h1>Robo-advisor</h1>

      {checking && <p>Checking your session...</p>}
      {!checking && !user && <AuthForm onAuthed={setUser} />}
      {user && (
        <section className="card">
          <h2>Welcome, {user.name}</h2>
          <p>You are logged in as {user.email}.</p>
          <p>Next slices: risk profile, KYC, fund recommendations.</p>
          <button onClick={logout}>Log out</button>
        </section>
      )}

      <details onToggle={(e) => e.currentTarget.open && !info && loadInfo()}>
        <summary>Infrastructure diagnostics</summary>
        {infoError && (
          <p className="err">Could not reach the API: {infoError}</p>
        )}
        {info && <pre>{JSON.stringify(info, null, 2)}</pre>}
      </details>
    </main>
  );
}
