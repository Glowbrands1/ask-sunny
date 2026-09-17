import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { PRODUCTION_SALONS } from "@/data/salons";

/**
 * ============================================================================
 * WHAT GLOBAL SEARCH SHOWS A RESTRICTED USER — RECORDED, NOT CHANGED
 * ============================================================================
 *
 * The authorization work narrowed every REPORTING surface to the caller's
 * salons. Global search was left alone, and this file records exactly what that
 * means so the decision is explicit rather than an oversight nobody revisited.
 *
 * THIS IS A CHARACTERIZATION TEST. It asserts the behaviour that exists today.
 * It is not a claim that the behaviour is right — whether a Salon Director
 * should be able to see that other salons exist is a product question about
 * what "scope" means outside reporting, and it is open with the stakeholder.
 * When that is answered, this test changes with the code and the change is
 * visible in a diff rather than silent.
 *
 * WHAT IT ESTABLISHES, so the stakeholder is deciding about the real thing:
 *
 *   SALON NAMES ARE VISIBLE to any signed-in user — all fifteen, with city,
 *   state and district, from the checked-in roster.
 *
 *   NO FIGURE IS ATTACHED. Not a metric, not a rank, not a count. The roster is
 *   the company's own list of its salons; the reporting figures are elsewhere
 *   and are narrowed.
 *
 *   NO OTHER USER'S EMPLOYEE DATA IS REACHABLE. The form hits look like the
 *   riskiest part — they render an employee name — but they come from the
 *   browser's OWN IndexedDB store, which holds seeded content plus whatever
 *   that browser created. `getStorageProvider` returns the local provider in
 *   both modes, so nothing here is a server read of `form_instances`.
 */

const SEARCH = readFileSync(
  join(process.cwd(), "src", "components", "shell", "global-search.tsx"),
  "utf8",
);

describe("salon names in global search", () => {
  it("are drawn from the full roster with no scope filter", () => {
    // The path a stakeholder needs named: the component imports the roster
    // directly, client-side, and maps every entry.
    expect(SEARCH).toMatch(/import \{ PRODUCTION_SALONS \} from "@\/data\/salons"/);
    expect(SEARCH).toMatch(/PRODUCTION_SALONS\.map\(/);

    // No narrowing of any kind is applied to them today.
    expect(SEARCH).not.toMatch(/authorizedSalonNumbers|admitsSalonNumber|useSession\(\)/);
  });

  it("exposes only fields reporting actually holds, for all fifteen salons", () => {
    /*
     * IT USED TO PRINT A CITY. The retired roster carried one and the
     * reporting source does not, so a real salon was described to a searcher
     * with an invented location. The detail line is now the salon number and
     * the district manager — both from reporting's own columns.
     */
    expect(SEARCH).toMatch(/label: location\.name/);
    expect(SEARCH).toMatch(/\$\{location\.salonNumber\} · \$\{location\.districtName\}/);
    expect(SEARCH).not.toMatch(/location\.city/);
    expect(PRODUCTION_SALONS).toHaveLength(15);
  });

  it("attaches no reporting figure to a salon hit", () => {
    /*
     * The line between a roster disclosure and a figures disclosure. A salon
     * hit links to Google Reviews and carries no metric, rank or count.
     */
    const salonBlock = SEARCH.slice(
      SEARCH.indexOf("const salonHits"),
      SEARCH.indexOf("return [...screens"),
    );

    expect(salonBlock).toMatch(/href: `\/reviews\?location=/);
    for (const figure of ["ppta", "tans", "revenue", "sessions", "rank", "conversion"]) {
      expect(salonBlock.toLowerCase(), `salon hits leak ${figure}`).not.toContain(figure);
    }
  });
});

describe("form hits are this browser's own records, not the estate's", () => {
  it("come from the client store rather than a server read", () => {
    expect(SEARCH).toMatch(/useAppStore\(\)/);
    // No server read, no fetch, no Supabase client anywhere in the component.
    expect(SEARCH).not.toMatch(/getSupabaseAdmin|listInstances|fetch\(|\/api\//);
  });

  it("is backed by local storage in BOTH modes, so nothing syncs across users", () => {
    /*
     * The claim that makes the employee names in a form hit safe. If
     * `getStorageProvider` ever returns a shared backend, every form in the
     * business becomes searchable by every user and this test fails.
     */
    const storage = readFileSync(
      join(process.cwd(), "src", "lib", "storage", "index.ts"),
      "utf8",
    );

    expect(storage).toMatch(/cached \?\?= new LocalPrototypeStorageProvider\(\)/);
    expect(storage).not.toMatch(/isDemoMode\(\)\s*\?[\s\S]{0,80}StorageProvider\(\)\s*:/);
  });
});
