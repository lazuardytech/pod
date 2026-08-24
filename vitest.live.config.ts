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
    include: ["tests/live/**/*.test.{js,mjs,ts}"],
    exclude: [...configDefaults.exclude],
    environment: "node",
    testTimeout: 180000,
    hookTimeout: 30000,
    silent: true,
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
