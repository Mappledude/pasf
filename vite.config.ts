import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { port: 4173 },
  appType: "mpa"   // ← IMPORTANT: serve .html files as-is; disable SPA fallback
});
