import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * ============================================================================
 * THE HEALTH ENDPOINT MAKES TWO ARCHITECTURAL CLAIMS. THESE KEEP THEM TRUE.
 * ============================================================================
 *
 * `/api/health` tells a reviewer opening a Preview deployment which half of the
 * product is safe to QA there:
 *
 *   "All five reports read the reporting tables in Supabase in either mode."
 *   "In demo mode the assistant answers through a mock provider."
 *
 * Both are claims about the CODE, not about configuration, and a note in a JSON
 * payload cannot enforce itself. If somebody later adds a demo branch to a
 * report page, the endpoint would keep saying report QA is valid on a demo
 * preview and it would no longer be — which is worse than never having said it,
 * because a reviewer would trust it.
 *
 * So the claims are asserted here against the source. If one stops being true,
 * this fails and the note has to change with the behaviour.
 */

const SRC = join(process.cwd(), "src");

function filesUnder(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...filesUnder(path));
      continue;
    }
    if (path.includes(".test.")) continue;
    if ([".ts", ".tsx"].includes(extname(path))) out.push(path);
  }
  return out;
}

/** Strips comments, so a comment ABOUT demo mode is not a demo branch. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("claim 1 — the reports do not depend on demo mode", () => {
  const REPORTS = [
    "salon-performance",
    "sales-totals",
    "bed-usage",
    "spa-wellness",
    "spa-engagement",
  ];

  it("no report page consults isDemoMode", () => {
    for (const report of REPORTS) {
      const page = code(
        readFileSync(join(SRC, "app", "(app)", "reports", report, "page.tsx"), "utf8"),
      );
      expect(page, `${report} branches on demo mode`).not.toMatch(/isDemoMode|demoMode/);
    }
  });

  it("the reporting read layer contains no demo branch at all", () => {
    /*
     * Checked over the whole tree rather than the pages alone: a demo branch in
     * a loader, an analytics module or the repository would have exactly the
     * same effect and would be harder to spot.
     */
    const offenders = filesUnder(join(SRC, "lib", "reporting"))
      .filter((file) => /isDemoMode|demoMode/.test(code(readFileSync(file, "utf8"))))
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });
});

describe("claim 2 — the assistant DOES depend on demo mode", () => {
  it("selects the mock provider in demo mode and Claude otherwise", () => {
    /*
     * The claim that makes assistant QA on a demo preview worthless. If this
     * ever stops being true the endpoint's warning becomes misleading in the
     * other direction — telling a reviewer to discard answers that were real.
     */
    const provider = code(readFileSync(join(SRC, "lib", "ai", "index.ts"), "utf8"));

    expect(provider).toMatch(/isDemoMode\(\)\s*\?\s*new MockAIProvider\(\)\s*:\s*new ClaudeProvider\(\)/);
  });
});

describe("the endpoint discloses no value of any environment variable", () => {
  it("reads only readiness flags, names and modes", () => {
    /*
     * The endpoint is deliberately UNAUTHENTICATED — it is what an
     * administrator opens when authentication itself is broken — so the one
     * rule it must never break is printing a secret. `process.env` may be read
     * for NODE_ENV and for nothing else.
     */
    const route = code(readFileSync(join(SRC, "app", "api", "health", "route.ts"), "utf8"));
    const envReads = [...route.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);

    expect(envReads).toEqual(["NODE_ENV"]);
  });

  it("adds no row, count or figure from the reporting tables", () => {
    // The QA block answers an architecture question, not a data question. A
    // salon count on an unauthenticated endpoint would be a disclosure.
    const route = readFileSync(join(SRC, "app", "api", "health", "route.ts"), "utf8");

    expect(route).not.toMatch(/getSupabaseAdmin|\.from\(|salonCount|loadReport/);
  });
});
