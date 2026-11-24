import { expect, vi } from "vitest";

import production from "@/test/fixtures/jba-manual-production-151.json";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

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
/** Production's chunks from..to, as the manual reader reads them. */
const productionChunks = (from: number, to: number) => (production as { chunks: Row[] }).chunks
  .filter((row) => row.chunk_index >= from && row.chunk_index <= to)
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
const PRODUCTION_CHUNKS = productionChunks(23, 27);
/*
 * QA's controls (23 Nov 2026), on the two relabels managers' headings lean on most: chunk 121 (stored Time Records, its
 * last Time Records lines then "Schedule Requests/General availability Changes") and chunk 67 (stored Solicitation, its
 * last Solicitation lines then "Care and Cleaning of Equipment and Facilities"), with the chunks around them.
 */
const AROUND_121 = productionChunks(119, 122);
const AROUND_67 = productionChunks(65, 68);

async function ask(t: ReplayContext, question: string, heading: string, chunks = PRODUCTION_CHUNKS) {
  vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.(chunks, { inPlace: true });
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
  {
    id: "nov23-f109-control-time-records-after-shift",
    title: "QA's control (chunk 121): \"she stayed after her shift and didn't clock out\" still cites Time Records with its page, never Schedule Requests",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { read, cited } = await ask(t, "she stayed after her shift and didn't clock out", "Time Records", AROUND_121);
      expect(read?.heading, JSON.stringify(read)).toBe("Time Records");
      expect(cited.length, "no source card (the case proves nothing)").toBeGreaterThan(0);
      expect(cited.join(" | ")).toMatch(/^Page \d+ — Time Records$/);
      expect(cited.join(" | "), "Time Records is cited as Schedule Requests").not.toMatch(/Schedule Requests/);
    },
  },
  {
    id: "nov23-f109-control-time-records-ca-policy-line",
    title: "QA's control (chunk 121): a CA for staying after the shift without clocking out has the Policy line Time Records with its page",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      vi.setSystemTime(new Date("2026-11-22T18:00:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      t.manualAlsoHas?.(AROUND_121, { inPlace: true });
      const account = "Remy stayed after her shift and didn't clock out.";
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : {
        tool: "propose_form",
        input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: evidenceFrom(view, "Remy Calder"), what_happened: account, policy: "Time Records", incident_date: "2026-11-21", warning_level: "written", level_evidence: evidenceFrom(view, "written") },
      })));
      t.draftWrites({ observation: `Observed:\n${account}\n\nExpectation:\nRemy is expected to follow the policy.` });
      const reply = await t.thread().say("written CA for Remy Calder, she stayed after her shift and didn't clock out yesterday");
      const line = String((reply.formProposal as { policyLine?: string } | undefined)?.policyLine ?? "");
      expect(line, "no Policy line (the case proves nothing)").not.toBe("");
      /* Time Records sits under the Standards of Conduct on a CA (as `nov20-agent-loop-rule-not-cleaning-duty` has it). */
      expect(line).toMatch(/^Standards of Conduct \u2014 Time Records, JBA Policy Manual p\.\d+$/);
      expect(line, "Time Records is cited as Schedule Requests").not.toMatch(/Schedule Requests/);
    },
  },
  {
    id: "nov23-f109-control-solicitation-still-solicitation",
    title: "QA's control (chunk 67): a solicitation question still cites Solicitation, never Care and Cleaning",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { read, cited } = await ask(t, "what is the policy on solicitation", "Solicitation", AROUND_67);
      expect(read?.heading, JSON.stringify(read)).toBe("Solicitation");
      expect(cited.length, "no source card (the case proves nothing)").toBeGreaterThan(0);
      expect(cited.join(" | ")).toMatch(/^Page \d+ — Solicitation$/);
    },
  },
  {
    id: "nov23-f109-control-clean-beds-care-and-cleaning",
    title: "QA's control (chunk 67): \"didn't clean the beds\" still cites Care and Cleaning of Equipment and Facilities, p.21",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
      const { read, cited } = await ask(t, "she didn't clean the beds, what policy is that", "Care and Cleaning of Equipment and Facilities", AROUND_67);
      expect(read?.heading, JSON.stringify(read)).toBe("Care and Cleaning of Equipment and Facilities");
      expect(cited.join(" | ")).toBe("Page 21 — Care and Cleaning of Equipment and Facilities");
    },
  },
];
