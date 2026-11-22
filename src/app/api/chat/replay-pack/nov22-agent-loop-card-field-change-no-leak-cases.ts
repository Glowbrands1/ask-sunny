import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CHANGE TO A FIELD THE CARD SHOWS GOES ON THE CARD, AND THE REPLY NEVER SHOWS THE MODEL'S REASONING (A13)
 * ============================================================================
 *
 * QA's re-run (22 Nov 2026, A13; found in Ask Bubbles #1007, the same loop in Sunny), the manager's turns word for word
 * (the person invented, the pack's roster): T1 "corrective action", T2 "<P full name>" (the card's Prior actions filled
 * from forms on file), T3 "<P> did not acknowledge woven policies by the due date 10/31", T4 "in the previously recieved
 * coaching include that <P full name> signed the jba policy manual on 10-15-26". Live: T4 was not applied; the reply
 * leaked "The manager's request to add this is about the card on screen (the open draft), not an older form on file."
 * and asked whether the change was for the card or a form on file. Now: the rules book has the card changed
 * (propose_form again, the card's entries kept and the step added), and a reply sentence speaking of "the manager" goes
 * back once and is then left out (`agent-loop/reasoning-leak.ts`).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's re-run (22 Nov 2026, A13; found in Ask Bubbles): T4's \"include\" on the card's Prior actions was not applied, and the reply showed the model's reasoning";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const JUNO = "e-3";
const T = ["corrective action", "Juno Paxton", "Juno did not acknowledge woven policies by the due date 10/31", "in the previously recieved coaching include that Juno Paxton signed the jba policy manual on 10-15-26"];
const ACCOUNT = "Juno Paxton did not acknowledge Woven policies by the due date 10/31.";
const LEAK = "The manager's request to add this is about the card on screen (the open draft), not an older form on file.";
const RULE = /never ask whether it is for the card or a form on file/;
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;
const checkedBack = (view: LoopView) => view.turns.some((turn) => /^\[app check\]/.test(turn.text) && /third person/.test(turn.text));

/** A finalized Corrective Action Form on file for Juno, made in an earlier chat (10/20). */
async function caOnFile(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: JUNO, what_happened: "Juno Paxton was late to open on 10/20.", incident_date: "2026-10-20" } })));
  const setup = t.thread();
  await setup.say("ca for juno paxton, late to open on 10/20");
  const id = await setup.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-10-20" });
}

/** `leakFixes`: whether the model's second reply drops the reasoning sentence. */
const live = (leakFixes: boolean) => {
  let cardPrior = "";
  return loopStandIn((view): LoopDecision => {
    const turn = users(view);
    const proposed = lastResult(view, "propose_form") as { card?: { prior_actions?: string | null } } | null;
    if (turn === 1) return { text: "Who is this Corrective Action for?" };
    const card = { template_key: "dpoa", employee_id: JUNO, person_evidence: evidenceFrom(view, "Juno Paxton", turn === 2 ? 0 : turn - 2) };
    if (turn === 2) return proposed ? { text: "What happened?" } : { tool: "propose_form", input: card };
    const account = { ...card, what_happened: ACCOUNT, incident_date: "2026-10-31", policy: headingWith(view, /standards of conduct/i) };
    if (turn === 3) {
      if (proposed) {
        cardPrior = proposed.card?.prior_actions ?? "";
        return { text: "Here's the Corrective Action Form for **Juno**." };
      }
      return { tool: "propose_form", input: account };
    }
    if (!RULE.test(view.system)) return { text: `${LEAK} Is this change for the card on screen, or for one of the forms already on file?` };
    if (!proposed) return { tool: "propose_form", input: { ...account, prior_actions: [cardPrior, "Signed the JBA Policy Manual — 10/15/2026"].filter(Boolean).join("; ") } };
    return { text: checkedBack(view) && leakFixes ? "Added to Prior actions: signed the JBA Policy Manual on 10/15/2026." : `${LEAK} Added to Prior actions: signed the JBA Policy Manual on 10/15/2026.` };
  });
};

type Model = ReturnType<typeof live>;
/** The card's Prior actions as the latest propose_form result gave them. */
const priorOf = (model: Model) =>
  ((model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).at(-1)?.output as { card?: { prior_actions?: string | null } } | undefined)?.card?.prior_actions ?? "");

async function chat(t: ReplayContext, leakFixes: boolean) {
  await caOnFile(t);
  vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
  const model = live(leakFixes);
  t.loopModel!(model);
  const thread = t.thread();
  for (const said of T.slice(0, 3)) await thread.say(said);
  expect(thread.proposal?.templateKey, "T3 made no Corrective Action card (the case proves nothing)").toBe("dpoa");
  const reply = await thread.say(T[3]!);
  return { thread, reply, model };
}

const loopCase = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

export const NOV22_AGENT_LOOP_CARD_FIELD_CHANGE_NO_LEAK_CASES: ReplayCase[] = [
  loopCase("nov22-a13-include-on-card-prior-actions", "A13: T4 \"in the previously recieved coaching include that <P> signed the jba policy manual on 10-15-26\" with the CA card on screen: the signing is added to the card's Prior actions (propose_form again); no card-or-file question", async (t) => {
    const { reply, model } = await chat(t, true);
    expect(priorOf(model), `the signing was not added to the card:\n${reply.content}`).toMatch(/10\/15\/2026/);
    expect(reply.content, "the reply asks card-or-file").not.toMatch(/forms? already on file/i);
  }),
  loopCase("nov22-a13-reply-reasoning-handed-back", "A13: a reply that speaks of \"the manager\" in the third person (\"The manager's request to add this is about the card on screen …\") goes back once; the reply has no reasoning", async (t) => {
    const { reply } = await chat(t, true);
    expect(reply.content, `the model's reasoning reached the manager:\n${reply.content}`).not.toMatch(/the manager/i);
    expect(reply.content).toMatch(/Added to Prior actions/);
  }),
  loopCase("nov22-a13-reply-reasoning-left-out-when-repeated", "A13: the model repeats the reasoning sentence after the hand-back: that sentence is left out, the rest of the reply stays", async (t) => {
    const { reply } = await chat(t, false);
    expect(reply.content, `the model's reasoning reached the manager:\n${reply.content}`).not.toMatch(/the manager/i);
    expect(reply.content).toMatch(/Added to Prior actions/);
  }),
];
