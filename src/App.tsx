cat > src/App.tsx <<'TS'
import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import AdminPage from "./pages/AdminPage";
import ArenaPage from "./pages/ArenaPage";
import TrainingPage from "./pages/TrainingPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* Old links to /index should still work */}
      <Route path="/index" element={<Navigate to="/" replace />} />
      {/* Admin SPA route (separate from legacy /admin.html) */}
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/arena/:arenaId" element={<ArenaPage />} />
      <Route path="/training" element={<TrainingPage />} />
      <Route path="*" element={<div style={{ padding: 24, color: "#e5e7eb" }}>
        Route not found. Try <a href="/">home</a>.
      </div>} />
    </Routes>
  );
}
TS
