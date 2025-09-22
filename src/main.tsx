import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import "./styles/base.css";
import { setupGlobalDebug, dbg, enableDebug } from "./lib/debug";
import { installConsoleMirror } from "./debug/DebugBus";
import { ensureAnonAuth } from "./auth/ensureAnonAuth";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}
const root = createRoot(rootEl);

// Initialize debug traps early
setupGlobalDebug();
installConsoleMirror();

const boot = async () => {
  await ensureAnonAuth();

  // Optional: force-on in prod while investigating (remove later)
  // enableDebug(true);

  // First breadcrumb
  dbg("boot:start", { href: typeof window !== "undefined" ? window.location.href : "" });

  root.render(
    <React.StrictMode>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
};

boot().catch((error) => {
  console.error("[BOOT] failed", error);
});
