import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import AppShell from "./components/AppShell";
import CanaryBadge from "./components/CanaryBadge";
import HomePage from "./pages/HomePage";
import AdminPage from "./pages/AdminPage";
import ArenaPage from "./pages/ArenaPage";
import TrainingPage from "./pages/TrainingPage";
import DebugArenaStatePage from "./pages/DebugArenaStatePage";
import NotFoundPage from "./pages/NotFoundPage";

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          {/* legacy /index should work */}
          <Route path="/index" element={<Navigate to="/" replace />} />
          {/* alternative lobby entry point */}
          <Route path="/lobby" element={<HomePage />} />
          {/* SPA admin (separate from legacy /admin.html) */}
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/arena/:arenaId" element={<ArenaPage />} />
          <Route path="/debug/arena/:arenaId" element={<DebugArenaStatePage />} />
          {/* the one we need */}
          <Route path="/training" element={<TrainingPage />} />
          {/* catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <CanaryBadge />
    </>
  );
}
