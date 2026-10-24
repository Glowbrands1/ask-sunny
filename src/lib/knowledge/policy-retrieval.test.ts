import { describe, expect, it } from "vitest";

import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import { selectHybridMatches, type HybridCandidate } from "@/lib/knowledge/hybrid-rank";

import { expandPolicyQuery, orderPolicyRetrieval } from "./policy-retrieval";

/**
 * The six plain-language prompts from the 24 Oct 2026 retrieval check.
 * Hybrid search ranks them. Identical JBA copies collapse to one slot, and
 * the mapped section leads. A training-manual neighbor does not.
 */

const PROMPTS: readonly { readonly prompt: string; readonly section: string; readonly page: number }[] = [
  { prompt: "I need a CA for someone opening the store late", section: "Late Opening", page: 15 },
  { prompt: "CA for late opening is a verbal warning", section: "Late Opening", page: 15 },
  { prompt: "write a CA … slippers and the wrong uniform", section: "Dress Code for The Company", page: 15 },
  { prompt: "employee was tardy, showed up late for shift again", section: "Attendance", page: 14 },
  {
    prompt: "CA for insubordination, she did not acknowledge policies at onboarding",
    section: "Standards of Conduct",
    page: 12,
  },
  { prompt: "CA for using her cell phone on the floor", section: "Cell Phone/Smart Watch Policy", page: 19 },
];

function row(input: {
  id: string;
  title: string;
  section: string;
  page: number;
  similarity: number;
  content: string;
}): MatchedChunkRow {
  return {
    chunk_id: input.id,
    document_id: input.id,
    document_title: input.title,
    category: "policies_compliance",
    locator: `Page ${input.page} — ${input.section}`,
    page: input.page,
    section: input.section,
    content: input.content,
    similarity: input.similarity,
  };
}

function pool(section: string, page: number): HybridCandidate[] {
  const text = `${section}\nThe company rule for this section.`;
  const copyA = row({
    id: "ce6b00f1",
    title: "JBA Policy Manual Edited 5.2025",
    section,
    page,
    similarity: 0.9,
    content: text,
  });
  const copyB = row({
    id: "5c626f3c",
    title: "JBA Policy Manual 2025 — 2025 JBA Policy Manual Master - Edited 5-2025 with acknowledgement",
    section,
    page,
    similarity: 0.88,
    content: text,
  });
  const framework = row({
    id: "framework",
    title: "Ask Sunny Performance Framework",
    section: "Verbal Warnings",
    page: 4,
    similarity: 0.97,
    content: "Verbal warning. Coaching comes first.",
  });
  framework.category = "leadership_coaching";
  return [
    { row: framework, vectorRank: 1, keywordRank: null, sectionExact: false },
    { row: copyA, vectorRank: 2, keywordRank: 2, sectionExact: false },
    { row: copyB, vectorRank: 3, keywordRank: 3, sectionExact: false },
  ];
}

describe("hybrid search for the six corrective-action prompts", () => {
  it.each(PROMPTS)("$prompt reaches $section and keeps one manual copy", (item) => {
    const expanded = expandPolicyQuery(item.prompt);
    expect(expanded.toLowerCase()).toContain(item.section.toLowerCase());
    const hybrid = selectHybridMatches(pool(item.section, item.page), expanded, { vectorFloor: 0.78, limit: 14 });
    const ordered = orderPolicyRetrieval(hybrid, item.prompt, 14);
    expect(ordered[0]).toMatchObject({ section: item.section, page: item.page });
    expect(ordered.filter((hit) => hit.section === item.section)).toHaveLength(1);
    expect(ordered.every((hit) => /jba policy manual/i.test(hit.document_title))).toBe(true);
    expect(ordered.some((hit) => hit.chunk_id === "framework")).toBe(false);
  });

  it("leaves a non-policy question's other documents in place", () => {
    const rows = pool("Late Opening", 15).map((candidate) => candidate.row);
    const ordered = orderPolicyRetrieval(rows, "what time do we open on Sunday", rows.length);
    expect(ordered.some((hit) => hit.chunk_id === "framework")).toBe(true);
    expect(ordered.filter((hit) => hit.section === "Late Opening")).toHaveLength(1);
  });

  it("boosts the manual for a policy question and keeps the coaching guide after it", () => {
    const rows = pool("Attendance", 14).map((candidate) => candidate.row);
    const ordered = orderPolicyRetrieval(
      rows,
      "In the JBA Policy Manual Edited 5.2025, what does the attendance or tardiness policy say?",
      rows.length,
    );
    expect(ordered[0]).toMatchObject({ section: "Attendance", page: 14 });
    expect(ordered.some((hit) => hit.chunk_id === "framework")).toBe(true);
    expect(ordered.filter((hit) => hit.section === "Attendance")).toHaveLength(1);
  });
});
