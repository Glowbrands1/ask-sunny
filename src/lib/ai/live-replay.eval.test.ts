/**
 * Replay cases from the 24 Oct 2026 live run, plus Pau's later rules.
 *
 * How to add a case:
 *   1. Copy an object in CITATIONS or ROSTER.
 *   2. Set id and prompts. Include the live wording, a lowercase phrasing,
 *      and a typo or another date form when the report had one.
 *   3. Set chunks to the manual rows retrieval would return. The page has
 *      to be on the chunk. Do not add a keyword-to-page table.
 *   4. Set roster to the Woven rows the case may match, or [] when the
 *      directory is empty or down. An empty roster keeps a typed person.
 *      A document or policy name is still not an employee.
 *   5. Set expect. The case calls the same functions production uses:
 *      account sections, the citation writer, the roster gate, and the
 *      proposal post-process.
 *
 * Employee names in these fixtures are the anonymised replay name and the
 * names the matcher examples already use.
 */

import { describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";
import { correctiveActionPlan } from "@/lib/forms/ca-action-plan";
import { unconfirmedManualLine } from "@/lib/forms/ca-policy";
import { fieldsToRestore, retainFilledFields, showDraftWithEdits } from "@/lib/forms/draft-merge";
import { pickResentDraft } from "@/lib/forms/draft-reopen";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { isApprovedPolicyManualTitle } from "@/lib/forms/official-policy-manual";
import { manualStandingNotice } from "@/lib/forms/standing-notices";

import { accountManualSections } from "./account-manual-sections";
import feedbackReplayCases from "./__fixtures__/feedback-replay-cases.json";
import { containsPersonalData, type FeedbackReplayCase } from "./feedback-replay";
import { headingFromAccount } from "./intent-slots";
import { actionPlanSentenceCount, collapseToTwoSentences, twoSentenceActionPlan } from "@/lib/forms/action-plan-sentences";
import { factsVisibleInConversation } from "./chat-memory";
import { reviewInventoryLine } from "./chat-data-tools";
import { prependFormState } from "./form-state";
import {
  applyGroundedProposal,
  isDocumentOrPolicyName,
  labelDuplicateQuestion,
  prepareGroundedQuestion,
  type GroundedPerson,
} from "./grounded-entities";
import { uniqueRosterSalon } from "./intake-augment";
import { flaggedCitationWrite, formatManualCitation, pinnedManualBlock } from "./policy-citation-fields";

const LATE: ManualChunk = {
  chunkIndex: 4,
  page: 16,
  printedPage: 99,
  section: "Late Opening",
  content: "Late Opening\nOpens on time.",
  sections: [{ heading: "Late Opening", page: 15 }],
};

const ATTENDANCE: ManualChunk = {
  chunkIndex: 3,
  page: 15,
  printedPage: 99,
  section: "Attendance",
  content: "Attendance\nBe on time for a scheduled shift.",
  sections: [{ heading: "Attendance", page: 14 }],
};

const CONDUCT: ManualChunk = {
  chunkIndex: 2,
  page: 13,
  printedPage: 99,
  section: "Standards of Conduct",
  content: "Standards of Conduct\nEmployees follow the standards.",
  sections: [{ heading: "Standards of Conduct", page: 12 }],
};

const PHONE: ManualChunk = {
  chunkIndex: 9,
  page: 20,
  printedPage: 99,
  section: "Cell Phone/Smart Watch Policy",
  content: "Cell Phone/Smart Watch Policy\nPhones are put away during the shift.",
  sections: [{ heading: "Cell Phone/Smart Watch Policy", page: 19 }],
};

const MANUAL = {
  documentId: "doc-jba",
  documentTitle: "JBA Policy Manual Edited 5.2025",
  matchedBy: "fallback" as const,
};

interface CitationCase {
  readonly id: string;
  readonly prompts: readonly string[];
  readonly chunks: readonly ManualChunk[];
  readonly includes: readonly string[];
  readonly excludes: readonly string[];
}

const CITATIONS: readonly CitationCase[] = [
  {
    id: "late-opening",
    prompts: [
      "She was late opening the salon.",
      "she was late opening the salon on 10/1/2026",
      "late opening on october 1",
    ],
    chunks: [LATE, ATTENDANCE],
    includes: ["Late Opening Policy, JBA Policy Manual p.15"],
    excludes: [],
  },
  {
    id: "ordinary-lateness",
    prompts: ["she was 20 minutes late for her 2pm shift", "SHE WAS 20 MINUTES LATE FOR HER 2PM SHIFT ON 10-1"],
    chunks: [LATE, ATTENDANCE],
    includes: ["Attendance Policy, JBA Policy Manual p.14"],
    excludes: ["Late Opening"],
  },
  {
    id: "standards-of-conduct",
    prompts: [
      "She violated the standards of conduct.",
      "standards of conduct on 10/1/2026",
      "code of conduct",
    ],
    chunks: [CONDUCT, ATTENDANCE],
    includes: ["Standards of Conduct Policy, JBA Policy Manual p.12"],
    excludes: ["Attendance"],
  },
  {
    id: "cell-phone",
    prompts: ["she was on her cell phone during the shift", "CELL PHONE during the shift on October 1"],
    chunks: [PHONE],
    includes: ["Cell Phone/Smart Watch Policy, JBA Policy Manual p.19"],
    excludes: [],
  },
];

function cite(notes: string, chunks: readonly ManualChunk[]): string {
  const written = flaggedCitationWrite({
    enabled: true,
    templateKey: "dpoa",
    values: { policy_language: "" },
    notes,
    chunks,
    manual: MANUAL,
  });
  return written.values.policy_language ?? "";
}

describe("replay citations come from the chunk, and the JBA manual is not re-confirmed", () => {
  it.each(CITATIONS)("$id", (item) => {
    for (const prompt of item.prompts) {
      const line = cite(prompt, item.chunks);
      for (const part of item.includes) expect(line, prompt).toContain(part);
      for (const part of item.excludes) expect(line, prompt).not.toContain(part);
    }
  });

  it("a misspelling of the policy name does not invent a page", () => {
    expect(cite("standads of conduct", [CONDUCT])).toBe("");
  });

  it("the standards page is the page on the chunk, not a fixed number", () => {
    const moved: ManualChunk = {
      ...CONDUCT,
      sections: [{ heading: "Standards of Conduct", page: 12 }],
      printedPage: 99,
    };
    const sections = accountManualSections("standards of conduct", [moved]);
    expect(sections[0]?.page).toBe(12);
    expect(formatManualCitation("Standards of Conduct", sections[0]?.page ?? null)).toBe(
      "Standards of Conduct Policy, JBA Policy Manual p.12",
    );
  });

  it("a fallback match of the JBA manual is approved, and the reply does not ask for confirmation", () => {
    const written = flaggedCitationWrite({
      enabled: true,
      templateKey: "dpoa",
      values: { policy_language: "" },
      notes: "standards of conduct",
      chunks: [CONDUCT],
      manual: MANUAL,
    });
    expect(written.provenance.policy_language).toMatchObject({ ownerConfirmed: true, matchedBy: "fallback" });
    expect(isApprovedPolicyManualTitle("JBA Policy Manual Edited 5.2025")).toBe(true);
    expect(isApprovedPolicyManualTitle("JBA Manual")).toBe(false);
    expect(
      unconfirmedManualLine({
        phrase: "standards of conduct",
        lookup: "found",
        heading: "Standards of Conduct",
        page: 12,
        offenseKey: "standards_of_conduct",
        unconfirmedManual: "JBA Policy Manual",
      }),
    ).toBeNull();
    expect(
      manualStandingNotice([
        {
          fieldKey: "policy_language",
          value: "Standards of Conduct",
          checked: [],
          filledBy: "ai",
          provenance: {
            source: "official_policy_manual",
            matchedBy: "fallback",
            ownerConfirmed: false,
            documentTitle: "JBA Policy Manual Edited 5.2025",
          },
        },
      ]),
    ).toBeNull();
  });

  it("a search answer that resolved a section is told the documents do contain it", () => {
    const block = pinnedManualBlock("she was late opening the salon", [LATE]);
    expect(block).toContain("POLICY FROM THE JBA POLICY MANUAL");
    expect(block).toContain("Late Opening Policy, JBA Policy Manual p.15");
    expect(block).toContain("do not say the documents do not contain it");
  });

  it("flag off returns the same values object", () => {
    const values = { policy_language: "" };
    expect(
      flaggedCitationWrite({
        enabled: false,
        templateKey: "dpoa",
        values,
        notes: "standards of conduct",
        chunks: [CONDUCT],
        manual: MANUAL,
      }).values,
    ).toBe(values);
  });
});

const LAWRENCE: GroundedPerson = {
  id: "m-lawrence",
  firstName: "Larissa",
  lastName: "Venko",
  salonIds: ["loc-0468"],
  title: "Salon Director",
  primaryLocationName: "KS Lawrence",
};

const JOSEPH: GroundedPerson = {
  id: "m-joseph",
  firstName: "Larissa",
  lastName: "Venko",
  salonIds: ["loc-0495"],
  title: "Shift Lead",
  primaryLocationName: "MO St Joseph",
};

const KAITLYN: GroundedPerson = {
  id: "kaitlyn",
  firstName: "Kaitlyn",
  lastName: "Smith",
  salonIds: ["loc-0468"],
  title: "Salon Associate",
  primaryLocationName: "KS Lawrence",
};

function proposal(employeeName: string | null, extra: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "p1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName,
    employeeRole: null,
    locationId: null,
    locationName: null,
    locationResolution: "not_applicable",
    authorizedLocationIds: [],
    status: employeeName ? "ready" : "needs_employee",
    sourceMessageIds: [],
    ...extra,
  };
}

