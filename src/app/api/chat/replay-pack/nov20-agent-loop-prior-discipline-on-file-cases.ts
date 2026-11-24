import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * PRIOR DISCIPLINE ON FILE FILLS THE CARD'S PRIOR ACTIONS; THE LEVEL STAYS THE MANAGER'S (QA item 22, production audit)
 * ============================================================================
 *
 * Real managers: one employee had a finalized Verbal CA (Late Opening, 10/20) and another had 7 finalized CAs; Sunny left
 * the new Corrective Action card's prior actions empty, so the managers typed the history and chose the level themselves.
 * General rule (Pau via QA, 20 Nov 2026): a Corrective Action card's prior actions list this person's finalized Corrective
 * Actions and Coaching forms already in the app (form, level, date), as far as this manager may see them; the manager's
 * own stated steps win. The card's level is never set from them. Invented names only (Remy Calder).
 *
 * CHANGED ON PURPOSE (QA, 23 Nov 2026; Pau's ruling, port of Ask Bubbles #1089, after a saved form carried a prior action
 * the manager never said): the forms on file are OFFERED in the reply (prior_on_file.ask_exactly), never added to Prior
 * actions by the AI. These cases now assert the offer, empty Prior actions and the level still unset.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA item 22 (production audit, 20 Nov 2026): a CA card left prior actions empty though the person had finalized CAs on file";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type CardOut = { facts?: { prior_on_file?: { line?: string; on_card?: boolean; ask_exactly?: string } } };
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined) ?? null;

function start(t: ReplayContext) {
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** A finalized form on file for Remy Calder: a CA with its level, or a Coaching Form. */
async function onFile(t: ReplayContext, date: string, form: "dpoa" | "coaching", level: "verbal" | "written" | null, status: "finalized" | "draft" = "finalized"): Promise<string> {
  vi.setSystemTime(new Date(`${date}T15:00:00Z`));
  const said = `${form === "dpoa" ? "ca" : "coaching"} for remy calder, she was late to open on ${date.slice(5).replace("-", "/")}${level ? `, ${level} warning` : ""}`;
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: form, employee_id: "e-2", what_happened: "Remy Calder was late to open the salon.", incident_date: date, ...(level ? { warning_level: level, level_evidence: evidenceFrom(view, `${level} warning`) } : {}) } })));
  const setup = t.thread();
  await setup.say(said);
  const id = await setup.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status, form_date: date });
  return id;
}

