import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * ACCENTS NEVER HIDE A FORM ON FILE (QA's f072, 20 Nov 2026; Coding-G's port of #1141 to Ask Bubbles)
 * ============================================================================
 *
 * The forms-on-file readers split names on [^a-z], so "Ramírez" was read as "ram rez"; and the database's ilike compares
 * the letters as stored, so "lucia ramirez" never found a form stored as "Lucía Ramírez". The readers fold accents first
 * (`foldName`), and the overview's employee_name_folded (lower(unaccent(employee_name)), migration 20261120002000) is
 * matched beside the stored name. Each case makes the form through the chat (Create); the person then leaves the staff
 * list (a former employee's forms, read by the name alone), and the manager asks for them the other way.
 * Invented names only (Lucía Ramírez, Inés Peñalver).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's f072 (20 Nov 2026): \"lucia ramirez\" never found a form stored as \"Lucía Ramírez\" (accents)";

const LUCIA: DirectoryRow = { id: "e-71", firstName: "Lucía", lastName: "Ramírez", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const INES: DirectoryRow = { id: "e-72", firstName: "Ines", lastName: "Penalver", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T16:30:00Z"));
  t.directory([...STAFF, LUCIA, INES]);
  t.as("salon_director", KEARNEY);
}

const managerTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user" && (turn.messageIds?.length ?? 0) > 0);
const quoteOf = (view: LoopView, quote: string) => ({ message_id: managerTurns(view).at(-1)?.messageIds?.at(-1) ?? "current", quote });

/** T1 makes the CA card for `cardName`; T2 asks for forms on file for `asked` (find_past_forms with the manager's words). */
function model(cardName: string, asked: string, found: { forms: number }) {
  return loopStandIn((view): LoopDecision => {
    if (managerTurns(view).length === 1) {
      if (lastResult(view, "propose_form")) return { text: `Here's the Corrective Action Form for **${cardName}**.` };
      return { tool: "propose_form", input: { template_key: "dpoa", employee_name: cardName, person_evidence: quoteOf(view, cardName.toLowerCase()), what_happened: "Was late to her shift on 11/18.", incident_date: "2026-11-18", policy: "Attendance" } };
    }
    const result = lastResult(view, "find_past_forms");
    if (result) {
      found.forms = ((result.forms ?? []) as unknown[]).length;
      return { text: found.forms > 0 ? "Here is what is on file." : "There are no forms on file for that name." };
    }
    return { tool: "find_past_forms", input: { employee_name: asked, forms_on_file_evidence: quoteOf(view, `show me forms for ${asked}`) } };
  });
}

async function onFileThenAsked(t: ReplayContext, cardName: string, typedFirst: string, asked: string) {
  start(t);
  const found = { forms: -1 };
  t.loopModel!(model(cardName, asked, found));
  const thread = t.thread();
  await thread.say(`ca for ${typedFirst}, she was late to her shift on 11/18`);
  expect(thread.proposal?.employeeName, "no card to put on file (the case proves nothing)").toBe(cardName);
  await thread.create();
  /* Since left (no longer on the staff list): the forms on file are read by the name alone, never through a roster alias. */
  t.directory([...STAFF]);
  await thread.say(`show me forms for ${asked}`);
  return found.forms;
}

const fixed = (id: string, title: string, run: (t: ReplayContext) => Promise<void>): ReplayCase => ({
  id,
  title,
  report: REPORT,
  status: "fixed",
  fixFlags: [FLAG],
  async run(t) {
    if (!t.loopOn?.()) return;
    await run(t);
  },
});

export const NOV20_FORMS_ON_FILE_ACCENTED_NAMES_CASES: ReplayCase[] = [
  fixed("nov20-forms-for-lucia-ramirez-finds-lucia-ramirez", "A CA filed for Lucía Ramírez (accents, as the staff list spells her), then \"show me forms for lucia ramirez\": the form is found", async (t) => {
    expect(await onFileThenAsked(t, "Lucía Ramírez", "Lucía Ramírez", "lucia ramirez"), "the form stored with accents was not found by the name typed without them").toBe(1);
  }),
  fixed("nov20-forms-for-ines-penalver-with-accents-finds-it", "The reverse: a CA filed for Ines Penalver (no accents), then \"show me forms for Inés Peñalver\": the form is found", async (t) => {
    expect(await onFileThenAsked(t, "Ines Penalver", "Ines Penalver", "Inés Peñalver"), "the form stored without accents was not found by the name typed with them").toBe(1);
  }),
];
