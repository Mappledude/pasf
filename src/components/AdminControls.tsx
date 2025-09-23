import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { getIdTokenResult, onIdTokenChanged } from "firebase/auth";

import { auth } from "../firebase";
import { callAdminDeleteArena, callAdminDeletePlayer } from "../api/admin";

interface StatusMessage {
  tone: "info" | "success" | "error";
  message: string;
}

const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Unknown error";
};

const AdminControls: React.FC = () => {
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [arenaId, setArenaId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [purgeRelated, setPurgeRelated] = useState(true);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      if (!user) {
        setIsAdmin(false);
        setCheckingAdmin(false);
        return;
      }

      try {
        const result = await getIdTokenResult(user, true);
        setIsAdmin(result.claims?.admin === true);
      } catch (error) {
        console.error("admin-check failed", error);
        setIsAdmin(false);
        setStatus({ tone: "error", message: `Failed to verify admin status: ${extractErrorMessage(error)}` });
      } finally {
        setCheckingAdmin(false);
      }
    });

    return unsubscribe;
  }, []);

  const handleDeleteArena = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = arenaId.trim();
    if (!trimmed) {
      setStatus({ tone: "error", message: "Arena ID is required." });
      return;
    }

    const confirmed = window.confirm(
      `Delete arena ${trimmed}? This removes the arena document and all related subcollections.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus({ tone: "info", message: `Deleting arena ${trimmed}…` });
    try {
      const result = await callAdminDeleteArena(trimmed);
      setStatus({ tone: "success", message: `Arena ${result.arenaId} deleted.` });
      setArenaId("");
    } catch (error) {
      console.error("delete-arena failed", error);
      setStatus({ tone: "error", message: `Failed to delete arena: ${extractErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePlayer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = playerId.trim();
    if (!trimmed) {
      setStatus({ tone: "error", message: "Player ID is required." });
      return;
    }

    const confirmed = window.confirm(
      `Delete player ${trimmed}? This removes the player document${
        purgeRelated ? " and related presence/seats" : ""
      } across arenas.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus({ tone: "info", message: `Deleting player ${trimmed}…` });
    try {
      const result = await callAdminDeletePlayer(trimmed, purgeRelated);
      setStatus({
        tone: "success",
        message: `Player ${result.playerId} deleted${
          result.purgeRelated ? " with related documents purged." : "."
        }`,
      });
      setPlayerId("");
    } catch (error) {
      console.error("delete-player failed", error);
      setStatus({ tone: "error", message: `Failed to delete player: ${extractErrorMessage(error)}` });
    } finally {
      setBusy(false);
    }
  };

  const statusMessage = useMemo(() => {
    if (status) return status.message;
    return "Ready.";
  }, [status]);

  const statusTone = status?.tone ?? "info";
  const statusClass = `status-bar${statusTone === "error" ? " error" : ""}`;

  if (checkingAdmin || !isAdmin) {
    return null;
  }

  return (
    <section className="card">
      <div className="card-header">
        <h2>Admin Controls</h2>
        <span className="muted">Danger zone</span>
      </div>

      <div className={statusClass} role="status" aria-live="polite">
        {statusMessage}
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <form onSubmit={handleDeleteArena}>
          <fieldset disabled={busy} className="fieldset">
            <label htmlFor="admin-arena-id">Arena ID</label>
            <input
              id="admin-arena-id"
              value={arenaId}
              onChange={(event) => setArenaId(event.target.value)}
              placeholder="ARENA-ID"
            />
            <button className="button danger" type="submit">
              Delete Arena
            </button>
          </fieldset>
        </form>

        <form onSubmit={handleDeletePlayer}>
          <fieldset disabled={busy} className="fieldset">
            <label htmlFor="admin-player-id">Player ID</label>
            <input
              id="admin-player-id"
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              placeholder="PLAYER-UID"
            />

            <label className="checkbox">
              <input
                type="checkbox"
                checked={purgeRelated}
                onChange={(event) => setPurgeRelated(event.target.checked)}
              />
              Purge seats/presence across arenas
            </label>

            <button className="button danger" type="submit">
              Delete Player
            </button>
          </fieldset>
        </form>
      </div>
    </section>
  );
};

export default AdminControls;
