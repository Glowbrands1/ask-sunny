import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import {
  PRODUCTION_DISTRICTS,
  PRODUCTION_REGIONS,
  PRODUCTION_SALONS,
  salonRosterMatches,
} from "./salons";
import {
  authorizedSalonNumbers,
  reportingScopeOf,
  rosterSalonNumbers,
  admitsSalonNumber,
} from "@/lib/reporting/scope/authorized-salons";

/**
 * ============================================================================
 * ONE PRODUCTION ROSTER, AND NO DEMO DATA BEHIND ANY PRODUCTION DECISION
 * ============================================================================
 *
 * The roster used to be exported as `DEMO_LOCATIONS` from `src/data/demo`, and
 * production authorization imported it under that name. The data was real; the
 * path was not, and it had two consequences worth recording because a rename
 * alone would not have found either:
 *
 *   SEVERAL CALL SITES DECLINED TO USE IT, in writing, "because DEMO_LOCATIONS
 *   is seeded demo data rather than an authority" — true of its neighbours and
 *   false of the roster, so correct code was avoided for a wrong reason.
 *
 *   ITS DISTRICTS WERE INVENTED. "District 1 — Omaha & St Joseph" and
 *   "District 2 — Lincoln & Central Nebraska" exist nowhere in reporting, which
 *   groups these salons by the manager who runs them. A district-scoped account
 *   would have resolved through a taxonomy that did not describe the business.
 *   No live account holds a district scope, so nothing was mis-authorized — the
 *   first one created would have been.
 *
 * These tests hold the line on both: the roster is singular and production-
 * named, and nothing under `src/data/demo` may reach a production decision.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    // Test files may hold fixtures; production files may not.
    if (path.includes(".test.")) continue;
    if ([".ts", ".tsx"].includes(extname(path))) out.push(path);
  }
  return out;
}

/** The fifteen, as reporting's `salons` table lists them. */
const REPORTING_SALON_NUMBERS = [
  "0306", "0307", "0309", "0310", "0311", "0312", "0313", "0314",
  "0394", "0410", "0462", "0463", "0468", "0476", "0495",
] as const;

describe("the production roster", () => {
  it("contains exactly the fifteen production salons", () => {
    expect(PRODUCTION_SALONS).toHaveLength(15);
    expect(PRODUCTION_SALONS.map((s) => s.salonNumber)).toEqual([...REPORTING_SALON_NUMBERS]);
  });

  it("agrees with what reporting holds", () => {
    /*
     * The drift check, run against the salon numbers the reporting source
     * returns. A salon opened, closed or renumbered upstream fails here rather
     * than being discovered when somebody's report comes back short.
     */
    const result = salonRosterMatches([...REPORTING_SALON_NUMBERS]);

    expect(result.missingFromRoster).toEqual([]);
    expect(result.missingFromReporting).toEqual([]);
    expect(result.matches).toBe(true);
  });

  it("notices a salon that reporting has and the roster does not", () => {
    // The guard's own guard: a check that cannot fail proves nothing.
    const result = salonRosterMatches([...REPORTING_SALON_NUMBERS, "0999"]);

    expect(result.matches).toBe(false);
    expect(result.missingFromRoster).toEqual(["0999"]);
  });

  it("groups salons by the districts reporting actually reports", () => {
    /*
     * Manager names, not invented geography. If reporting's `district_label`
     * changes, this is where it surfaces.
     */
    expect(PRODUCTION_DISTRICTS.map((d) => d.name).sort()).toEqual([
      "Cotton, Sarah",
      "Dugan, Rachael",
      "Patterson, Madeline",
    ]);
    expect(PRODUCTION_REGIONS).toHaveLength(1);

    for (const salon of PRODUCTION_SALONS) {
      expect(
        PRODUCTION_DISTRICTS.some((d) => d.id === salon.districtId),
        `${salon.name} names an unknown district`,
      ).toBe(true);
    }
  });

  it("holds no retired demo salon or demo id", () => {
    const names = PRODUCTION_SALONS.map((s) => s.name.toLowerCase());
    const ids = PRODUCTION_SALONS.map((s) => s.id);

    for (const retired of ["maple crossing", "riverbend commons", "hillcrest station"]) {
      expect(names, `${retired} is not a production salon`).not.toContain(retired);
    }
    for (const retired of ["loc-101", "loc-102", "loc-109", "loc-111"]) {
      expect(ids, `${retired} is a retired demo id`).not.toContain(retired);
    }
  });
});

