import { afterEach, describe, expect, it } from "vitest";

import { assembleGrounding } from "@/lib/ai/grounding-assembly";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import { manualTopicPinEnabled } from "@/lib/config/chat-quality-flags";

import {
  expandPolicyQuery,
  manualTopicSections,
  manualTopicSectionsForTurn,
  pinManualTopic,
  pinManualTopicRows,
  policySectionsFor,
  topicPinPolicyNote,
} from "./policy-retrieval";

/**
 * The four questions from the 24 Oct 2026 retrieval miss. The wording is
 * theirs. The right JBA sections rank past the top 20, so the pin reads
 * the manual by heading instead of by similarity.
 */

const QUESTIONS = {
  timeOff: "How do I request time off?",
  requestOff: "Can I request off next Friday?",
  sick: "How many sick days do I get?",
  w2: "How do I get my W-2?",
  deposit: "How do I update my direct deposit?",
} as const;

function chunk(input: {
  index: number;
  section: string | null;
  content: string;
  locator?: string;
  page?: number;
  sections?: readonly { heading: string; page: number }[];
}): ManualChunk {
  const printed = input.sections?.[0]?.page;
  return {
    chunkIndex: input.index,
    chunkId: `chunk-${input.index}`,
    page: input.page ?? input.index,
    locator:
      input.locator ??
      (input.section ? `Page ${printed && printed > 0 ? printed : 37} — ${input.section}` : "Page 37"),
    section: input.section,
    sections: input.sections ?? (input.section ? [{ heading: input.section, page: printed && printed > 0 ? printed : 37 }] : []),
    content: input.content,
  };
}

/** Chunk 121 as production stores it: labelled Time Records, Schedule Requests buried in the text. */
const MISLABELLED: readonly ManualChunk[] = [
  chunk({
    index: 50,
    section: "Vehicle Fleet Usage Policy and Guidelines",
    content: "Vehicle Fleet Usage Policy and Guidelines\nCompany vehicles are for work.",
  }),
  chunk({
    index: 121,
    section: "Time Records",
    sections: [{ heading: "Time Records", page: 37 }],
    content:
      "Time Records\nEmployees record their own time.\nSchedule Requests/General availability Changes 37\nRequests are submitted in advance.",
  }),
  chunk({
    index: 122,
    section: "Shift Replacement",
    content: "Shift Replacement\nAn employee who cannot work a shift arranges cover.",
  }),
  chunk({
    index: 136,
    section: "Employee Benefits",
    sections: [
      { heading: "Employee Benefits", page: 41 },
      { heading: "Paid time Off (PTO)", page: 41 },
    ],
    content:
      "Employee Benefits\nPaid time Off (PTO)\nPTO replaces sick, absence, personal and vacation time.",
  }),
  chunk({
    index: 137,
    section: "Eligibility",
    sections: [
      { heading: "Eligibility", page: 41 },
      { heading: "Provisions", page: 41 },
    ],
    content:
      "Eligibility\nProvisions\nEmployees begin accruing PTO after 90 days. Full-time employees accrue 2 weeks (80 hours).",
  }),
  chunk({
    index: 138,
    section: null,
    content:
      "Employees with 5-9 years of service accrue additional PTO. Employees with 10 or more years accrue the top tier.",
  }),
  chunk({
    index: 139,
    section: "Usage",
    sections: [{ heading: "Usage", page: 42 }],
    content: "Usage\nPTO is requested before the day it is used.",
  }),
  chunk({
    index: 12,
    section: null,
    content:
      "Table of Contents\nAccessing W-2's................................................................\nPay Periods........................................................................\nPaid time Off (PTO)........................................................",
  }),
];

function pin(question: string, chunks: readonly ManualChunk[] = MISLABELLED) {
  return pinManualTopicRows({
    question,
    documentId: "ce6b00f1-ff30-565f-b446-53fd268a1695",
    documentTitle: "JBA Policy Manual Edited 5.2025",
    documentCategory: "policies_compliance",
    chunks,
  });
}

describe("flags off leave the existing policy map alone", () => {
  it("does not treat the four questions as corrective-action synonyms", () => {
    expect(manualTopicPinEnabled()).toBe(false);
    for (const question of Object.values(QUESTIONS)) {
      expect(policySectionsFor(question)).toEqual([]);
      expect(expandPolicyQuery(question)).toBe(question);
    }
  });
});

