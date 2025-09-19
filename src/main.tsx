cat > src/main.tsx <<'TS'
import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}
const root = createRoot(rootEl);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
TS
