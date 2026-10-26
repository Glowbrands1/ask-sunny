import { afterEach, describe, expect, it, vi } from "vitest";

import { decideIntentTurn, type IntentTurnInput } from "@/lib/ai/intent-slots";
import { augmentIntakeQuestion } from "@/lib/ai/intake-augment";
import { readCaPolicy } from "./ca-policy";
import { yearlessCuedDates, withYearlessDatesWritten } from "./late-open";
import { sectionHeadingsFor } from "./official-policy-manual";
import { policySectionsFor } from "@/lib/knowledge/policy-retrieval";

/**
 * QA, 24 Oct 2026 (F5, F6), in the manager's words. See `late-open.ts`, and
 * `late-open-date-live.test.ts` for the same turns through `answerQuestion`.
 */

const TODAY = "2026-10-24";

afterEach(() => {
  vi.unstubAllEnvs();
});

function on() {
  vi.stubEnv("LATE_OPEN_DATE_ENABLED", "1");
}

/** Pinned to flag-off; the env may set it (production runs with it on). Restored by `unstubAllEnvs` above. */
function off() {
  vi.stubEnv("LATE_OPEN_DATE_ENABLED", "");
}

describe("a yearless dashed month-day after a date cue", () => {
  it.each([
    ["late to open 10-19, verbal, no payroll", "2026-10-19"],
    ["late opening 10-19", "2026-10-19"],
    ["change the date to 10-22", "2026-10-22"],
    ["on 10-21", "2026-10-21"],
    ["dated 10-1", "2026-10-01"],
    ["the date is 10-20", "2026-10-20"],
    // The most recent 20 December, never one still to come.
    ["late to open 12-20", "2025-12-20"],
  ])("%s → %s", (text, iso) => {
    expect(yearlessCuedDates(text, TODAY).map((found) => found.iso)).toEqual([iso]);
  });

  it.each([
    ["she worked 10-12 hours on the 19th"],
    ["late to open 10-19-26"],
    ["opened late on 10/19"],
    ["scored 10-12 on the audit"],
    ["late to open 10-12 min"],
    ["13-40 on the schedule"],
  ])("%s is not a yearless date", (text) => {
    expect(yearlessCuedDates(text, TODAY)).toEqual([]);
  });

  it("is written in a shape the date readers accept", () => {
    expect(withYearlessDatesWritten("late to open 10-19, verbal", TODAY)).toBe("late to open 10/19/2026, verbal");
  });
});

describe("late to open is the Late Opening section", () => {
  it("names it, maps it and finds it, with the flag on", () => {
    on();
    expect(readCaPolicy("late to open 10-19, verbal, no payroll").stated).toBe("late_opening");
    expect(sectionHeadingsFor({ offenseKeys: ["tardiness"], notes: "late to open 10-19" })).toEqual([
      ["Late Opening"],
      ["Attendance"],
    ]);
    expect(policySectionsFor("late to open 10-19")).toEqual(["Late Opening"]);
  });

  it("is Attendance with the flag off, as before", () => {
    off();
    expect(readCaPolicy("late to open 10-19, verbal, no payroll").stated).toBeNull();
    expect(sectionHeadingsFor({ offenseKeys: ["tardiness"], notes: "late to open 10-19" })).toEqual([["Attendance"]]);
  });

  it("late for a shift stays Attendance", () => {
    on();
    const text = "arrived 20 minutes late for her shift on 10-19";
    expect(readCaPolicy(text).stated).toBeNull();
    expect(sectionHeadingsFor({ offenseKeys: ["tardiness"], notes: text })).toEqual([["Attendance"]]);
  });
});

const SALONS = [{ id: "loc-0309", name: "NE Kearney" }] as const;
const TEMPLATES = [{ key: "dpoa", name: "Corrective Action Form" }] as const;
const HEADINGS = ["Attendance", "Late Opening", "Standards of Conduct"];

function turn(question: string, overrides: Partial<IntentTurnInput> = {}): IntentTurnInput {
  return {
    question,
    history: [],
    today: TODAY,
    saved: null,
    raw: null,
    people: [],
    salons: SALONS,
    headings: HEADINGS,
    templates: TEMPLATES,
    formInProgress: false,
    ...overrides,
  };
}

describe("the intent read (this app's live path)", () => {
  const F5 = "CA for Test Employee at NE Kearney, late to open 10-19, verbal, no payroll";

  it("F5: dates the form 10/19 and reads Late Opening, not Attendance", () => {
    on();
    const decision = decideIntentTurn(turn(F5));
    expect(decision.state.formDate).toBe("2026-10-19");
    expect(decision.state.incidentType).toBe("Late Opening");
    expect(decision.state.policyHeading).toBe("Late Opening");
    expect(decision.state.payrollDeduct).toBe("no");
    expect(decision.question).toContain("It happened on 10/19/2026.");
  });

  it("F5 with the flag off reads no date and Attendance, as live", () => {
    off();
    const decision = decideIntentTurn(turn(F5));
    expect(decision.state.formDate).toBeNull();
    expect(decision.state.incidentType).toBe("Attendance");
  });

  it('"change the date to 10-22" beats the saved 10/19', () => {
    on();
    const first = decideIntentTurn(turn(F5));
    const second = decideIntentTurn(
      turn("change the date to 10-22", {
        history: [
          { role: "user", content: F5 },
          { role: "assistant", content: "I'll draft a **Corrective Action Form** for **Test Employee**." },
        ],
        saved: first.state,
        formInProgress: true,
      }),
    );
    expect(second.state.formDate).toBe("2026-10-22");
    expect(second.question).toContain("It happened on 10/22/2026.");
  });

  it('"arrived 20 minutes late for her shift on 10-19" is Attendance', () => {
    on();
    const decision = decideIntentTurn(
      turn("CA for Test Employee at NE Kearney, arrived 20 minutes late for her shift on 10-19, verbal"),
    );
    expect(decision.state.formDate).toBe("2026-10-19");
    expect(decision.state.incidentType).toBe("Attendance");
  });

  it.each([
    ["payroll deduct is not applicable."],
    ["payroll deduct n/a"],
    ["not applicable"],
    ["doesn't apply"],
  ])("F6: %s, answering the payroll question, is No in the saved state", (reply) => {
    on();
    const decision = decideIntentTurn(
      turn(reply, {
        history: [
          { role: "user", content: "CA for Test Employee at NE Kearney, late to open 10-19, verbal" },
          { role: "assistant", content: "One more question: **Is payroll deduct applicable?** Yes or No?" },
        ],
        formInProgress: true,
      }),
    );
    expect(decision.state.payrollDeduct).toBe("no");
    expect(decision.question).toContain("No payroll deduction.");
  });

  it("F6: inside the request", () => {
    on();
    const decision = decideIntentTurn(
      turn("CA for Test Employee at NE Kearney, late to open 10-19, verbal. payroll deduct is not applicable."),
    );
    expect(decision.state.payrollDeduct).toBe("no");
  });
});

describe("the intake line (FIELD_ACCURACY_ENABLED)", () => {
  it("adds the date a cue gave, not only after \"on\"", () => {
    on();
    const out = augmentIntakeQuestion({
      slots: false,
      fields: true,
      question: "verbal, no payroll",
      history: [{ role: "user", content: "CA for Test Employee at NE Kearney, late to open 10-19" }],
      today: TODAY,
    });
    expect(out).toContain("It happened on 10/19/2026.");
  });
});
