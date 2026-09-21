import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACTIVE_BRAND } from "@/lib/brand";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import { routeReportFamilies } from "@/lib/reporting/read/family-routing";
import type { AccessScope, Permission, Role } from "@/types";

import { QUICK_QUESTIONS, quickQuestionsFor } from "./quick-questions";

/**
 * ============================================================================
 * WHAT THE PRODUCT OFFERS, AND TO WHOM
 * ============================================================================
 *
 * Three claims, and they are separate describes because they fail for separate
 * reasons:
 *
 *   1. THE QUESTIONS THEMSELVES are answerable. Every report question routes
 *      to the families that answer it, and none of them asks for a window the
 *      reports do not deliver. This is the claim the old list broke.
 *   2. WHO SEES WHAT follows from scope and permission, never from a role name.
 *   3. AN EMPLOYEE IS NOT OFFERED A REPORT QUESTION, because the only honest
 *      answer to one would be that they have no salons.
 */

/** A scope at one salon and nothing else. */
function salonScope(overrides: Partial<AccessScope> = {}): AccessScope {
  return {
    level: "salon",
    primaryAreaId: "loc-0306",
    alsoCoversAreaIds: [],
    ...overrides,
  };
}

/** The permission check the session performs, for a given role. */
function canFor(role: Role): (permission: Permission) => boolean {
  return (permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission);
}

const DAILY_REPORT = ACTIVE_BRAND.vocabulary.dailyReportName;

const DISTRICT_QUESTIONS = [
  "Where is my district losing revenue based on the latest data?",
  "Which salons need my attention today?",
];
const REGION_QUESTIONS = [
  "Where is my region losing revenue based on the latest data?",
  "Which salons need my attention today?",
];
const GLOBAL_QUESTIONS = [
  "Where are we losing revenue based on the latest data?",
  "Which salons need attention today?",
];
const SALON_QUESTION = `Show me the most recent ${DAILY_REPORT} and what I need to focus on today.`;

/** Every report question, across every level. */
const ALL_REPORT_QUESTIONS = [
  ...DISTRICT_QUESTIONS,
  ...REGION_QUESTIONS,
  ...GLOBAL_QUESTIONS,
  SALON_QUESTION,
];

/* ================================================= the questions themselves = */

describe("every report question reaches the reports that answer it", () => {
  /**
   * THE DAILY SIGNAL AND THE TREND, TOGETHER, FOR ALL THREE.
   *
   * This is the requirement in one assertion. A manager triaging salons needs
   * the day (what happened) and the month to date (whether it is a bad day or
   * a bad month); a manager asking where revenue is going needs both plus the
   * traffic. "Which salons need my attention today?" reached Sales Totals
   * ALONE before `salons_needing_attention` was added, which is exactly the
   * shape of failure this pins.
   */
  it.each([
    [DISTRICT_QUESTIONS[0], ["sales-totals", "salon-performance", "bed-usage"]],
    [REGION_QUESTIONS[0], ["sales-totals", "salon-performance", "bed-usage"]],
    [GLOBAL_QUESTIONS[0], ["sales-totals", "salon-performance", "bed-usage"]],
    [DISTRICT_QUESTIONS[1], ["sales-totals", "salon-performance"]],
    [GLOBAL_QUESTIONS[1], ["sales-totals", "salon-performance"]],
    [SALON_QUESTION, ["sales-totals", "salon-performance"]],
  ])("%s", (question, expected) => {
    expect(routeReportFamilies(question).sort()).toEqual([...expected].sort());
  });

  /**
   * THE WORDING CHANGES PER LEVEL AND THE ROUTING DOES NOT. "my district", "my
   * region" and "we" are the same query with the reader's own noun in front of
   * it, and a level whose phrasing quietly lost a report family would be the
   * hardest kind of bug to see.
   */
  it("always carries the month-to-date Comp Report beside the daily report", () => {
    for (const question of ALL_REPORT_QUESTIONS) {
      const families = routeReportFamilies(question);
      expect(families).toContain("sales-totals");
      expect(families).toContain("salon-performance");
    }
  });

  /**
   * NO QUESTION ASKS FOR A WINDOW THE REPORTS DO NOT DELIVER.
   *
   * The retired chip asked for "today's Daily Stats" and no delivery is ever
   * dated today. A draft of the District Manager question asked for "this
   * week" and no source delivers a week. Both are the same defect — the
   * product promising a window it cannot produce — so both spellings are
   * barred here rather than only the one that shipped.
   *
   * "today" ON ITS OWN IS ALLOWED, and the distinction is the point: "which
   * salons need my attention today" says when to ACT. What is barred is a
   * phrase that makes the DATA same-day or weekly.
   */
  it.each([
    /today'?s\s+(daily|sales|comp)/i,
    /\bthis week\b/i,
    /\blast week\b/i,
    /\bweekly\b/i,
    /\bweek to date\b/i,
    /\bright now\b/i,
  ])("no question promises the window %s", (banned) => {
    for (const question of QUICK_QUESTIONS) {
      expect(question.text).not.toMatch(banned);
    }
  });
});

