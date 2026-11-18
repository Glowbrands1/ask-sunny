import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CARD THE LOOP SHOWS AS READY PASSES CREATE (Runner 2's saved-form run on 33863575; QA, 17 Nov 2026)
 * ============================================================================
 *
 * 6 of 138 loop cards were refused at Create: "This proposal is out of date: the conversation now says the form is for
 * <typed>, not <card name>" (c003, c039, c134, c220, c232) or "… names more than one person (resubmit, LPSVA, Avg Club)"
 * (c210). The loop had seated the right person every time; Create's name reader re-read the whole chat and took a job
 * title before the name ("Tanning Consulatant <name>", "TC <name>"), a salon after it, metric words, or a person named
 * only in a write-up pasted after the card. The rule: Create reads the loop's card with the loop's record for it (the
 * turns after the card's own turn; another person is somebody on the roster; the names it settled as the card's person),
 * never loosened for any other card; a switch to another person on the roster after the card is still refused. Each case
 * presses Create. Invented names only (Remy Calder, typed "Remy Cadler"; Juno Paxton and Marnie Holloway on the staff
 * list; Tessa Marlow, not).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "Runner 2's saved-form run on 33863575 (QA, 17 Nov 2026): 6 of 138 loop cards refused at Create as out of date (c003, c039, c134, c210, c220, c232)";

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-17T11:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const latest = (view: LoopView) => managerTurns(view).at(-1)?.text ?? "";
const quoted = (view: LoopView, quote: string) => ({ message_id: [...managerTurns(view)].reverse().find((turn) => turn.text.toLowerCase().includes(quote.toLowerCase()))?.messageIds?.at(-1) ?? "current", quote });

/**
 * The live model: on a turn `cardTurn` accepts, the card for Remy Calder (the person evidence quoting `evidence`); any
 * other turn only answers. Replies with the tool's own question when refused.
 */
function liveModel(template: string, input: (view: LoopView) => Record<string, unknown>, cardTurn: (text: string) => boolean, evidence: (text: string) => string) {
  return loopStandIn((view): LoopDecision => {
    const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form" || entry.tool === "find_staff")?.output;
    if (result) return { text: typeof result.ask_exactly === "string" ? result.ask_exactly : `Here's the form for **Remy Calder**.${result.reason_code ? ` (${String(result.reason_code)}: ${String(result.error ?? "")})` : ""}` };
    if (!cardTurn(latest(view))) return { text: "The card above is still open; press Create when it looks right." };
    return { tool: "propose_form", input: { template_key: template, employee_name: "Remy Calder", person_evidence: quoted(view, evidence(latest(view))), ...input(view) } };
  });
}

async function created(t: ReplayContext, turns: readonly string[]) {
  const thread = t.thread();
  const replies: string[] = [];
  for (const turn of turns) replies.push((await thread.say(turn)).content);
  expect(thread.proposal?.employeeName, `no card for Remy Calder (the case proves nothing): ${replies.join(" | ")}`).toBe("Remy Calder");
  return thread;
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

const LATE = { what_happened: "Opened the store late.", policy: "Late Opening" };

export const NOV17_AGENT_LOOP_CREATE_ACCEPTS_SETTLED_NAME_CASES: ReplayCase[] = [
  fixed("nov17-create-loop-card-c003-title-before-name", "c003: \"corrective action form for empolyee Remy Calder for opening store late\", \"can you format a corrective action form for Tanning Consulatant Remy Calder who opened the store late today\", \"make the corrective action form draft printable as is\": Create makes the Remy Calder card (it read \"Tanning Consulatant Remy Calder\" as another person)", async (t) => {
    t.loopModel!(liveModel("dpoa", () => LATE, (text) => /corrective action form for/i.test(text), (text) => (/Tanning Consulatant/.test(text) ? "for Tanning Consulatant Remy Calder" : "Remy Calder")));
    const thread = await created(t, ["corrective action form for empolyee Remy Calder for opening store late", "can you format a corrective action form for Tanning Consulatant Remy Calder who opened the store late today", "make the corrective action form draft printable as is"]);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-loop-card-c039-salon-after-name", "c039: \"policy review form Remy Calder kearney, cell phone use on the floor\" (the salon right after the name): Create makes the Remy Calder card", async (t) => {
    t.loopModel!(liveModel("dpoa", () => ({ what_happened: "Cell phone use on the floor.", salon: "kearney", policy: "Standards of Conduct" }), () => true, () => "policy review form Remy Calder kearney"));
    const thread = await created(t, ["policy review form Remy Calder kearney, cell phone use on the floor"]);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-loop-card-c134-person-in-pasted-write-up", "c134: an exit card for Remy Calder (resigned, last day 10/25), then a pasted write-up about Tessa Marlow (not on the staff list) tanning while clocked in, with no card for her: Create makes Remy Calder's exit card", async (t) => {
    t.loopModel!(liveModel("stc-exit", (view) => ({ exit_evidence: { ...quoted(view, "put together an exit for Remy Calder"), kind: "asks_for_exit_form" }, exit_type: "resignation", incident_date: "2026-10-25" }), (text) => /exit/i.test(text), () => "Remy Calder"));
    const thread = await created(t, ["put together an exit for Remy Calder, she resigned and her last day worked was 10/25", "On 11/12 Tessa Marlow was seen tanning while clocked in. Tessa Marlow was reminded that tanning on the clock is not allowed and Tessa Marlow said she understood."]);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-loop-card-c210-metric-words", "c210: a verbal CA for Remy Calder, then the pasted HR note \"Please make the following edits and resubmit: … completed 24 tans and was below expectations in PPTA, LPSVA, Avg Club, CC%, and Spa% …\" and \"It needs to be a CA, not a coaching form\", the note again, \"Its a CA\", with no card change: Create makes the Remy Calder card (it read \"resubmit, LPSVA, Avg Club\" as people)", async (t) => {
    t.loopModel!(liveModel("dpoa", (view) => ({ what_happened: "146 tans; below in PPTA, LPSVA, Average Club, CC%, Spa%.", policy: "Other — Must See Behaviors", warning_level: "verbal", level_evidence: quoted(view, "verbal") }), (text) => /^create a ca/i.test(text), () => "this should be for Remy Calder"));
    const thread = await created(t, [
      "create a ca for must see behaviors for performace this should be for Remy Calder - verbal / 146 tans / Below in PPTA, LPSVA, Average Club, CC%, Spa%",
      "Please make the following edits and resubmit: 1. Kit Coaching Document signed by the employee 2. Remy completed 24 tans and was below expectations in PPTA, LPSVA, Avg Club, CC%, and Spa% 3. Policy Violated Standards of Conduct",
      "It needs to be a CA, not a coaching form",
      "Please make the following edits and resubmit: 1. Kit Coaching Document signed by the employee 2. Remy completed 24 tans and was below expectations in PPTA, LPSVA, Avg Club, CC%, and Spa% 3. Policy Violated Standards of Conduct",
      "Its a CA",
    ]);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-loop-card-c220-tc-and-another-roster-person", "c220: \"I need a verbal warning for TC Remy Calder. For insubordination on 11/5/2026. On November 5, 2026, TC Remy Calder contacted Training Salon Director Marnie Holloway through Woven …\", then \"TC Remy Calder\": Create makes the Remy Calder card", async (t) => {
    t.loopModel!(liveModel("dpoa", () => ({ what_happened: "On November 5, 2026, contacted Training Salon Director Marnie Holloway through Woven.", incident_date: "2026-11-05", policy: "Standards of Conduct" }), () => true, () => "TC Remy Calder"));
    const thread = await created(t, ["I need a verbal warning for TC Remy Calder. For insubordination on 11/5/2026. On November 5, 2026, TC Remy Calder contacted Training Salon Director Marnie Holloway through Woven about her schedule.", "TC Remy Calder"]);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-loop-card-c232-tc-exit", "c232: \"I need a exit form for TC Remy Calder\": Create makes the Remy Calder exit card", async (t) => {
    t.loopModel!(liveModel("stc-exit", (view) => ({ exit_evidence: { ...quoted(view, "I need a exit form for TC Remy Calder"), kind: "asks_for_exit_form" } }), () => true, () => "I need a exit form for TC Remy Calder"));
    const thread = await created(t, ["I need a exit form for TC Remy Calder"]);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-loop-card-typed-spelling-after-the-card", "The loop's recorded Did-you-mean (\"ca for remy cadler …\": Did you mean Remy Calder?), \"yes, she was also on her phone at the desk\": Create makes the Remy Calder card (the typed spelling the loop settled is the card's person)", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const result = [...view.results].reverse().find((entry) => entry.tool === "propose_form" || entry.tool === "find_staff")?.output;
      if (result) return { text: typeof result.ask_exactly === "string" ? result.ask_exactly : "Here's the form for **Remy Calder**." };
      if (managerTurns(view).length === 1) return { tool: "find_staff", input: { name: "Remy Cadler", person_evidence: quoted(view, "remy cadler") } };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "Remy Calder", person_evidence: quoted(view, "remy cadler"), what_happened: "Was late on 11/14. Was also on her phone at the desk.", incident_date: "2026-11-14", policy: "Attendance" } };
    }));
    const thread = await created(t, ["ca for remy cadler she was late on 11/14", "yes, she was also on her phone at the desk"]);
    await expect(thread.create()).resolves.toBeTruthy();
  }),
  fixed("nov17-create-loop-card-control-switch-to-roster-person", "Control: the CA card for Remy Calder, then \"actually this CA is for Juno Paxton, not Remy Calder\" (Juno Paxton on the staff list; the model makes no new card): Create refuses the Remy Calder card", async (t) => {
    t.loopModel!(liveModel("dpoa", () => LATE, (text) => !/^actually/i.test(text), () => "Remy Calder"));
    const thread = await created(t, ["corrective action form for Remy Calder for opening store late"]);
    await thread.say("actually this CA is for Juno Paxton, not Remy Calder");
    await expect(thread.create(), "a card for the person the manager switched away from was created").rejects.toThrow(/out of date/);
  }),
];
