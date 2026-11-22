import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * THE REPLY STATES THE SAME DEADLINE AS THE CARD (port of Ask Bubbles #1004, QA's re-run of 22 Nov 2026, A3)
 * ============================================================================
 *
 * The manager's turn, word for word (the person invented, the pack's roster): "create corrective action for <P> for
 * violating standards of conduct policy on 10-20-26. <P> failed to acknowledge policies in woven by the 10-15-26
 * deadline." The card and the saved draft said "by the 10/15/26 deadline"; the reply said "by the 10/20/26 deadline".
 * Mechanism (`agent-loop/observation-dates.ts`): a reply sentence restating the card's Observation must carry that
 * sentence's dates; otherwise it goes back to the model once with the card's facts, and a second misdated restatement is
 * left out of the reply (the card under it shows the Observation).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's re-run (22 Nov 2026, A3; found in Ask Bubbles, same code in Sunny): the reply said \"by the 10/20/26 deadline\" while the card and the saved draft said 10/15/26";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const REMY = "e-2";
const T1 = "create corrective action for Remy Calder for violating standards of conduct policy on 10-20-26. Remy Calder failed to acknowledge policies in woven by the 10-15-26 deadline.";
const ACCOUNT = "Remy Calder failed to acknowledge policies in Woven by the 10/15/26 deadline.";
const LIVE = "Remy failed to acknowledge policies in Woven by the 10/20/26 deadline.";
const RIGHT = "Remy failed to acknowledge policies in Woven by the 10/15/26 deadline.";

const checkedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /observation date \(10\/20\/26\)/.test(turn.text));

function reply(view: LoopView, account: string): string {
  const card = (lastResult(view, "propose_form") as { card?: { policy?: string | null } } | null)?.card;
  return [`Here's the Corrective Action Form for **Remy Calder**.`, account, ...(card?.policy ? [`**Policy:** ${card.policy}`] : [])].join("\n\n");
}

const propose = (view: LoopView): LoopDecision => ({
  tool: "propose_form",
  input: { template_key: "dpoa", employee_id: REMY, what_happened: ACCOUNT, incident_date: "2026-10-20", policy: headingWith(view, /standards of conduct/i), person_evidence: evidenceFrom(view, "Remy Calder") },
});

/** The live model: the card is right; the reply restates the account with the form's date, `fixes` decides the second reply. */
const live = (fixes: boolean) => loopStandIn((view): LoopDecision => (!lastResult(view, "propose_form") ? propose(view) : { text: reply(view, checkedBack(view) && fixes ? RIGHT : LIVE) }));

const issue = (proposal: unknown) => (proposal as { issue?: string | null } | null)?.issue ?? "";

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_REPLY_KEEPS_OBSERVATION_DATES_CASES: ReplayCase[] = [
  loopCase("nov22-a3-reply-deadline-matches-card", "A3: \"… on 10-20-26. <P> failed to acknowledge policies in woven by the 10-15-26 deadline.\" — the reply restating the account with 10/20/26 goes back once, and the reply says the card's 10/15/26 deadline", async (t) => {
    const thread = t.thread();
    const model = live(true);
    t.loopModel!(model);
    const said = await thread.say(T1);
    expect(issue(thread.proposal), "the card lost the account's deadline (the case proves nothing)").toMatch(/10\/15\/26 deadline/);
    expect(model.views.some(checkedBack), "the misdated restatement was never handed back").toBe(true);
    expect(said.content, `the reply states another deadline than the card:\n${said.content}`).not.toMatch(/10\/20\/26 deadline/);
    expect(said.content).toMatch(/10\/15\/26 deadline/);
  }),
  loopCase("nov22-a3-reply-misdated-twice-left-out", "A3, the model repeats \"by the 10/20/26 deadline\" after the hand-back: that sentence is left out of the reply (the card shows the account); never offered as a change to make", async (t) => {
    const thread = t.thread();
    t.loopModel!(live(false));
    const said = await thread.say(T1);
    expect(said.content, `the reply still states another deadline than the card:\n${said.content}`).not.toMatch(/10\/20\/26 deadline/);
    expect(said.content, "the misdated account was offered as a change").not.toMatch(/isn't on the card yet/);
    expect(said.content, "the reply lost the card line").toMatch(/Corrective Action Form for \*\*Remy/);
  }),
  loopCase("nov22-a3-control-account-dates-kept-no-hand-back", "Control: a reply that restates the account with its own 10/15/26 deadline is not handed back", async (t) => {
    const thread = t.thread();
    const model = loopStandIn((view): LoopDecision => (!lastResult(view, "propose_form") ? propose(view) : { text: reply(view, RIGHT) }));
    t.loopModel!(model);
    const said = await thread.say(T1);
    expect(model.views.some((view) => view.turns.some((turn) => /^\[app check\]/.test(turn.text))), "a correct reply was handed back").toBe(false);
    expect(said.content).toMatch(/10\/15\/26 deadline/);
  }),
];
