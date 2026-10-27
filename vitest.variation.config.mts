import { configDefaults, defineConfig } from "vitest/config";

/**
 * `npm run variation-report` only: the variation report (support/variation-report),
 * which prints pass rates and asserts nothing. Not part of `npm test`, so it
 * never runs in CI. Same resolution as `vitest.config.mts`.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url).pathname,
      "@/lib/demo/runtime": new URL("./src/lib/demo/runtime.demo.ts", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test/restore-env.ts"],
    include: ["support/variation-report/*.report.ts"],
    exclude: [...configDefaults.exclude],
    pool: "forks",
    fileParallelism: false,
  },
});
