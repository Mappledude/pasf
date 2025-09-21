import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase";
import { doc, onSnapshot } from "firebase/firestore";

export default function DebugArenaStatePage() {
  const { arenaId = "" } = useParams();
  const [json, setJson] = useState<any>(null);
  const [exists, setExists] = useState<boolean>(false);
  useEffect(() => {
    if (!arenaId) return;
    const ref = doc(db, "arenas", arenaId, "state");
    return onSnapshot(ref, (s) => {
      setExists(s.exists());
      setJson(s.data());
    });
  }, [arenaId]);
  return (
    <div style={{ padding: 16, background: "#0f1115", color: "#e6e6e6", minHeight: "100vh" }}>
      <Link to="/" style={{ color: "#7dd3fc" }}>← Lobby</Link>
      <h2>Debug: /arenas/{arenaId}/state</h2>
      <div>Exists: {String(exists)}</div>
      <pre style={{ background: "#111827", padding: 12, borderRadius: 8 }}>
        {JSON.stringify(json, null, 2)}
      </pre>
    </div>
  );
}
