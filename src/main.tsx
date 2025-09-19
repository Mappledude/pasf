import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import HomePage from "./pages/HomePage";
import TrainingPage from "./pages/TrainingPage";
import { AuthProvider } from "./context/AuthContext";
import "./styles/global.css";

const AdminPage = lazy(() => import("./pages/AdminPage"));
const ArenaPage = lazy(() => import("./pages/ArenaPage"));
const DebugFirebaseExports = lazy(() => import("./pages/DebugFirebaseExports"));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/arena" element={<ArenaPage />} />
            <Route path="/arena/:arenaId" element={<ArenaPage />} />
            <Route path="/training" element={<TrainingPage />} />
            <Route path="/debug/firebase-exports" element={<DebugFirebaseExports />} />
            <Route path="/index.html" element={<Navigate to="/" replace />} />
            <Route path="/admin.html" element={<Navigate to="/admin" replace />} />
            <Route path="/training.html" element={<Navigate to="/training" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
