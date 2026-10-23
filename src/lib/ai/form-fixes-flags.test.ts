import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { extractFormDate } from "@/lib/forms/form-date-answer";
import { HR_TEMPLATE_SEEDS } from "@/lib/forms/library";
import { payrollDeductAmount } from "@/lib/forms/payroll-deduct";
import { pickResentDraft } from "@/lib/forms/draft-reopen";
import type { AccessScope, ChatMessage } from "@/types";

import { proposeFormForTurn } from "./form-proposal";
import { augmentIntakeQuestion, fieldLines } from "./intake-augment";
import { flaggedCitationWrite } from "./policy-citation-fields";
import { historyWantsSeparateDocument, wantsSeparateDocument } from "./second-form";

/**
 * Form fixes that stay off until a flag asks for them.
 *
 * The sentences added here are ones the existing readers already accept.
 * With both flags false, the question string is the one the caller passed.
 */

const TODAY = "2026-10-23";
const MULTI: AccessScope = {
  level: "salon",
  primaryAreaId: "loc-0468",
  alsoCoversAreaIds: ["loc-0306"],
};

const LIBRARY = HR_TEMPLATE_SEEDS.filter((seed) =>
  ["coaching", "dpoa", "follow-up-coaching"].includes(seed.key),
).map((seed) => ({
  id: `tpl-${seed.key}`,
  key: seed.key,
  name: seed.name,
  shortName: seed.shortName,
  description: seed.description,
  category: seed.category,
  layoutFamily: seed.layoutFamily,
  requiredPermission: seed.requiredPermission,
  active: true,
  displayOrder: seed.displayOrder,
  currentVersion: { id: `v-${seed.key}`, status: "published", document: seed.document, variants: seed.variants },
  draftVersion: null,
  versionCount: 1,
  activeAsset: null,
  assetCount: 0,
}));

const FACTS =
  "The employee is Avery Holt. She is a Salon Director at Lawrence. It happened on 10-1. We will payroll deduct the amount of $3.25.";

function user(id: string, content: string): ChatMessage {
  return { id, role: "user", content, createdAt: "2026-10-01T12:00:00Z" };
}

/** Eight turns after the facts, so the six-turn window no longer holds them. */
function buriedHistory(): ChatMessage[] {
  const fillers = Array.from({ length: 8 }, (_, index) => user(`fill-${index}`, "the schedule is set"));
  return [user("facts", FACTS), ...fillers];
}

const LATE_CHUNK = {
  chunkIndex: 4,
  page: 16,
  printedPage: 15,
  section: "Late Opening",
  content: "Late Opening\n15 | P a g e\nA salon opens at the posted time.",
  sections: [{ heading: "Late Opening", page: 15 }],
};

describe("flags off leave the question unchanged", () => {
  it("returns the same string when both intake flags are off", () => {
    const question = "create a verbal corrective action";
    const history = buriedHistory();
    expect(
      augmentIntakeQuestion({ slots: false, fields: false, question, history, today: TODAY }),
    ).toBe(question);
    expect(fieldLines(question, TODAY, FACTS)).not.toEqual([]);
    expect(extractFormDate(FACTS, TODAY)).toBeNull();
    expect(payrollDeductAmount(FACTS)).toBeNull();
  });
});

describe("slots and fields the existing readers already accept", () => {
  it("carries a buried salon, name, title, date and payroll amount onto the current turn", () => {
    const question = "create a verbal corrective action";
    const augmented = augmentIntakeQuestion({
      slots: true,
      fields: true,
      question,
      history: buriedHistory(),
      today: TODAY,
    });
    expect(augmented).toContain("The employee is Avery Holt.");
    expect(augmented).toContain("Job title: Salon Director.");
    expect(augmented).toContain("It happened at KS Lawrence.");
    expect(augmented).toContain("It happened on 10/1/2026.");
    expect(augmented).toContain("Payroll deduction of $3.25.");
    expect(extractFormDate(augmented, TODAY)).toBe("2026-10-01");
    expect(payrollDeductAmount(augmented)).toBe("$3.25");
  });

  it("reads a mistyped salon when the roster reader found none", () => {
    const augmented = augmentIntakeQuestion({
      slots: true,
      fields: false,
      question: "create a coaching form",
      history: [user("typo", "she opened late at Lawerence yesterday")],
      today: TODAY,
    });
    expect(augmented).toContain("It happened at KS Lawrence.");
  });

  it("does not ask again once those sentences are on the turn", async () => {
    const history = buriedHistory();
    const question = "create a verbal corrective action";
    const bare = await proposeFormForTurn({
      history,
      question,
      questionMessageId: "msg-bare",
      actor: { role: "salon_director", scope: MULTI },
      summaries: LIBRARY as never,
      today: TODAY,
    });
    expect(bare?.formProposal?.employeeName).toBe("Avery Holt");
    expect(bare?.formProposal?.employeeRole ?? null).toBeNull();
    expect(bare?.formProposal?.locationResolution).toBe("needs_selection");
    expect(bare?.formProposal?.formDate ?? null).toBeNull();
    expect(bare?.content).toMatch(/which salon/i);

    const augmented = augmentIntakeQuestion({
      slots: true,
      fields: true,
      question,
      history,
      today: TODAY,
    });
    const filled = await proposeFormForTurn({
      history,
      question: augmented,
      questionMessageId: "msg-filled",
      actor: { role: "salon_director", scope: MULTI },
      summaries: LIBRARY as never,
      today: TODAY,
    });
    expect(filled?.formProposal?.employeeName).toBe("Avery Holt");
    expect(filled?.formProposal?.employeeRole).toBe("Salon Director");
    expect(filled?.formProposal?.locationId).toBe("loc-0468");
    expect(filled?.formProposal?.locationResolution).toBe("resolved");
    expect(filled?.formProposal?.formDate).toBe("2026-10-01");
    expect(filled?.formProposal?.payrollDeduct).toBe("yes");
    expect(filled?.content ?? "").not.toMatch(/which salon is this about/i);
    expect(filled?.content ?? "").not.toMatch(/who is this/i);
  });
});

