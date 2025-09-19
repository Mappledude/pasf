import React from "react";

const DebugFirebaseExports: React.FC = () => {
  const [keys, setKeys] = React.useState<string[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        const mod = await import("../firebase");
        const exportKeys = Object.keys(mod).sort();
        setKeys(exportKeys);
        // eslint-disable-next-line no-console
        console.log("[debug/firebase-exports] keys:", exportKeys);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
  }, []);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui, Arial" }}>
      <h2>Debug: Firebase Exports</h2>
      {error && <pre style={{ color: "tomato" }}>{error}</pre>}
      {!keys && !error && <div>Loading…</div>}
      {keys && (
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(keys, null, 2)}</pre>
      )}
    </div>
  );
};

export default DebugFirebaseExports;