describe("the topic map names the manual sections", () => {
  it.each([QUESTIONS.timeOff, QUESTIONS.requestOff, QUESTIONS.sick])("%s pins PTO, Eligibility, Usage and Schedule Requests", (question) => {
    expect(manualTopicSections(question)).toEqual([
      "Paid time Off (PTO)",
      "Eligibility",
      "Provisions",
      "Usage",
      "PTO Usage",
      "Schedule Requests/General availability Changes",
    ]);
  });

  it("maps W-2 and direct deposit to their own sections", () => {
    expect(manualTopicSections(QUESTIONS.w2)).toEqual(["Accessing W-2's"]);
    expect(manualTopicSections(QUESTIONS.deposit)).toEqual(["Pay Periods"]);
    expect(manualTopicSections("How do I update my paycheck?")).toEqual(["Pay Periods"]);
    expect(manualTopicSections("what's the smoking policy?")).toEqual([]);
  });
});

describe("a matching topic includes those sections even when the label is wrong", () => {
  it("includes the Time Records chunk that prints Schedule Requests, and not the fleet policy", () => {
    const rows = pin(QUESTIONS.timeOff);
    expect(rows.map((row) => row.chunk_id)).toEqual([
      "chunk-121",
      "chunk-136",
      "chunk-137",
      "chunk-138",
      "chunk-139",
    ]);
    expect(rows.every((row) => row.similarity === 0)).toBe(true);
    expect(rows.every((row) => row.document_id === "ce6b00f1-ff30-565f-b446-53fd268a1695")).toBe(true);
    expect(rows.some((row) => row.section === "Vehicle Fleet Usage Policy and Guidelines")).toBe(false);
    expect(rows.some((row) => row.section === "Shift Replacement")).toBe(false);
    expect(rows.some((row) => /table of contents/i.test(row.content))).toBe(false);
  });

  it.each([QUESTIONS.sick, QUESTIONS.requestOff, "How much PTO do I accrue?"])(
    "%s includes accrual and eligibility, not only the PTO heading",
    (question) => {
      const rows = pin(question);
      expect(rows.map((row) => row.chunk_id)).toEqual([
        "chunk-121",
        "chunk-136",
        "chunk-137",
        "chunk-138",
        "chunk-139",
      ]);
      expect(rows.some((row) => row.content.includes("after 90 days"))).toBe(true);
      expect(rows.some((row) => row.content.includes("10 or more years"))).toBe(true);
      expect(rows.some((row) => row.section === "Eligibility")).toBe(true);
    },
  );

  it("includes Accessing W-2's and Pay Periods from the manual's own headings", () => {
    const manual = [
      ...MISLABELLED,
      chunk({
        index: 119,
        section: "Liquidating 401K",
        sections: [
          { heading: "Liquidating 401K", page: 36 },
          { heading: "Accessing W-2’s", page: 36 },
        ],
        content: "Liquidating 401K\nA former employee asks payroll.",
      }),
      chunk({
        index: 126,
        section: "Pay Periods",
        content: "Pay Periods\nEmployees are required to use direct deposit through Paycor.",
      }),
    ];
    expect(pin(QUESTIONS.w2, manual).map((row) => row.chunk_id)).toEqual(["chunk-119"]);
    expect(pin(QUESTIONS.deposit, manual).map((row) => row.section)).toEqual(["Pay Periods"]);
  });

  it("reads the same headings out of the indexed manual fixture", () => {
    const input = {
      documentId: JBA_MANUAL_DOCUMENT.id,
      documentTitle: JBA_MANUAL_DOCUMENT.title,
      documentCategory: JBA_MANUAL_DOCUMENT.category,
      chunks: JBA_MANUAL_CHUNKS,
    };
    expect(pinManualTopicRows({ ...input, question: QUESTIONS.timeOff }).map((row) => row.chunk_id)).toEqual([
      "jba-81",
      "jba-90",
    ]);
    expect(pinManualTopicRows({ ...input, question: QUESTIONS.w2 }).map((row) => row.chunk_id)).toEqual(["jba-79"]);
    expect(pinManualTopicRows({ ...input, question: QUESTIONS.deposit }).map((row) => row.section)).toEqual([
      "Pay Periods",
    ]);
    expect(pinManualTopicRows({ ...input, question: "what's the smoking policy?" })).toEqual([]);
  });
});

describe("a form or a corrective action does not take a topic pin", () => {
  const writeUp = "Create a verbal corrective action for Jordan Lee for paycheck fraud.";

  it("still maps paycheck on a chat question, and does not map it on a write-up", () => {
    expect(policySectionsFor(writeUp)).toEqual([]);
    expect(expandPolicyQuery(writeUp)).toBe(writeUp);
    expect(manualTopicSections(writeUp)).toEqual(["Pay Periods"]);
    expect(manualTopicSectionsForTurn({ question: writeUp })).toEqual([]);
    expect(manualTopicSectionsForTurn({ question: "How do I update my paycheck?" })).toEqual(["Pay Periods"]);
    expect(
      manualTopicSectionsForTurn({
        question: QUESTIONS.deposit,
        formOrCorrectiveAction: true,
      }),
    ).toEqual([]);
    expect(manualTopicSectionsForTurn({ question: QUESTIONS.deposit })).toEqual(["Pay Periods"]);
  });
});

