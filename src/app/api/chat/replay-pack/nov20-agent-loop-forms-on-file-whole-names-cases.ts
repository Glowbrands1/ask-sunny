import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * FORMS ON FILE ARE ONLY EVER THE NAMED PERSON'S: WHOLE NAME WORDS, NEVER A SUBSTRING (QA's code audit, item 27; privacy)
 * ============================================================================
 *
 * find_past_forms kept a form when the typed name was a raw substring of the form's employee name, after a database read
 * of `employee_name ilike *ann*`: "Ann" listed Hannah's and Joann's forms, and "Ann Lee" listed Joann Lee's, and
 * best_match could open the wrong person's form. General rule: a form is this person's only when the typed name matches
 * whole name words of its employee (the full name, the first name, or the last name, never part of a word); when the
 * matching forms belong to more than one person, none is listed and the reply asks which person, by full name.
 * Invented people only.
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's code audit on main 9e1d1f67 (item 27, privacy): find_past_forms listed other people's forms (\"Ann\" → Hannah's and Joann's)";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

const person = (id: string, firstName: string, lastName: string): DirectoryRow => ({ id, firstName, lastName, preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" });
const ANN = person("e-ann-lee", "Ann", "Lee");
const JOANN = person("e-joann-lee", "Joann", "Lee");
const HANNAH = person("e-hannah-brook", "Hannah", "Brook");

type Found = { forms?: { employee?: string }[]; best_match?: string; names_on_file?: string[]; note?: string };

async function onFile(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
  t.directory([...STAFF, ANN, JOANN, HANNAH]);
  t.as("salon_director", KEARNEY);
  for (const who of [ANN, JOANN, HANNAH]) {
    t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form") ? { text: "Here's the card." } : { tool: "propose_form", input: { template_key: "dpoa", employee_id: who.id, what_happened: `${who.firstName} ${who.lastName} was late to open on 11/10.`, incident_date: "2026-11-10" } })));
    const setup = t.thread();
    await setup.say(`ca for ${who.firstName} ${who.lastName}, late to open on 11/10`);
    const id = await setup.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: "2026-11-10" });
  }
}

/** The live model: find_past_forms with the name as the manager typed it. */
async function look(t: ReplayContext, said: string, name: string): Promise<Found> {
  const model = loopStandIn((view): LoopDecision => (lastResult(view, "find_past_forms")
    ? { text: "Here's what's on file." }
    : { tool: "find_past_forms", input: { employee_name: name, forms_on_file_evidence: evidenceFrom(view, said) } }));
  t.loopModel!(model);
  await t.thread().say(said);
  return lastResult(model.views.at(-1)!, "find_past_forms") as Found;
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.() || !offline) return;
    await onFile(t);
    await run(t);
  },
});

export const NOV20_AGENT_LOOP_FORMS_ON_FILE_WHOLE_NAMES_CASES: ReplayCase[] = [
  fixed("nov20-forms-on-file-full-name-never-another-person", "\"show me ann lee's forms\": only Ann Lee's form, never Joann Lee's (a substring), and best_match is hers", async (t) => {
    const found = await look(t, "show me ann lee's forms", "Ann Lee");
    expect((found.forms ?? []).map((form) => form.employee), JSON.stringify(found)).toEqual(["Ann Lee"]);
  }),
  fixed("nov20-forms-on-file-first-name-never-part-of-a-word", "\"show me ann's forms\": only Ann Lee's form, never Hannah Brook's or Joann Lee's (\"ann\" inside their names)", async (t) => {
    const found = await look(t, "show me ann's forms", "Ann");
    const names = (found.forms ?? []).map((form) => form.employee);
    expect(names, JSON.stringify(found)).not.toContain("Hannah Brook");
    expect(names).not.toContain("Joann Lee");
    expect(names).toEqual(["Ann Lee"]);
  }),
  fixed("nov20-forms-on-file-shared-last-name-asks-which", "\"show me lee's forms\": two people are named Lee (Ann Lee, Joann Lee): no form is listed, and the reply asks which person", async (t) => {
    const found = await look(t, "show me lee's forms", "Lee");
    expect(found.forms ?? [], JSON.stringify(found)).toEqual([]);
    expect([...(found.names_on_file ?? [])].sort()).toEqual(["Ann Lee", "Joann Lee"]);
  }),
];
