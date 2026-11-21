import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A NAME CORRECTED MID-CHAT IS THE NAME EVERYWHERE (port from the sibling app: its QA's live re-test, 21 Nov 2026, loop on)
 * ============================================================================
 *
 * The sibling app's conversation, its wording kept, its person invented here (STAFF's Remy Calder, first typed "Remy Caldr"):
 *  T1 "My employee <First> <Lastx> has was 10 minutes late on her last two shifts. … She was late on 10/5 and 10/15"
 *  T2 "Create the coaching form with the information given. Her name is <First> <Lasty>"
 * The card's employee became the corrected spelling, but its account (and the saved Coaching Details) still said
 * "<First> <Lastx>", copied from T1. Expected: the corrected name replaces the old spelling everywhere.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port from the sibling app (its QA's live re-test, 21 Nov 2026, agent loop on): the name corrected mid-chat kept the old spelling in the account and the saved write-up";
const T1 = "My employee Remy Caldr has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15";
const T2 = "Create the coaching form with the information given. Her name is Remy Calder";
/** The live model's account: the manager's T1, the misspelt name and all. */
const ACCOUNT = "Remy Caldr was 10 minutes late on her last two shifts. On the first shift she was verbally coached on policy and expectations. Then she was late again on 10/15.";
/** The old spelling, never the corrected one. */
const OLD_SPELLING = /\bCaldr\b/i;

const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

/** T1 a Corrective Action card for the typed spelling, T2 the Coaching card for the roster person, the account as the live model copied it. */
const live = () =>
  loopStandIn((view): LoopDecision => {
    const turn = users(view);
    if (lastResult(view, "propose_form")) return { text: turn >= 2 ? "Here is the Coaching Form for **Remy**." : "Here is the Corrective Action Form." };
    if (turn <= 1) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Caldr", what_happened: ACCOUNT, incident_date: "2026-10-15", person_evidence: evidenceFrom(view, "Remy Caldr") } };
    return { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-2", what_happened: ACCOUNT, incident_date: "2026-10-15", person_evidence: evidenceFrom(view, "Remy Calder") } };
  });

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    t.loopModel!(live());
    await run(t);
  },
});

export const NOV21_AGENT_LOOP_CORRECTED_NAME_EVERYWHERE_CASES: ReplayCase[] = [
  fixed("nov21-agent-loop-corrected-name-card-account", "T1 \"My employee Remy Caldr has was 10 minutes late …\", T2 \"… Her name is Remy Calder\": the card is Remy Calder's and its account never says \"Remy Caldr\"", async (t) => {
    const thread = t.thread();
    for (const said of [T1, T2]) await thread.say(said);
    const card = thread.proposal as { employeeName?: string; templateKey?: string; issue?: string } | null;
    expect(card?.employeeName).toBe("Remy Calder");
    expect(card?.templateKey).toBe("coaching");
    expect(card?.issue ?? "", "the card's account kept the old spelling").not.toMatch(OLD_SPELLING);
    expect(card?.issue ?? "").toMatch(/10 minutes late/);
  }),
  fixed("nov21-agent-loop-corrected-name-saved-write-up", "The same chat and Create (the loop card's account is the saved write-up): the saved Coaching form never says \"Remy Caldr\"", async (t) => {
    const thread = t.thread();
    for (const said of [T1, T2]) await thread.say(said);
    const id = await thread.create();
    const values = t.values(id);
    expect(values.employee_name).toBe("Remy Calder");
    for (const [field, value] of Object.entries(values)) expect(value, `${field} kept the old spelling`).not.toMatch(OLD_SPELLING);
    expect(Object.values(values).join("\n")).toMatch(/10 minutes late/);
  }),
];
