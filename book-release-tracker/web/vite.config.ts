import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // In development the browser talks to Vite only; Vite forwards API calls,
    // so there is no cross-origin request (CORS is configured for staging/prod).
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        // If the API dies mid-stream, end the browser's side too, so an open
        // live-update stream (/api/events) notices and reconnects. Without
        // this the dev proxy keeps the browser's connection open forever.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            proxyRes.on("close", () => {
              if (!res.writableEnded) res.destroy();
            });
          });
        },
      },
      "/healthz": "http://localhost:3000",
    },
  },
});
