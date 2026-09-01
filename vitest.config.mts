import { defineConfig } from "vitest/config";

/**
 * Tests cover what can be verified without an external account: chunking, file
 * validation, path safety, text extraction, provider selection, citation
 * mapping and the live-mode failure contract.
 *
 * Nothing here reaches a network. The Voyage tests inject a fake `fetch`; the
 * Supabase and Anthropic paths are not exercised end to end, because doing so
 * honestly requires credentials this project does not yet have.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `import "server-only"` throws outside a React Server Component. In a
      // Node test it is a no-op: the guard's job is to fail the Next build if a
      // client component imports a module holding secrets, and that guard is
      // still in force where it matters.
      "server-only": new URL("./src/test/server-only-stub.ts", import.meta.url)
        .pathname,
    },
  },
  test: {
    environment: "node",
    // `.test.tsx` is included so component behaviour can be tested by rendering
    // and clicking. A source scan cannot see that a Radix `asChild` trigger has
    // stopped forwarding its props — the markup still looks correct and the
    // control is inert — and that shipped once. Files needing a DOM opt in with
    // `// @vitest-environment jsdom` rather than slowing the whole suite down.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    restoreMocks: true,
  },
});