function answer(employeeName: string | null): Parameters<typeof applyGroundedProposal>[0] {
  return {
    content: "I'll draft a form.",
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
    formProposal: proposal(employeeName),
  };
}

describe("replay names resolve against the roster, and a document is not an employee", () => {
  it.each(["JBA Manual", "jba manual", "Standards of Conduct", "standards of conduct"])(
    "%s is a document or a policy",
    (name) => {
      expect(isDocumentOrPolicyName(name)).toBe(true);
    },
  );

  it("a long account that mentions a policy is still an account", () => {
    expect(
      isDocumentOrPolicyName("she opened the salon late and the manager wrote it up yesterday"),
    ).toBe(false);
  });

  it("JBA Manual is cleared as the employee even when the roster is empty, and the words stay", () => {
    const prep = prepareGroundedQuestion({
      question: "create a CA for JBA Manual",
      history: [],
      people: [],
      saved: null,
    });
    expect(prep.question).toContain("JBA Manual");
    const applied = applyGroundedProposal(answer("JBA Manual"), { people: [], prep, rosterEmpty: true });
    expect(applied.formProposal?.employeeName).toBeNull();
    expect(applied.formProposal?.status).toBe("needs_employee");
    expect(applied.content).toContain("names a document or a policy");
  });

  it("two people with the same name are told apart by salon and title", () => {
    const labeled = labelDuplicateQuestion(
      "Did you mean **Larissa Venko** or **Larissa Venko**?",
      [LAWRENCE, JOSEPH],
      "Larissa Venko",
    );
    expect(labeled).toContain("KS Lawrence");
    expect(labeled).toContain("Salon Director");
    expect(labeled).toContain("MO St Joseph");
    expect(labeled).toContain("Shift Lead");
    expect(labeled).toContain("a close match for **Larissa Venko**");
  });

  it.each(["the first one", "1", "keep larissa"])("the choice %s is remembered on the next question", (reply) => {
    const asked = labelDuplicateQuestion(
      "Did you mean **Larissa Venko** or **Larissa Venko**?",
      [LAWRENCE, JOSEPH],
      "Larissa Venko",
    );
    const prep = prepareGroundedQuestion({
      question: reply,
      history: [{ role: "assistant", content: asked }],
      people: [LAWRENCE, JOSEPH],
      saved: null,
    });
    expect(prep.question.startsWith("The employee is ")).toBe(true);
    expect(prep.question.toLowerCase()).not.toContain("the employee is keep");
    if (reply === "keep larissa") expect(prep.keptTypedName).toBe("Larissa Venko");
    else expect(prep.employeeId).toBe(LAWRENCE.id);
  });

  it("Katlin Smith is rewritten to the one close directory name", () => {
    const prep = prepareGroundedQuestion({
      question: "create a coaching form for Katlin Smith",
      history: [],
      people: [KAITLYN],
      saved: null,
    });
    expect(prep.question).toContain("Kaitlyn Smith");
    expect(prep.question).not.toContain("Katlin");
    expect(prep.employeeId).toBe(KAITLYN.id);
  });

  it.each([
    ["st joe", "MO St Joseph"],
    ["lawrence", "KS Lawrence"],
    ["St Joe on 10/1/2026", "MO St Joseph"],
  ])("%s is a salon", (text, salon) => {
    expect(uniqueRosterSalon(text)).toBe(salon);
  });

  it.each(["based", "EFT or spa", "Red Light Visits", "September", "Fitzpatrick Skin Type Chart"])(
    "%s is not a salon",
    (text) => {
      expect(uniqueRosterSalon(text)).toBeNull();
    },
  );
});

