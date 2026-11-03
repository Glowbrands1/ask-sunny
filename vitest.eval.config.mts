import { configDefaults, defineConfig } from "vitest/config";

/**
 * `npm run eval` only: the replay eval (`evals/*.eval.ts`), on its own so the
 * unit suite (`npm test`) is unchanged. Same resolution as `vitest.config.mts`;
 * one file at a time, because a replay file sends every case through the chat
 * route.
 *
 * `evals/live-regressions.eval.ts` calls the real model: it is left out unless
 * LIVE=1 (or its no-network LIVE_DRY=1) is set, so `npm run eval` (and CI)
 * never loads it.
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
    include: ["evals/**/*.eval.ts"],
    exclude: [...configDefaults.exclude, ...(process.env.LIVE === "1" || process.env.LIVE_DRY === "1" ? [] : ["evals/live-regressions.eval.ts"])],
    restoreMocks: true,
    fileParallelism: false,
  },
});
