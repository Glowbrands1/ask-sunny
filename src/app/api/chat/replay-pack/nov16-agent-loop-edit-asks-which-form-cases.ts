import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * AN EDIT OF ANOTHER FORM TYPE ASKS WHICH ONE (QA, live group E on main 63ba4c48, 16 Nov 2026)
 * ============================================================================
 *
 * A Coaching Form card for the person is on screen; Corrective Actions are on file for them; "edit <name> ca". Live, the
 * model skipped find_past_forms and proposed a NEW Corrective Action card (r1 after "yes" to the Did-you-mean; r2 at
 * once). General rule: an edit asked for a form type while the person's card on screen is another type and forms of the
 * asked type are on file is never a new card; propose_form answers the which-one question, the card on screen first.
 * Invented names only: Tamsin Orwell (roster), "tamsin orwelx" (nobody).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA (16 Nov 2026): live group E on main 63ba4c48 — \"edit <B>x ca\" with a Coaching card on screen and CAs on file made a new CA card (2 of 2)";
const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
/*
 * Changed on purpose (item 18, Pau via QA, 20 Nov 2026): each form on file is named by its choice line (form · status ·
 * date · salon, and the created time when two match), so choices that share a form name and date never read alike.
 */
const WHICH = /^Which one: the Coaching Form on screen, or one of the 2 Corrective Action Forms on file \(Corrective Action Form · finalized · dated 11\/0\d\/2026 · NE Kearney; Corrective Action Form · finalized · dated 11\/0\d\/2026 · NE Kearney\)\?$/m;

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
}
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user");
type Out = { ask_exactly?: string; reason_code?: string; card?: unknown; matches?: { employee_id: string }[] } | null;

/** Two Corrective Actions on file for Tamsin (from earlier chats). */
async function casOnFile(t: ReplayContext) {
  for (const day of ["2026-11-02", "2026-11-05"]) {
    t.loopModel!(loopStandIn((view): LoopDecision => {
      const staff = lastResult(view, "find_staff") as Out;
      if (!staff) return { tool: "find_staff", input: { name: "tamsin orwell", person_evidence: evidenceFrom(view, "tamsin orwell") } };
      if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, what_happened: "Late opening.", incident_date: day } };
      return { text: "Here is the Corrective Action Form." };
    }));
    const earlier = t.thread();
    await earlier.say(`ca for tamsin orwell, late opening on ${day}`);
    const id = await earlier.create();
    Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: day });
  }
}

/** T1: the Coaching card for Tamsin. */
async function coachingCard(t: ReplayContext) {
  t.loopModel!(loopStandIn((view): LoopDecision => {
    const staff = lastResult(view, "find_staff") as Out;
    if (!staff) return { tool: "find_staff", input: { name: "Tamsin Orwell", person_evidence: evidenceFrom(view, "Tamsin Orwell") } };
    if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: staff.matches?.[0]?.employee_id, what_happened: "Not greeting guests at the front desk.", incident_date: "2026-11-14" } };
    return { text: "Here's the Coaching Form for **Tamsin**." };
  }));
  const thread = t.thread();
  await thread.say("coaching for Tamsin Orwell on greeting guests");
  expect(thread.proposal?.templateKey).toBe("coaching");
  return thread;
}

/** The live model's new-CA path: find_staff (the confirmed or exact name), then propose_form for a Corrective Action by id. */
const newCaModel = (name: string) => loopStandIn((view): LoopDecision => {
  const staff = lastResult(view, "find_staff") as Out;
  const card = lastResult(view, "propose_form") as Out;
  if (!staff) return { tool: "find_staff", input: { name, person_evidence: evidenceFrom(view, userTurns(view).length > 2 ? "edit tamsin orwelx ca" : "edit tamsin orwell ca", userTurns(view).length > 2 ? 1 : 0) } };
  if (staff.ask_exactly) return { text: staff.ask_exactly };
  if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id } };
  return { text: card.ask_exactly ?? "Here's the Corrective Action Form for **Tamsin**. What happened?" };
});

export const NOV16_AGENT_LOOP_EDIT_ASKS_WHICH_FORM_CASES: ReplayCase[] = [
  {
    id: "nov16-edit-asks-which-form-after-yes-r1",
    title: "Group E r1: Coaching card on screen, 2 CAs on file; \"edit tamsin orwelx ca\" asks Did you mean; \"yes\" then has the model propose a NEW Corrective Action: refused, the which-one question offers the Coaching Form on screen first, never a new CA card",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      await casOnFile(t);
      const thread = await coachingCard(t);
      t.loopModel!(newCaModel("tamsin orwelx"));
      const ask = await thread.say("edit tamsin orwelx ca");
      expect(ask.content).toMatch(/Did you mean \*\*Tamsin Orwell\*\*/);
      const model = newCaModel("Tamsin Orwell");
      t.loopModel!(model);
      const yes = await thread.say("yes");
      expect(yes.formProposal ?? null, `a new card was made:\n${yes.content}`).toBeNull();
      expect(yes.content, `no which-one question:\n${yes.content}`).toMatch(WHICH);
      const refused = model.views.flatMap((view) => view.results).find((result) => result.tool === "propose_form")?.output as Out;
      expect(refused?.reason_code).toBe("edit_asked_forms_on_file");
    },
  },
  {
    id: "nov16-edit-asks-which-form-right-name-r2",
    title: "Group E r2: Coaching card on screen, 2 CAs on file; \"edit tamsin orwell ca\" (the right name) has the model propose a Corrective Action at once: refused, the which-one question offers the Coaching Form on screen first",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      await casOnFile(t);
      const thread = await coachingCard(t);
      t.loopModel!(newCaModel("Tamsin Orwell"));
      const edit = await thread.say("edit tamsin orwell ca");
      expect(edit.formProposal ?? null, `a new card replaced the coaching card:\n${edit.content}`).toBeNull();
      expect(edit.content, `no which-one question:\n${edit.content}`).toMatch(WHICH);
    },
  },
  {
    id: "nov16-edit-asks-which-form-control-make-it-a-ca",
    title: "Control: \"make it a CA\" on the Coaching card on screen, no CA on file, still switches the card to a Corrective Action as today",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const thread = await coachingCard(t);
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as Out;
        if (!staff) return { tool: "find_staff", input: { name: "Tamsin Orwell", person_evidence: evidenceFrom(view, "Tamsin Orwell", 1) } };
        // Changed on purpose (QA item 7, 20 Nov 2026, the form lock): a different form for the card's person needs this turn's words asking for it (form_change_evidence).
        // Changed on purpose (the issue-line port, 6f27926, account_no_subject): the CA account has the person as its subject, as the live model is taught; the expectation is unchanged.
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, what_happened: `Tamsin was not greeting guests at the front desk.`, incident_date: "2026-11-14", form_change_evidence: evidenceFrom(view, "make it a CA") } };
        return { text: "Here's the Corrective Action Form for **Tamsin**." };
      }));
      const switched = await thread.say("make it a CA");
      expect(switched.formProposal?.templateKey, switched.content).toBe("dpoa");
    },
  },
];
