import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A CARD'S PERSON IS NAMED BY THE MANAGER IN THIS REQUEST (CARD_PERSON_THIS_REQUEST_ENABLED; QA2, 21 Nov 2026)
 * ============================================================================
 *
 * The outside audit's wrong-person risk, approved by Pau: the loop seated a roster person when ANY manager turn in the
 * chat held their name, or any earlier card was theirs, so a name from an earlier unrelated turn, or a card made for
 * someone the manager had since moved on from, could put a form on the wrong person (it happened in Ask Bubbles on
 * 18 Nov 2026). With the flag on, the person must be named in this request: the turn that asks, or a turn after the
 * chat's last card, after the last turn that named a different roster person, or after a who-is-this-for question.
 * Invented people from the pack's roster: Remy Calder, Juno Paxton.
 *
 * The flag is off in production (`production-flags.json`), so the wrong-person cases are `open` there and pass with the
 * flag on; the f059 story-then-ask flow and the plain cases hold either way.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEW_FLAG = "CARD_PERSON_THIS_REQUEST_ENABLED";
const REPORT = "QA2 (21 Nov 2026), the outside audit's wrong-person risk: a card's person accepted from any earlier turn or card in the chat";
const offline = process.env.AGENT_LOOP_LIVE !== "1";
const REMY = "e-2";
const JUNO = "e-3";
const users = (view: LoopView) => view.turns.filter((turn) => turn.role === "user").length;

function setup(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T15:00:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** A model that proposes a card for this person (by employee_id) whatever the manager's words, as a model carrying a name over would. */
const proposesFor = (employeeId: string, account: string) =>
  loopStandIn((view): LoopDecision =>
    lastResult(view, "propose_form")
      ? { text: "Here's the card." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_id: employeeId, what_happened: account, incident_date: "2026-11-19", person_evidence: evidenceFrom(view) } },
  );

const open = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: { open: "the card is made for a person the manager did not name in this request" },
  fixFlags: [FLAG, NEW_FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    setup(t);
    await run(t);
  },
});

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG, NEW_FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    setup(t);
    await run(t);
  },
});

export const NOV21_AGENT_LOOP_CARD_PERSON_THIS_REQUEST_CASES: ReplayCase[] = [
  open("nov21-card-person-different-person-two-turns-earlier", "Remy Calder is named, then Juno Paxton, then \"make a ca, she was late on 11/19\": the model carries Remy over; no card is made, the reply asks who the form is for", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (users(view) < 3) return { text: "Okay." };
      return lastResult(view, "propose_form") ? { text: "Who is this Corrective Action Form for?" } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: REMY, what_happened: "She was late on 11/19.", incident_date: "2026-11-19" } };
    }));
    const thread = t.thread();
    await thread.say("remy calder has been a great help this month");
    await thread.say("juno paxton opened the salon today");
    await thread.say("make a ca, she was late on 11/19");
    expect(thread.proposal ?? null, "a card was made for a person named two turns before another").toBeNull();
  }),
  open("nov21-card-person-earlier-card-then-another-person", "A card for Remy Calder, then a card for Juno Paxton, then \"make another ca, she left early on 11/19\": a card for Remy is not made from the old card; Juno, the latest, is still the person", async (t) => {
    let who = REMY;
    t.loopModel!(loopStandIn((view): LoopDecision =>
      lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: who, what_happened: users(view) === 1 ? "Remy Calder was late on 11/19." : users(view) === 2 ? "Juno Paxton was late on 11/18." : "She left early on 11/19.", incident_date: "2026-11-19" } },
    ));
    const thread = t.thread();
    await thread.say("ca for remy calder, late on 11/19");
    who = JUNO;
    await thread.say("ca for juno paxton, late on 11/18");
    who = REMY;
    const reply = await thread.say("make another ca, she left early on 11/19");
    expect(reply.formProposal?.employeeName ?? null, "an old card's person was carried onto the new card after someone else was named").not.toBe("Remy Calder");
  }),
  fixed("nov21-card-person-f059-story-then-ask", "f059's flow still works: \"Remy Calder was late on 11/19\" (a story, no ask), then \"a corrective action\": the card is Remy's", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (users(view) === 1) return { text: "This is an account of Remy being late. Do you want a Corrective Action or a Coaching Form?" };
      return lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: REMY, what_happened: "Remy was late on 11/19.", incident_date: "2026-11-19" } };
    }));
    const thread = t.thread();
    await thread.say("Remy Calder was late on 11/19");
    await thread.say("a corrective action");
    expect(thread.proposal?.employeeName, "the person named in the story was not carded").toBe("Remy Calder");
  }),
  fixed("nov21-card-person-this-turn-names-them", "\"ca for remy calder, late on 11/19\" (the turn that asks names the person) makes Remy's card, flag on or off", async (t) => {
    t.loopModel!(proposesFor(REMY, "Remy was late on 11/19."));
    const thread = t.thread();
    await thread.say("ca for remy calder, late on 11/19");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
  }),
  fixed("nov21-card-person-name-only-in-sunnys-reply", "A name only in Sunny's reply (\"Remy Calder and Juno Paxton work Saturday\"), then \"make a ca, she was late on 11/19\": no card is made for either", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      if (users(view) === 1) return { text: "Remy Calder and Juno Paxton work Saturday." };
      return lastResult(view, "propose_form") ? { text: "Who is this Corrective Action Form for?" } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: REMY, what_happened: "She was late on 11/19.", incident_date: "2026-11-19" } };
    }));
    const thread = t.thread();
    await thread.say("who works saturday?");
    await thread.say("make a ca, she was late on 11/19");
    expect(thread.proposal ?? null, "a card was made for a name only Sunny wrote").toBeNull();
  }),
  open("nov21-card-person-exit-account-names-the-salon-director", "QA2's 17 Nov case (Ask Bubbles' old path, conv_mwk2t40v27izanu), salon wording: \"create an exit for Remy Calder\", the details, then an account naming \"Salon Director, Juno Paxton, messaged Remy …\": the exit card stays Remy's; the model's second card for Juno is refused", async (t) => {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const exit = (employeeId: string) => ({ tool: "propose_form" as const, input: { template_key: "stc-exit", employee_id: employeeId, exit_type: "resignation", exit_evidence: { ...evidenceFrom(view), kind: "asks_for_exit_form" } } });
      if (users(view) === 2) return { text: "Got it." };
      if (lastResult(view, "propose_form")) return { text: "Here's the Resignation/Exit Form." };
      return users(view) === 1 ? exit(REMY) : exit(JUNO);
    }));
    const thread = t.thread();
    await thread.say("create an exit for Remy Calder");
    expect(thread.proposal?.employeeName, "the first card is Remy's").toBe("Remy Calder");
    await thread.say("last day worked 11-10-26. Remy quit without notice. payroll deduct applies");
    const reply = await thread.say("On 11-14-26 Salon Director, Juno Paxton, messaged Remy asking if she forgot to clock in or come to work on 11-13-26. Remy replied stating, \"I didn't come in, I'm actually going to resign. I meant to call in but I been dealing with my sick baby.\"");
    expect(reply.formProposal?.employeeName ?? null, "the exit card moved to the salon director named inside the account").not.toBe("Juno Paxton");
  }),
];
