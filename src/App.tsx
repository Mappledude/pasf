import { Route, Routes } from "react-router-dom";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";
import { ArenaPage } from "./pages/ArenaPage";
import TrainingPage from "./pages/TrainingPage";
import { AuthProvider } from "./context/AuthContext";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/arena/:arenaId" element={<ArenaPage />} />
        <Route path="/training" element={<TrainingPage />} />
      </Routes>
    </AuthProvider>
  );
}

export default App;
