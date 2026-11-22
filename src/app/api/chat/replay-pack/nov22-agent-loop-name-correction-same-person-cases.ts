import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CORRECTED SPELLING OF THE CARD'S OWN PERSON IS THAT PERSON (port from Ask Bubbles 136d85d: its QA's live re-run,
 * 22 Nov 2026, A1, BLOCKER)
 * ============================================================================
 *
 * The manager's turns, word for word (the person invented; T1–T4 as in `nov21-agent-loop-corrected-name-everywhere`):
 * T1 names "<P1>" (a misspelling, not on the staff list) and asks for a CA; T2's card is <P1>'s; T3 "Create the coaching
 * form with the information given. Her name is <P2> and she is at <store>. …" corrects the spelling to the staff list's
 * <P2>. Live (CARD_PERSON_THIS_REQUEST on): propose_form was refused twice as person_change_not_asked, the turn ran out
 * of time at T4 with no reply stored, and Create on the old card was refused 409. Pau's rule: a name correction is the
 * manager's own words. Mechanism: a person whose name this message gives, and who is a close spelling of the open card's
 * person (one name the same, the other within two letters), is that card's person, corrected.
 */

const REPORT = "QA's Bubbles live re-run (22 Nov 2026, A1): \"Her name is <P2>\" (the corrected spelling of the card's <P1>) was refused as person_change_not_asked twice; T4 timed out with no reply stored; Create got 409";
/*
 * QA's four turns, word for word, with Sunny's invented person (STAFF's Marnie Holloway) and place in place of the sibling
 * app's: the misspelling <P1> kept as typed, then "Her name is <P2>" with the staff list's spelling.
 */
const P1 = "Marnee Hallowey";
const ACCOUNT = "Marnie Holloway was 10 minutes late on her last two shifts. On the first shift she was verbally coached on policy and expectations. Then she was late again on 10/15.";
const T1 = `My employee ${P1} has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15`;
/*
 * Sunny asks "Did you mean **<P2>**?" for any misspelling within A1's reach (its close-spelling check is wider than the
 * sibling app's), so the card is <P1>'s only after the manager keeps the name as typed: T2 is that answer ("no"), not
 * the sibling app's "I already told you the employee name". T1, T3 and T4 are QA's words.
 */
const T2 = "no";
const T3 = "Create the coaching form with the information given. Her name is Marnie Holloway and she is at Kearney. She is a tanning consultant";
const T4 = "she is at NE Kearney";
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

/** T1/T2 the CA card for the misspelling as typed; from T3 the live model proposes the Coaching form for the corrected name. */
const live = (byId: boolean) =>
  loopStandIn((view): LoopDecision => {
    const turn = users(view);
    const proposed = lastResult(view, "propose_form") as { card?: unknown; reason_code?: string } | null;
    if (proposed?.card) return { text: turn >= 3 ? "Here is the Coaching Form for **Marnie**." : "Here is the Corrective Action Form." };
    if (proposed?.reason_code) return { text: `refused: ${proposed.reason_code}` };
    if (turn <= 2) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: P1, what_happened: ACCOUNT.replace("Marnie Holloway", P1), incident_date: "2026-10-15", person_evidence: evidenceFrom(view, P1, turn - 1) } };
    const who = byId ? { employee_id: "e-1" } : { employee_name: "Marnie Holloway" };
    return { tool: "propose_form", input: { template_key: "coaching", ...who, what_happened: ACCOUNT, incident_date: "2026-10-15", person_evidence: evidenceFrom(view, "Marnie Holloway", turn === 3 ? 0 : 1) } };
  });

const run = (byId: boolean) => async (t: ReplayContext) => {
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  const model = live(byId);
  t.loopModel!(model);
  const thread = t.thread();
  await thread.say(T1);
  const t2 = await thread.say(T2);
  expect(thread.proposal?.employeeName, `T2 made no card for the misspelling (the case proves nothing):\n${t2.content}`).toBe(P1);
  const t3 = await thread.say(T3);
  const refusals = model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form").map((result) => (result.output as { reason_code?: string }).reason_code)).filter(Boolean);
  expect(refusals, `the corrected spelling was refused:\n${t3.content}`).not.toContain("person_change_not_asked");
  expect(thread.proposal?.templateKey, t3.content).toBe("coaching");
  expect(thread.proposal?.employeeName, "the card is not the corrected person's").toBe("Marnie Holloway");
  await thread.say(T4);
  const id = await thread.create();
  expect(t.forms().find((row) => row.id === id)?.employee_name, "Create did not save the corrected person's form").toBe("Marnie Holloway");
};

export const NOV22_AGENT_LOOP_NAME_CORRECTION_SAME_PERSON_CASES: ReplayCase[] = [
  { id: "nov22-a1-corrected-spelling-by-name-is-the-card-person", title: "A1: T3 \"… Her name is <P2> …\" with the model passing the corrected name: the Coaching card is <P2>'s (never person_change_not_asked), T4 keeps it, Create saves it", report: REPORT, status: "fixed", run: run(false) },
  { id: "nov22-a1-corrected-spelling-by-id-is-the-card-person", title: "A1: the same chat with the model passing <P2>'s staff id: the Coaching card is <P2>'s, T4 keeps it, Create saves it", report: REPORT, status: "fixed", run: run(true) },
];
