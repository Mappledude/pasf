import React, { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listArenas } from "../firebase";
import { useAuth } from "../context/AuthContext";
import type { Arena } from "../types/models";

const HomePage = () => {
  const { login, player, loading } = useAuth();
  const navigate = useNavigate();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [isLoadingArenas, setIsLoadingArenas] = useState(false);

  useEffect(() => {
    const fetchArenas = async () => {
      setIsLoadingArenas(true);
      try {
        const arenaList = await listArenas();
        setArenas(arenaList);
      } catch (err) {
        console.error("Failed to load arenas", err);
      } finally {
        setIsLoadingArenas(false);
      }
    };
    fetchArenas().catch((err) => console.error(err));
  }, []);

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
        <button type="submit" disabled={loading}>
          {loading ? "Connecting..." : "Enter Lobby"}
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );

  const renderArenaList = () => (
    <section className="card">
      <h2>Arenas</h2>
      {isLoadingArenas ? (
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
      {!player ? renderPasscodePrompt() : null}

      {player ? (
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

      {player ? renderArenaList() : null}
    </main>
  );
};

export default HomePage;
