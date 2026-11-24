import { expect, vi } from "vitest";

import type { ChatFormProposal } from "@/types";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, headingWith, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A PRIOR ACTION THE MANAGER NEVER SAID IS NEVER SAVED, AND NEVER "AS YOU SAID" (QA, 23 Nov 2026, Pau's review)
 * ============================================================================
 *
 * Production, 22 Nov 2026 ~10:12 PM: one turn, word for word but for the name (invented here): "create a ca for <P> she
 * was wearing sandals at work 9/11". The reply read "**Prior actions:** Corrective Action Form, Written Warning —
 * 09/10/2026, as you said.", and the form was created and finalized with that line. The manager never named a prior step.
 * The line came from two ARCHIVED finalized Written CAs dated 09/10, filed under the person's first name alone, which the
 * old auto-fill put on the card; `stated` carried it, so the model said "as you said". Prior actions now hold only the
 * manager's own steps, or a form on file they said yes to (the reply offers it; port of Ask Bubbles #1089).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA (23 Nov 2026, Pau's review of a finalized CA): \"Prior actions: Corrective Action Form, Written Warning — 09/10/2026, as you said\" on a one-turn chat that named no prior step";
const SAID = "create a ca for remy calder she was wearing sandals at work 9/11";
const ON_FILE = "Corrective Action Form, Written Warning — 09/10/2026";

type Result = { card?: { prior_actions?: string | null }; facts?: { stated?: { prior_actions?: string }; stated_this_turn?: string[]; prior_on_file?: { line?: string; ask_exactly?: string } } } | null;
const card = (reply: { formProposal?: unknown }) => (reply.formProposal as ChatFormProposal | undefined) ?? null;

/** A finalized Written CA dated 09/10 for Remy Calder, filed under `name`, archived or not. */
async function writtenOnFile(t: ReplayContext, name: string, archived: boolean): Promise<void> {
  vi.setSystemTime(new Date("2026-09-10T23:28:00Z"));
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was wearing sandals at work.", incident_date: "2026-09-10", warning_level: "written", level_evidence: evidenceFrom(view, "written") } })));
  const setup = t.thread();
  await setup.say("written ca for remy calder, she was wearing sandals at work on 9/10");
  const id = await setup.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-09-10", employee_name: name, archived_at: archived ? "2026-09-14T20:58:00Z" : null });
}

/** As in production: two finalized Written CAs dated 09/10, filed under the first name alone, archived. */
async function archivedOnFile(t: ReplayContext): Promise<void> {
  await writtenOnFile(t, "Remy", true);
  await writtenOnFile(t, "Remy", true);
}

/** The forms on file propose_form reported for this turn (offered or not). */
const onFileOf = (model: { views: LoopView[] }) => model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).map((result) => (result.output as Result)?.facts?.prior_on_file ?? null).find(Boolean) ?? null;

/**
 * The live model: propose_form for the request, then a reply that reads back `stated` with "as you said" (what the live
 * reply did). `copiesLine`: the model puts the forms-on-file line in prior_actions itself, unasked.
 */
