import { describe, expect, it } from "vitest";

import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import { manualTopicPinEnabled } from "@/lib/config/chat-quality-flags";

import { expandPolicyQuery, manualTopicSections, pinManualTopicRows, policySectionsFor } from "./policy-retrieval";

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
  sections?: readonly { heading: string; page: number }[];
}): ManualChunk {
  return {
    chunkIndex: input.index,
    chunkId: `chunk-${input.index}`,
    page: input.index,
    locator: input.section ? `Page 37 — ${input.section}` : "Page 37",
    section: input.section,
    sections: input.sections ?? (input.section ? [{ heading: input.section, page: 37 }] : []),
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
    section: "Paid time Off (PTO)",
    content: "Paid time Off (PTO)\nPTO replaces sick, absence, personal and vacation time.",
  }),
  chunk({
    index: 137,
    section: null,
    content: "Employees accrue PTO after the introductory period.",
  }),
  chunk({
    index: 139,
    section: "Usage",
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
  it.each([QUESTIONS.timeOff, QUESTIONS.requestOff, QUESTIONS.sick])("%s pins PTO, Usage and Schedule Requests", (question) => {
    expect(manualTopicSections(question)).toEqual([
      "Paid time Off (PTO)",
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
    expect(rows.map((row) => row.chunk_id)).toEqual(["chunk-121", "chunk-136", "chunk-137", "chunk-139"]);
    expect(rows.every((row) => row.similarity === 0)).toBe(true);
    expect(rows.every((row) => row.document_id === "ce6b00f1-ff30-565f-b446-53fd268a1695")).toBe(true);
    expect(rows.some((row) => row.section === "Vehicle Fleet Usage Policy and Guidelines")).toBe(false);
    expect(rows.some((row) => row.section === "Shift Replacement")).toBe(false);
    expect(rows.some((row) => /table of contents/i.test(row.content))).toBe(false);
  });

  it.each([QUESTIONS.sick, QUESTIONS.requestOff])("%s includes the same sections", (question) => {
    expect(pin(question).map((row) => row.chunk_id)).toEqual(["chunk-121", "chunk-136", "chunk-137", "chunk-139"]);
  });

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
