import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * ADDING A PRIOR STEP NEVER REMOVES ONE (port of Ask Bubbles #1069, its QA's live regression set, 22 Nov 2026, A13 item 9)
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. The manager's turns word for word (the person invented, Remy Calder): T1
 * "corrective action", T2 "<P full name>" (the card's Prior actions filled from her CA on file, 10/20/2026), T3 "<P> did not
 * acknowledge woven policies by the due date 10/31", T4 "in the previously recieved coaching include that <P full name>
 * signed the jba policy manual on 10-15-26". Live, T4's card held only the new coaching step: the model's prior_actions
 * listed just that, and the Corrective Action on file left the card. QA's ruling: adding never removes.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Port of Ask Bubbles #1069 (its QA's live regression set, 22 Nov 2026, A13): T4 \"in the previously recieved coaching include that <P> signed the jba policy manual on 10-15-26\" dropped the CA on file from Prior actions";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const T = ["corrective action", "Remy Calder", "Remy did not acknowledge woven policies by the due date 10/31", "in the previously recieved coaching include that Remy Calder signed the jba policy manual on 10-15-26"];
const ACCOUNT = "Remy Calder did not acknowledge Woven policies by the due date 10/31.";
/** The live model's T4 prior_actions: the new step only. */
const LIVE_T4_PRIOR = "Coaching — Remy Calder signed the JBA Policy Manual on 10/15/2026";

/** Which of the manager's turns (1–4) this call answers, by their own words. */
const turnOf = (view: LoopView) => {
  const said = view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0).at(-1)?.text ?? "";
  const index = T.indexOf(said);
  return index >= 0 ? index + 1 : T.length + 1;
};

/** A finalized Verbal CA on file for Remy Calder, dated 10/20/2026. */
async function caOnFile(t: ReplayContext): Promise<void> {
  vi.setSystemTime(new Date("2026-10-20T15:00:00Z"));
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late to open the salon.", incident_date: "2026-10-20", warning_level: "verbal", level_evidence: evidenceFrom(view, "verbal warning") } })));
  const setup = t.thread();
  await setup.say("ca for remy calder, she was late to open on 10/20, verbal warning");
  const id = await setup.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-10-20" });
}

type Proposed = { card?: { prior_actions?: string | null } } | null;

/** The live model; at T4 its prior_actions are `t4Prior`. */
const model = (t4Prior: string) => loopStandIn((view): LoopDecision => {
  const turn = turnOf(view);
  const proposed = lastResult(view, "propose_form") as Proposed;
  if (turn === 1) return { text: "Who is this Corrective Action for?" };
  if (proposed) return { text: `Here's the Corrective Action Form for **Remy**.\n\n**Prior actions:** ${proposed.card?.prior_actions ?? ""}` };
  const card = { template_key: "dpoa", employee_id: "e-2" };
  if (turn === 2) return { tool: "propose_form", input: card };
  const account = { ...card, what_happened: ACCOUNT, incident_date: "2026-10-31" };
  if (turn === 3) return { tool: "propose_form", input: account };
  return { tool: "propose_form", input: { ...account, prior_actions: t4Prior } };
});

/** The card's Prior actions as the latest propose_form result gave them (the card the manager sees). */
const priorOf = (stand: { views: LoopView[] }) => (stand.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).at(-1)?.output as Proposed | undefined)?.card?.prior_actions ?? "";

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
    await caOnFile(t);
    vi.setSystemTime(new Date("2026-11-21T18:00:00Z"));
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_ADDING_PRIOR_STEP_KEEPS_ON_FILE_CASES: ReplayCase[] = [
  loopCase("nov23-a13-adding-prior-step-keeps-on-file-line", "A13, under Pau's ruling (23 Nov 2026; Ask Bubbles #1089): the CA on file (10/20/2026) is offered, never added unasked; T4 \"in the previously recieved coaching include that <P> signed the jba policy manual on 10-15-26\" adds the signing (10/15/2026), and Create saves it", async (t) => {
    const stand = model(LIVE_T4_PRIOR);
    t.loopModel!(stand);
    const thread = t.thread();
    for (const said of T.slice(0, 3)) await thread.say(said);
    /*
     * CHANGED ON PURPOSE (QA, 23 Nov 2026; Pau's ruling, as Ask Bubbles changed this case in #1089): the AI never puts a
     * form on file on Prior actions by itself, so T3's card offers the CA on file (10/20/2026) instead, and the manager here
     * never says yes. What this case still guards: the step the manager adds lands, and nothing unaccepted is added.
     */
    // CHANGED ON PURPOSE (Pau, 26 Nov 2026: "Ai saw prior forms but i need them here"; PRIOR_ON_FILE_ON_CARD_ENABLED): forms on file are put on the card's Prior actions by the app, each saying what it is, and never offered. What A13 guards again: adding a step never removes the form on file.
    expect(priorOf(stand), "T3's card does not hold the CA on file").toMatch(/finalized — 10\/20\/2026/);
    const reply = await thread.say(T[3]!);
    expect(priorOf(stand), `the signing was not added:\n${reply.content}`).toMatch(/10\/15\/2026/);
    expect(priorOf(stand), `adding the signing removed the CA on file:\n${reply.content}`).toMatch(/10\/20\/2026/);
    const id = await thread.create();
    const saved = JSON.stringify(t.values(id));
    expect(saved, `the saved form lost the signing:\n${saved}`).toMatch(/10\/15\/2026/);
    expect(saved, `the saved form lost the CA on file:\n${saved}`).toMatch(/10\/20\/2026/);
  }),
  loopCase("nov23-a13-control-on-file-step-restated-listed-once", "Control: a step the manager restates with the on-file form's own date (10/20/2026) is that form, listed once", async (t) => {
    const stand = model("Verbal CA — 10/20/2026");
    t.loopModel!(stand);
    const thread = t.thread();
    for (const said of T.slice(0, 3)) await thread.say(said);
    await thread.say("she had a verbal ca on 10/20/26");
    expect(priorOf(stand).match(/10\/20\/2026/g)?.length ?? 0, priorOf(stand)).toBe(1);
  }),
];
