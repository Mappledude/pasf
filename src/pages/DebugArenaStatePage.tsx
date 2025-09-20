import React, { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { useParams } from "react-router-dom";

import { db } from "../firebase";
import { arenaStateDoc } from "../lib/arenaState";

interface DebugPresenceEntry {
  id: string;
  codename?: string;
  playerId?: string;
  authUid?: string;
  joinedAt?: string;
  [key: string]: unknown;
}

const DebugArenaStatePage: React.FC = () => {
  const { arenaId } = useParams<{ arenaId: string }>();
  const [presence, setPresence] = useState<DebugPresenceEntry[]>([]);
  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [stateData, setStateData] = useState<Record<string, unknown> | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [presenceSnapAt, setPresenceSnapAt] = useState<string | null>(null);
  const [stateSnapAt, setStateSnapAt] = useState<string | null>(null);

  useEffect(() => {
    if (!arenaId) {
      setPresence([]);
      setPresenceError("Arena ID not provided");
      return;
    }

    const presenceQuery = query(
      collection(db, "arenas", arenaId, "presence"),
      orderBy("joinedAt", "asc"),
    );

    const unsubscribe = onSnapshot(
      presenceQuery,
      (snapshot) => {
        const entries: DebugPresenceEntry[] = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Record<string, unknown>),
        }));
        setPresence(entries);
        setPresenceError(null);
        setPresenceSnapAt(new Date().toISOString());
      },
      (err) => {
        console.error("[debug/arena] presence subscription error:", err);
        setPresenceError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      unsubscribe();
    };
  }, [arenaId]);

  useEffect(() => {
    if (!arenaId) {
      setStateData(null);
      setStateError("Arena ID not provided");
      return;
    }

    const ref = arenaStateDoc(arenaId);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (snapshot.exists()) {
          setStateData(snapshot.data() as Record<string, unknown>);
        } else {
          setStateData(null);
        }
        setStateError(null);
        setStateSnapAt(new Date().toISOString());
      },
      (err) => {
        console.error("[debug/arena] state subscription error:", err);
        setStateError(err instanceof Error ? err.message : String(err));
      },
    );

    return () => {
      unsubscribe();
    };
  }, [arenaId]);

  return (
    <div style={{ padding: 24, background: "#0f1115", color: "#e5e7eb", minHeight: "100vh" }}>
      <h1 style={{ marginTop: 0 }}>Arena Debug</h1>
      <p>
        Viewing arena <code>{arenaId ?? "(none)"}</code>
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2>Presence</h2>
        <p style={{ color: "#9ca3af" }}>
          Last snapshot: {presenceSnapAt ? new Date(presenceSnapAt).toLocaleString() : "waiting..."}
        </p>
        {presenceError ? (
          <div style={{ color: "#fca5a5" }}>Error: {presenceError}</div>
        ) : presence.length === 0 ? (
          <div style={{ color: "#9ca3af" }}>No presence records.</div>
        ) : (
          <ul style={{ listStyle: "disc", paddingLeft: 20 }}>
            {presence.map((entry) => (
              <li key={entry.id}>
                <code>{entry.id}</code>
                {entry.codename ? ` — ${entry.codename}` : ""}
                {entry.playerId && entry.playerId !== entry.id ? ` (playerId: ${entry.playerId})` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>State document</h2>
        <p style={{ color: "#9ca3af" }}>
          Path: <code>{`/arenas/${arenaId ?? "?"}/state`}</code>
        </p>
        <p style={{ color: "#9ca3af" }}>
          Last snapshot: {stateSnapAt ? new Date(stateSnapAt).toLocaleString() : "waiting..."}
        </p>
        {stateError ? (
          <div style={{ color: "#fca5a5" }}>Error: {stateError}</div>
        ) : (
          <pre
            style={{
              background: "#111827",
              padding: 16,
              borderRadius: 8,
              overflowX: "auto",
              maxHeight: 360,
              border: "1px solid #1f2937",
            }}
          >
            {stateData ? JSON.stringify(stateData, null, 2) : "<no data>"}
          </pre>
        )}
      </section>
    </div>
  );
};

export default DebugArenaStatePage;
