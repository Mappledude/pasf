import { Navigate, Route, Routes } from "react-router-dom";
import AdminPage from "./pages/AdminPage";
import HomePage from "./pages/HomePage";
import ArenaPage from "./pages/ArenaPage";
import TrainingPage from "./pages/TrainingPage";
import DebugFirebaseExports from "./pages/DebugFirebaseExports";
import { AuthProvider } from "./context/AuthContext";

function App() {
  return (
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
  );
}

export default App;
