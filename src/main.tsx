import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import "./styles/base.css";
import { ensureAuth } from "./firebaseAuth";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Missing #root element");
}
const root = createRoot(rootEl);

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
