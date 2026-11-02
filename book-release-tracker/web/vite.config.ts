import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the browser talks to Vite only; Vite forwards API calls,
    // so there is no cross-origin request (CORS is configured for staging/prod).
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
    },
  },
});
