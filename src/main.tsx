import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import AdminPage from "./pages/AdminPage";
import ArenaPage from "./pages/ArenaPage";
import TrainingPage from "./pages/TrainingPage";
import DebugFirebaseExports from "./pages/DebugFirebaseExports";
import { AuthProvider } from "./context/AuthContext";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/arena/:arenaId" element={<ArenaPage />} />
          <Route path="/training" element={<TrainingPage />} />
          <Route path="/debug/firebase-exports" element={<DebugFirebaseExports />} />
          {/* legacy fallbacks */}
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="/admin.html" element={<Navigate to="/admin" replace />} />
          <Route path="/training.html" element={<Navigate to="/training" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