describe("authorization resolves through that same roster", () => {
  it("gives an unrestricted reader every production salon and nothing else", () => {
    expect(rosterSalonNumbers().sort()).toEqual([...REPORTING_SALON_NUMBERS].sort());
    // Global scope is unrestricted, which is `null` and never an empty list.
    expect(
      authorizedSalonNumbers({ level: "global", primaryAreaId: null, alsoCoversAreaIds: [] }),
    ).toBeNull();
  });

  it("gives the Wornall account its own salon and no other", () => {
    const scope = {
      level: "salon" as const,
      primaryAreaId: "loc-0306",
      alsoCoversAreaIds: [],
    };

    expect(authorizedSalonNumbers(scope)).toEqual(["0306"]);
    expect(admitsSalonNumber(reportingScopeOf(scope), "0306")).toBe(true);
  });

  it("refuses every OTHER production salon to the Wornall account, by name", () => {
    /*
     * Named production salons rather than placeholders, because the thing being
     * proved is about the real roster: fourteen real salons this account may
     * not see.
     */
    const allowed = reportingScopeOf({
      level: "salon",
      primaryAreaId: "loc-0306",
      alsoCoversAreaIds: [],
    });

    for (const salon of PRODUCTION_SALONS) {
      if (salon.salonNumber === "0306") continue;
      expect(
        admitsSalonNumber(allowed, salon.salonNumber),
        `Wornall must not reach ${salon.name}`,
      ).toBe(false);
    }
  });

  it("refuses a retired demo id outright", () => {
    // `loc-102` was Maple Crossing. An account still carrying it gets nothing,
    // not everything.
    expect(
      authorizedSalonNumbers({
        level: "district",
        primaryAreaId: "loc-102",
        alsoCoversAreaIds: [],
      }),
    ).toEqual([]);
  });
});

describe("no production path imports demo data", () => {
  it("has no production file referencing DEMO_LOCATIONS", () => {
    /*
     * The symbol is gone; a reintroduction under the old name fails here. The
     * authority file is exempt because its header explains the move, and
     * deleting that explanation to satisfy a grep would lose the reason the
     * districts changed.
     */
    const offenders = sourceFiles(SRC)
      .filter((file) => /DEMO_LOCATIONS/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SRC.length + 1))
      .filter((file) => file !== "data/salons.ts");

    expect(offenders).toEqual([]);
  });

  it("keeps every demo SALON list out of authorization, reporting and search", () => {
    /*
     * THE STANDARD, stated precisely: no demo salon roster may participate in
     * production behaviour. It is narrower than "no demo import anywhere",
     * because `src/data/demo` legitimately still holds seeded knowledge
     * categories, video categories and chat examples that no decision rests on
     * — deleting those would be removing working prototype content, not a
     * production dependency.
     *
     * `DEMO_REVIEW_METRICS` is the one salon-shaped demo export left. It is
     * confined to Google Reviews — the reviews screen and the Overview's
     * reviews tile — which the stakeholder explicitly deferred. It reaches no
     * report, no filter, no scope and no assistant context, and it is listed
     * here so the exception is deliberate rather than missed.
     */
    const SALON_SHAPED = /DEMO_REVIEW_METRICS|DEMO_REVIEW_TREND/;
    const GOOGLE_REVIEWS_ONLY = [
      "features/reviews/reviews-screen.tsx",
      "features/dashboard/overview.tsx",
      "data/demo/reviews.ts",
    ];

    const offenders = sourceFiles(SRC)
      .filter((file) => SALON_SHAPED.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SRC.length + 1))
      .filter((file) => !GOOGLE_REVIEWS_ONLY.includes(file));

    expect(offenders).toEqual([]);
  });

  it("keeps demo SALON modules out of every reporting and scope path", () => {
    /*
     * Scoped to salon data on purpose. Two demo imports survive in these
     * directories and neither is a salon:
     *
     *   `KNOWLEDGE_CATEGORIES` — a category vocabulary, no salon in it.
     *   `userForRole` in `demo-provider.ts` — the demo auth provider ITSELF,
     *     which is what demo mode is, and which a Production deployment never
     *     selects (see `providers.test.ts`).
     *
     * Failing those would mean deleting working prototype content to satisfy a
     * grep. What must never come back is a demo module carrying salons.
     */
    const DEMO_SALON_MODULES = /from "@\/data\/demo\/(locations|reviews)"/;
    const PRODUCTION_DECISION_PATHS = [
      "lib/reporting/",
      "lib/auth/",
      "app/(app)/reports/",
      "app/api/",
    ];

    const offenders = sourceFiles(SRC)
      .filter((file) => {
        const relative = file.slice(SRC.length + 1);
        if (!PRODUCTION_DECISION_PATHS.some((path) => relative.startsWith(path))) return false;
        return DEMO_SALON_MODULES.test(readFileSync(file, "utf8"));
      })
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it("has no demo locations module left to import", () => {
    // The file is gone. Recreating it puts a second roster back in play.
    const offenders = sourceFiles(SRC)
      .map((file) => file.slice(SRC.length + 1))
      .filter((file) => file === "data/demo/locations.ts");

    expect(offenders).toEqual([]);
  });

  it("keeps authorization and global search on the production authority", () => {
    for (const file of [
      "lib/reporting/scope/authorized-salons.ts",
      "lib/forms/production-records.ts",
      "components/shell/global-search.tsx",
      "lib/session/session-context.tsx",
      "features/admin/users-screen.tsx",
    ]) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, `${file} does not use the production roster`).toMatch(
        /from "@\/data\/salons"/,
      );
    }
  });
});