function liveModel(copiesLine: boolean) {
  return loopStandIn((view: LoopView): LoopDecision => {
    const result = lastResult(view, "propose_form") as Result;
    if (!result) {
      return { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy was wearing sandals at work on 9/11.", incident_date: "2026-09-11", policy: headingWith(view, /dress code/i), ...(copiesLine ? { prior_actions: ON_FILE } : {}) } };
    }
    const stated = result.facts?.stated?.prior_actions ?? result.card?.prior_actions ?? null;
    const lines = ["Here's the Corrective Action Form for **Remy**."];
    if (stated) lines.push(`**Prior actions:** ${stated}, as you said.`);
    if (result.facts?.prior_on_file?.ask_exactly) lines.push(result.facts.prior_on_file.ask_exactly);
    return { text: lines.join("\n\n") };
  });
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || process.env.AGENT_LOOP_LIVE === "1") return;
    t.directory([...STAFF]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

export const NOV23_AGENT_LOOP_PRIOR_ACTION_NEVER_AS_YOU_SAID_CASES: ReplayCase[] = [
  fixed("nov23-prior-action-unsaid-never-on-card-or-saved", `"${SAID}" (one turn, no prior step named) with two archived Written CAs on file under the first name: the card and the saved form have no Prior actions, and the reply never says "as you said" about one`, async (t) => {
    await archivedOnFile(t);
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    const model = liveModel(false);
    t.loopModel!(model);
    const thread = t.thread();
    const reply = await thread.say(SAID);
    expect(card(reply)?.priorActions ?? null, `the card holds a prior action the manager never said:\n${reply.content}`).toBeNull();
    expect(reply.content, "the reply says a prior action was the manager's").not.toMatch(/Prior actions:[^\n]*as you said/);
    const id = await thread.create();
    expect(t.values(id).prior_actions ?? "", "the saved form holds a prior action the manager never said").toBe("");
  }),
  fixed("nov23-prior-action-model-copies-on-file-line-not-kept", "The same turn, the model copying the forms-on-file line into prior_actions unasked: never kept, never saved", async (t) => {
    await archivedOnFile(t);
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    t.loopModel!(liveModel(true));
    const thread = t.thread();
    const reply = await thread.say(SAID);
    expect(card(reply)?.priorActions ?? null, reply.content).toBeNull();
    const id = await thread.create();
    expect(t.values(id).prior_actions ?? "").toBe("");
  }),
  fixed("nov23-prior-action-control-manager-says-it", "Control: \"…, she had a written on 9/10\" states the step, prior_actions_evidence quoting it: on the card and saved, and stated_this_turn lists prior_actions (\"as you said\" is the manager's)", async (t) => {
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    const model = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
      ? { text: "Here's the card." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy was wearing sandals at work on 9/11.", incident_date: "2026-09-11", policy: headingWith(view, /dress code/i), prior_actions: "Written Warning — 09/10/2026", prior_actions_evidence: evidenceFrom(view, "she had a written on 9/10") } }));
    t.loopModel!(model);
    const thread = t.thread();
    const reply = await thread.say(`${SAID}, she had a written on 9/10`);
    expect(card(reply)?.priorActions ?? "", reply.content).toMatch(/09\/10\/2026/);
    const result = lastResult(model.views.at(-1)!, "propose_form") as Result;
    expect(result?.facts?.stated_this_turn ?? [], JSON.stringify(result?.facts)).toContain("prior_actions");
    const id = await thread.create();
    expect(t.values(id).prior_actions ?? "").toMatch(/09\/10\/2026/);
  }),
  fixed("nov23-prior-action-no-evidence-never-as-you-said", "The manager states the step but the model passes no prior_actions_evidence: the step is on the card (its date is the manager's), but stated_this_turn never lists prior_actions, so no \"as you said\"", async (t) => {
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    const model = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
      ? { text: "Here's the card." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy was wearing sandals at work on 9/11.", incident_date: "2026-09-11", policy: headingWith(view, /dress code/i), prior_actions: "Written Warning — 09/10/2026" } }));
    t.loopModel!(model);
    const reply = await t.thread().say(`${SAID}, she had a written on 9/10`);
    expect(card(reply)?.priorActions ?? "", reply.content).toMatch(/09\/10\/2026/);
    const result = lastResult(model.views.at(-1)!, "propose_form") as Result;
    expect(result?.facts?.stated_this_turn ?? []).not.toContain("prior_actions");
  }),
  // CHANGED ON PURPOSE (Pau, 23 Nov 2026, archiving removed): this case asserted an ARCHIVED Written CA was "not on file".
  // Archiving no longer exists and the unarchive migration clears the flag, so the flagged row is an ordinary finalized
  // form (the fixture's `archived_at` is ignored) and, under the full name, it IS on file and is offered.
  fixed("nov23-on-file-archived-full-name-not-on-file", "A finalized Written CA under the full name \"Remy Calder\" (what production held as archived before the unarchive migration): archiving is gone, so it is on file and offered", async (t) => {
    await writtenOnFile(t, "Remy Calder", true);
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    const model = liveModel(false);
    t.loopModel!(model);
    const reply = await t.thread().say(SAID);
    expect(onFileOf(model)?.ask_exactly ?? "", reply.content).toMatch(/has a Written CA on file from 09\/10\/2026\. Want me to add it to Prior actions\?/);
    expect(card(reply)?.priorActions ?? null, reply.content).toBeNull();
  }),
  fixed("nov23-on-file-first-name-shared-at-salon-not-attributed", "Pau (23 Nov 2026): an active finalized Written CA under the first name alone (\"Remy\") while another Remy is at the same salon: attributed to neither, never offered", async (t) => {
    t.directory([...STAFF, { id: "e-9", firstName: "Remy", lastName: "Okafor", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" }]);
    await writtenOnFile(t, "Remy", false);
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    const model = liveModel(false);
    t.loopModel!(model);
    await t.thread().say(SAID);
    expect(onFileOf(model), JSON.stringify(onFileOf(model))).toBeNull();
  }),
  fixed("nov23-on-file-first-name-other-salon-still-counts", "Pau (23 Nov 2026): the same first name at a DIFFERENT salon (another Remy at Manhattan, KS) does not matter: the form under \"Remy\" is offered", async (t) => {
    t.directory([...STAFF, { id: "e-9", firstName: "Remy", lastName: "Okafor", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0462"], positionName: "Tanning Consultant" }]);
    await writtenOnFile(t, "Remy", false);
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    const model = liveModel(false);
    t.loopModel!(model);
    const reply = await t.thread().say(SAID);
    expect(onFileOf(model)?.ask_exactly ?? "", reply.content).toMatch(/has a Written CA on file from 09\/10\/2026\. Want me to add it to Prior actions\?/);
    expect(card(reply)?.priorActions ?? null, reply.content).toBeNull();
  }),
  fixed("nov23-on-file-control-first-name-unique-offered", "Pau (23 Nov 2026), control: an active finalized Written CA under the first name alone, and no other Remy at the salon: it is offered (\"… has a Written CA on file from 09/10/2026. Want me to add it to Prior actions?\"), never added", async (t) => {
    await writtenOnFile(t, "Remy", false);
    vi.setSystemTime(new Date("2026-11-23T14:11:56Z"));
    const model = liveModel(false);
    t.loopModel!(model);
    const reply = await t.thread().say(SAID);
    expect(onFileOf(model)?.ask_exactly ?? "", reply.content).toMatch(/has a Written CA on file from 09\/10\/2026\. Want me to add it to Prior actions\?/);
    expect(card(reply)?.priorActions ?? null, reply.content).toBeNull();
  }),
];
