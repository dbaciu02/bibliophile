import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The migration test drops and recreates the schema in the test database,
    // so test files must not run at the same time.
    fileParallelism: false,
    setupFiles: ["./test/setup.ts"],
  },
});
