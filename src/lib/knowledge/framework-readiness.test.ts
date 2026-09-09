import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * THE LIVE-CORPUS READINESS CHECK, ENVIRONMENT-GATED
 * ============================================================================
 *
 * This is the only test in the suite that talks to a real Supabase project, and
 * it is OFF unless explicitly switched on:
 *
 *   RUN_CORPUS_READINESS=1 npx vitest run src/lib/knowledge/framework-readiness.test.ts
 *
 * Two reasons for the gate, and both matter:
 *
 *   ORDINARY UNIT TESTS MUST NOT NEED CREDENTIALS. `npm test` runs in CI, on a
 *   laptop with no `.env`, and in a sandbox with no route to Supabase. A test
 *   that needs a service key to pass is a test that gets skipped, then deleted.
 *
 *   IT ASKS A QUESTION ABOUT AN ENVIRONMENT, not about the code. Whether the
 *   framework is present, unique, current and complete is a property of the
 *   corpus a deployment points at — it changes when somebody uploads a file,
 *   not when somebody edits a function.
 *
 * WHAT IT PROVES, against the configured corpus:
 *   - exactly one Employee Performance Framework document resolves
 *   - how it resolved: `tag` (durable) or `fallback` (temporary)
 *   - the document's CURRENT version was used
 *   - the mandatory chunk count is above zero
 *   - every required rule group is represented
 *   - every pinned chunk's provenance points at that document
 *   - no superseded chunk version was selected
 *
 * READ-ONLY. Two selects per call and no writes, so it is safe to point at any
 * environment including Production.
 */

const ENABLED =
  process.env.RUN_CORPUS_READINESS === "1" &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);

const forEnvironment = ENABLED ? describe : describe.skip;

forEnvironment("the configured corpus is ready for employee-performance analysis", () => {
  it("resolves exactly one healthy, complete, current framework", async () => {
    const { checkFrameworkReadiness } = await import("./framework-readiness");
    const { EMPLOYEE_PERFORMANCE_FRAMEWORK } = await import("./document-roles");

    const report = await checkFrameworkReadiness();

    // Printed unconditionally: when this fails, the report is the diagnosis.
    console.log(JSON.stringify(report, null, 2));

    expect(report.problems).toEqual([]);
    expect(report.ready).toBe(true);

    // Identity: exactly one, and we know how it was found.
    expect(report.claimingDocuments).toBe(1);
    expect(report.matchedBy === "tag" || report.matchedBy === "fallback").toBe(true);
    expect(report.documentId).toBeTruthy();
    expect(report.documentTitle).toBeTruthy();

    // Currency: read at the document's own version, nothing superseded chosen.
    expect(report.documentVersion).toBeGreaterThan(0);
    expect(report.staleSelected).toBe(false);

    // Content: something was pinned, and every required rule is represented.
    expect(report.mandatoryChunkCount).toBeGreaterThan(0);
    expect(report.missingGroups).toEqual([]);
    expect(report.presentGroups).toHaveLength(
      EMPLOYEE_PERFORMANCE_FRAMEWORK.ruleGroups.length,
    );
  });

  it("reports the durable-tag advisory while identity rests on the filename", async () => {
    const { checkFrameworkReadiness } = await import("./framework-readiness");
    const report = await checkFrameworkReadiness();

    if (report.matchedBy === "fallback") {
      expect(report.advisories.join(" ")).toContain("employee-performance-framework");
    } else {
      expect(report.advisories).toEqual([]);
    }
  });
});

/**
 * Runs everywhere, including with no credentials: the readiness check has to be
 * importable and shaped correctly even where it cannot execute, or the gate
 * above would hide a broken module rather than an unconfigured environment.
 */
describe("the readiness check is wired up regardless of environment", () => {
  it("exports a callable check", async () => {
    const readiness = await import("./framework-readiness");
    expect(typeof readiness.checkFrameworkReadiness).toBe("function");
  });

  it("declares the rule groups the report is judged against", async () => {
    const { EMPLOYEE_PERFORMANCE_FRAMEWORK } = await import("./document-roles");

    expect(EMPLOYEE_PERFORMANCE_FRAMEWORK.ruleGroups.length).toBeGreaterThan(0);
    for (const group of EMPLOYEE_PERFORMANCE_FRAMEWORK.ruleGroups) {
      expect(group.id).toMatch(/^[a-z_]+$/);
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.headings.length).toBeGreaterThan(0);
    }
  });

  it("says in one place how to run it against a real corpus", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/knowledge/framework-readiness.test.ts", "utf8");

    expect(source).toContain("RUN_CORPUS_READINESS=1");
  });
});
