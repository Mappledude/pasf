import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, strictPort: true },
  preview: { port: 4173 },
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        admin: resolve(__dirname, "public/admin.html"),
        trainingStandalone: resolve(__dirname, "public/training-standalone.html"),
        mpaVerify: resolve(__dirname, "public/mpa-verify.html"),
      },
    },
  },
});
