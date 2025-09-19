import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listArenas, listLeaderboard } from "../firebase";
import { useAuth } from "../context/AuthContext";
import type { Arena, LeaderboardEntry } from "../types/models";

export const HomePage = () => {
  const { login, player, loading } = useAuth();
  const navigate = useNavigate();
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      setIsLoadingData(true);
      try {
        const [arenaList, leaderboardEntries] = await Promise.all([
          listArenas(),
          listLeaderboard(),
        ]);
        setArenas(arenaList);
        setLeaderboard(leaderboardEntries);
      } catch (err) {
        console.error("Failed to load data", err);
      } finally {
        setIsLoadingData(false);
      }
    };
    fetchData().catch((err) => console.error(err));
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const profile = await login(passcode);
      const fallbackArena = arenas.find((arena) => arena.isActive);
      const targetArenaId = profile.preferredArenaId ?? fallbackArena?.id;
      if (targetArenaId) {
        navigate(`/arena/${targetArenaId}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to login.";
      setError(message);
    }
  };

  const quickMatchArena = useMemo(() => arenas.find((arena) => arena.isActive), [arenas]);

  return (
    <main>
      <section className="card">
        <h1>StickFight PA</h1>
        <p>Enter the passcode provided by the Boss to join the fray.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="passcode">Passcode</label>
          <input
            id="passcode"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="e.g. thunder-fox"
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Connecting..." : "Enter Arena"}
          </button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
        {player ? <p>Welcome back, Agent {player.codename}!</p> : null}
      </section>

      <section className="card">
        <h2>Quick Match</h2>
        <p>Jump into the first active arena available.</p>
        <button
          type="button"
          disabled={!player || !quickMatchArena}
          onClick={() => quickMatchArena && navigate(`/arena/${quickMatchArena.id}`)}
        >
          {player ? "Queue Me Up" : "Login to queue"}
        </button>
        {!quickMatchArena ? <p>No active arenas yet. Ask the Boss to spin one up.</p> : null}
      </section>

      <section className="card">
        <h2>Arenas</h2>
        {isLoadingData ? (
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
                <Link to={`/arena/${arena.id}`}>View</Link>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Leaderboard</h2>
        {isLoadingData ? (
          <p>Loading leaderboard…</p>
        ) : leaderboard.length === 0 ? (
          <p>No results yet. Battle to place!</p>
        ) : (
          <ol>
            {leaderboard.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.playerCodename ?? entry.playerId}</strong> — {entry.wins}W / {entry.losses}L (streak {entry.streak})
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
};
