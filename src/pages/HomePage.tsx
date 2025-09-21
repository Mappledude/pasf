import React, { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useArenas } from "../utils/useArenas";

const HomePage = () => {
  const { login, player, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const {
    arenas,
    loading: arenasLoading,
    error: arenasError,
  } = useArenas();

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      await login(passcode);
      setPasscode("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to login.";
      setError(message);
    }
  };

  const renderPasscodePrompt = () => (
    <section className="card">
      <h1>StickFight PA</h1>
      <p>Enter the passcode provided by the Boss to access the lobby.</p>
      <form onSubmit={handleLogin}>
        <label htmlFor="passcode">Passcode</label>
        <input
          id="passcode"
          value={passcode}
          onChange={(event) => setPasscode(event.target.value)}
          placeholder="e.g. thunder-fox"
          required
        />
        <button type="submit" disabled={authLoading}>
          {authLoading ? "Connecting..." : "Enter Lobby"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );

  const renderArenaList = () => (
    <section className="card">
      <h2>Arenas</h2>
      {arenasError ? (
        <p role="alert">Failed to load arenas.</p>
      ) : arenasLoading ? (
        <p>Loading arenas…</p>
      ) : arenas.length === 0 ? (
        <p>No arenas created yet.</p>
      ) : (
        <div className="list">
          {arenas.map((arena) => (
            <div key={arena.id} className="list-item">
              <div>
                <strong>{arena.name}</strong>
                {arena.description ? <p>{arena.description}</p> : null}
              </div>
              <button type="button" onClick={() => navigate(`/arena/${arena.id}`)}>
                Join
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <main>
      {authLoading ? (
        <section className="card">
          <h1>Preparing lobby…</h1>
          <p>Securing your connection. Please wait.</p>
        </section>
      ) : !player ? (
        renderPasscodePrompt()
      ) : null}

      {!authLoading && player ? (
        <section className="card">
          <h1>Lobby</h1>
          <p>Welcome, Agent {player.codename}. Choose an arena to jump into.</p>
        </section>
      ) : null}

      <section className="card">
        <h2>Practice</h2>
        <p>
          Want to warm up solo? Open the standalone training arena in a new tab and
          practice offline.
        </p>
        <a className="button-link" href="/training-standalone.html" target="_blank" rel="noreferrer">
          Open Training (Standalone)
        </a>
      </section>

      {!authLoading && player ? renderArenaList() : null}
    </main>
  );
};

export default HomePage;
