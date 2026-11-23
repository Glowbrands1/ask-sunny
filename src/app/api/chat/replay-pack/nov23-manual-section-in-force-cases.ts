import { expect, vi } from "vitest";

import production from "@/test/fixtures/jba-manual-production-151.json";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE DISABILITY TEXT IS CITED AS DISABILITY ACCOMMODATION, NEVER IMMIGRATION LAW COMPLIANCE (board f109, QA, 23 Nov 2026)
 * ============================================================================
 *
 * Production's manual rows (`jba-manual-production-151.json`, chunks 23–27, put in place of the pinned ones): chunks 24–26
 * are stored under "Immigration Law Compliance" (page 9) though chunk 25's text holds the "Disability Accommodation-
 * Americans with Disability Act" heading line and chunk 26 is all disability text. "what is the policy on disability
 * accommodation" was answered with the disability text labelled "Immigration Law Compliance p.9". The reader now labels
 * each chunk with the section in force, read from the manual's own headings (`withSectionsInForce`), and read_policy's
 * source card names the section read. Control: an immigration question still cites Immigration Law Compliance.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Board f109 (QA, 23 Nov 2026): the Sunny disability text is labelled \"Immigration Law Compliance p.9\"";
const DISABILITY = "Disability Accommodation-Americans with Disability Act";
const IMMIGRATION = "Immigration Law Compliance";

type Row = { chunk_index: number; locator: string; page: number | string | null; section: string | null; content: string; metadata?: { sections?: { heading: string; page: number }[]; printedPage?: number } | null };
/** Production's chunks 23–27, as the manual reader reads them. */
const PRODUCTION_CHUNKS = (production as { chunks: Row[] }).chunks
  .filter((row) => row.chunk_index >= 23 && row.chunk_index <= 27)
  .map((row) => ({
    chunkIndex: row.chunk_index,
    chunkId: `prod-${row.chunk_index}`,
    locator: row.locator,
    page: row.page === null ? null : Number(row.page),
    content: row.content,
    section: row.section,
    printedPage: row.metadata?.printedPage ?? null,
    sections: row.metadata?.sections ?? [],
  }));

async function ask(t: ReplayContext, question: string, heading: string) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.(PRODUCTION_CHUNKS, { inPlace: true });
  /* The reply cites the section's source marker, as the rules book has it, so the source card is shown. */
  const model = loopStandIn((view): LoopDecision => {
    const policy = lastResult(view, "read_policy") as { source?: string } | null;
    return policy ? { text: `Here is what the manual says ${policy.source ?? ""}.` } : { tool: "read_policy", input: { heading } };
  });
  t.loopModel!(model);
  const reply = await t.thread().say(question);
  const read = lastResult(model.views.at(-1)!, "read_policy") as { heading?: string; reason_code?: string } | null;
  const cited = ((reply.citations ?? []) as { locator?: string }[]).map((citation) => citation.locator ?? "");
  return { read, cited };
}

export const NOV23_MANUAL_SECTION_IN_FORCE_CASES: ReplayCase[] = [
  {
    id: "nov23-f109-disability-cited-as-disability",
    title: "f109: \"what is the policy on disability accommodation\" (production's chunks 23–27): the source card names Disability Accommodation, never Immigration Law Compliance",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { read, cited } = await ask(t, "what is the policy on disability accommodation", DISABILITY);
      expect(read?.heading, JSON.stringify(read)).toBe(DISABILITY);
      expect(cited.length, "no source card (the case proves nothing)").toBeGreaterThan(0);
      expect(cited.join(" | "), "the disability text is cited as Immigration Law Compliance").not.toMatch(/Immigration Law Compliance/);
      expect(cited.join(" | ")).toMatch(/Disability Accommodation/);
    },
  },
  {
    id: "nov23-f109-control-immigration-still-immigration",
    title: "Control: an immigration question still cites Immigration Law Compliance",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { read, cited } = await ask(t, "what is the policy on immigration law compliance", IMMIGRATION);
      expect(read?.heading, JSON.stringify(read)).toBe(IMMIGRATION);
      expect(cited.join(" | ")).toMatch(/Immigration Law Compliance/);
    },
  },
];
