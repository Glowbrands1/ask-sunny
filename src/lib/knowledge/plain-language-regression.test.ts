import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { hybridSearchEnabled } from "@/lib/config/chat-quality-flags";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import { selectHybridMatches, type HybridCandidate } from "@/lib/knowledge/hybrid-rank";

import { expandPolicyQuery, orderPolicyRetrieval, policySectionsFor } from "./policy-retrieval";

/**
 * Round 1 QA. The 17 prompts are the table in the validation report.
 * Hybrid search runs in this process only. The production flag stays off.
 *
 * Before is vector order, the path production uses while the flag is off.
 * After is the expanded query, hybrid rank, then the manual order.
 */

const REPORT = "research/reports/full-validation-2026-10-24.md";

interface Case {
  readonly n: number;
  readonly prompt: string;
  readonly section: string;
  readonly page: number;
}

function casesFromReport(): Case[] {
  const text = readFileSync(REPORT, "utf8");
  const parsed = [...text.matchAll(/^\| (\d+) \| (.+?) \| (.+?) \| (\d+) \|$/gm)].map((match) => ({
    n: Number(match[1]),
    prompt: match[2]!,
    section: match[3]!,
    page: Number(match[4]),
  }));
  return parsed;
}

function row(input: {
  id: string;
  title: string;
  section: string;
  page: number;
  similarity: number;
  content?: string;
}): MatchedChunkRow {
  return {
    chunk_id: input.id,
    document_id: input.id,
    document_title: input.title,
    category: input.title.toLowerCase().includes("jba policy manual") ? "policies_compliance" : "leadership_coaching",
    locator: `Page ${input.page} — ${input.section}`,
    page: input.page,
    section: input.section,
    content: input.content ?? `${input.section}\nThe company rule for this section.`,
    similarity: input.similarity,
  };
}

function distractor(index: number, similarity: number): MatchedChunkRow {
  return row({
    id: `training-${index}`,
    title: index % 2 === 0 ? "DM Training Manual" : "Ask Sunny Performance Framework",
    section: "Verbal Warnings",
    page: index + 1,
    similarity,
    content: `Training note ${index}. Verbal warning. Coaching comes first.`,
  });
}

function manual(section: string, page: number, id: string, similarity: number): MatchedChunkRow {
  return row({
    id,
    title: "JBA Policy Manual Edited 5.2025",
    section,
    page,
    similarity,
    content: `${section}\nThe company rule for this section.`,
  });
}

/** Vector top 14. Rank is 1-based, or null when the section is not in that window. */
function vectorRank(rows: readonly MatchedChunkRow[], section: string): number | null {
  const top = [...rows].sort((a, b) => b.similarity - a.similarity).slice(0, 14);
  const index = top.findIndex((hit) => hit.section === section);
  return index === -1 ? null : index + 1;
}

function afterRank(rows: readonly MatchedChunkRow[], prompt: string, section: string): number | null {
  const expanded = expandPolicyQuery(prompt);
  const candidates: HybridCandidate[] = [...rows]
    .sort((a, b) => b.similarity - a.similarity)
    .map((hit, index) => ({ row: hit, vectorRank: index + 1, keywordRank: null, sectionExact: false }));
  const hybrid = selectHybridMatches(candidates, expanded, { vectorFloor: 0.78, limit: 14 });
  const ordered = orderPolicyRetrieval(hybrid, prompt, 14);
  const index = ordered.findIndex((hit) => hit.section === section);
  return index === -1 ? null : index + 1;
}

/**
 * The 24 Oct check: Dress Code and Standards of Conduct missed the top 14.
 * Attendance for "tardy" sat at 6. Training manuals outrank the manual on cosine.
 */
function validationPool(section: string, page: number, kind: "miss" | "sixth"): MatchedChunkRow[] {
  if (kind === "miss") {
    const noise = Array.from({ length: 14 }, (_, index) => distractor(index, 0.99 - index * 0.005));
    return [...noise, manual(section, page, "ce6b00f1", 0.8), manual(section, page, "5c626f3c", 0.79)];
  }
  const ahead = Array.from({ length: 5 }, (_, index) => distractor(index, 0.97 - index * 0.01));
  const behind = Array.from({ length: 7 }, (_, index) => distractor(index + 5, 0.84 - index * 0.01));
  return [
    ...ahead,
    manual(section, page, "ce6b00f1", 0.86),
    manual(section, page, "5c626f3c", 0.85),
    ...behind,
  ];
}

function rankLabel(rank: number | null): string {
  return rank === null ? "not in top 14" : `#${rank}`;
}

describe("round 1 plain-language regression, local hybrid harness", () => {
  const cases = casesFromReport();

  it("reads 17 cases and leaves hybrid search off", () => {
    expect(cases).toHaveLength(17);
    expect(cases.map((item) => item.n)).toEqual(Array.from({ length: 17 }, (_, index) => index + 1));
    expect(hybridSearchEnabled()).toBe(false);
    expect(process.env.HYBRID_SEARCH_ENABLED).toBeUndefined();
  });

  it.each(cases)("#$n $prompt → $section p.$page", (item) => {
    expect(policySectionsFor(item.prompt)).toContain(item.section);
    const pool = [
      distractor(1, 0.97),
      manual(item.section, item.page, "ce6b00f1", 0.9),
      manual(item.section, item.page, "5c626f3c", 0.88),
    ];
    expect(afterRank(pool, item.prompt, item.section)).toBe(1);
  });

  it("shows before and after ranks for Dress Code, Standards of Conduct, and tardy Attendance", () => {
    const dress = cases.find((item) => item.n === 3)!;
    const conduct = cases.find((item) => item.n === 5)!;
    const tardy = cases.find((item) => item.prompt === "employee was tardy")!;
    const shown = [
      { item: dress, pool: validationPool(dress.section, dress.page, "miss"), before: null },
      { item: conduct, pool: validationPool(conduct.section, conduct.page, "miss"), before: null },
      { item: tardy, pool: validationPool(tardy.section, tardy.page, "sixth"), before: 6 },
    ] as const;

    const lines = shown.map(({ item, pool, before }) => {
      const vector = vectorRank(pool, item.section);
      const after = afterRank(pool, item.prompt, item.section);
      expect(vector, item.section).toBe(before);
      expect(after, item.prompt).toBe(1);
      return `${item.section} (${item.prompt})\n  before ${rankLabel(vector)}\n  after  ${rankLabel(after)}`;
    });
    expect(lines).toEqual([
      "Dress Code for The Company (write a CA … slippers and the wrong uniform)\n  before not in top 14\n  after  #1",
      "Standards of Conduct (CA for insubordination, she did not acknowledge policies at onboarding)\n  before not in top 14\n  after  #1",
      "Attendance (employee was tardy)\n  before #6\n  after  #1",
    ]);
    expect(policySectionsFor("the store opened late")).toEqual(["Late Opening"]);
    expect(policySectionsFor("policy acknowledgements")).toEqual(["Standards of Conduct"]);
    expect(hybridSearchEnabled()).toBe(false);
  });
});