describe("a second document is not a resend", () => {
  it("treats follow-up and another form as separate, and a redraft as the same one", () => {
    expect(wantsSeparateDocument("please do a follow-up coaching form for Avery Holt")).toBe(true);
    expect(wantsSeparateDocument("I need a second corrective action")).toBe(true);
    expect(wantsSeparateDocument("another coaching form")).toBe(true);
    expect(wantsSeparateDocument("please redraft the coaching form")).toBe(false);
    expect(
      historyWantsSeparateDocument([
        { role: "user", content: "follow-up coaching for Avery Holt" },
        { role: "assistant", content: "Which salon?" },
      ]),
    ).toBe(true);
    expect(historyWantsSeparateDocument([{ role: "user", content: "create a verbal corrective action" }])).toBe(
      false,
    );
  });

  it("reopens the newest draft for the same person and salon", () => {
    const rows = [
      { id: "old", employeeName: "Avery Holt", locationId: "loc-0468", createdAt: "2026-10-22T12:00:00Z" },
      { id: "new", employeeName: "avery holt", locationId: "loc-0468", createdAt: "2026-10-23T12:00:00Z" },
      { id: "other", employeeName: "Avery Holt", locationId: "loc-0306", createdAt: "2026-10-23T13:00:00Z" },
    ];
    expect(
      pickResentDraft(rows, {
        templateKey: "dpoa",
        employeeName: "Avery Holt",
        createdBy: "user-1",
        locationId: "loc-0468",
      }),
    ).toBe("new");
  });

  it("skips revision only when the second-form flag is on", () => {
    const source = readFileSync("src/app/api/chat/route.ts", "utf8");
    expect(source).toContain("secondFormEnabled() && wantsSeparateDocument(parsed.question)");
    const revision = readFileSync("src/lib/forms/chat-revision.ts", "utf8");
    expect(revision).toContain('["coaching", "follow-up-coaching"]');
  });
});

describe("policy citation uses the chunk's printed page", () => {
  const manual = {
    documentId: "doc-manual",
    documentTitle: "JBA Policy Manual",
    matchedBy: "tag" as const,
  };

  it("names Late Opening and page 15 from the chunk, not a guessed page", () => {
    const written = flaggedCitationWrite({
      enabled: true,
      templateKey: "coaching",
      values: { coaching_details: "She opened the salon late." },
      notes: "She was late opening the salon.",
      chunks: [LATE_CHUNK],
      manual,
    });
    expect(written.values.coaching_details).toContain(
      "Policy reference: Late Opening Policy, JBA Policy Manual p.15",
    );
    expect(written.values.coaching_details).not.toContain("Attendance");
  });

  it("omits the page when the chunk does not print one", () => {
    const written = flaggedCitationWrite({
      enabled: true,
      templateKey: "coaching",
      values: { coaching_details: "She opened the salon late." },
      notes: "late opening",
      chunks: [{ chunkIndex: 1, page: null, section: "Late Opening", content: "Late Opening\nOpens on time." }],
      manual,
    });
    expect(written.values.coaching_details).toContain("Late Opening Policy, JBA Policy Manual");
    expect(written.values.coaching_details).not.toMatch(/p\.\d+/);
  });

  it("fills an empty Corrective Action policy line and leaves a filled one alone", () => {
    const filled = flaggedCitationWrite({
      enabled: true,
      templateKey: "dpoa",
      values: { policy_language: "Source: JBA Policy Manual — Attendance, p. 14" },
      notes: "late opening",
      chunks: [LATE_CHUNK],
      manual,
    });
    expect(filled.values.policy_language).toBe("Source: JBA Policy Manual — Attendance, p. 14");
    expect(filled.provenance).toEqual({});

    const empty = flaggedCitationWrite({
      enabled: true,
      templateKey: "dpoa",
      values: { policy_language: "" },
      notes: "she was on her cell phone during the shift",
      chunks: [
        {
          chunkIndex: 9,
          page: 20,
          printedPage: 19,
          section: "Cell Phone/Smart Watch Policy",
          content: "Cell Phone/Smart Watch Policy\n19 | P a g e",
          sections: [{ heading: "Cell Phone/Smart Watch Policy", page: 19 }],
        },
      ],
      manual,
    });
    expect(empty.values.policy_language).toBe("Cell Phone/Smart Watch Policy, JBA Policy Manual p.19");
    expect(empty.provenance.policy_language).toMatchObject({ verified: true, source: "official_policy_manual" });
  });

  it("returns the same values object when the flag is off", () => {
    const values = { coaching_details: "She opened the salon late." };
    const written = flaggedCitationWrite({
      enabled: false,
      templateKey: "coaching",
      values,
      notes: "late opening",
      chunks: [LATE_CHUNK],
      manual,
    });
    expect(written.values).toBe(values);
    expect(written.provenance).toEqual({});
  });
});
