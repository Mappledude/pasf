import React, { FormEvent, useEffect, useState } from "react";
import {
  createArena,
  createPlayer,
  ensureBossProfile,
  listPlayers,
  ensureAnonAuth, // ✅ make sure we await auth before any Firestore calls
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
  const { loading } = useAuth(); // loading === true until anon auth is ready
  const [bossName, setBossName] = useState("Boss");

  // Players form state
  const [playerCodename, setPlayerCodename] = useState("");
  const [playerPasscode, setPlayerPasscode] = useState("");

  // Arenas form state
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
        // ✅ Ensure auth first (rules require request.auth != null)
        await ensureAnonAuth();
        await ensureBossProfile(bossName);
        await fetchPlayers();
      } catch (err) {
        console.error(err);
        setStatus(`Failed to load admin data: ${extractErrorMessage(err)}`);
      }
    };
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  const fetchPlayers = async () => {
    // ✅ guard reads with auth
    await ensureAnonAuth();
    const playerList = await listPlayers();
    setPlayers(playerList);
  };

  const handleEnsureBossProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    try {
      await ensureAnonAuth(); // ✅
      await ensureBossProfile(bossName);
      setStatus("Boss profile updated.");
    } catch (err) {
      console.error(err);
      setStatus(`Failed to update boss profile: ${extractErrorMessage(err)}`);
    }
  };

  const handleCreatePlayer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    try {
      await ensureAnonAuth(); // ✅
      const normalizedPasscode = normalizePasscode(playerPasscode);
      await createPlayer({
        codename: playerCodename,
        passcode: normalizedPasscode,
      });
      setPlayerCodename("");
      setPlayerPasscode("");
      setStatus("Player created.");
      await fetchPlayers(); // refresh list after success
    } catch (err) {
      console.error(err);
      setStatus(`Failed to create player: ${extractErrorMessage(err)}`);
    }
  };

  const handleCreateArena = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    try {
      await ensureAnonAuth(); // ✅
      await createArena({
        name: arenaName,
        description: arenaDescription || undefined,
        capacity: arenaCapacity ? Number(arenaCapacity) : undefined,
      });
      setArenaName("");
      setArenaDescription("");
      setArenaCapacity("");
      setStatus("Arena created.");
      // No manual refresh needed for arenas: useArenas() is real-time
    } catch (err) {
      console.error(err);
      setStatus(`Failed to create arena: ${extractErrorMessage(err)}`);
    }
  };

  const formsDisabled = loading; // disable forms until auth is ready

  return (
    <main>
      <section className="card">
        <h1>Admin Console</h1>
        <p>Use this console to manage players and arenas.</p>
        <p>
          <a
            className="button-link"
            href="/training-standalone.html"
            target="_blank"
            rel="noreferrer"
          >
            Open Training (Standalone)
          </a>
        </p>
        {status ? <p>{status}</p> : null}
      </section>

      <section className="card">
        <h2>Boss Profile</h2>
        <form onSubmit={handleEnsureBossProfile}>
          <fieldset disabled={formsDisabled}>
            <label htmlFor="boss-name">Display name</label>
            <input
              id="boss-name"
              value={bossName}
              onChange={(event) => setBossName(event.target.value)}
              required
            />
            <button type="submit">Save Boss profile</button>
          </fieldset>
        </form>
      </section>

      <section className="card">
        <h2>Add Player</h2>
        <form onSubmit={handleCreatePlayer}>
          <fieldset disabled={formsDisabled}>
            <label htmlFor="player-codename">Codename</label>
            <input
              id="player-codename"
              value={playerCodename}
              onChange={(event) => setPlayerCodename(event.target.value)}
              required
            />

            <label htmlFor="player-passcode">Passcode (share privately!)</label>
            <input
              id="player-passcode"
              value={playerPasscode}
              onChange={(event) => setPlayerPasscode(event.target.value)}
              required
            />

            <button type="submit">Create Player</button>
          </fieldset>
        </form>
      </section>

      <section className="card">
        <h2>Add Arena</h2>
        <form onSubmit={handleCreateArena}>
          <fieldset disabled={formsDisabled}>
            <label htmlFor="arena-name">Name</label>
            <input
              id="arena-name"
              value={arenaName}
              onChange={(event) => setArenaName(event.target.value)}
              required
            />

            <label htmlFor="arena-description">Description</label>
            <input
              id="arena-description"
              value={arenaDescription}
              onChange={(event) => setArenaDescription(event.target.value)}
            />

            <label htmlFor="arena-capacity">Capacity (optional)</label>
            <input
              id="arena-capacity"
              type="number"
              value={arenaCapacity}
              onChange={(event) => setArenaCapacity(event.target.value)}
              min="0"
            />

            <button type="submit">Create Arena</button>
          </fieldset>
        </form>
      </section>

      <section className="card">
        <h2>Current Players</h2>
        {players.length === 0 ? (
          <p>No players created yet.</p>
        ) : (
          <ul>
            {players.map((p) => (
              <li key={p.id}>
                {p.codename}
                {p.passcode ? (
                  <span className="muted"> — passcode: {p.passcode}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Current Arenas</h2>
        {arenasError ? (
          <p>Failed to load arenas.</p>
        ) : arenasLoading ? (
          <p>Loading arenas...</p>
        ) : arenas.length === 0 ? (
          <p>No arenas yet.</p>
        ) : (
          <ul>
            {arenas.map((arena) => (
              <li key={arena.id}>
                {arena.name}
                {arena.description ? ` — ${arena.description}` : ""}
                {arena.capacity ? ` (capacity ${arena.capacity})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
};

export default AdminPage;
