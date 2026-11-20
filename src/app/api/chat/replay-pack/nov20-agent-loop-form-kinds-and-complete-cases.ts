import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * FORM KINDS STAY APART, AND A CUT-OFF LIST IS NEVER CALLED COMPLETE (QA's code audit on main 9e1d1f67, items 28 and 29)
 * ============================================================================
 *
 * 28: the "coaching" kind (chat-form-records.ts, `templateNameWords: ["coaching"]`, an ilike) and find_past_forms' /coach/
 *     also matched the Follow-Up Coaching Form, so "how many coachings this month" counted follow-ups as coachings.
 *     General rule: Coaching and Follow-Up Coaching are separate kinds unless the manager asks for follow-ups.
 * 29: a period list read at most 100 rows, filtered them by what this manager may see, and called the list complete
 *     when fewer than 100 were left: rows the read cut off were never counted. General rule: completeness comes from the
 *     database's own count of rows read, before the visibility filter. The replay harness's actor sees every row (no
 *     visibility filter runs here), so item 29 is proved by `src/lib/ai/agent-loop/period-list-complete.test.ts`.
 * Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's code audit on main 9e1d1f67 (items 28 and 29): Follow-Up Coaching counted as Coaching; a cut-off list called complete";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type Listed = { forms?: { form?: string }[]; form_kind?: string | null };

async function made(t: ReplayContext, template: string, extra: Record<string, unknown> = {}): Promise<string> {
  t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: template, employee_id: "e-2", what_happened: "Remy Calder was late to open on 11/10.", incident_date: "2026-11-10", ...(template === "stc-exit" ? { exit_evidence: { ...evidenceFrom(view, "exit form for remy calder"), kind: "asks_for_exit_form" } } : {}), ...extra } })));
  const setup = t.thread();
  await setup.say(template === "stc-exit" ? "exit form for remy calder, she quit on 11/10" : `${template} for remy calder, late to open on 11/10`);
  const id = await setup.create();
  Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-11-10" });
  return id;
}

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF]);
  t.as("salon_director", KEARNEY);
}

/** The live model: a period list (no employee), with the kind it was asked about. */
async function periodList(t: ReplayContext, said: string, form?: string): Promise<Listed> {
  const model = loopStandIn((view): LoopDecision => (lastResult(view, "find_past_forms")
    ? { text: "Here's the list." }
    : { tool: "find_past_forms", input: { date_from: "11/01/2026", date_to: "11/30/2026", ...(form ? { form } : {}), forms_on_file_evidence: evidenceFrom(view, said) } }));
  t.loopModel!(model);
  await t.thread().say(said);
  return lastResult(model.views.at(-1)!, "find_past_forms") as Listed;
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

export const NOV20_AGENT_LOOP_FORM_KINDS_AND_COMPLETE_CASES: ReplayCase[] = [
  fixed("nov20-form-kinds-coaching-not-follow-up", "Item 28: a Coaching Form and a Follow-Up Coaching Form this month; \"how many coachings did we do this month\" lists the Coaching Form only; \"follow up coachings this month\" lists the follow-up only", async (t) => {
    await made(t, "coaching");
    await made(t, "follow-up-coaching");
    const coachings = await periodList(t, "how many coachings did we do this month", "coaching");
    expect((coachings.forms ?? []).map((form) => form.form), JSON.stringify(coachings)).toEqual(["Coaching Form"]);
    const followUps = await periodList(t, "follow up coachings this month", "follow-up coaching");
    expect((followUps.forms ?? []).map((form) => form.form), JSON.stringify(followUps)).toEqual(["Follow-Up Coaching Form"]);
  }),
  fixed("nov20-form-kinds-person-coaching-not-follow-up", "Item 28: Remy Calder has a Coaching Form and a Follow-Up Coaching Form; \"open remy calder's coaching\" finds the Coaching Form alone (best_match), never the follow-up", async (t) => {
    const coaching = await made(t, "coaching");
    await made(t, "follow-up-coaching");
    const model = loopStandIn((view): LoopDecision => (lastResult(view, "find_past_forms")
      ? { text: "Found it." }
      : { tool: "find_past_forms", input: { employee_name: "Remy Calder", form: "coaching", open: true, forms_on_file_evidence: evidenceFrom(view, "open remy calder's coaching") } }));
    t.loopModel!(model);
    await t.thread().say("open remy calder's coaching");
    const found = lastResult(model.views.at(-1)!, "find_past_forms") as { forms?: { instance_id: string; form: string }[]; best_match?: string };
    expect((found.forms ?? []).map((form) => form.form), JSON.stringify(found)).toEqual(["Coaching Form"]);
    expect(found.best_match).toBe(coaching);
  }),
];
