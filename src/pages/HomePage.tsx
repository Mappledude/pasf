import React, { FormEvent, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useArenas } from "../utils/useArenas";
import { useArenaPresence, usePresenceRoster } from "../utils/useArenaPresence";

import type { Arena } from "../types/models";

interface ArenaListItemProps {
  arena: Arena;
  onJoin: (arenaId: string) => void;
}

const ArenaListItem = ({ arena, onJoin }: ArenaListItemProps) => {
// seatless roster (Lobby card)
const { loading: presenceLoading } = useArenaPresence(arena.id);
const { names: rosterNames, count: rosterCount } = usePresenceRoster(arena.id);

// "Ben, Zane, Asha (+2)" style chip
const formattedRoster = useMemo(() => {
  const head = rosterNames.slice(0, 3).join(", ");
  return rosterCount > 3 ? `${head} (+${rosterCount - 3})` : head;
}, [rosterNames, rosterCount]);

const occupancy = rosterCount;

React.useEffect(() => {
  if (presenceLoading) return;
  console.log(
    `[LOBBY] arena=${arena.id} liveCount=${rosterCount} names=${formattedRoster}`
  );
}, [arena.id, presenceLoading, rosterCount, formattedRoster]);

  const capacityLabel = useMemo(() => {
    if (presenceLoading) return null;
    if (arena.capacity) {
      return `${rosterCount}/${arena.capacity}`;
    }
    return `${rosterCount} agents`;
  }, [arena.capacity, presenceLoading, rosterCount]);

  return (
    <li>
      <div className="meta-grid">
        <strong>{arena.name}</strong>
        {arena.description ? <span className="muted">{arena.description}</span> : null}
      </div>
      {presenceLoading ? (
        <span className="skel" style={{ width: 160, height: 16, display: "block", marginTop: 8 }} />
      ) : rosterNames.length ? (
        <div className="chips" style={{ marginTop: 8 }}>
          {rosterNames.map((name, index) => (
            <span className="chip" key={`${name}-${index}`}>
              {name}
            </span>
          ))}
          {overflow > 0 ? <span className="chip muted">+{overflow}</span> : null}
        </div>
      ) : null}
      <div className="meta">
        {presenceLoading ? (
          <span className="skel" style={{ width: 80, height: 14 }} />
        ) : (
          <span className="muted">{capacityLabel}</span>
        )}
        <button type="button" className="button ghost" onClick={() => onJoin(arena.id)}>
          Join
        </button>
      </div>
    </li>
  );
};

const HomePage = () => {
  const { login, player, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const passcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [passcode, setPasscode] = useState("");
  const [codename, setCodename] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return sessionStorage.getItem("pasf:lastCodename") ?? "";
  });
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
      if (codename) {
        sessionStorage.setItem("pasf:lastCodename", codename);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to login.";
      setError(message);
    }
  };

  const handleJoinArena = (arenaId: string) => {
    if (!player) {
      setError("Enter your passcode before joining an arena.");
      passcodeInputRef.current?.focus();
      return;
    }
    navigate(`/arena/${arenaId}`);
  };

  const renderHeroCard = () => {
    if (authLoading) {
      return (
        <section className="card">
          <h1>Linking to Lobby…</h1>
          <p>Establishing anonymous auth handshake. One moment.</p>
          <div className="skel" style={{ width: "60%", height: 20 }} />
        </section>
      );
    }

    if (!player) {
      return (
        <section className="card">
          <h1>Enter the Arena</h1>
          <p>Secure access with the nightly passcode. Your codename is optional, but stylish.</p>
          <form onSubmit={handleLogin} aria-live="polite">
            <fieldset className="fieldset" disabled={authLoading}>
              <div>
                <label htmlFor="codename">Codename (optional)</label>
                <input
                  id="codename"
                  value={codename}
                  onChange={(event) => setCodename(event.target.value)}
                  placeholder="e.g. shadow-fox"
                />
              </div>
              <div>
                <label htmlFor="passcode">Passcode</label>
                <input
                  id="passcode"
                  ref={passcodeInputRef}
                  value={passcode}
                  onChange={(event) => setPasscode(event.target.value)}
                  placeholder="Enter tonight's key"
                  required
                />
              </div>
              <button type="submit" className="button">
                Enter Arena
              </button>
            </fieldset>
            {error ? <div className="error" role="alert">{error}</div> : null}
          </form>
        </section>
      );
    }

    return (
      <section className="card">
        <h1>Lobby Ready</h1>
        <p>Welcome back, Agent {player.codename}. Select an arena to deploy.</p>
        <div className="button-row">
          <Link to="/training" className="button ghost">
            Warmup Run
          </Link>
        </div>
      </section>
    );
  };

  const renderArenaList = () => (
    <section className="card">
      <div className="card-header">
        <h2>Live Arenas</h2>
        <span className="muted">Realtime status</span>
      </div>
      {arenasError ? (
        <div className="error" role="alert">
          Failed to load arenas.
        </div>
      ) : arenasLoading ? (
        <ul className="list">
          {Array.from({ length: 3 }).map((_, index) => (
            <li key={index}>
              <div className="meta-grid">
                <span className="skel" style={{ width: 140 }} />
                <span className="skel" style={{ width: 180 }} />
              </div>
              <div className="meta">
                <span className="skel" style={{ width: 64, height: 14 }} />
                <span className="skel" style={{ width: 80, height: 34 }} />
              </div>
            </li>
          ))}
        </ul>
      ) : arenas.length === 0 ? (
        <p className="empty">No arenas yet. Ask the Boss to create one.</p>
      ) : (
        <ul className="list">
          {arenas.map((arena) => (
            <ArenaListItem key={arena.id} arena={arena} onJoin={handleJoinArena} />
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="grid grid-2" style={{ alignItems: "start" }}>
        {renderHeroCard()}
        {renderArenaList()}
      </div>

      <section className="card">
        <div className="card-header">
          <h2>Training Grounds</h2>
          <span className="muted">Solo drills</span>
        </div>
        <p>Warm up your reflexes in the single-player sandbox before the next match.</p>
        <div className="button-row">
          <Link to="/training" className="button">
            Launch Training
          </Link>
          <a className="button ghost" href="/training-standalone.html" target="_blank" rel="noreferrer">
            Standalone Canvas
          </a>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
