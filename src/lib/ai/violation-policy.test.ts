import { describe, expect, it } from "vitest";

import { JBA_MANUAL_CHUNKS } from "@/lib/ai/__fixtures__/jba-policy-manual";
import { expandGlossaryQuery } from "@/lib/ai/glossary";
import { applyRerank } from "@/lib/ai/retrieval-rerank";
import type { ManualChunk } from "@/lib/forms/official-policy-manual";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";
import { selectRecallCandidates, type RecallCandidate } from "@/lib/knowledge/recall-rank";

import { citedSections, withMappedPolicy } from "./violation-policy";

/**
 * Staff describe the violation. Baseline is vector-only with a 0.78 floor.
 * Flags-on expands the glossary, pins the section, and attaches that
 * section's manual text to the form. Haiku is not called.
 *
 * "Client Service Must-See Behaviors" is not a heading in the checked-in
 * manual fixture. The dress-code body is not in that fixture either: the
 * heading is recorded on the Late Opening chunk, whose text is Late Opening.
 * The extra chunks below are synthetic so attachment can be measured.
 */

const PROPOSAL = "I'll draft a **Corrective Action Form**.\n\nCreate the draft here when you're ready.";

const DRESS: ManualChunk = {
  chunkIndex: 900,
  page: 16,
  printedPage: 15,
  section: "Dress Code for The Company",
  content: "Dress Code for The Company\nSynthetic policy wording, dress.",
};

const MUST_SEE: ManualChunk = {
  chunkIndex: 901,
  page: 40,
  section: "Client Service Must-See Behaviors",
  content: "Client Service Must-See Behaviors\nSynthetic policy wording, service.",
};

const CHUNKS: readonly ManualChunk[] = [...JBA_MANUAL_CHUNKS, DRESS, MUST_SEE];

const CASES: { readonly phrase: string; readonly section: string; readonly excerpt: string }[] = [
  {
    phrase: "CA for cleaning duties not completed",
    section: "Standards of Conduct",
    excerpt: "Standards of Conduct\nSynthetic policy wording",
  },
  {
    phrase: "verbal CA for missing the 10/15 woven deadline",
    section: "Standards of Conduct",
    excerpt: "Standards of Conduct\nSynthetic policy wording",
  },
  {
    phrase: "new hire didn't complete policy acknowledgments",
    section: "Standards of Conduct",
    excerpt: "Standards of Conduct\nSynthetic policy wording",
  },
  {
    phrase: "CA for late opening is a verbal warning",
    section: "Late Opening",
    excerpt: "Late Opening\nSynthetic policy wording",
  },
  {
    phrase: "client service must-see behaviors",
    section: "Client Service Must-See Behaviors",
    excerpt: "Synthetic policy wording, service.",
  },
];

function row(section: string, similarity: number, vectorRank: number): RecallCandidate {
  const chunk: MatchedChunkRow = {
    chunk_id: section,
    document_id: "manual",
    document_title: "JBA Policy Manual",
    category: "policies",
    locator: section,
    page: 1,
    section,
    content: "Synthetic policy wording.",
    similarity,
  };
  return { row: chunk, vectorRank, keywordRank: null, sectionExact: false };
}

function pool(wanted: string): RecallCandidate[] {
  return [
    row("Open Door Policy", 0.91, 1),
    row(wanted, 0.55, 2),
    row("Safety in the Workplace", 0.86, 3),
    row("Visitors in the Workplace", 0.84, 4),
    row("Smoking/Vaping", 0.8, 5),
  ];
}

function baseline(candidates: readonly RecallCandidate[]): boolean {
  return candidates.some((candidate) => candidate.row.similarity >= 0.78 && candidate.row.section === candidates[1]?.row.section);
}

function flagsOnHit(query: string, wanted: string): boolean {
  const selected = selectRecallCandidates(pool(wanted), expandGlossaryQuery(query), { limit: 4 });
  const ranked = applyRerank(selected.rows, selected.pinnedIds, selected.pinnedIds);
  return ranked.slice(0, 4).some((item) => item.section === wanted);
}

describe("violation to policy section", () => {
  const table = CASES.map((item) => ({
    phrase: item.phrase,
    section: item.section,
    baselineRecallAt4: baseline(pool(item.section)) ? 1 : 0,
    flagsOnRecallAt4: flagsOnHit(item.phrase, item.section) ? 1 : 0,
    attached: withMappedPolicy(PROPOSAL, [item.phrase], CHUNKS, true).includes(item.excerpt),
  }));

  it("cites the section and attaches its manual text for the reported phrases", () => {
    expect(table.map((item) => item.baselineRecallAt4)).toEqual([0, 0, 0, 0, 0]);
    expect(table.map((item) => item.flagsOnRecallAt4)).toEqual([1, 1, 1, 1, 1]);
    expect(table.every((item) => item.attached)).toBe(true);
    for (const item of CASES) {
      const cited = citedSections([item.phrase]);
      expect(cited.map((section) => section.section)).toEqual([item.section]);
      const attached = withMappedPolicy(PROPOSAL, [item.phrase], CHUNKS, true);
      expect(attached).toContain(`JBA Policy Manual — ${item.section}`);
      expect(attached).toContain(item.excerpt);
      expect(withMappedPolicy(PROPOSAL, [item.phrase], CHUNKS, false)).toBe(PROPOSAL);
    }
  });

  it("keeps the earlier section when the manager adds dress code policy too", () => {
    const turns = ["CA for cleaning duties not completed", "add dress code policy too"];
    expect(citedSections(turns).map((section) => section.section)).toEqual([
      "Standards of Conduct",
      "Dress Code for The Company",
    ]);
    const attached = withMappedPolicy(PROPOSAL, turns, CHUNKS, true);
    expect(attached).toContain("Standards of Conduct\nSynthetic policy wording");
    expect(attached).toContain("Dress Code for The Company\nSynthetic policy wording, dress.");
    expect(attached).toContain("Create the draft here");
  });

  it("maps insubordination, misconduct, and tardiness onto the manual sections", () => {
    expect(citedSections(["insubordination"]).map((section) => section.section)).toEqual(["Standards of Conduct"]);
    expect(citedSections(["general misconduct"]).map((section) => section.section)).toEqual(["Standards of Conduct"]);
    expect(citedSections(["she was tardy again"]).map((section) => section.section)).toEqual(["Attendance"]);
  });

  it("does not invent a client-service or dress-code passage the fixture does not hold", () => {
    expect(
      JBA_MANUAL_CHUNKS.some((chunk) => chunk.section === "Client Service Must-See Behaviors"),
    ).toBe(false);
    expect(
      JBA_MANUAL_CHUNKS.some(
        (chunk) =>
          chunk.section === "Dress Code for The Company" &&
          chunk.content.includes("Dress Code for The Company"),
      ),
    ).toBe(false);
    const cited = withMappedPolicy(PROPOSAL, ["add dress code policy too"], JBA_MANUAL_CHUNKS, true);
    expect(cited).toContain("JBA Policy Manual — Dress Code for The Company (p.15)");
    expect(cited).not.toContain("Synthetic policy wording, dress.");
  });
});
