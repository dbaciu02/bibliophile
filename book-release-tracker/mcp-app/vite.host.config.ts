import { defineConfig } from "vite";

// Dev host only (never deployed). Proxies /mcp to the local API so the
// browser talks same-origin and the API needs no CORS for it.
export default defineConfig({
  root: "dev-host",
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/mcp": { target: process.env.API_URL ?? "http://localhost:3000", changeOrigin: true } },
  },
});
