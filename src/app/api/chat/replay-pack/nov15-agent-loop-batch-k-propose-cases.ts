import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * BATCH K, PROPOSE_FORM (K4, K6, K8): the private shadow replay of 266 real manager chats through the loop
 * ============================================================================
 *
 * Design rules (QA, 15 Nov 2026): the model decides; code may refuse or inform (a fact on a tool result, a rules-book
 * line, one hand-back), never rewrite the model's words; never the wrong person (an extra question is the cheap
 * mistake). Invented names only: Remy Calder and Juno Paxton are on the replay directory; Odalys Fenwick is not.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "The private shadow replay of 266 real manager chats through the loop (batch K, 15 Nov 2026)";
const toolOutputs = (views: readonly LoopView[], tool: string) => views.flatMap((view) => view.results.filter((result) => result.tool === tool)).map((result) => result.output);

/** Odalys Fenwick is not on the directory. */
const ODALYS = "Odalys Fenwick";

/* ------------------------------------------------------------------------------------------------------- K4 --- */

type OtherPerson = { name?: { untrusted_text?: string }; said_in?: { untrusted_text?: string } };
const othersIn = (output: unknown): OtherPerson[] => ((output as { facts?: { account_names_other_person?: OtherPerson[] } }).facts?.account_names_other_person ?? []);
const namedOther = (output: unknown) => othersIn(output)[0]?.name?.untrusted_text ?? null;

/** A Corrective Action card for Remy Calder from the manager's words; the stand-in model proposes it with the account as given. */
async function k4Card(t: ReplayContext, words: string, account: string) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
  const model = loopStandIn((view): LoopDecision => {
    if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: account, incident_date: "2026-11-10" } };
    const fact = namedOther(lastResult(view, "propose_form"));
    return { text: fact ? `This account is about **${fact}**. Is the form for **${fact}** or **Remy Calder**?` : `Here's the Corrective Action Form for **Remy Calder**.\n\n**Observation of Offense:** ${account}` };
  });
  t.loopModel!(model);
  const thread = t.thread();
  const reply = await thread.say(words);
  return { thread, reply, model };
}

export const NOV15_AGENT_LOOP_BATCH_K_PROPOSE_CASES: ReplayCase[] = [
  {
    id: "nov15-k4-account-names-off-roster-person",
    title: `K4: "ca for remy calder" with a pasted account about ${ODALYS} (not on the roster): propose_form says account_names_other_person, and the reply asks "Is the form for ${ODALYS} or Remy Calder?"`,
    report: `${REPORT}; K4`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const account = `${ODALYS} was 20 minutes late on 11/10 and did not call the salon.`;
      const { reply, model } = await k4Card(t, `ca for remy calder\n\n${account}`, account);
      const results = toolOutputs(model.views, "propose_form");
      expect(namedOther(results.at(-1)), `the off-roster name in the account was not reported:\n${JSON.stringify(results.at(-1))}`).toBe(ODALYS);
      expect(reply.content).toContain(`This account is about **${ODALYS}**. Is the form for **${ODALYS}** or **Remy Calder**?`);
    },
  },
  {
    id: "nov15-k4-account-names-roster-person",
    title: "K4: \"ca for remy calder\" with a pasted account about Juno Paxton (on the roster): the same fact, never carded silently",
    report: `${REPORT}; K4`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const account = "Juno Paxton did not clean the beds on 11/10 and left early.";
      const { reply, model } = await k4Card(t, `ca for remy calder\n\n${account}`, account);
      const results = toolOutputs(model.views, "propose_form");
      expect(namedOther(results.at(-1)), `the roster name in the account was not reported:\n${JSON.stringify(results.at(-1))}`).toBe("Juno Paxton");
      expect(reply.content).toContain("Is the form for **Juno Paxton** or **Remy Calder**?");
    },
  },
  {
    id: "nov15-k4-control-witness-is-reported-the-model-decides",
    title: "K4 control: \"Remy Calder saw it\" in an account about Juno Paxton: the name is reported as a fact (code never reads intent), and the stand-in model, as the rules book teaches, does not ask",
    report: `${REPORT}; K4 control (a coworker as a witness)`,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const account = "She did not clean the beds on 11/10. Remy Calder saw it.";
      const model = loopStandIn((view): LoopDecision => {
        if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "juno paxton" } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-3", what_happened: account, incident_date: "2026-11-10" } };
        return { text: `Here's the Corrective Action Form for **Juno Paxton**.\n\n**Observation of Offense:** ${account}` };
      });
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say(`ca for juno paxton. ${account}`);
      const fact = othersIn(toolOutputs(model.views, "propose_form").at(-1))[0];
      expect(fact?.name?.untrusted_text, "the coworker's name is a fact for the model to weigh").toBe("Remy Calder");
      expect(fact?.said_in?.untrusted_text, "the fact carries the manager's sentence so the model can tell a witness from the subject").toContain("Remy Calder saw it");
      expect(reply.content).not.toMatch(/Is the form for/);
      expect(thread.proposal?.employeeName).toBe("Juno Paxton");
    },
  },
];

