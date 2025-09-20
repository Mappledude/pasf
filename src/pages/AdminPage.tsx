import React, { FormEvent, useEffect, useState } from "react";
import {
  createArena,
  createPlayer,
  ensureBossProfile,
  listArenas,
  listPlayers,
} from "../firebase";
import type { Arena, PlayerProfile } from "../types/models";

const AdminPage = () => {
  const [bossName, setBossName] = useState("Boss");
  const [playerCodename, setPlayerCodename] = useState("");
  const [playerPasscode, setPlayerPasscode] = useState("");
  const [arenaName, setArenaName] = useState("");
  const [arenaDescription, setArenaDescription] = useState("");
  const [arenaCapacity, setArenaCapacity] = useState<string>("");
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [players, setPlayers] = useState<PlayerProfile[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      await ensureBossProfile(bossName);
      await refreshData();
    };
    bootstrap().catch((err) => {
      console.error(err);
      setStatus("Failed to load admin data");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshData = async () => {
    const [arenaList, playerList] = await Promise.all([listArenas(), listPlayers()]);
    setArenas(arenaList);
    setPlayers(playerList);
  };

  const handleEnsureBossProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    try {
      await ensureBossProfile(bossName);
      setStatus("Boss profile updated.");
    } catch (err) {
      console.error(err);
      setStatus("Failed to update boss profile");
    }
  };

  const handleCreatePlayer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    try {
      await createPlayer({
        codename: playerCodename,
        passcode: playerPasscode,
      });
      setPlayerCodename("");
      setPlayerPasscode("");
      setStatus("Player created.");
      await refreshData();
    } catch (err) {
      console.error(err);
      setStatus("Failed to create player");
    }
  };

  const handleCreateArena = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    try {
      await createArena({
        name: arenaName,
        description: arenaDescription || undefined,
        capacity: arenaCapacity ? Number(arenaCapacity) : undefined,
      });
      setArenaName("");
      setArenaDescription("");
      setArenaCapacity("");
      setStatus("Arena created.");
      await refreshData();
    } catch (err) {
      console.error(err);
      setStatus("Failed to create arena");
    }
  };

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
          <label htmlFor="boss-name">Display name</label>
          <input
            id="boss-name"
            value={bossName}
            onChange={(event) => setBossName(event.target.value)}
            required
          />
          <button type="submit">Save Boss profile</button>
        </form>
      </section>

      <section className="card">
        <h2>Add Player</h2>
        <form onSubmit={handleCreatePlayer}>
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
        </form>
      </section>

      <section className="card">
        <h2>Add Arena</h2>
        <form onSubmit={handleCreateArena}>
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
                {p.passcode ? <span className="muted"> — passcode: {p.passcode}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Current Arenas</h2>
        {arenas.length === 0 ? (
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
