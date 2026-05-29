import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["tests/**/*.test.{js,mjs}"],
    environment: "node",
    testTimeout: 20000,
    // Migration test mutates process.env.DATA_DIR and opens a real SQLite
    // file; isolate it from other tests by running suites sequentially.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{js,mjs}"],
      // Start with low floors — raise as coverage improves.
      thresholds: {
        lines: 1,
        functions: 1,
        branches: 1,
        statements: 1,
        "src/lib/**": { lines: 3, functions: 3, branches: 2, statements: 3 },
        "src/app/api/**": { lines: 0, functions: 0, branches: 0, statements: 0 },
      },
    },
  },
});
