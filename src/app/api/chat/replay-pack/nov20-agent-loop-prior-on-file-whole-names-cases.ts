import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * PRIOR DISCIPLINE ON FILE IS ONLY EVER THIS PERSON'S (QA f029, with #1131's whole-name rule)
 * ============================================================================
 *
 * QA's f029: a Corrective Action card's prior actions list the forms on file for the SAME person, by #1131's whole-name
 * rule (never a substring: "Ann Lee" is never Joann Lee, "Ann" is never Hannah), with their dates and levels; the card's
 * own level stays the manager's. The forms on file are read with `employee_name ilike *<word>*`, so Joann Lee's and
 * Hannah Brook's finalized CAs come back for "Ann Lee" and must be left out. Invented people only.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA f029 (20 Nov 2026): past CAs on file listed in prior actions, the same person only (#1131's whole-name rule)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({ id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" });
const ANN = person("e-ann-lee", "Ann", "Lee");
const JOANN = person("e-joann-lee", "Joann", "Lee");
const HANNAH = person("e-hannah-brook", "Hannah", "Brook");

type Facts = { facts?: { prior_on_file?: { line?: string; forms?: { form: string; level: string | null; date: string | null }[] } } };

/** A finalized verbal CA on file for each of these people, dated 11/10. */
async function onFile(t: ReplayContext, people: readonly DirectoryRow[]) {
  vi.setSystemTime(new Date("2026-11-10T22:40:00Z"));
  for (const who of people) {
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
      ? { text: "Here's the card." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_id: who.id, what_happened: `${who.firstName} ${who.lastName} was late to open on 11/10.`, incident_date: "2026-11-10" } })));
    const setup = t.thread();
    await setup.say(`ca for ${who.firstName} ${who.lastName}, late to open on 11/10`);
    const id = await setup.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-11-10" });
  }
}

/** A new CA card for Ann Lee; the propose_form result is returned. */
async function annCard(t: ReplayContext): Promise<Facts & { card?: { prior_actions?: string | null; warning_level?: string | null } }> {
  vi.setSystemTime(new Date("2026-11-17T22:40:00Z"));
  const model = loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
    ? { text: "Here's the card." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: ANN.id, what_happened: "Ann Lee did not come in for her scheduled shift on 11/17.", incident_date: "2026-11-17" } }));
  t.loopModel!(model);
  await t.thread().say("put together a corrective action for ann lee, she did not come into her scheduled shift today at 9:30");
  return lastResult(model.views.at(-1)!, "propose_form") as Facts;
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    t.directory([...STAFF, ANN, JOANN, HANNAH]);
    t.as("salon_director", KEARNEY);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_PRIOR_ON_FILE_WHOLE_NAMES_CASES: ReplayCase[] = [
  fixed("nov20-prior-on-file-never-a-substring-name", "Joann Lee and Hannah Brook each have a finalized CA on file (Ann Lee has none): a CA card for Ann Lee lists no prior actions from them (\"ann\" inside their names)", async (t) => {
    await onFile(t, [JOANN, HANNAH]);
    const result = await annCard(t);
    expect(result.facts?.prior_on_file, JSON.stringify(result.facts?.prior_on_file)).toBeUndefined();
    expect(result.card?.prior_actions ?? null, JSON.stringify(result.card)).toBeNull();
  }),
  fixed("nov20-prior-on-file-own-ca-only-level-not-set", "Ann Lee, Joann Lee and Hannah Brook each have a finalized CA on file: Ann Lee's card lists only her own (one form, dated 11/10), and the card's level stays unset", async (t) => {
    await onFile(t, [ANN, JOANN, HANNAH]);
    const result = await annCard(t);
    const forms = result.facts?.prior_on_file?.forms ?? [];
    expect(forms, JSON.stringify(result.facts?.prior_on_file)).toHaveLength(1);
    expect(forms[0]?.date).toBe("2026-11-10");
    /* CHANGED ON PURPOSE (QA, 23 Nov 2026; Pau's ruling, port of Ask Bubbles #1089): forms on file are offered, never added to Prior actions by the AI. Was: the card listed them. Now Prior actions stay empty and prior_on_file.ask_exactly offers them. */
    expect(result.card?.prior_actions ?? null, JSON.stringify(result.card)).toBeNull();
    expect((result.facts?.prior_on_file as { ask_exactly?: string } | undefined)?.ask_exactly ?? "", JSON.stringify(result.facts?.prior_on_file)).toMatch(/on file from 11\/10\/2026\. Want me to add it to Prior actions\?/);
    expect(result.card?.warning_level ?? null, "the card's level was set from the form on file").toBeNull();
  }),
];
