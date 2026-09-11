import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_FEATURES,
  CATEGORY_FEATURE,
  CATEGORY_LABEL,
  FEATURE_LABEL,
  categoryLabel,
  classifyChatTurn,
} from "./taxonomy";
import {
  DEFAULT_RANGE,
  EMPTY_FILTERS,
  bucketFor,
  hasActiveFilters,
  parseFilters,
  resolveWindow,
  serializeFilters,
} from "./filters";
import { changeAgainst } from "./queries";
import { ROLES } from "@/lib/permissions";

/* ------------------------------------------------------------ taxonomy --- */

describe("the taxonomy matches the database", () => {
  /*
   * THE ENUMS ARE DECLARED TWICE — once in the migration, once in TypeScript —
   * and a category added to one and not the other is silent: the database
   * returns a key, the label lookup misses, and a whole class of usage reads as
   * a raw identifier or vanishes from a chart. These read the migration as text
   * rather than trusting the two to be kept in step by hand.
   */
  const migration = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260911001000_activity_events.sql",
    ),
    "utf8",
  );

  function enumValues(typeName: string): string[] {
    const declaration = migration.split(`create type public.${typeName} as enum`)[1];
    const body = declaration?.split(");")[0] ?? "";
    return [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  }

  it("declares exactly the categories the migration does", () => {
    expect([...ACTIVITY_CATEGORIES].sort()).toEqual(
      enumValues("activity_category").sort(),
    );
  });

  it("declares exactly the features the migration does", () => {
    expect([...ACTIVITY_FEATURES].sort()).toEqual(
      enumValues("activity_feature").sort(),
    );
  });

  it("gives every category a label and an owning feature", () => {
    for (const category of ACTIVITY_CATEGORIES) {
      expect(CATEGORY_LABEL[category], category).toBeTruthy();
      expect(ACTIVITY_FEATURES).toContain(CATEGORY_FEATURE[category]);
    }
    for (const feature of ACTIVITY_FEATURES) {
      expect(FEATURE_LABEL[feature], feature).toBeTruthy();
    }
  });

  it("uses role names Postgres will accept as app_user_role", () => {
    /*
     * `filters.role` is passed straight into `analytics_*` as a typed
     * `app_user_role` argument. A role this app knows and the enum does not is
     * not a mislabel — it is a 22P02 from Postgres and an error page, and it
     * would only appear when somebody actually picked that role in the filter.
     * The enum is declared in the app_users migration; this reads it there.
     */
    const appUsers = readFileSync(
      join(process.cwd(), "supabase/migrations/20260904006000_app_users.sql"),
      "utf8",
    );
    const body =
      appUsers.split("create type public.app_user_role as enum")[1]?.split(");")[0] ?? "";
    const dbRoles = [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

    expect(dbRoles.length).toBeGreaterThan(0);
    expect([...ROLES].sort()).toEqual(dbRoles.sort());
  });

  it("shows an unknown key as itself rather than folding it into Other", () => {
    /*
     * A category a later migration adds must read as the thing it is, so the
     * gap is visible. "Other" would hide a whole kind of usage behind a word
     * that looks deliberate.
     */
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("a chat turn is classified from what the server did", () => {
  it("calls a turn that produced a form proposal a form request", () => {
    expect(
      classifyChatTurn({
        proposedForm: true,
        hadReportContext: true,
        citedDocuments: true,
      }),
    ).toBe("form_request");
  });

  it("calls a turn carrying an attached report Daily Stats", () => {
    expect(
      classifyChatTurn({
        proposedForm: false,
        hadReportContext: true,
        citedDocuments: true,
      }),
    ).toBe("daily_stats");
  });

  it("calls a cited turn a policy question", () => {
    expect(
      classifyChatTurn({
        proposedForm: false,
        hadReportContext: false,
        citedDocuments: true,
      }),
    ).toBe("policy_question");
  });

  it("falls back to general guidance when nothing else explains the turn", () => {
    expect(
      classifyChatTurn({
        proposedForm: false,
        hadReportContext: false,
        citedDocuments: false,
      }),
    ).toBe("general_guidance");
  });
});

/* ------------------------------------------------------------- filters --- */

describe("filters survive the round trip through a URL", () => {
  it("restores everything that was set", () => {
    const filters = {
      range: "90d" as const,
      from: null,
      to: null,
      district: "Patterson, Madeline",
      salonId: "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      role: "salon_director" as const,
      actorId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    };
    expect(
      parseFilters(Object.fromEntries(new URLSearchParams(serializeFilters(filters)))),
    ).toEqual(filters);
  });

  it("omits an unset filter from the query string entirely", () => {
    expect(serializeFilters(EMPTY_FILTERS)).toBe("");
  });

  it("drops a salon or leader id that is not a uuid", () => {
    /*
     * Both are passed to a Postgres function as typed arguments. A junk value
     * must come back as "no filter" rather than as an error page from the
     * database, which is what a hand-edited URL would otherwise produce.
     */
    const parsed = parseFilters({ salon: "'; drop table", leader: "42" });
    expect(parsed.salonId).toBeNull();
    expect(parsed.actorId).toBeNull();
  });

  it("drops a role this build does not know", () => {
    expect(parseFilters({ role: "supreme_leader" }).role).toBeNull();
  });

  it("falls back to the default range rather than trusting a junk one", () => {
    expect(parseFilters({ range: "since_forever" }).range).toBe(DEFAULT_RANGE);
  });

  it("ignores half a custom window", () => {
    /*
     * One end of a range is not a range. Honouring it would pair a typed date
     * with a default boundary the reader never chose and never sees.
     */
    const parsed = parseFilters({ from: "2026-01-01" });
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
  });

  it("knows when something is actually narrowing the view", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, district: "West" })).toBe(true);
  });
});

