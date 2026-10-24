import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { selfCheckEnabled, queryRewriteEnabled } from "@/lib/config/chat-quality-flags";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { actionPlanSentenceCount } from "@/lib/forms/action-plan-sentences";

import { manualTermsQuery, queryWithManualTerms } from "./query-rewrite";
import { reviewOutgoing, runSelfCheck, type OutgoingDraft, type ReviewBrief } from "./self-check";

/**
 * Varied phrasings, lowercase names, typos, and date formats.
 *
 * The model is not called. A repair is a function the test supplies, and a
 * heading is taken from the list the manual retrieval would have returned.
 */

const HEADINGS = ["Attendance", "Late Opening", "Standards of Conduct", "Dress Code"];

const TWO =
  "Management will review the Attendance policy with Jordan. Further issues may result in additional action.";
const THREE =
  "Management will review the Attendance policy with Jordan. A written note is the next step. Further issues may result in additional action.";

const JORDAN: RosterEmployee = {
  id: "emp-jordan",
  firstName: "Jordan",
  lastName: "Hale",
  salonIds: ["loc-1001"],
};

function chunk(input: {
  section?: string;
  page?: number | null;
  printedPage?: number | null;
  sections?: { heading: string; page: number }[];
  content?: string;
}): ManualChunk {
  return {
    chunkIndex: 0,
    page: input.page ?? null,
    printedPage: input.printedPage,
    content: input.content ?? "",
    section: input.section ?? null,
    sections: input.sections ?? null,
  };
}

function draft(overrides: Partial<OutgoingDraft> = {}): OutgoingDraft {
  return {
    content: `Attendance Policy, JBA Policy Manual p.14. ${TWO}`,
    employeeName: "Jordan Hale",
    actionPlan: TWO,
    chunks: [chunk({ sections: [{ heading: "Attendance", page: 14 }] })],
    roster: [JORDAN],
    ...overrides,
  };
}

