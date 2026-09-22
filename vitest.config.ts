import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(__dirname, "./src")}/` },
      { find: /^open-sse\/(.*)$/, replacement: `${resolve(__dirname, "./open-sse")}/$1` },
      { find: /^open-sse$/, replacement: resolve(__dirname, "./open-sse") },
    ],
  },
  test: {
    include: ["tests/**/*.test.{js,mjs,ts}"],
    exclude: [...configDefaults.exclude, "tests/live/**"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
    silent: true,
    // Migration test mutates process.env.DATA_DIR and opens a real SQLite
    // file; isolate it from other tests by running suites sequentially.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      // Floors ratcheted from the 2026-09-22 baseline (global 12.4/8.9/9.4/11.8,
      // lib 28.9/26.9/23.7/27.9, api 15.7/18.4/10.8/14.8) — set at ~70% of
      // measured to allow variance while blocking coverage regressions.
      thresholds: {
        lines: 10,
        functions: 7,
        branches: 7,
        statements: 10,
        "src/lib/**": { lines: 20, functions: 18, branches: 16, statements: 20 },
        "src/app/api/**": { lines: 10, functions: 12, branches: 7, statements: 10 },
      },
    },
  },
});