/* ------------------------------------------------------------------------------------------------------- K6 --- */

NOV15_AGENT_LOOP_BATCH_K_PROPOSE_CASES.push({
  id: "nov15-k6-second-persons-card-takes-no-date-from-the-first",
  title: "K6: \"write up Remy Calder for being late 10/16\" then \"also a coaching form for Juno Paxton for not cleaning beds\": Juno's card has no date from Remy's turn",
  report: `${REPORT}; K6 (a card for person B took 10/16 from person A's account)`,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    const model = loopStandIn((view): LoopDecision => {
      const last = view.turns.at(-1)?.text ?? "";
      const juno = /juno/i.test(last);
      if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: juno ? "juno paxton" : "remy calder" } };
      if (!lastResult(view, "propose_form")) {
        return juno
          ? { tool: "propose_form", input: { template_key: "coaching", employee_id: "e-3", what_happened: "Juno Paxton did not clean the beds." } }
          : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late on 10/16.", incident_date: "2026-10-16" } };
      }
      return { text: juno ? "Here's the Coaching Form for **Juno Paxton**." : "Here's the Corrective Action Form for **Remy Calder**." };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say("write up Remy Calder for being late 10/16");
    expect(thread.proposal?.formDate, "Remy's card is dated 10/16").toBe("2026-10-16");
    const reply = await thread.say("also a coaching form for Juno Paxton for not cleaning beds");
    expect(thread.proposal?.employeeName).toBe("Juno Paxton");
    expect(thread.proposal?.formDate ?? null, `Juno's card took Remy's date:\n${reply.content}`).not.toBe("2026-10-16");
    const card = (toolOutputs(model.views, "propose_form").at(-1) as { card?: { form_date?: string | null } }).card;
    expect(card?.form_date ?? null, "the tool's card carries Remy's date").not.toBe("2026-10-16");
  },
});

/* ------------------------------------------------------------------------------------------------------- K8 --- */

const K8_FIRST = "I need an exit form with this information for Remmy Caldar: she was terminated on 11/12, no call no show three days, payroll not deducted";
const K8_SECOND = "I need an exit form with this information for Remmy Caldar. She was terminated 11/12 for no call no shows";

NOV15_AGENT_LOOP_BATCH_K_PROPOSE_CASES.push({
  id: "nov15-k8-exit-request-survives-the-name-correction",
  title: "K8: two turns \"I need an exit form with this information … terminated …\" with a typo-near name, the app asks about the name, then \"For Remy Calder\": the exit form is carded (exit_not_asked never fires) with the termination",
  report: `${REPORT}; K8 (an explicit exit request lost when the name is corrected)`,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    const model = loopStandIn((view): LoopDecision => {
      const last = view.turns.at(-1)?.text ?? "";
      if (!/^for remy calder/i.test(last)) return { text: "Did you mean **Remy Calder**? Tell me the full name and I'll start the form." };
      if (!lastResult(view, "find_staff")) return { tool: "find_staff", input: { name: "remy calder" } };
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "stc-exit", employee_id: "e-2", exit_type: "termination", effective_date: "11/12" } };
      return { text: "Here's the Employee Exit Form for **Remy Calder**." };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say(K8_FIRST);
    await thread.say(K8_SECOND);
    const reply = await thread.say("For Remy Calder");
    const results = toolOutputs(model.views, "propose_form") as { exit_not_asked?: boolean; facts?: { exit_termination?: { effective?: string } } }[];
    expect(results.at(-1)?.exit_not_asked, `the exit request was lost when the name was corrected:\n${JSON.stringify(results.at(-1))}`).toBeUndefined();
    expect(thread.proposal?.templateKey, `no exit card:\n${reply.content}`).toBe("stc-exit");
    expect(thread.proposal?.employeeName).toBe("Remy Calder");
    expect(results.at(-1)?.facts?.exit_termination?.effective, "the termination words of the earlier turns were lost").toBe("2026-11-12");
  },
});