describe("self-check", () => {
  it("accepts a cited heading and page that the retrieved chunks list", () => {
    expect(reviewOutgoing(draft())).toEqual([]);
    expect(
      reviewOutgoing(
        draft({
          content: "Please use Attendance Policy, JBA Policy Manual p.14.",
          actionPlan: null,
          employeeName: null,
        }),
      ),
    ).toEqual([]);
    expect(
      reviewOutgoing(
        draft({
          content: "Late Opening Policy, JBA Policy Manual p.15.",
          actionPlan: null,
          employeeName: null,
          chunks: [chunk({ sections: [{ heading: "Late Opening", page: 15 }] })],
        }),
      ),
    ).toEqual([]);
  });

  it("uses the printed page when the chunk has no sections list", () => {
    expect(
      reviewOutgoing(
        draft({
          content: "Attendance, JBA Policy Manual p.14.",
          actionPlan: null,
          employeeName: null,
          chunks: [chunk({ section: "Attendance", page: 16, printedPage: 14 })],
        }),
      ),
    ).toEqual([]);
  });

  it("uses the indexed chunk page when a heading list still has an older page", () => {
    const chunks = [chunk({ section: "Attendance", page: 16, printedPage: 15, sections: [{ heading: "Attendance", page: 14 }] })];
    expect(reviewOutgoing(draft({ content: "Attendance Policy, JBA Policy Manual p.15.", actionPlan: null, employeeName: null, chunks }))).toEqual([]);
    expect(reviewOutgoing(draft({ content: "Attendance Policy, JBA Policy Manual p.14.", actionPlan: null, employeeName: null, chunks })).map((failure) => failure.kind)).toEqual(["citation"]);
  });

  it("rejects a page the retrieved chunks do not have", () => {
    const failures = reviewOutgoing(
      draft({ content: "Attendance Policy, JBA Policy Manual p.99.", actionPlan: null, employeeName: null }),
    );
    expect(failures).toEqual([{ kind: "citation", detail: "Attendance Policy, JBA Policy Manual p.99" }]);
    expect(
      reviewOutgoing(
        draft({
          content: "Invented Section Policy, JBA Policy Manual p.14.",
          actionPlan: null,
          employeeName: null,
        }),
      ).some((failure) => failure.kind === "citation"),
    ).toBe(true);
  });

  it("cites the heading list's printed page, not the PDF sheet, when that flag is on", () => {
    const chunks = [chunk({ section: "Late Opening", page: 16, sections: [{ heading: "Late Opening", page: 15 }] })];
    const pdf = draft({
      content: "Late Opening Policy, JBA Policy Manual p.16.",
      actionPlan: null,
      employeeName: null,
      chunks,
    });
    const printed = draft({
      content: "Late Opening Policy, JBA Policy Manual p.15.",
      actionPlan: null,
      employeeName: null,
      chunks,
    });
    expect(reviewOutgoing(pdf)).toEqual([]);
    expect(reviewOutgoing(printed).map((failure) => failure.kind)).toEqual(["citation"]);
    process.env.PRINTED_PAGE_CITATION_ENABLED = "1";
    try {
      expect(reviewOutgoing(printed)).toEqual([]);
      expect(reviewOutgoing(pdf).map((failure) => failure.kind)).toEqual(["citation"]);
    } finally {
      delete process.env.PRINTED_PAGE_CITATION_ENABLED;
    }
  });

  it("accepts an action plan of two sentences and rejects three", () => {
    expect(reviewOutgoing(draft({ content: TWO, actionPlan: null, employeeName: null, chunks: [] }))).toEqual([]);
    expect(
      reviewOutgoing(draft({ content: THREE, actionPlan: null, employeeName: null, chunks: [] })).map((failure) => failure.kind),
    ).toEqual(["action_plan"]);
    expect(actionPlanSentenceCount(TWO)).toBe(2);
    expect(actionPlanSentenceCount(THREE)).toBe(3);
    const payroll =
      "Management will review the Attendance policy with Jordan. $25 will be deducted from Jordan's pay.";
    expect(
      reviewOutgoing(draft({ content: payroll, actionPlan: payroll, chunks: [] })).map((failure) => failure.kind),
    ).toEqual(["action_plan"]);
  });

  it("never sends the repair model's refusal: I cannot repair this reply, Test Testy does not appear on the employee roster", async () => {
    const settled = await runSelfCheck(
      draft({
        content: "Invented Section, JBA Policy Manual p.4. The form is for Test Testy.",
        actionPlan: null,
        employeeName: "Test Testy",
        chunks: [],
      }),
      async () => ({
        content: "I cannot repair this reply. 'Test Testy' does not appear on the employee roster.",
        employeeName: null,
        actionPlan: null,
        sections: [],
      }),
    );
    expect(settled.content).not.toMatch(/I cannot repair|does not appear on the employee roster|I cannot create this form/i);
    expect(settled.employeeName).toBe("Test Testy");
    expect(settled.content).toContain("Test Testy");
  });

  it("does not treat a name that is missing from Woven as a failure", () => {
    // Pau, 23 Oct 2026: a person who is not in Woven is still the employee.
    // The old check rejected "jorden hale" and the repair model then refused the form.
    expect(reviewOutgoing(draft({ content: "Ready.", actionPlan: null, chunks: [], employeeName: "jordan hale" }))).toEqual([]);
    expect(reviewOutgoing(draft({ content: "Ready.", actionPlan: null, chunks: [], employeeName: "JORDAN HALE" }))).toEqual([]);
    expect(reviewOutgoing(draft({ content: "Ready.", actionPlan: null, chunks: [], employeeName: "jorden hale" }))).toEqual([]);
    expect(reviewOutgoing(draft({ content: "Ready.", actionPlan: null, chunks: [], employeeName: "Test Testy" }))).toEqual([]);
  });

  it("skips the employee check when the roster could not be read or came back empty", () => {
    // An empty read is not proof the person is absent. Treating it as a miss
    // took the typed name off the card (live replay, 23 Oct 2026).
    expect(reviewOutgoing(draft({ content: "Ready.", actionPlan: null, chunks: [], roster: null, employeeName: "Casey Quinn" }))).toEqual([]);
    expect(
      reviewOutgoing(draft({ content: "Ready.", actionPlan: null, chunks: [], roster: [], employeeName: "Jordan Hale" })),
    ).toEqual([]);
  });

  it("does not call repair when the draft is already valid", async () => {
    let calls = 0;
    const settled = await runSelfCheck(draft(), async () => {
      calls += 1;
      return { content: "changed", employeeName: null, actionPlan: null };
    });
    expect(calls).toBe(0);
    expect(settled.ok).toBe(true);
    expect(settled.repaired).toBe(false);
    expect(settled.content).toContain("p.14");
  });

  it("repairs once when a check fails", async () => {
    let calls = 0;
    const settled = await runSelfCheck(
      draft({ content: `Attendance Policy, JBA Policy Manual p.99. ${THREE}`, actionPlan: THREE, employeeName: "jorden hale" }),
      async () => {
        calls += 1;
        return { content: `Attendance Policy, JBA Policy Manual p.14. ${TWO}`, employeeName: "jordan hale", actionPlan: TWO };
      },
    );
    expect(calls).toBe(1);
    expect(settled).toMatchObject({ ok: true, repaired: true, employeeName: "jordan hale", actionPlan: TWO });
  });

  it("falls back after one repair that is still wrong", async () => {
    let calls = 0;
    const settled = await runSelfCheck(
      draft({ content: `Attendance Policy, JBA Policy Manual p.99. ${THREE}`, actionPlan: THREE, employeeName: "jorden hale" }),
      async () => {
        calls += 1;
        return {
          content: `Attendance Policy, JBA Policy Manual p.99. ${THREE}`,
          employeeName: "Jorden Hale",
          actionPlan: THREE,
        };
      },
    );
    expect(calls).toBe(1);
    expect(settled.ok).toBe(false);
    expect(settled.repaired).toBe(true);
    // The typed spelling stays. A missing Woven row is not said as an error.
    expect(settled.employeeName).toBe("Jorden Hale");
    expect(settled.content).not.toContain("p.99");
    expect(settled.content).not.toMatch(/couldn'?t find|does not appear|I cannot repair/i);
    expect(settled.content).not.toContain("not on the form");
    expect(settled.actionPlan && actionPlanSentenceCount(settled.actionPlan)).toBe(2);
    expect(settled.content).not.toContain("written note");
  });

  it("falls back when the repair cannot be read", async () => {
    const settled = await runSelfCheck(
      draft({ content: "Invented Section, JBA Policy Manual p.4.", actionPlan: null, employeeName: null }),
      async () => ({ content: "" }),
    );
    expect(settled.ok).toBe(false);
    expect(settled.content).not.toContain("Invented Section");
    const thrown = await runSelfCheck(
      draft({ content: THREE, actionPlan: THREE, employeeName: null, chunks: [] }),
      async () => {
        throw new Error("repair failed");
      },
    );
    expect(thrown.ok).toBe(false);
    expect(thrown.actionPlan && actionPlanSentenceCount(thrown.actionPlan)).toBe(2);
  });

  it("corrects Attendance to the indexed page and drops a section whose text does not fit: what is the policy if an employee showed up late 3 times this month", async () => {
    const question = "what is the policy if an employee showed up late 3 times this month";
    const chunks = [
      chunk({
        section: "Attendance",
        page: 15,
        sections: [{ heading: "Attendance", page: 14 }],
        content: "Attendance\nAn employee is expected to be present at the scheduled start of the shift. Repeated lateness is covered here.",
      }),
      chunk({
        section: "Late Opening",
        page: 15,
        content:
          "Late Opening\nWhen an employee assigned to open a location is unable to open the location at the proper time, the employee will reimburse the company $25.00 via payroll deduction.",
      }),
    ];
    const content = [
      "An employee who showed up late is covered by Attendance Policy, JBA Policy Manual p.14.",
      "Late Opening Policy, JBA Policy Manual p.15.",
      "The employee will reimburse the company $25.00.",
    ].join(" ");
    let calls = 0;
    const captured: { brief: ReviewBrief | null } = { brief: null };
    const settled = await runSelfCheck(
      draft({ content, actionPlan: null, employeeName: null, chunks, roster: [], question }),
      async (brief: ReviewBrief) => {
        calls += 1;
        captured.brief = brief;
        return {
          content,
          employeeName: null,
          actionPlan: null,
          sections: [
            { heading: "Attendance", applies: true },
            { heading: "Late Opening", applies: false },
          ],
        };
      },
    );
    expect(calls).toBe(1);
    expect(captured.brief?.question).toBe(question);
    expect(captured.brief?.sections.some((section) => section.heading === "Attendance" && section.page === 15 && section.text.includes("scheduled start"))).toBe(true);
    expect(captured.brief?.sections.some((section) => section.heading === "Late Opening" && section.text.includes("$25.00") && section.text.includes("open a location"))).toBe(true);
    expect(settled.ok).toBe(true);
    expect(settled.content).toContain("Attendance Policy, JBA Policy Manual p.15");
    expect(settled.content).not.toContain("p.14");
    expect(settled.content).not.toContain("Late Opening");
    expect(settled.content).not.toContain("$25");
  });

  it("keeps a cited section when the model says that chunk's text fits the question", async () => {
    const chunks = [
      chunk({
        section: "Late Opening",
        page: 15,
        content: "Late Opening\nWhen an employee assigned to open a location is unable to open the location at the proper time, the employee will reimburse the company $25.00.",
      }),
    ];
    const content = "Late Opening Policy, JBA Policy Manual p.15. The employee will reimburse the company $25.00.";
    const settled = await runSelfCheck(
      draft({
        content,
        actionPlan: null,
        employeeName: null,
        chunks,
        roster: [],
        question: "what is the policy if an employee showed up late 3 times this month",
      }),
      async () => ({
        content,
        employeeName: null,
        actionPlan: null,
        sections: [{ heading: "Late Opening", applies: true }],
      }),
    );
    expect(settled.ok).toBe(true);
    expect(settled.repaired).toBe(false);
    expect(settled.content).toContain("Late Opening Policy, JBA Policy Manual p.15");
    expect(settled.content).toContain("$25.00");
  });
});

describe("manual-term retrieval query", () => {
  it.each([
    ["she showed up late", "Attendance"],
    ["SHOWED UP LATE on 10/1/2026", "Attendance"],
    ["showed up late on 10-1-2026", "Attendance"],
    ["showed up late on October 1, 2026", "Attendance"],
    ["showed up late on 1 October 2026", "Attendance"],
    ["jorden hale showed up late on 1st of October 2026", "Attendance"],
    ["she arrived late", "Attendance"],
    ["she was late opening the salon", "Late Opening"],
    ["she was late opening the salon on 10/1/2026", "Late Opening"],
    ["opened the salon late", "Late Opening"],
    ["late opening on october 1", "Late Opening"],
    ["LATE OPENING", "Late Opening"],
  ])("%s retrieves %s", (question, heading) => {
    let called = false;
    const query = queryWithManualTerms({
      question,
      headings: HEADINGS,
      modelHeading: "Late Opening",
      fallback: question,
      onModel() {
        called = true;
      },
    });
    expect(query).toBe(heading);
    expect(called).toBe(false);
    expect(manualTermsQuery({ question, headings: HEADINGS, modelHeading: "Late Opening" })).toBe(heading);
  });

  it("does not invent Attendance when that heading was not retrieved", () => {
    expect(manualTermsQuery({ question: "she showed up late", headings: ["Late Opening"], modelHeading: null })).toBeNull();
    expect(
      queryWithManualTerms({
        question: "she showed up late",
        headings: ["Late Opening"],
        modelHeading: "Attendance",
        fallback: "she showed up late",
      }),
    ).toBe("she showed up late");
  });

  it("keeps a model heading only when the account is silent and the heading was retrieved", () => {
    let called = false;
    expect(
      queryWithManualTerms({
        question: "what does the dress code say",
        headings: HEADINGS,
        modelHeading: "Dress Code",
        fallback: "what does the dress code say",
        onModel() {
          called = true;
        },
      }),
    ).toBe("Dress Code");
    expect(called).toBe(true);
    expect(
      queryWithManualTerms({
        question: "what does the dress code say",
        headings: HEADINGS,
        modelHeading: "Not A Heading",
        fallback: "glossed question",
      }),
    ).toBe("glossed question");
    expect(
      manualTermsQuery({ question: "what does the dress code say", headings: HEADINGS, modelHeading: "dress code" }),
    ).toBe("Dress Code");
  });
});

describe("self-check and query rewrite flags", () => {
  it("defaults off and turns on only for 1, true, on, or yes", () => {
    const names = ["SELF_CHECK_ENABLED", "QUERY_REWRITE_ENABLED"] as const;
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      for (const name of names) delete process.env[name];
      expect(selfCheckEnabled()).toBe(false);
      expect(queryRewriteEnabled()).toBe(false);
      for (const off of ["", "0", "false", "off", "no", "maybe"]) {
        process.env.SELF_CHECK_ENABLED = off;
        process.env.QUERY_REWRITE_ENABLED = off;
        expect(selfCheckEnabled()).toBe(false);
        expect(queryRewriteEnabled()).toBe(false);
      }
      for (const on of ["1", "true", "on", "yes", " YES ", " TRUE "]) {
        process.env.SELF_CHECK_ENABLED = on;
        process.env.QUERY_REWRITE_ENABLED = on;
        expect(selfCheckEnabled()).toBe(true);
        expect(queryRewriteEnabled()).toBe(true);
      }
    } finally {
      for (const name of names) {
        const saved = previous[name];
        if (saved === undefined) delete process.env[name];
        else process.env[name] = saved;
      }
    }
  });

  it("wires the pass and the rewrite behind their flags and does not write", () => {
    const ask = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    const guard = readFileSync("src/lib/ai/self-check-run.ts", "utf8");
    const rewrite = readFileSync("src/lib/ai/query-rewrite-claude.ts", "utf8");
    expect(ask).toContain("if (!selfCheckEnabled()) return produce();");
    expect(ask).toContain("rewriteToManualTerms");
    expect(ask).toContain("queryRewriteEnabled()");
    expect(guard).toContain("if (!selfCheckEnabled()) return response;");
    expect(guard).toContain('status: settled.employeeName ? proposal.status : "needs_employee"');
    expect(guard).toContain("brief.question");
    expect(guard).toContain("applies");
    const checker = readFileSync("src/lib/ai/self-check.ts", "utf8");
    expect(checker).not.toContain("showed up late");
    expect(checker).not.toContain("Late Opening");
    expect(guard).not.toContain("Late Opening");
    expect(rewrite).toContain("if (known) return known;");
    for (const source of [guard, rewrite]) {
      expect(source).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
    }
  });
});
