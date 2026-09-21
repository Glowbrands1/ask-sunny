import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ACTIVE_BRAND } from "@/lib/brand";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import { routeReportFamilies } from "@/lib/reporting/read/family-routing";
import type { AccessScope, Permission, Role } from "@/types";

import { QUICK_QUESTIONS, breadthOf, quickQuestionsFor } from "./quick-questions";

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

const MULTI_SALON_QUESTIONS = [
  "Where is my region losing revenue based on the latest data?",
  "Which salons need my attention today?",
];
const SINGLE_SALON_QUESTION = `Show me the most recent ${DAILY_REPORT} and what I need to focus on today.`;

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
    [MULTI_SALON_QUESTIONS[0], ["sales-totals", "salon-performance", "bed-usage"]],
    [MULTI_SALON_QUESTIONS[1], ["sales-totals", "salon-performance"]],
    [SINGLE_SALON_QUESTION, ["sales-totals", "salon-performance"]],
  ])("%s", (question, expected) => {
    expect(routeReportFamilies(question).sort()).toEqual([...expected].sort());
  });

  it("always carries the month-to-date Comp Report beside the daily report", () => {
    for (const question of [...MULTI_SALON_QUESTIONS, SINGLE_SALON_QUESTION]) {
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

describe("breadth is read from the scope, not from the role", () => {
  it.each([
    ["global", { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] }],
    ["region", salonScope({ level: "region", primaryAreaId: "reg-a" })],
    ["district", salonScope({ level: "district", primaryAreaId: "dist-1" })],
  ])("%s scope answers for more than one salon", (_label, scope) => {
    expect(breadthOf(scope as AccessScope)).toBe("multi");
  });

  it("a single salon answers for one", () => {
    expect(breadthOf(salonScope())).toBe("one");
  });

  /**
   * COVERING FOR SOMEBODY WIDENS THE QUESTION.
   *
   * A salon-level assignment that also covers two other salons is answering
   * for three, and "which salons need my attention" is a real question there.
   * Reading `level` alone would have offered them the single-salon opening.
   */
  it("a salon assignment that also covers other areas answers for more than one", () => {
    expect(breadthOf(salonScope({ alsoCoversAreaIds: ["loc-0310", "loc-0314"] }))).toBe(
      "multi",
    );
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
});

describe("the questions a reader is offered", () => {
  it("offers a district manager the two multi-salon report questions", () => {
    const questions = quickQuestionsFor({
      scope: salonScope({ level: "district", primaryAreaId: "dist-1" }),
      can: canFor("district_manager"),
    });

    expect(questions.slice(0, 2)).toEqual(MULTI_SALON_QUESTIONS);
    expect(questions).not.toContain(SINGLE_SALON_QUESTION);
  });

  it("offers a regional manager the same pair, by scope rather than by title", () => {
    const questions = quickQuestionsFor({
      scope: salonScope({ level: "region", primaryAreaId: "reg-a" }),
      can: canFor("regional_manager"),
    });

    expect(questions.slice(0, 2)).toEqual(MULTI_SALON_QUESTIONS);
  });

  it.each(["salon_director", "assistant_salon_director"] as const)(
    "offers %s the single-salon opening",
    (role) => {
      const questions = quickQuestionsFor({ scope: salonScope(), can: canFor(role) });

      expect(questions[0]).toBe(SINGLE_SALON_QUESTION);
      for (const question of MULTI_SALON_QUESTIONS) {
        expect(questions).not.toContain(question);
      }
    },
  );

  /**
   * AN ADMINISTRATOR IS NOT RELABELLED, AND STILL GETS WHAT THEIR ACCESS
   * SUPPORTS.
   *
   * They hold a global scope, so they can read every salon and the multi-salon
   * questions are the ones the data answers for them. Nothing anywhere calls
   * them a District Manager to arrange it — `breadthOf` never saw their role.
   */
  it.each(["admin", "owner", "developer"] as const)(
    "offers %s the multi-salon questions on the strength of a global scope",
    (role) => {
      const questions = quickQuestionsFor({
        scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
        can: canFor(role),
      });

      expect(questions.slice(0, 2)).toEqual(MULTI_SALON_QUESTIONS);
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
    for (const question of [...MULTI_SALON_QUESTIONS, SINGLE_SALON_QUESTION]) {
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
