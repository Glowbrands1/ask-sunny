import { expect, vi } from "vitest";

import production from "@/test/fixtures/jba-manual-production-151.json";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * THE QUOTED POLICY FITS THE OFFENSE, AND NO PLACE IS ADDED (QA's live check, 20 Nov 2026; items 16-17)
 * ============================================================================
 *
 * The live Test Testy draft (a0f593bc), on the real Create path (createInlineForm → POST /api/forms/instances → POST
 * …/draft; the drafting model is a stand-in that writes what the live one wrote). Names invented.
 * 16. A CA card citing "All Locations Dress Code" p.15 for a mini-skirt account saved "Direct policy from official
 *     manual" as the NAME TAGS paragraph, the first thing under that heading. The pinned manual here is production's own
 *     dress code rows (chunks 44-48 of `jba-manual-production-151.json`).
 * 17. The write-up added "at the salon", which the manager never said.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's live check (20 Nov 2026): Direct policy quoted the name tags paragraph, and the write-up added \"at the salon\"";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Row = (typeof production.chunks)[number];
const DRESS_CODE_ROWS = production.chunks
  .filter((row: Row) => row.chunk_index >= 44 && row.chunk_index <= 48)
  .map((row: Row) => ({
    chunkIndex: row.chunk_index,
    chunkId: `jba-${row.chunk_index}`,
    locator: row.locator,
    page: row.page,
    printedPage: row.metadata.printedPage,
    section: row.section,
    sections: row.metadata.sections,
    content: row.content,
  }));

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-16T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  t.manualAlsoHas?.(DRESS_CODE_ROWS);
}

async function created(t: ReplayContext, said: string, whatHappened: string, observation: string) {
  t.loopModel!(loopStandIn((view): LoopDecision => lastResult(view, "propose_form")
    ? { text: "Here's the Corrective Action Form for **Remy**." }
    : {
        tool: "propose_form",
        input: {
          template_key: "dpoa",
          employee_name: "Remy Calder",
          person_evidence: evidenceFrom(view, "Remy Calder"),
          what_happened: whatHappened,
          policy: "All Locations Dress Code",
          incident_date: "2026-09-12",
        },
      }));
  t.draftWrites({ observation });
  const thread = t.thread();
  await thread.say(said);
  const id = await thread.create();
  return t.values(id);
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

const SKIRT = "ca for Remy Calder, she was wearing a mini skirt on 9/12";
const SKIRT_ACCOUNT = "Remy was wearing a mini skirt on 9/12.";
const SKIRT_OBSERVATION =
  "Observed:\nRemy was observed wearing a mini skirt at the salon on September 12, 2026.\n\nExpectation:\nRemy is expected to wear approved work attire for every shift.";

export const NOV20_WRITE_UP_EXCERPT_PLACE_CASES: ReplayCase[] = [
  fixed("nov20-direct-policy-fits-the-offense", `"${SKIRT}", card citing All Locations Dress Code p.15: Direct policy quotes the dress code's attire rule, never the Name tags paragraph`, async (t) => {
    const values = await created(t, SKIRT, SKIRT_ACCOUNT, SKIRT_OBSERVATION);
    const quoted = values.policy_language ?? "";
    expect(quoted, "no Direct policy was saved (the case proves nothing)").not.toBe("");
    expect(quoted, `Direct policy quotes a passage that is not the offense:\n${quoted}`).not.toMatch(/name tag/i);
    expect(quoted).toMatch(/attire|appearance/i);
  }),
  fixed("nov20-direct-policy-name-tag-control", `Control: "ca for Remy Calder, she was not wearing her name tag on 9/12": Direct policy quotes the Name tags passage`, async (t) => {
    const values = await created(
      t,
      "ca for Remy Calder, she was not wearing her name tag on 9/12",
      "Remy was not wearing a name tag on 9/12.",
      "Observed:\nRemy was not wearing a name tag on September 12, 2026.\n\nExpectation:\nRemy is expected to wear a visible name tag while working.",
    );
    expect(values.policy_language ?? "").toMatch(/Name tags are to be worn and visible/);
  }),
  fixed("nov20-write-up-no-unsaid-salon", `"${SKIRT}", the drafter writes "at the salon": the saved Observation has no place the manager never said`, async (t) => {
    const values = await created(t, SKIRT, SKIRT_ACCOUNT, SKIRT_OBSERVATION);
    const observation = values.observation ?? "";
    expect(observation, "no Observation was saved (the case proves nothing)").toMatch(/mini skirt/);
    expect(observation, `a place the manager never said:\n${observation}`).not.toMatch(/\bat the salon\b/i);
  }),
  fixed("nov20-write-up-said-salon-kept", `Control: "${SKIRT} at the salon": the place the manager said stays`, async (t) => {
    const values = await created(t, `${SKIRT} at the salon`, "Remy was wearing a mini skirt at the salon on 9/12.", SKIRT_OBSERVATION);
    expect(values.observation ?? "").toMatch(/\bat the salon\b/i);
  }),
];
