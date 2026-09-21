import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { demoRuntime as demo } from "./runtime.demo";
/*
 * THE PRODUCTION IMPLEMENTATION BY ITS REAL PATH.
 *
 * `vitest.config.mts` aliases the bare `@/lib/demo/runtime` specifier to the
 * demo implementation, exactly as a demo build does — so this file reaches for
 * the file itself. It is the only place in the suite that needs to see both
 * sides at once, which is the point of it.
 */
import { demoRuntime as production } from "./runtime";

/**
 * ============================================================================
 * ONE INTERFACE, TWO IMPLEMENTATIONS, AND THEY MUST NOT DRIFT
 * ============================================================================
 *
 * `runtime.ts` is what production compiles; `runtime.demo.ts` is what a demo
 * build compiles in its place. TypeScript already forces both to satisfy
 * `DemoRuntime`, so a missing member is a compile error. What a type cannot
 * check is the thing that matters here:
 *
 *   the production side returns NOTHING, and imports nothing seeded;
 *   the demo side returns the seeded content, so the demo still works.
 *
 * Both halves are asserted, because either failing is a defect and they fail
 * in opposite directions: a production side that returned data would put
 * fabricated records back on a live deployment, and a demo side that returned
 * nothing would quietly empty the demo while every guard still passed.
 */

const SRC = join(process.cwd(), "src");
const productionSource = readFileSync(join(SRC, "lib/demo/runtime.ts"), "utf8");
const configSource = readFileSync(join(process.cwd(), "next.config.ts"), "utf8");

/* ==================================================== the production side == */

describe("the production implementation carries no seeded content", () => {
  it("imports nothing from data/demo", () => {
    const code = productionSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/from "@\/data\/demo/);
    expect(code).not.toMatch(/import\("@\/data\/demo/);
  });

  it("imports no demo-only screen", () => {
    const code = productionSource.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/-demo-screen"/);
    expect(code).not.toMatch(/-demo"/);
  });

  it("reports itself as the production implementation", () => {
    expect(production.kind).toBe("production");
  });

  it("returns empty collections for every seeded loader", async () => {
    const seeds = await production.loadSeeds();
    expect(seeds.documents).toEqual([]);
    expect(seeds.videos).toEqual([]);
    expect(seeds.templates).toEqual([]);
    expect(seeds.forms).toEqual([]);
    expect(seeds.conversations).toEqual([]);

    const bank = await production.loadAnswerBank();
    expect(bank.answers).toEqual([]);
    expect(bank.videos).toEqual([]);

    const knowledge = await production.loadKnowledge();
    expect(knowledge.documents).toEqual([]);
    expect(knowledge.chunks).toEqual([]);

    expect(await production.loadUsers()).toEqual([]);
    expect(await production.userForRole("salon_director")).toBeNull();
  });

  /**
   * THE FALLBACK TEXT IS EMPTY, NOT PLAUSIBLE. A sentence here would be a
   * fabricated assistant answer sitting in production waiting for a bug to
   * surface it.
   */
  it("has no fallback answer text to render", async () => {
    const { fallback } = await production.loadAnswerBank();
    expect(Object.values(fallback).every((text) => text === "")).toBe(true);
  });

  it("offers no demo screen and no unverified quick action", () => {
    expect(Object.values(production.screens).every((screen) => screen === null)).toBe(
      true,
    );
    expect(production.quickActions).toEqual([]);
  });
});

/* ========================================================== the demo side == */

describe("the demo implementation still works", () => {
  it("reports itself as the demo implementation", () => {
    expect(demo.kind).toBe("demo");
  });

  it("returns the seeded collections", async () => {
    const seeds = await demo.loadSeeds();
    expect(seeds.documents.length).toBeGreaterThan(0);
    expect(seeds.videos.length).toBeGreaterThan(0);
    expect(seeds.templates.length).toBeGreaterThan(0);
    expect(seeds.forms.length).toBeGreaterThan(0);
    expect(seeds.conversations.length).toBeGreaterThan(0);
  });

  it("returns an answer bank the mock provider can answer from", async () => {
    const bank = await demo.loadAnswerBank();
    expect(bank.answers.length).toBeGreaterThan(0);
    expect(bank.fallback.standard.length).toBeGreaterThan(0);
    expect(bank.videos.length).toBeGreaterThan(0);
  });

  it("returns a corpus the seeded retriever can search", async () => {
    const knowledge = await demo.loadKnowledge();
    expect(knowledge.documents.length).toBeGreaterThan(0);
    expect(knowledge.chunks.length).toBeGreaterThan(0);
  });

  it("resolves a seeded identity for a role", async () => {
    const user = await demo.userForRole("salon_director");
    expect(user).not.toBeNull();
    expect(user?.role).toBe("salon_director");
    expect((await demo.loadUsers()).length).toBeGreaterThan(0);
  });

  it("offers every demo screen", () => {
    expect(Object.values(demo.screens).every((screen) => screen !== null)).toBe(true);
  });

  it("offers the unverified quick action that production withholds", () => {
    expect(demo.quickActions.length).toBeGreaterThan(0);
    expect(demo.quickActions.some((action) => action.id === "qa-l10")).toBe(true);
  });
});

/* ====================================================== the build contract == */

describe("the build-time selection matches the runtime mode rule", () => {
  /**
   * TWO DECISIONS, ONE RULE. `isDemoMode()` decides what RENDERS and is read
   * in the browser; `next.config.ts` decides what EXISTS and is read once by
   * the compiler. If they disagreed the result would be a demo build whose
   * screens refuse to render, or a production build rendering screens it never
   * compiled. These assertions pin the config to the same four clauses
   * `lib/config/runtime.ts` implements.
   */
  it("treats a Vercel production deployment as never a demo build", () => {
    expect(configSource).toContain('NEXT_PUBLIC_VERCEL_ENV) === "production"');
    expect(configSource).toContain("NEXT_PUBLIC_ALLOW_DEMO_IN_PRODUCTION");
  });

  it("requires the literal word true, so absent and invalid are production", () => {
    expect(configSource).toContain('normalise(process.env.NEXT_PUBLIC_DEMO_MODE) === "true"');
  });

  it("aliases exactly one specifier, not a list of datasets", () => {
    const aliases = [...configSource.matchAll(/"@\/lib\/demo\/runtime":/g)];
    // One for Turbopack, one for the webpack fallback. No per-dataset stubs.
    expect(aliases).toHaveLength(2);
    expect(configSource).not.toMatch(/"@\/data\/demo[^"]*":/);
  });
});
