import React, { FormEvent, useEffect, useMemo, useState } from "react";
import {
  createArena,
  createPlayer,
  ensureBossProfile,
  listPlayers,
  ensureAnonAuth,
  normalizePasscode,
} from "../firebase";
import type { PlayerProfile } from "../types/models";
import { useArenas } from "../utils/useArenas";
import { useAuth } from "../context/AuthContext";
import DebugDock from "../components/DebugDock";

const extractErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown error";
};

const AdminPage = () => {
  const { loading } = useAuth(); // true until anon auth ready

  // Boss
  const [bossName, setBossName] = useState("Boss");

  // Players form
  const [playerCodename, setPlayerCodename] = useState("");
  const [playerPasscode, setPlayerPasscode] = useState("");

  // Arenas form
  const [arenaName, setArenaName] = useState("");
  const [arenaDescription, setArenaDescription] = useState("");
  const [arenaCapacity, setArenaCapacity] = useState<string>("");

  // Data
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [playersLoading, setPlayersLoading] = useState(true);
  const { arenas, loading: arenasLoading, error: arenasError } = useArenas();

  // UI status
  const [status, setStatus] = useState<{ message: string; tone: "info" | "error" } | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        setStatus({ message: "Booting admin console…", tone: "info" });
        await ensureAnonAuth();
        await ensureBossProfile(bossName);
        await fetchPlayers();
        setStatus({ message: "Console ready.", tone: "info" });
      } catch (err) {
        console.error(err);
        setStatus({ message: `Failed to load admin data: ${extractErrorMessage(err)}`, tone: "error" });
      }
    };
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPlayers = async () => {
    try {
      setPlayersLoading(true);
      await ensureAnonAuth();
      const playerList = await listPlayers();
      setPlayers(playerList);
    } catch (err) {
      console.error(err);
      setStatus({ message: `Failed to load players: ${extractErrorMessage(err)}`, tone: "error" });
    } finally {
      setPlayersLoading(false);
    }
  };

  const handleEnsureBossProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus({ message: "Saving boss profile…", tone: "info" });
    try {
      await ensureAnonAuth();
      await ensureBossProfile(bossName);
      setStatus({ message: "Boss profile updated.", tone: "info" });
    } catch (err) {
      console.error(err);
      setStatus({ message: `Failed to update boss profile: ${extractErrorMessage(err)}`, tone: "error" });
    }
  };

  const handleCreatePlayer = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus({ message: "Creating player…", tone: "info" });
    try {
      await ensureAnonAuth();
      await createPlayer({
        codename: playerCodename,
        passcode: normalizePasscode(playerPasscode), // ✅ normalized
      });
      setPlayerCodename("");
      setPlayerPasscode("");
      setStatus({ message: "Player created.", tone: "info" });
      await fetchPlayers();
    } catch (err) {
      console.error(err);
      setStatus({ message: `Failed to create player: ${extractErrorMessage(err)}`, tone: "error" });
    }
  };

  const handleCreateArena = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus({ message: "Creating arena…", tone: "info" });
    try {
      await ensureAnonAuth();
      await createArena({
        name: arenaName,
        description: arenaDescription || undefined,
        capacity: arenaCapacity ? Number(arenaCapacity) : undefined,
      });
      setArenaName("");
      setArenaDescription("");
      setArenaCapacity("");
      setStatus({ message: "Arena created.", tone: "info" });
      // useArenas() will update list in real-time
    } catch (err) {
      console.error(err);
      setStatus({ message: `Failed to create arena: ${extractErrorMessage(err)}`, tone: "error" });
    }
  };

  const formsDisabled = loading;
  const statusTone = status?.tone ?? (loading ? "info" : "info");
  const statusMessage = useMemo(() => {
    if (status) return status.message;
    return loading ? "Authenticating admin…" : "All systems nominal.";
  }, [loading, status]);

  return (
    <>
      <div className="grid" style={{ gap: 24 }}>
        <div
          className={`status-bar${statusTone === "error" ? " error" : ""}`}
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </div>

      <div className="grid grid-2" style={{ alignItems: "start", gap: 24 }}>
        <div className="grid" style={{ gap: 24 }}>
          <section className="card">
            <div className="card-header">
              <h2>Boss Profile</h2>
              <span className="muted">Identity</span>
            </div>
            <form onSubmit={handleEnsureBossProfile}>
              <fieldset disabled={formsDisabled} className="fieldset">
                <label htmlFor="boss-name">Display name</label>
                <input
                  id="boss-name"
                  value={bossName}
                  onChange={(e) => setBossName(e.target.value)}
                  required
                />
                <button className="button" type="submit">
                  Save Boss Profile
                </button>
              </fieldset>
            </form>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Add Player</h2>
              <span className="muted">Credentials</span>
            </div>
            <form onSubmit={handleCreatePlayer}>
              <fieldset disabled={formsDisabled} className="fieldset">
                <label htmlFor="player-codename">Codename</label>
                <input
                  id="player-codename"
                  value={playerCodename}
                  onChange={(e) => setPlayerCodename(e.target.value)}
                  placeholder="e.g. midnight-spark"
                  required
                />

                <label htmlFor="player-passcode">Passcode (share privately)</label>
                <input
                  id="player-passcode"
                  value={playerPasscode}
                  onChange={(e) => setPlayerPasscode(e.target.value)}
                  placeholder="auto-generated or custom"
                  required
                />

                <button className="button" type="submit">
                  Create Player
                </button>
              </fieldset>
            </form>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Add Arena</h2>
              <span className="muted">Deploy</span>
            </div>
            <form onSubmit={handleCreateArena}>
              <fieldset disabled={formsDisabled} className="fieldset">
                <label htmlFor="arena-name">Name</label>
                <input
                  id="arena-name"
                  value={arenaName}
                  onChange={(e) => setArenaName(e.target.value)}
                  placeholder="e.g. Forge Alpha"
                  required
                />

                <label htmlFor="arena-description">Description</label>
                <input
                  id="arena-description"
                  value={arenaDescription}
                  onChange={(e) => setArenaDescription(e.target.value)}
                  placeholder="Short mission brief"
                />

                <label htmlFor="arena-capacity">Capacity (optional)</label>
                <input
                  id="arena-capacity"
                  type="number"
                  value={arenaCapacity}
                  onChange={(e) => setArenaCapacity(e.target.value)}
                  min="0"
                  placeholder="Max agents"
                />

                <button className="button" type="submit">
                  Create Arena
                </button>
              </fieldset>
            </form>
          </section>
        </div>

        <div className="grid" style={{ gap: 24 }}>
          <section className="card">
            <div className="card-header">
              <h2>Current Players</h2>
              <span className="muted">Roster</span>
            </div>
            {playersLoading ? (
              <ul className="list">
                {Array.from({ length: 4 }).map((_, index) => (
                  <li key={index}>
                    <span className="skel" style={{ width: 160 }} />
                    <span className="skel" style={{ width: 90 }} />
                  </li>
                ))}
              </ul>
            ) : players.length === 0 ? (
              <p className="empty">No players created yet.</p>
            ) : (
              <ul className="list">
                {players.map((p) => (
                  <li key={p.id}>
                    <div className="meta-grid">
                      <strong>{p.codename}</strong>
                      {p.lastActiveAt ? (
                        <span className="muted">Last active {new Date(p.lastActiveAt).toLocaleString()}</span>
                      ) : (
                        <span className="muted">Created {new Date(p.createdAt).toLocaleString()}</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Current Arenas</h2>
              <span className="muted">Live grid</span>
            </div>
            {arenasError ? (
              <div className="error">Failed to load arenas.</div>
            ) : arenasLoading ? (
              <ul className="list">
                {Array.from({ length: 3 }).map((_, index) => (
                  <li key={index}>
                    <span className="skel" style={{ width: 140 }} />
                    <span className="skel" style={{ width: 110 }} />
                  </li>
                ))}
              </ul>
            ) : arenas.length === 0 ? (
              <p className="empty">No arenas created yet.</p>
            ) : (
              <ul className="list">
                {arenas.map((arena) => (
                  <li key={arena.id}>
                    <div className="meta-grid">
                      <strong>{arena.name}</strong>
                      {arena.description ? <span className="muted">{arena.description}</span> : null}
                    </div>
                    <div className="meta">
                      {arena.capacity ? (
                        <span className="muted">Capacity {arena.capacity}</span>
                      ) : (
                        <span className="muted">Capacity ∞</span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
      </div>
      <DebugDock />
    </>
  );
};

export default AdminPage;
