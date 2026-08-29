/**
 * Test stub for the `server-only` package.
 *
 * The real module throws when imported outside a React Server Component, which
 * is exactly the protection we want in the Next build — a client component that
 * imports a secret-holding module fails to compile. Under Vitest there is no
 * React server graph, so importing it would fail every server-side module's
 * tests for the wrong reason. Aliased to this no-op in vitest.config.mts.
 */
export {};
