import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// MCP hosts load the app from a ui:// resource as one HTML string, so the
// build inlines all JS and CSS into dist/release-calendar.html. The API reads
// that file (MCP_APP_HTML) and serves it from resources/read.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: "release-calendar.html" },
  },
});
