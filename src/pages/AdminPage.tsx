import React, { FormEvent, useEffect, useState } from "react";
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
  const { arenas, loading: arenasLoading, error: arenasError } = useArenas();

  // UI status
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await ensureAnonAuth();                // ✅ rules need auth
        await ensureBossProfile(bossName);
        await fetchPlayers();
      } catch (err) {
        console.error(err);
        setStatus(`Failed to load admin data: ${extractErrorMessage(err)}`);
      }
    };
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPlayers = async () => {
    await ensureAnonAuth();                   // ✅ guard reads too
    const playerList = await listPlayers();
    setPlayers(playerList);
  };

  const handleEnsureBossProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus(null);
    try {
      await ensureAnonAuth();
      await ensureBossProfile(bossName);
      setStatus("Boss profile updated.");
    } catch (err) {
      console.error(err);
      setStatus(`Failed to update boss profile: ${extractErrorMessage(err)}`);
    }
  };

  const handleCreatePlayer = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus(null);
    try {
      await ensureAnonAuth();
      await createPlayer({
        codename: playerCodename,
        passcode: normalizePasscode(playerPasscode), // ✅ normalized
      });
      setPlayerCodename("");
      setPlayerPasscode("");
      setStatus("Player created.");
      await fetchPlayers();
    } catch (err) {
      console.error(err);
      setStatus(`Failed to create player: ${extractErrorMessage(err)}`);
    }
  };

  const handleCreateArena = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus(null);
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
      setStatus("Arena created.");
      // useArenas() will update list in real-time
    } catch (err) {
      console.error(err);
      setStatus(`Failed to create arena: ${extractErrorMessage(err)}`);
    }
  };

  const formsDisabled = loading;

  return (
    <main>
      <section className="card">
        <h1>Admin Console</h1>
        <p>Use this console to manage players and arenas.</p>
        <p>
          <a className="button-link" href="/training-standalone.html" target="_blank" rel="noreferrer">
            Open Training (Standalone)
          </a>
        </p>
        {status ? <p>{status}</p> : null}
      </section>

      <section className="card">
        <h2>Boss Profile</h2>
        <form onSubmit={handleEnsureBossProfile}>
          <fieldset disabled={formsDisabled} className="fieldset">
            <label htmlFor="boss-name">Display name</label>
            <input
              id="boss-name"
              value={bossName}
              onChange={(e) => setBossName(e.target.value)}
              required
            />
            <button className="button" type="submit">Save Boss profile</button>
          </fieldset>
        </form>
      </section>

      <section className="card">
        <h2>Add Player</h2>
        <form onSubmit={handleCreatePlayer}>
          <fieldset disabled={formsDisabled} className="fieldset">
            <label htmlFor="player-codename">Codename</label>
            <input
              id="player-codename"
              value={playerCodename}
              onChange={(e) => setPlayerCodename(e.target.value)}
              required
            />

            <label htmlFor="player-passcode">Passcode (share privately!)</label>
            <input
              id="player-passcode"
              value={playerPasscode}
              onChange={(e) => setPlayerPasscode(e.target.value)}
              required
            />

            <button className="button" type="submit">Create Player</button>
          </fieldset>
        </form>
      </section>

      <section className="card">
        <h2>Add Arena</h2>
        <form onSubmit={handleCreateArena}>
          <fieldset disabled={formsDisabled} className="fieldset">
            <label htmlFor="arena-name">Name</label>
            <input
              id="arena-name"
              value={arenaName}
              onChange={(e) => setArenaName(e.target.value)}
              required
            />

            <label htmlFor="arena-description">Description</label>
            <input
              id="arena-description"
              value={arenaDescription}
              onChange={(e) => setArenaDescription(e.target.value)}
            />

            <label htmlFor="arena-capacity">Capacity (optional)</label>
            <input
              id="arena-capacity"
              type="number"
              value={arenaCapacity}
              onChange={(e) => setArenaCapacity(e.target.value)}
              min="0"
            />

            <button className="button" type="submit">Create Arena</button>
          </fieldset>
        </form>
      </section>

      <section className="card">
        <h2>Current Players</h2>
        {players.length === 0 ? (
          <p className="empty">No players created yet.</p>
        ) : (
          <ul className="list">
            {players.map((p) => (
              <li key={p.id}>
                {p.codename}
                {p.passcode ? <span className="muted"> — passcode: {p.passcode}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Current Arenas</h2>
        {arenasError ? (
          <p className="error">Failed to load arenas.</p>
        ) : arenasLoading ? (
          <p>Loading arenas...</p>
        ) : arenas.length === 0 ? (
          <p className="empty">No arenas created yet.</p>
        ) : (
          <ul className="list">
            {arenas.map((arena) => (
              <li key={arena.id}>
                <strong>{arena.name}</strong>
                {arena.description ? <span className="muted"> — {arena.description}</span> : null}
                {arena.capacity ? <span className="muted"> (capacity {arena.capacity})</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};

export default AdminPage;
