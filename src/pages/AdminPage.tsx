import { FormEvent, useEffect, useState } from "react";
import { createArena, createPlayer, ensureBossProfile, listArenas, listLeaderboard } from "../firebase";
import type { Arena, LeaderboardEntry } from "../types/models";

const AdminPage = () => {
  const [bossName, setBossName] = useState("Boss");
  const [playerCodename, setPlayerCodename] = useState("");
  const [playerPasscode, setPlayerPasscode] = useState("");
  const [playerPreferredArena, setPlayerPreferredArena] = useState<string>("");
  const [arenaName, setArenaName] = useState("");
  const [arenaDescription, setArenaDescription] = useState("");
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
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
    // we intentionally exclude bossName from deps so we only create once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshData = async () => {
    const [arenaList, leaderboardEntries] = await Promise.all([
      listArenas(),
      listLeaderboard(),
    ]);
    setArenas(arenaList);
    setLeaderboard(leaderboardEntries);
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
        preferredArenaId: playerPreferredArena || undefined,
      });
      setPlayerCodename("");
      setPlayerPasscode("");
      setPlayerPreferredArena("");
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
        description: arenaDescription,
      });
      setArenaName("");
      setArenaDescription("");
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
        <p>Use this console to manage players, arenas, and the leaderboard.</p>
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
        <p className="muted">Boss profile is stored in Firestore under <code>boss/primary</code>.</p>
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

          <label htmlFor="player-preferred-arena">Preferred Arena</label>
          <select
            id="player-preferred-arena"
            value={playerPreferredArena}
            onChange={(event) => setPlayerPreferredArena(event.target.value)}
          >
            <option value="">No preference</option>
            {arenas.map((arena) => (
              <option key={arena.id} value={arena.id}>
                {arena.name}
              </option>
            ))}
          </select>

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

          <button type="submit">Create Arena</button>
        </form>
      </section>

      <section className="card">
        <h2>Current Arenas</h2>
        {arenas.length === 0 ? (
          <p>No arenas yet.</p>
        ) : (
          <ul>
            {arenas.map((arena) => (
              <li key={arena.id}>
                {arena.name} — {arena.description || "No description"}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>Leaderboard Snapshot</h2>
        {leaderboard.length === 0 ? (
          <p>Leaderboard will populate once matches start.</p>
        ) : (
          <ol>
            {leaderboard.map((entry) => (
              <li key={entry.id}>
                {entry.playerId}: {entry.wins}W / {entry.losses}L (streak {entry.streak})
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
};

export default AdminPage;
