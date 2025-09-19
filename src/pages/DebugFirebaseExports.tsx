import React, { useEffect, useState } from "react";

const DebugFirebaseExports: React.FC = () => {
  const [keys, setKeys] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    import("/src/firebase.ts")
      .then((m) => setKeys(Object.keys(m)))
      .catch((e) => setErr(String(e)));
  }, []);

  return (
    <div style={{ padding: 16, color: "#e6e6e6", background: "#0f1115", minHeight: "100vh" }}>
      <h2>Firebase exports</h2>
      {err && <pre style={{color:"#fca5a5"}}>{err}</pre>}
      {keys && <pre>{JSON.stringify(keys, null, 2)}</pre>}
    </div>
  );
};

export default DebugFirebaseExports;