/** The live model: the new CA card with no prior actions and no level of its own. */
function newCard(priorActions?: string) {
  return loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    /* As the rules book says, the reply ends with the offer of the forms on file when there is one. */
    ? { text: ["Here's the Corrective Action Form for **Remy Calder**.", (lastResult(view, "propose_form") as CardOut).facts?.prior_on_file?.ask_exactly ?? ""].filter(Boolean).join("\n\n") }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late to open the salon on 11/14.", incident_date: "2026-11-14", ...(priorActions ? { prior_actions: priorActions } : {}) } }));
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    start(t);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_PRIOR_DISCIPLINE_ON_FILE_CASES: ReplayCase[] = [
  fixed("nov20-prior-on-file-one-verbal-real-wording", "The audit's chat: a finalized Verbal CA (Late Opening, 10/20) on file; \"put togehter a corrective action for remy calder\", \"did not come into her scheduled shift today at 9:30\": the card's prior actions read \"Corrective Action Form, Verbal Warning — 10/20/2026\" with no level set; the manager's own \"make it a written\" then sets Written", async (t) => {
    await onFile(t, "2026-10-20", "dpoa", "verbal");
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    const model = loopStandIn((view): LoopDecision => {
      const said = view.turns.filter((turn) => turn.role === "user").at(-1)?.text ?? "";
      if (lastResult(view, "propose_form")) return { text: "Here's the Corrective Action Form for **Remy Calder**." };
      const account = /scheduled shift/.test(said) || view.turns.filter((turn) => turn.role === "user").length > 1 ? { what_happened: "Remy Calder did not come into her scheduled shift today at 9:30.", incident_date: "2026-11-14" } : {};
      const level = /make it a written/.test(said) ? { warning_level: "written", level_evidence: evidenceFrom(view, "make it a written") } : {};
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", ...account, ...level } };
    });
    t.loopModel!(model);
    const thread = t.thread();
    await thread.say("put togehter a corrective action for remy calder");
    const reply = await thread.say("did not come into her scheduled shift today at 9:30");
    expect(card(reply)?.priorActions ?? null, `a form on file was added to Prior actions on its own:\n${reply.content}`).toBeNull();
    expect(card(reply)?.warningLevel ?? null, "the level was set from the form on file").toBeNull();
    expect((lastResult(model.views.at(-1)!, "propose_form") as CardOut).facts?.prior_on_file?.ask_exactly ?? "").toMatch(/has a Verbal CA on file from 10\/20\/2026\. Want me to add it to Prior actions\?/);
    const raised = await thread.say("make it a written");
    expect(card(raised)?.warningLevel, "the manager's own level was not kept").toBe("written");
    expect(card(raised)?.priorActions ?? null).toBeNull();
  }),
  fixed("nov20-prior-on-file-seven-cas", "Seven finalized CAs on file (three Verbal, four Written): every one is in prior actions with its level, oldest first, and no level is set on the new card", async (t) => {
    for (const [index, date] of ["2026-08-11", "2026-08-25", "2026-09-08", "2026-09-22", "2026-10-06", "2026-10-20", "2026-11-03"].entries()) await onFile(t, date, "dpoa", index < 3 ? "verbal" : "written");
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    t.loopModel!(newCard());
    const reply = await t.thread().say("ca for remy calder, she was late to open on 11/14");
    expect(card(reply)?.priorActions ?? null, reply.content).toBeNull();
    for (const day of ["08/11/2026", "08/25/2026", "09/08/2026", "09/22/2026", "10/06/2026", "10/20/2026", "11/03/2026"]) expect(reply.content, "a form on file was not offered").toContain(day);
    expect(card(reply)?.warningLevel ?? null).toBeNull();
  }),
  fixed("nov20-prior-on-file-coaching-yes-draft-no", "A finalized Coaching Form is a prior action; a CA still in draft is not", async (t) => {
    await onFile(t, "2026-09-12", "coaching", null);
    await onFile(t, "2026-11-10", "dpoa", "written", "draft");
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    t.loopModel!(newCard());
    const reply = await t.thread().say("ca for remy calder, she was late to open on 11/14");
    expect(card(reply)?.priorActions ?? null, reply.content).toBeNull();
    expect(reply.content, "the finalized coaching was not offered").toMatch(/a Coaching Form on file from 09\/12\/2026/);
    expect(reply.content, "the draft CA was offered").not.toMatch(/11\/10\/2026/);
  }),
  fixed("nov20-prior-on-file-control-manager-steps-win", "Control: the manager states the history (\"she had a coaching on 9/8\"): their steps are the prior actions, not the forms on file", async (t) => {
    await onFile(t, "2026-10-20", "dpoa", "verbal");
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    t.loopModel!(newCard("Coaching — 09/08/2026"));
    const reply = await t.thread().say("ca for remy calder, she was late to open on 11/14, she had a coaching on 9/8");
    expect(card(reply)?.priorActions).toBe("Coaching — 09/08/2026");
  }),
  fixed("nov20-prior-on-file-control-nothing-on-file", "Control: nothing finalized on file: prior actions stay empty", async (t) => {
    vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
    t.loopModel!(newCard());
    const reply = await t.thread().say("ca for remy calder, she was late to open on 11/14");
    expect(card(reply)?.priorActions ?? null).toBeNull();
  }),
];