describe("the window and the one before it", () => {
  it("covers the anchor day and ends exclusively after it", () => {
    const window = resolveWindow({ ...EMPTY_FILTERS, range: "7d" }, "2026-09-11");
    expect(window.days).toBe(7);
    expect(window.from).toBe("2026-09-05T00:00:00.000Z");
    /* Exclusive: the 12th is the boundary, so the 11th is fully included. */
    expect(window.to).toBe("2026-09-12T00:00:00.000Z");
  });

  it("compares against an equally long window immediately before", () => {
    const window = resolveWindow({ ...EMPTY_FILTERS, range: "30d" }, "2026-09-11");
    expect(window.previousTo).toBe(window.from);
    const length =
      Date.parse(window.previousTo) - Date.parse(window.previousFrom);
    expect(length).toBe(Date.parse(window.to) - Date.parse(window.from));
  });

  it("treats a custom end date as the last day the reader wants included", () => {
    const window = resolveWindow(
      { ...EMPTY_FILTERS, from: "2026-09-01", to: "2026-09-07" },
      "2026-09-11",
    );
    expect(window.days).toBe(7);
    expect(window.to).toBe("2026-09-08T00:00:00.000Z");
  });

  it("starts this month and this year on their first day", () => {
    expect(
      resolveWindow({ ...EMPTY_FILTERS, range: "mtd" }, "2026-09-11").from,
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(
      resolveWindow({ ...EMPTY_FILTERS, range: "ytd" }, "2026-09-11").from,
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("coarsens the bucket as the window grows", () => {
    expect(bucketFor(30)).toBe("day");
    expect(bucketFor(365)).toBe("week");
    expect(bucketFor(900)).toBe("month");
  });
});

/* -------------------------------------------------------- the comparison -- */

describe("change against the prior period", () => {
  it("refuses to divide by an empty baseline", () => {
    /*
     * THE RULE THE BRIEF ASKED FOR IN AS MANY WORDS: no misleading percentage
     * when the comparison period has insufficient data. 0 to 7 is a first week
     * of use, not "+700%", and every four-figure percentage on a dashboard of
     * this kind is a small number divided by a smaller one.
     */
    expect(changeAgainst(7, 0)).toBeNull();
    expect(changeAgainst(0, 0)).toBeNull();
  });

  it("reports a real change as a percentage", () => {
    expect(changeAgainst(150, 100)).toBe(50);
    expect(changeAgainst(50, 100)).toBe(-50);
  });
});
