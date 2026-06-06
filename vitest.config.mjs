import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
    include: ["tests/**/*.test.{js,mjs}"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
    // Migration test mutates process.env.DATA_DIR and opens a real SQLite
    // file; isolate it from other tests by running suites sequentially.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
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
