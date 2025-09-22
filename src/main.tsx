import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import "./styles/base.css";
import { ensureAuth } from "./firebaseAuth";
import { setupGlobalDebug, dbg, enableDebug } from "./lib/debug";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}
const root = createRoot(rootEl);

// Initialize debug traps early
setupGlobalDebug();

// Optional: force-on in prod while investigating (remove later)
// enableDebug(true);

// First breadcrumb
dbg("boot:start", { href: typeof window !== "undefined" ? window.location.href : "" });

ensureAuth();

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