describe("flag on does not pin cell phone or attendance", () => {
  const previous = process.env.MANUAL_TOPIC_PIN_ENABLED;

  afterEach(() => {
    if (previous === undefined) delete process.env.MANUAL_TOPIC_PIN_ENABLED;
    else process.env.MANUAL_TOPIC_PIN_ENABLED = previous;
  });

  it("leaves printed page 19 and printed page 14 unpinned", () => {
    process.env.MANUAL_TOPIC_PIN_ENABLED = "1";
    expect(manualTopicPinEnabled()).toBe(true);
    const cell = "What does the cell phone policy say?";
    const attendance = "What does the attendance policy say?";
    expect(manualTopicSections(cell)).toEqual([]);
    expect(manualTopicSections(attendance)).toEqual([]);
    const pages = [
      chunk({
        index: 43,
        section: "Cell Phone/Smart Watch Policy",
        locator: "Page 19 — Cell Phone/Smart Watch Policy",
        sections: [{ heading: "Cell Phone/Smart Watch Policy", page: 19 }],
        content: "Cell Phone/Smart Watch Policy\nPhones stay off the sales floor.",
      }),
      chunk({
        index: 33,
        section: "Attendance",
        locator: "Page 14 — Attendance",
        sections: [{ heading: "Attendance", page: 14 }],
        content: "Attendance\nA late arrival is recorded.",
      }),
    ];
    expect(pin(cell, pages)).toEqual([]);
    expect(pin(attendance, pages)).toEqual([]);
    expect(pin(QUESTIONS.timeOff, pages)).toEqual([]);
  });
});

describe("a pinned W-2 section stays in the answer and is not called missing", () => {
  it("puts chunk 119 ahead of a full evidence window and names its printed page", () => {
    const input = {
      documentId: JBA_MANUAL_DOCUMENT.id,
      documentTitle: JBA_MANUAL_DOCUMENT.title,
      documentCategory: JBA_MANUAL_DOCUMENT.category,
      chunks: JBA_MANUAL_CHUNKS,
    };
    const pinned = pinManualTopic({ ...input, question: QUESTIONS.w2 });
    expect(pinned.rows.map((row) => row.chunk_id)).toEqual(["jba-79"]);
    expect(pinned.sections).toEqual([{ heading: "Accessing W-2’s", page: 36 }]);
    const retrieved = Array.from({ length: 12 }, (_, index) => ({
      chunk_id: `other-${index}`,
      document_id: "myglow",
      document_title: "myGlow Guide",
      category: "operations",
      locator: `Page ${index + 1}`,
      page: index + 1,
      section: null,
      content: "Another document.",
      similarity: 0.99,
    }));
    const assembled = assembleGrounding({
      mandatory: pinned.rows,
      retrieved,
      roleDocumentIds: [],
      evidenceBudget: 12,
    });
    expect(assembled.rows[0]?.chunk_id).toBe("jba-79");
    const note = topicPinPolicyNote({
      documentTitle: JBA_MANUAL_DOCUMENT.title,
      pin: pinned,
      used: assembled.rows,
    });
    expect(note).toContain("Accessing W-2");
    expect(note).toContain("page 36");
    expect(note).toContain("Do not say the manual as a whole is silent");
    expect(note).not.toContain("page 0");
  });

  it("does not invent page 0 when the heading has no page", () => {
    const pinned = pinManualTopic({
      question: QUESTIONS.w2,
      documentId: "ce6b00f1-ff30-565f-b446-53fd268a1695",
      documentTitle: "JBA Policy Manual Edited 5.2025",
      chunks: [
        chunk({
          index: 119,
          section: "Accessing W-2's",
          locator: "Accessing W-2's",
          page: 0,
          sections: [{ heading: "Accessing W-2's", page: 0 }],
          content: "Accessing W-2's\nPaycor lists the form.",
        }),
      ],
    });
    expect(pinned.rows).toHaveLength(1);
    expect(pinned.sections).toEqual([]);
    expect(
      topicPinPolicyNote({
        documentTitle: "JBA Policy Manual Edited 5.2025",
        pin: pinned,
        used: pinned.rows,
      }),
    ).toBeNull();
  });
});