describe("replay state, dedupe, reviews, and the two-sentence plan", () => {
  it("a saved warning, payroll answer, and salon are already on the next question", () => {
    const next = prependFormState("anything else?", {
      employeeId: LAWRENCE.id,
      employeeName: "Larissa Venko",
      keptTypedName: null,
      salonId: "loc-0495",
      title: "Shift Lead",
      formDate: "2026-10-01",
      warningLevel: "verbal",
      payrollDeduct: "no",
      policyHeading: "Standards of Conduct",
      policyPage: 12,
      templateKey: "dpoa",
      incident: null,
      incidentType: null,
      payrollAmount: null,
      payrollDeductAmount: null,
    });
    expect(next).toContain("The employee is Larissa Venko.");
    expect(next).toContain("Warning level: verbal.");
    expect(next).toContain("No payroll deduction.");
    expect(next).toContain("It happened at MO St Joseph.");
    expect(next).toContain("Policy reference: Standards of Conduct, JBA Policy Manual p.12.");
  });

  it("an identical incident reopens, a different incident does not, and a different date does not", () => {
    const rows = [
      {
        id: "old",
        employeeName: "Larissa Venko",
        locationId: "loc-0468",
        createdAt: "2026-10-23T12:00:00Z",
        narrative: "She was late opening the salon on October 1.",
        formDate: "2026-10-01",
      },
    ];
    const same = {
      templateKey: "dpoa",
      employeeName: "larissa venko",
      createdBy: "manager",
      locationId: "loc-0468",
    };
    expect(pickResentDraft(rows, { ...same, incident: "She was late opening the salon on October 1." })).toBe("old");
    expect(pickResentDraft(rows, { ...same, incident: "She was on her cell phone during the shift." })).toBeNull();
    expect(
      pickResentDraft(rows, {
        ...same,
        incident: "She was late opening the salon on October 1.",
        formDate: "2026-10-02",
      }),
    ).toBeNull();
    expect(pickResentDraft(rows, same)).toBe("old");
  });

  it("employee memory from another chat stays out, and a salon fact stays", () => {
    const visible = factsVisibleInConversation(
      [
        { kind: "employee", key: "employee", value: "Larissa Venko", sourceConversationId: "other" },
        { kind: "salon", key: "salon", value: "KS Lawrence", sourceConversationId: "other" },
      ],
      "this-chat",
    );
    expect(visible.map((fact) => fact.kind)).toEqual(["salon"]);
  });

  it("the review inventory is the page total, not the weekly qualifying count", () => {
    expect(reviewInventoryLine(254, false)).toBe(
      "The Google Reviews page holds 254 reviews in total. That is the inventory total, not the count of reviews that qualify this week.",
    );
    expect(reviewInventoryLine(12, true)).toContain("for the salons in this account");
  });

  it("show draft with edits keeps a filled offense and action plan", () => {
    expect(showDraftWithEdits("show draft with edits")).toBe(true);
    expect(showDraftWithEdits("SHOW the DRAFT WITH EDITS")).toBe(true);
    const existing = [
      { fieldKey: "offense_type", value: null, checked: ["tardiness"] },
      { fieldKey: "action_plan", value: "Management will review Attendance with Larissa.", checked: [] },
    ];
    const kept = retainFilledFields({
      question: "show draft with edits",
      existing,
      values: { action_plan: "" },
      checked: { offense_type: [] },
    });
    expect(kept.checked.offense_type).toBeUndefined();
    expect(kept.values.action_plan).toBeUndefined();
    const restored = fieldsToRestore({
      question: "show draft with edits",
      before: existing,
      after: [
        { fieldKey: "offense_type", value: null, checked: [] },
        { fieldKey: "action_plan", value: "", checked: [] },
      ],
    });
    expect(restored.checked.offense_type).toEqual(["tardiness"]);
    expect(restored.values.action_plan).toContain("Management will review");
    const cleared = retainFilledFields({
      question: "please clear the offense and clear the action plan",
      existing,
      values: { action_plan: "" },
      checked: { offense_type: [] },
    });
    expect(cleared.checked.offense_type).toEqual([]);
    expect(cleared.values.action_plan).toBe("");
  });

  it("the action plan is two sentences when payroll is yes, and the existing builder still writes the payroll sentence", () => {
    const input = {
      citedPolicies: ["Standards of Conduct"],
      policyViolated: null,
      employeeName: "Larissa Venko",
      payroll: { answer: "yes" as const, amount: "$25.00" },
    };
    const two = twoSentenceActionPlan(input);
    expect(actionPlanSentenceCount(two)).toBe(2);
    expect(two).not.toMatch(/deduct/i);
    expect(two).toContain("Management will review");
    expect(two).toContain("Future policy violations may result");
    const three = correctiveActionPlan(input);
    expect(actionPlanSentenceCount(three)).toBe(3);
    expect(actionPlanSentenceCount(collapseToTwoSentences(three))).toBe(2);
    expect(collapseToTwoSentences(three)).not.toMatch(/deduct/i);
  });
});

const FEEDBACK_CASES = feedbackReplayCases as FeedbackReplayCase[];

describe("every exported feedback replay case is checked", () => {
  it("has cases to check", () => {
    expect(FEEDBACK_CASES.length).toBeGreaterThan(0);
  });

  it.each(FEEDBACK_CASES)("$id rating $rating", (item) => {
    expect(item.rating).toBeGreaterThanOrEqual(1);
    expect(item.rating).toBeLessThanOrEqual(4);
    expect(item.prompts.length).toBeGreaterThan(0);
    for (const prompt of item.prompts) {
      expect(prompt.trim().length).toBeGreaterThan(0);
      expect(containsPersonalData(prompt)).toBe(false);
    }
    expect(item.answer.trim().length).toBeGreaterThan(0);
    expect(containsPersonalData(item.answer)).toBe(false);
    if (item.note) expect(containsPersonalData(item.note)).toBe(false);
    if (item.expectHeading) {
      expect(headingFromAccount(item.prompts.join("\n"), item.headings ?? [])).toBe(item.expectHeading);
    }
  });
});
