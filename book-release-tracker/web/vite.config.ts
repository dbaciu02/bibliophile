import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/**
 * D8: tell the browser about the API origin in the HTML, so it opens that
 * connection (DNS + TCP + TLS) while the JavaScript is still downloading,
 * instead of only when the first API call starts. `crossorigin` because the
 * API calls are CORS requests, which use a separate connection pool.
 * Only for builds with an API origin (staging/production); dev uses the proxy.
 */
function preconnectToApi(apiOrigin: string): Plugin {
  return {
    name: "preconnect-to-api",
    transformIndexHtml: () =>
      apiOrigin ? [{ tag: "link", attrs: { rel: "preconnect", href: apiOrigin, crossorigin: "" }, injectTo: "head-prepend" }] : [],
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), preconnectToApi(loadEnv(mode, process.cwd(), "VITE_").VITE_API_BASE_URL?.trim() ?? "")],
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
}));
