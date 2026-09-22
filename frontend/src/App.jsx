import { useEffect, useState } from "react";
import "./App.css";
import { api, getToken, setToken } from "./api";
import AuthForm from "./AuthForm";
import RiskQuestionnaire from "./RiskQuestionnaire";
import RiskResult from "./RiskResult";
import KycSection from "./KycSection";
import AdminKycPanel from "./AdminKycPanel";

export default function App() {
  const [user, setUser] = useState(null);
  // 'checking' while we ask the server whether a saved token is still valid
  const [checking, setChecking] = useState(() => Boolean(getToken()));
  const [info, setInfo] = useState(null);
  const [infoError, setInfoError] = useState(null);

  // undefined = still loading, null = user has not done the questionnaire yet
  const [assessment, setAssessment] = useState(undefined);
  const [previousCount, setPreviousCount] = useState(0);
  const [retaking, setRetaking] = useState(false);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch(() => setToken(null)) // expired or invalid: forget it
      .finally(() => setChecking(false));
  }, []);

  // Once we know who is logged in, fetch their saved risk profile
  useEffect(() => {
    if (!user) return;
    api
      .getAssessment()
      .then((r) => {
        setAssessment(r.assessment);
        setPreviousCount(r.previousCount);
      })
      .catch((e) => {
        if (e.status === 401) logout();
        else setProfileError(e.message);
      });
  }, [user]);

  function logout() {
    setToken(null);
    setUser(null);
    setAssessment(undefined);
    setRetaking(false);
    setProfileError(null);
  }

  function handleSaved(a) {
    setPreviousCount((n) => (assessment ? n + 1 : n));
    setAssessment(a);
    setRetaking(false);
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
        <>
          <p className="topbar">
            Signed in as <strong>{user.name}</strong> ({user.email}){" "}
            <button className="link" onClick={logout}>
              Log out
            </button>
          </p>

          {profileError && (
            <p className="err">Could not load your profile: {profileError}</p>
          )}
          {!profileError && assessment === undefined && (
            <p>Loading your profile...</p>
          )}
          {assessment === null && <RiskQuestionnaire onSaved={handleSaved} />}
          {assessment && !retaking && (
            <RiskResult
              assessment={assessment}
              previousCount={previousCount}
              onRetake={() => setRetaking(true)}
            />
          )}
          {assessment && retaking && (
            <RiskQuestionnaire
              onSaved={handleSaved}
              onCancel={() => setRetaking(false)}
            />
          )}

          <KycSection />

          {user.role === "admin" && <AdminKycPanel />}
        </>
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
