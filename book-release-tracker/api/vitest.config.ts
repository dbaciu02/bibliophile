import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The migration test drops and recreates the schema in the test database,
    // so test files must not run at the same time.
    fileParallelism: false,
    // These tests use a real Postgres; give slower machines room (default 5 s).
    testTimeout: 20_000,
    hookTimeout: 30_000,
    setupFiles: ["./test/setup.ts"],
  },
});
