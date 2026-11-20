import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * CREATE NEVER ACCEPTS A NAME START THE LOOP WOULD NOT SETTLE (QA item 9, 20 Nov 2026; Pau's name/form lock)
 * ============================================================================
 *
 * Create's currency check accepts a typed start or part of the card's name (`typedFor`'s 2-letter starts, `looseFits`,
 * and `partOfName`; PARTIAL_NAME_* and CHECKED_READING flags, on in production). For a loop card, #1095 gives Create the
 * loop's own record of the names it settled as the card's person, but the start and part rules still let through a name
 * the loop never settles: "sorry, this one is for Remy Ca" is read as "Remy", which is Remy Calder's and Remy Cassidy's
 * first name, and the loop would ask which. General rule: for a loop card, Create accepts the card's own name, the names
 * the loop's record settled, and the person's other names whole; a start is never enough, and a part of the name is
 * enough only when no other roster person has it. Cards from the old path are unchanged.
 * Invented names only: Remy Calder (the pack's roster), Remy Cassidy (added here).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (20 Nov 2026), item 9: Create accepted a 2-letter name start for a loop card that the loop would not settle";
const CASSIDY: DirectoryRow = { id: "e-remy-cassidy", firstName: "Remy", lastName: "Cassidy", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-19T22:40:00Z"));
  t.directory([...STAFF, CASSIDY]);
  t.as("salon_director", KEARNEY);
}
const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);

/** The live model: the Remy Calder card on the first turn; later turns only answer. */
const model = () => loopStandIn((view): LoopDecision => {
  const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form")?.output;
  if (result) return { text: typeof result.ask_exactly === "string" ? result.ask_exactly : "Here's the Corrective Action Form for **Remy Calder**." };
  if (managerTurns(view).length > 1) return { text: "The card above is still open; press Create when it looks right." };
  return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Opened the store late on 11/18.", incident_date: "2026-11-18", policy: "Late Opening" } };
});

async function card(t: ReplayContext) {
  t.loopModel!(model());
  const thread = t.thread();
  await thread.say("corrective action form for Remy Calder for opening the store late on 11/18");
  expect(thread.proposal?.employeeName).toBe("Remy Calder");
  return thread;
}

export const NOV20_AGENT_LOOP_CREATE_NAME_START_CASES: ReplayCase[] = [
  {
    id: "nov20-create-loop-card-name-start-refused",
    title: "The CA card for Remy Calder, then \"sorry, this one is for Remy Ca\" (read as \"Remy\", which fits Remy Calder and Remy Cassidy; the model makes no new card): Create refuses the Remy Calder card as out of date",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await card(t);
      await thread.say("sorry, this one is for Remy Ca");
      await expect(thread.create(), "Create accepted a name start the loop never settled").rejects.toThrow(/out of date/);
    },
  },
  {
    id: "nov20-create-loop-card-name-start-control-full-name",
    title: "Control: the CA card for Remy Calder, then \"yes this is for Remy Calder\": Create makes the card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await card(t);
      await thread.say("yes this is for Remy Calder");
      await expect(thread.create()).resolves.toBeTruthy();
    },
  },
];
