import { describe, expect, it } from "vitest";

import { JBA_MANUAL_CHUNKS } from "@/lib/ai/__fixtures__/jba-policy-manual";
import { buildSystemPrompt, UNIFIED_ORDER_OF_AUTHORITY, withUnifiedAuthority, EMPLOYEE_PERFORMANCE_RULES, DAILY_STATS_SOURCE_RULES } from "@/lib/ai/prompts";
import {
  actionPlanSentenceCount,
  collapseToTwoSentences,
  twoSentenceActionPlan,
} from "@/lib/forms/action-plan-sentences";
import { correctiveActionPlan } from "@/lib/forms/ca-action-plan";
import { findManualSection } from "@/lib/forms/official-policy-manual";
import {
  citeAttendanceForTardiness,
  policyFieldsWithCitation,
} from "@/lib/forms/required-policy-citation";
import { blocksOnNameQuestion, inlineCloseMatch, wovenNoteAlreadyShown } from "@/lib/forms/typed-name-proceeds";

const PLAN = {
  citedPolicies: ["Attendance"],
  employeeName: "Colene Shildt",
  payroll: { answer: "yes" as const, amount: "$25" },
};

const PROMPT = {
  assistantName: "Sunny",
  brandName: "Sun Tan City",
  salonNoun: "salon",
  context: { userName: "Pat Manager", locationName: "All salons", todayIso: "2026-10-23" },
  mode: "standard" as const,
  hasContext: true,
  hasFrameworkGrounding: true,
  hasDailyStatsFramework: true,
};