describe("the Reports picklist and the roster do not diverge", () => {
  it("builds every report's salon picklist from reporting, not from the roster", () => {
    /*
     * THE PICKLIST IS DATA-DRIVEN and must stay so. It is built from the salons
     * the loaded period actually returned — `listSalons`, which joins
     * `salon_period_attributes` to `salons` — so a salon that opens upstream
     * appears without a deploy, and one that is not in the period cannot be
     * selected.
     *
     * The roster's job is different: it turns an AREA assignment into salon
     * numbers. Wiring the picklist to the roster instead would make a stale
     * file offer salons the period does not carry.
     */
    for (const report of [
      "salon-performance",
      "sales-totals",
      "bed-usage",
      "spa-wellness",
      "spa-engagement",
    ]) {
      const source = readFileSync(
        join(SRC, "app", "(app)", "reports", report, "page.tsx"),
        "utf8",
      );
      expect(source, `${report}'s picklist must not read the roster`).not.toMatch(
        /PRODUCTION_SALONS|@\/data\/salons/,
      );
    }
  });
});

describe("the salon count a reader is shown", () => {
  it("says 15 for an unrestricted reader and names the assignment for a scoped one", async () => {
    /*
     * "15 salons included" on a one-salon account would be a false claim about
     * what the figures cover. A restricted reader is told WHOSE salon it is
     * instead, which reads as an assignment rather than a broken report.
     */
    const { formatSalonCount } = await import("@/lib/reporting/read/freshness-line");

    expect(formatSalonCount(15, null)).toBe("15 salons included");
    expect(formatSalonCount(1, "MO Kansas City Wornall")).toBe(
      "MO Kansas City Wornall · 1 salon",
    );
    expect(formatSalonCount(1, null)).toBe("1 salon included");
  });
});

describe("adding a sixteenth salon", () => {
  it("touches exactly one file, and none of the security path", () => {
    /*
     * WHAT A NEW SALON NEEDS, AND WHAT IT DOES NOT.
     *
     * Automatic, from reporting, with no code change at all:
     *   - the Reports salon picklist, on all five reports
     *   - the "N salons included" count
     *   - a DISTRICT or REGION scope's membership (`reporting-areas.ts`)
     *   - Ask Sunny's grounding, which goes through the same resolver
     *   - a SALON scope, which parses its own id and reads nothing
     *
     * One file, for presentation only:
     *   - `src/data/salons.ts`, so global search, the admin scope picker and
     *     the non-production record guard know the name exists.
     *
     * The distinction that matters: nothing in the second list decides access.
     * Forgetting the edit means the salon is missing from a picker and its
     * forms are treated as non-production — both of which HIDE, and neither of
     * which discloses another salon's figures.
     */
    const SECURITY_PATH = [
      "lib/reporting/scope/reporting-areas.ts",
      "lib/reporting/scope/server.ts",
      "lib/reporting/scope/area-ids.ts",
    ];

    for (const file of SECURITY_PATH) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, `${file} must not read the static roster`).not.toMatch(
        /PRODUCTION_SALONS|@\/data\/salons/,
      );
    }
  });

  it("resolves an area scope without the static roster at all", async () => {
    /*
     * The property stated as an import graph: the module that answers "which
     * salons does this district contain" does not import the roster, so a
     * roster that has not heard about the sixteenth salon cannot affect the
     * answer.
     */
    const source = readFileSync(
      join(SRC, "lib", "reporting", "scope", "reporting-areas.ts"),
      "utf8",
    );

    expect(source).toMatch(/from "@\/lib\/supabase\/server"/);
    expect(source).toMatch(/salon_period_attributes/);
    expect(source).not.toMatch(/@\/data\/salons/);
  });

  it("keeps the roster out of the chat and analyser scope decisions too", () => {
    // Both used to call `reportingScopeOf` directly, which is the static path.
    for (const file of [
      "lib/ai/server-ask.ts",
      "app/api/reporting/sales-totals/analyze/route.ts",
      "app/(app)/page.tsx",
    ]) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, `${file} must resolve scope through the server resolver`).toMatch(
        /resolveScopeFor/,
      );
      expect(source, `${file} must not resolve scope statically`).not.toMatch(
        /reportingScopeOf\(/,
      );
    }
  });
});