/* ============================================================== who sees what = */

describe("the level comes from scope_level and from nothing else", () => {
  /**
   * ==========================================================================
   * THE REGRESSION THIS FILE EXISTS FOR
   * ==========================================================================
   *
   * A first version derived a two-value "breadth" and widened anybody whose
   * `alsoCoversAreaIds` was non-empty. A Salon Director covering two salons
   * during a vacancy was therefore handed the District Manager's questions and
   * asked about "my district". They are still a Salon Director.
   *
   * Extra salon access is a DATA boundary — `reportingScopeOf` reads
   * `alsoCoversAreaIds` when it decides which rows may be read, and that is
   * unchanged — not a change of persona. So the assertion is exact: the same
   * questions, in the same order, however many extra salons are attached.
   */
  it("keeps a salon-level reader on the salon question however many salons they can see", () => {
    const one = quickQuestionsFor({
      scope: salonScope(),
      can: canFor("salon_director"),
    });
    const several = quickQuestionsFor({
      scope: salonScope({
        alsoCoversAreaIds: ["loc-0310", "loc-0314", "loc-0463"],
      }),
      can: canFor("salon_director"),
    });

    expect(several).toEqual(one);
    expect(several[0]).toBe(SALON_QUESTION);
    expect(several).not.toContain(DISTRICT_QUESTIONS[0]);
    expect(several).not.toContain(DISTRICT_QUESTIONS[1]);
    expect(several.join(" ")).not.toMatch(/my district|my region/i);
  });

  it("does the same for an assistant salon director covering extra salons", () => {
    const questions = quickQuestionsFor({
      scope: salonScope({ alsoCoversAreaIds: ["loc-0310"] }),
      can: canFor("assistant_salon_director"),
    });

    expect(questions[0]).toBe(SALON_QUESTION);
    expect(questions.join(" ")).not.toMatch(/my district|my region/i);
  });

  /**
   * ONE REPORT QUESTION PER LEVEL, AND EXACTLY ONE.
   *
   * Two would put two openings on a band with room for four chips; none would
   * leave a level with no reporting entry point at all.
   */
  it.each(["salon", "district", "region", "global"] as const)(
    "%s has exactly one revenue-or-focus opening",
    (level) => {
      const forLevel = QUICK_QUESTIONS.filter(
        (question) =>
          question.needs === "view_daily_stats" &&
          (question.levels === null || question.levels.includes(level)),
      );
      expect(forLevel).toHaveLength(level === "salon" ? 1 : 2);
    },
  );

  /**
   * EACH LEVEL IS ADDRESSED IN ITS OWN VOCABULARY. A District Manager owns a
   * district, not a region; an administrator owns neither and is not given a
   * field title to borrow.
   */
  it.each([
    ["district", /my district/, /my region|^Where are we/],
    ["region", /my region/, /my district|^Where are we/],
    ["global", /^Where are we/, /my district|my region/],
  ] as const)("%s is addressed as itself", (level, expected, forbidden) => {
    const revenue = QUICK_QUESTIONS.filter(
      (question) =>
        question.levels?.includes(level) && question.text.includes("losing revenue"),
    );
    expect(revenue).toHaveLength(1);
    expect(revenue[0].text).toMatch(expected);
    expect(revenue[0].text).not.toMatch(forbidden);
  });

  /**
   * THE STRUCTURAL CLAIM, ASSERTED AGAINST THE SOURCE.
   *
   * The obvious implementation of this module is `Record<Role, string[]>`, and
   * it is the one that would quietly relabel an administrator as a District
   * Manager. Nothing in the module may name a role, so nothing in it can drift
   * back into that shape without this failing.
   */
  it("names no role anywhere", () => {
    const source = readFileSync(
      new URL("./quick-questions.ts", import.meta.url),
      "utf8",
    );
    // The comments discuss roles by name; the CODE must not branch on one.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const role of [
      "district_manager",
      "regional_manager",
      "salon_director",
      "assistant_salon_director",
      "employee",
      "admin",
      "owner",
      "developer",
    ]) {
      expect(code).not.toContain(role);
    }
  });

  /**
   * AND IT NEVER READS THE ACCESSIBLE-SALON COUNT. The field belongs to the
   * read layer; this module reading it is how the last version went wrong.
   */
  it("does not read alsoCoversAreaIds", () => {
    const source = readFileSync(
      new URL("./quick-questions.ts", import.meta.url),
      "utf8",
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toContain("alsoCoversAreaIds");
  });
});

