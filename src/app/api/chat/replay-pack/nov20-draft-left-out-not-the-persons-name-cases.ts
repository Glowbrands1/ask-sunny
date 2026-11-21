import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE PERSON'S OWN SURNAME IS NEVER "LEFT OUT" (QA's f078, 20 Nov 2026; production dpl_5bzJ on main 9300526e)
 * ============================================================================
 *
 * The manager typed "ca for <First> <Last>, late on 11/18". The card's Observation said "<First> was late on 11/18" (the
 * first name, by Pau's rule), and the screen also showed "The draft left out <Last> in Observation of Offense; tell me if
 * you want it added." That note was wrong: the post-draft check (`draft-consistency.ts`) counted the employee's own name
 * words as facts the account must keep. They are never a fact left out; dates and amounts still are. Invented names only
 * (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's f078 (20 Nov 2026; production dpl_5bzJ, main 9300526e): \"The draft left out <Last> in Observation of Offense\" after a first-name Observation";
const SAID = "ca for Remy Calder, late on 11/18";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T19:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const notices = (t: ReplayContext) => (t.draftReplies?.() ?? []).map((reply) => String(reply.notice ?? "")).join("\n");

function cardModel() {
  return loopStandIn((view): LoopDecision => {
    if (view.results.some((entry) => entry.tool === "propose_form")) return { text: "Here's the Corrective Action Form for **Remy**." };
    const quote = { message_id: managerTurns(view).at(-1)?.messageIds?.at(-1) ?? "current", quote: "Remy Calder" };
    return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quote, what_happened: "Remy was late on 11/18.", incident_date: "2026-11-18", policy: "Attendance" } };
  });
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    start(t);
    await run(t);
  },
});

export const NOV20_DRAFT_LEFT_OUT_NOT_THE_PERSONS_NAME_CASES: ReplayCase[] = [
  fixed("nov20-draft-left-out-never-the-persons-surname-f078", `"${SAID}": the draft writes "Remy was late on 11/18." (the first name, Pau's rule); Create's note never says it left out "Calder"`, async (t) => {
    t.loopModel!(cardModel());
    t.draftWrites({ observation: "Observed:\nRemy was late on 11/18." });
    const thread = t.thread();
    await thread.say(SAID);
    const id = await thread.create();
    expect(notices(t), "the employee's own surname was reported as left out").not.toMatch(/left out[^.;]*\bCalder\b/);
    /* QA (20 Nov 2026, after #1175 passed live): the saved Observed starts with the first name only (Pau's rule). */
    expect(t.values(id).observation ?? "", "the saved Observed does not start with the first name only").toMatch(/^Observed:\s*Remy was late\b/);
  }),
  fixed("nov20-draft-left-out-still-says-a-lost-date", `Control: "${SAID}", and the draft writes "Remy was late." (the date lost): the note still says it left out 11/18`, async (t) => {
    t.loopModel!(cardModel());
    t.draftWrites({ observation: "Observed:\nRemy was late." });
    const thread = t.thread();
    await thread.say(SAID);
    await thread.create();
    expect(notices(t)).toMatch(/The draft left out (?:11\/18|2026-11-18) in Observation of Offense/);
    expect(notices(t)).not.toMatch(/\bCalder\b/);
  }),
];