describe("an unverified name is used as typed", () => {
  it("offers one close roster match without making it a gate", () => {
    const note = inlineCloseMatch("Colene Shildt", ["Colene Schildt"]);
    expect(note).toBe("Woven has Colene Schildt");
    expect(blocksOnNameQuestion(note)).toBe(false);
    expect(note).not.toMatch(/did you mean|I'll keep|\?/);
    expect(inlineCloseMatch("Jane Doe", [])).toBe("");
  });

  it("offers several close matches in the same reply, and not again later", () => {
    const note = inlineCloseMatch("Pat", ["Pat Rivera", "Pat Jones"]);
    expect(note).toBe("Woven has Pat Rivera or Pat Jones");
    expect(note).not.toMatch(/reply with the number|did you mean|\?/);
    expect(wovenNoteAlreadyShown([{ content: note }])).toBe(true);
    expect(
      wovenNoteAlreadyShown([
        { content: "Woven has **Jane Doe** — say so if that's who you mean. Carry on; do not wait." },
      ]),
    ).toBe(true);
    expect(wovenNoteAlreadyShown([{ content: "coaching form for Pat" }])).toBe(false);
  });

  it("still recognises the question that holds the card", () => {
    expect(
      blocksOnNameQuestion(
        "Did you mean **Colene Schildt**? I want to be sure before it goes on the form.",
      ),
    ).toBe(true);
    expect(blocksOnNameQuestion("Who is this **Coaching Form** for?")).toBe(true);
  });
});

describe("tardiness cites Attendance, and every resolved section has a page", () => {
  const attendance = findManualSection(JBA_MANUAL_CHUNKS, ["Attendance"])!;
  const lateOpening = findManualSection(JBA_MANUAL_CHUNKS, ["Late Opening"])!;

  it("cites Attendance by name and page for a late arrival", () => {
    const sections = citeAttendanceForTardiness({
      enabled: true,
      notes: "she was late for her shift",
      chunks: JBA_MANUAL_CHUNKS,
      sections: [{ heading: "Tardiness/Leaving Early", page: 0, chunkIndex: 0, foundBy: "page_heading" }],
    });
    expect(sections[0]?.heading).toBe("Attendance");
    expect(sections[0]?.page).toBe(14);
    expect(sections.some((section) => /tardiness/i.test(section.heading))).toBe(false);
  });

  it("leaves a late opening on Late Opening", () => {
    const sections = citeAttendanceForTardiness({
      enabled: true,
      notes: "the policy violated is late opening, not attendance. she opened the salon late",
      chunks: JBA_MANUAL_CHUNKS,
      sections: [lateOpening],
    });
    expect(sections.map((section) => section.heading)).toEqual([lateOpening.heading]);
    expect(sections.some((section) => section.heading === "Attendance")).toBe(false);
  });

  it("does nothing while the flag is off", () => {
    const box = [{ heading: "Tardiness/Leaving Early", page: 0, chunkIndex: 0, foundBy: "page_heading" as const }];
    expect(
      citeAttendanceForTardiness({
        enabled: false,
        notes: "she was late for her shift",
        chunks: JBA_MANUAL_CHUNKS,
        sections: box,
      }),
    ).toEqual(box);
  });

  it("writes the Attendance name and page over the ticked box", () => {
    const values = policyFieldsWithCitation({
      attendance: true,
      pageRequired: true,
      values: { policy_violated: "Tardiness/Leaving Early", policy_language: "" },
      sections: [attendance],
    });
    expect(values.policy_violated).toBe("Attendance Policy, JBA Policy Manual p.14");
    expect(values.policy_language).toBe("Attendance Policy, JBA Policy Manual p.14");
  });

  it("puts a name and page on a coaching narrative that had neither", () => {
    const values = policyFieldsWithCitation({
      attendance: false,
      pageRequired: true,
      values: { coaching_details: "Out of dress code." },
      sections: [findManualSection(JBA_MANUAL_CHUNKS, ["Dress Code for The Company"])!],
    });
    expect(values.coaching_details).toMatch(/Dress Code for The Company Policy, JBA Policy Manual p\.\d+/);
    expect(values).not.toHaveProperty("policy_language");
  });

  it("does not invent a page, and leaves a citation that already has one", () => {
    const cited = "Attendance Policy, JBA Policy Manual p.14";
    const values = policyFieldsWithCitation({
      attendance: true,
      pageRequired: true,
      values: { policy_language: cited, policy_violated: "Tardiness/Leaving Early" },
      sections: [attendance],
    });
    expect(values.policy_language).toBe(cited);
    expect(
      policyFieldsWithCitation({
        attendance: true,
        pageRequired: true,
        values: { policy_violated: "Tardiness/Leaving Early" },
        sections: [],
      }).policy_violated,
    ).toBe("Tardiness/Leaving Early");
  });
});

describe("a payroll yes stays two sentences", () => {
  it("builds the review and the closing, and keeps the deduction off the plan", () => {
    const plan = twoSentenceActionPlan(PLAN);
    expect(actionPlanSentenceCount(plan)).toBe(2);
    expect(plan).toMatch(/^Management will review the Attendance policy with Colene\./);
    expect(plan).toMatch(/Future policy violations may result in/);
    expect(plan).not.toMatch(/payroll deduction|deducted|\$25/i);
  });

  it("collapses the three-sentence plan a Yes used to build", () => {
    const three = correctiveActionPlan(PLAN);
    expect(actionPlanSentenceCount(three)).toBeGreaterThan(2);
    expect(three).toMatch(/\$25/);
    const collapsed = collapseToTwoSentences(three);
    expect(actionPlanSentenceCount(collapsed)).toBe(2);
    expect(collapsed).toMatch(/^Management will review/);
    expect(collapsed).toMatch(/Future policy violations may result in/);
    expect(collapsed).not.toMatch(/\$25/);
  });
});

describe("one order of authority", () => {
  it("leaves each block's own list while the flag is off", () => {
    expect(withUnifiedAuthority(EMPLOYEE_PERFORMANCE_RULES, false)).toBe(EMPLOYEE_PERFORMANCE_RULES);
    expect(withUnifiedAuthority(DAILY_STATS_SOURCE_RULES, false)).toBe(DAILY_STATS_SOURCE_RULES);
    const prompt = buildSystemPrompt(PROMPT);
    expect(prompt).toContain("2. Current employee performance data.");
    expect(prompt).toContain("2. The current ingested report data.");
    expect(prompt.match(/THE ORDER OF AUTHORITY, HIGHEST FIRST/g)).toHaveLength(2);
  });

  it("uses the same list in both framework blocks", () => {
    const prompt = buildSystemPrompt({ ...PROMPT, unifiedAuthority: true });
    const unified = UNIFIED_ORDER_OF_AUTHORITY.replaceAll("{{BRAND}}", "Sun Tan City");
    expect(prompt.split(unified)).toHaveLength(3);
    expect(prompt).not.toContain("2. Current employee performance data.");
    expect(prompt).not.toContain("2. The current ingested report data.");
    expect(prompt).toContain("BEFORE YOU SUGGEST ANY CONSEQUENCE");
    expect(prompt).toContain("WHERE POLICY AND A FRAMEWORK CONFLICT, POLICY WINS.");
  });
});