describe("the questions a reader is offered", () => {
  it("offers a district-level reader the district wording", () => {
    const questions = quickQuestionsFor({
      scope: salonScope({ level: "district", primaryAreaId: "dist-1" }),
      can: canFor("district_manager"),
    });

    expect(questions.slice(0, 2)).toEqual(DISTRICT_QUESTIONS);
    expect(questions).not.toContain(SALON_QUESTION);
    expect(questions).not.toContain(REGION_QUESTIONS[0]);
  });

  it("offers a region-level reader the region wording", () => {
    const questions = quickQuestionsFor({
      scope: salonScope({ level: "region", primaryAreaId: "reg-a" }),
      can: canFor("regional_manager"),
    });

    expect(questions.slice(0, 2)).toEqual(REGION_QUESTIONS);
    expect(questions).not.toContain(DISTRICT_QUESTIONS[0]);
  });

  it.each(["salon_director", "assistant_salon_director"] as const)(
    "offers %s the salon-level opening",
    (role) => {
      const questions = quickQuestionsFor({ scope: salonScope(), can: canFor(role) });

      expect(questions[0]).toBe(SALON_QUESTION);
      for (const question of [...DISTRICT_QUESTIONS, ...REGION_QUESTIONS, ...GLOBAL_QUESTIONS]) {
        expect(questions).not.toContain(question);
      }
    },
  );

  /**
   * AN ADMINISTRATOR IS NOT RELABELLED.
   *
   * They hold a global scope, so they can read every salon and the wider
   * questions are the ones the data answers for them — but in the
   * organization's words, not a District Manager's. Nothing here reads their
   * role to arrange it.
   */
  it.each(["admin", "owner", "developer"] as const)(
    "offers %s neutral organization-wide wording on a global scope",
    (role) => {
      const questions = quickQuestionsFor({
        scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
        can: canFor(role),
      });

      expect(questions.slice(0, 2)).toEqual(GLOBAL_QUESTIONS);
      expect(questions.join(" ")).not.toMatch(/my district|my region|my attention/i);
    },
  );

  it("shows the Overview band's four without repeating an opening", () => {
    const band = quickQuestionsFor({
      scope: salonScope({ level: "district", primaryAreaId: "dist-1" }),
      can: canFor("district_manager"),
    }).slice(0, 4);

    expect(band).toHaveLength(4);
    expect(new Set(band).size).toBe(4);
  });
});

/* ================================================== the employee, explicitly = */

describe("a reader without view_daily_stats gets no report questions", () => {
  const employee = quickQuestionsFor({
    scope: salonScope(),
    can: canFor("employee"),
  });

  it("is offered none of the report openings", () => {
    for (const question of ALL_REPORT_QUESTIONS) {
      expect(employee).not.toContain(question);
    }
  });

  it("is offered nothing that routes to a report family at all", () => {
    for (const question of employee) {
      expect(routeReportFamilies(question)).toEqual([]);
    }
  });

  /**
   * AND IS NOT LEFT WITH AN EMPTY SCREEN. They hold `ask_questions`,
   * `view_knowledge` and `view_videos`, so the policy, objection and training
   * openings are all still theirs. A permission filter that emptied the band
   * would have replaced a bad chip with no product.
   */
  it("keeps the policy, objection and training openings", () => {
    expect(employee).toEqual([
      "What does our policy say about attendance?",
      "How should I handle a client objection?",
      "Show me training related to this issue.",
    ]);
  });

  it("is offered no form question, which it could not open", () => {
    expect(employee.join(" ")).not.toMatch(/create a .* form/i);
  });
});
