import React, { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { db } from "../firebase";
import { doc, onSnapshot } from "firebase/firestore";

export default function DebugArenaStatePage() {
  const { arenaId = "" } = useParams();
  const [json, setJson] = useState<any>(null);
  const [exists, setExists] = useState<boolean>(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    if (!arenaId) return;
    const ref = doc(db, "arenas", arenaId, "state");
    return onSnapshot(ref, (s) => {
      setExists(s.exists());
      setJson(s.data());
    });
  }, [arenaId]);

  useEffect(() => {
    if (copyStatus !== "copied") return;
    const timeout = window.setTimeout(() => setCopyStatus("idle"), 2000);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  const prettyJson = useMemo(() => (json ? JSON.stringify(json, null, 2) : "{}"), [json]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prettyJson);
      setCopyStatus("copied");
    } catch (err) {
      console.error(err);
      setCopyStatus("error");
    }
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2>Debug Arena State</h2>
        <span className="muted mono">/arenas/{arenaId}/state</span>
      </div>
      <div className="button-row" style={{ marginBottom: 16 }}>
        <Link to="/" className="button ghost">
          ← Lobby
        </Link>
        <button type="button" className="button" onClick={handleCopy} disabled={!json}>
          {copyStatus === "copied" ? "Copied" : "Copy JSON"}
        </button>
      </div>
      <div className="small-print">Document exists: {String(exists)}</div>
      {copyStatus === "error" ? <div className="error" style={{ marginTop: 12 }}>Clipboard unavailable.</div> : null}
      <pre>{prettyJson}</pre>
    </section>
  );
}
