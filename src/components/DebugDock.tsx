import React, { useEffect, useMemo, useState } from "react";
import { debugSubscribe, debugGet, debugClear, debugExportText } from "../debug/DebugBus";

const boxCls =
  "fixed bottom-4 right-4 w-[360px] max-h-[50vh] bg-black/80 text-white border border-white/20 rounded-2xl shadow-xl backdrop-blur p-3 flex flex-col z-50";

export default function DebugDock() {
  const [open, setOpen] = useState(true);
  const [entries, setEntries] = useState(debugGet());

  useEffect(() => debugSubscribe(setEntries), []);

  const text = useMemo(() => {
    return entries
      .map((e) => {
        const t = new Date(e.ts).toLocaleTimeString();
        const payload = e.data !== undefined ? " " + JSON.stringify(e.data) : "";
        return `${t} ${e.tag} ${e.msg}${payload}`;
      })
      .join("\n");
  }, [entries]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(debugExportText());
    } catch (error) {
      console.warn("[DEBUG] copy failed", error);
    }
  };

  return (
    <div className={boxCls}>
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">Debug</div>
        <div className="flex gap-2">
          <button
            className="px-2 py-1 border border-white/30 rounded"
            onClick={() => setOpen((v) => !v)}
            title="Toggle"
          >
            {open ? "Hide" : "Show"}
          </button>
          <button className="px-2 py-1 border border-white/30 rounded" onClick={copy} title="Copy logs">
            Copy
          </button>
          <button className="px-2 py-1 border border-white/30 rounded" onClick={debugClear} title="Clear">
            Clear
          </button>
        </div>
      </div>
      {open && (
        <div className="text-xs font-mono whitespace-pre-wrap overflow-auto border border-white/10 rounded p-2">
          {text || "— No events yet —"}
        </div>
      )}
    </div>
  );
}
