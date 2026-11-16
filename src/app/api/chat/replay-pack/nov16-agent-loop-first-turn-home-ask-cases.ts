import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * TURN 1 FROM THE HOME ASK BAR (QA, the Coordinator's live re-test on production 269ac0d9, 16 Nov 2026)
 * ============================================================================
 *
 * Every chat started at the home page's ask bar, which sent no conversationId, so turn 1's trace had none and its
 * records were never read (#1075). Three groups failed live: a kept name asked again (c_keepname), payroll lost on an
 * edit (c_pay), and a typo of the card's person with forms on file (E). Each case sends T1 without a conversationId.
 * Invented names only: Tamsin Orwell (roster), "Tamsin Orwelx" (nobody).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const NEAR_MISS = "NEAR_MISS_NEVER_SEATED_ENABLED";
const REPORT = "QA (16 Nov 2026): the Coordinator's live re-test on production 269ac0d9, chats started at the home ask bar";
const TAMSIN: DirectoryRow = { id: "e-tamsin-orwell", firstName: "Tamsin", lastName: "Orwell", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };
const HOME = { conversationId: null, surface: "overview" };

function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-15T22:40:00Z"));
  t.directory([...STAFF, TAMSIN]);
  t.as("salon_director", KEARNEY);
}
const userTurns = (view: LoopView) => view.turns.filter((turn) => turn.role === "user");
type Out = { ask_exactly?: string; note?: string; reason_code?: string; card?: unknown; forms?: unknown[]; which_form_question?: string } | null;

export const NOV16_AGENT_LOOP_FIRST_TURN_HOME_ASK_CASES: ReplayCase[] = [
  {
    id: "nov16-home-ask-c-keepname-kept-name-sticks",
    title: "c_keepname: T1 \"ca for tamsin orwelx, late on 11/14\" from the home ask bar (no conversationId) asks Did you mean; \"keep tamsin orwelx\" makes the card as typed; two later edits are never asked the Did-you-mean again",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = () => loopStandIn((view): LoopDecision => {
        const card = lastResult(view, "propose_form") as Out;
        if (!card) return { tool: "propose_form", input: { template_key: "dpoa", employee_name: "tamsin orwelx", person_evidence: evidenceFrom(view, "tamsin orwelx", userTurns(view).length - 1), what_happened: "Late on 11/14.", incident_date: "2026-11-14", request_evidence: [evidenceFrom(view, "late on 11/14", userTurns(view).length - 1)] } };
        return { text: card.ask_exactly ?? (card.card ? "Here's the Corrective Action Form for **Tamsin Orwelx**." : card.reason_code ?? "") };
      });
      t.loopModel!(model());
      const thread = t.thread();
      const ask = await thread.say("ca for tamsin orwelx, late on 11/14", {}, HOME);
      expect(ask.content).toMatch(/Did you mean \*\*Tamsin Orwell\*\*/);
      t.loopModel!(model());
      const kept = await thread.say("keep tamsin orwelx");
      expect(kept.content, `"keep" was asked again:\n${kept.content}`).not.toMatch(/Did you mean/);
      expect(thread.proposal?.employeeName?.toLowerCase()).toBe("tamsin orwelx");
      for (const edit of ["also add that it was her second time this month", "change the date to 11/13"]) {
        t.loopModel!(model());
        const reply = await thread.say(edit);
        expect(reply.content, `"${edit}" asked the Did-you-mean again:\n${reply.content}`).not.toMatch(/Did you mean/);
      }
    },
  },
  {
    id: "nov16-home-ask-c-pay-payroll-kept-on-edit",
    title: "c_pay: T1 \"written CA for Tamsin Orwell, late 11/14, payroll deduct $20\" from the home ask bar gives the card with payroll Yes / $20; T2 \"also add that it was her third time this month\" rebuilds it with payroll Yes / $20 kept",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      const model = () => loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        const card = lastResult(view, "propose_form") as Out;
        const first = userTurns(view).length === 1;
        if (!staff) return { tool: "find_staff", input: { name: "Tamsin Orwell", person_evidence: evidenceFrom(view, "Tamsin Orwell", userTurns(view).length - 1) } };
        if (!card) {
          return {
            tool: "propose_form",
            input: {
              template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, incident_date: "2026-11-14",
              what_happened: first ? "Late on 11/14." : "Late on 11/14; her third time this month.",
              // The live model re-proposes the card from the turn's words; payroll from T1 only on T1 (the carry keeps it).
              ...(first ? { payroll_deduct: "yes", payroll_amount: "20", payroll_evidence: evidenceFrom(view, "payroll deduct $20") } : {}),
              request_evidence: [evidenceFrom(view, "late 11/14", userTurns(view).length - 1)],
            },
          };
        }
        return { text: card.ask_exactly ?? "Here's the Corrective Action Form for **Tamsin**." };
      });
      t.loopModel!(model());
      const thread = t.thread();
      await thread.say("written CA for Tamsin Orwell, late 11/14, payroll deduct $20", {}, HOME);
      expect(thread.proposal as unknown, "T1's card has no payroll").toMatchObject({ payrollDeduct: "yes", payrollDeductAmount: "20" });
      t.loopModel!(model());
      const edit = await thread.say("also add that it was her third time this month");
      expect(edit.formProposal as unknown, `the edit lost payroll:\n${edit.content}`).toMatchObject({ payrollDeduct: "yes", payrollDeductAmount: "20" });
    },
  },
  {
    id: "nov16-home-ask-e-typo-of-card-person-with-forms-on-file",
    title: "E: T1 \"coaching for Tamsin Orwell on greeting guests\" from the home ask bar gives the card; with Corrective Actions on file for her, \"edit tamsin orwelx ca\" (find_past_forms with the typo) asks Did you mean **Tamsin Orwell**, never \"Which one should I open?\" for a name nobody has; \"yes\" then offers the Coaching Form on screen first, then the forms on file",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG, NEAR_MISS],
    async run(t) {
      if (!t.loopOn?.()) return;
      start(t);
      // Two Corrective Actions on file for Tamsin, from an earlier chat.
      for (const day of ["2026-11-02", "2026-11-05"]) {
        t.loopModel!(loopStandIn((view): LoopDecision => {
          const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
          if (!staff) return { tool: "find_staff", input: { name: "tamsin orwell", person_evidence: evidenceFrom(view, "tamsin orwell") } };
          if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "dpoa", employee_id: staff.matches?.[0]?.employee_id, what_happened: "Late opening.", incident_date: day } };
          return { text: "Here is the Corrective Action Form." };
        }));
        const earlier = t.thread();
        await earlier.say(`ca for tamsin orwell, late opening on ${day}`);
        const id = await earlier.create();
        Object.assign(t.forms().find((row) => row.id === id)!, { status: "finalized", form_date: day });
      }
      t.loopModel!(loopStandIn((view): LoopDecision => {
        const staff = lastResult(view, "find_staff") as { matches?: { employee_id: string }[] } | null;
        if (!staff) return { tool: "find_staff", input: { name: "Tamsin Orwell", person_evidence: evidenceFrom(view, "Tamsin Orwell") } };
        if (!lastResult(view, "propose_form")) return { tool: "propose_form", input: { template_key: "coaching", employee_id: staff.matches?.[0]?.employee_id, what_happened: "Not greeting guests at the front desk.", incident_date: "2026-11-14" } };
        return { text: "Here's the Coaching Form for **Tamsin**." };
      }));
      const thread = t.thread();
      await thread.say("coaching for Tamsin Orwell on greeting guests", {}, HOME);
      expect(thread.proposal?.employeeName).toBe("Tamsin Orwell");
      const live = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as Out;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "tamsin orwelx", form: "CA", open: true, forms_on_file_evidence: evidenceFrom(view, "edit tamsin orwelx ca") } };
        return { text: found.ask_exactly ?? found.which_form_question ?? found.note ?? "" };
      });
      t.loopModel!(live);
      const edit = await thread.say("edit tamsin orwelx ca");
      expect(edit.content, `the typo was answered with the forms on file:\n${edit.content}`).toMatch(/Did you mean \*\*Tamsin Orwell\*\*/);
      /*
       * QA (16 Nov 2026): "yes" confirms Tamsin; her Coaching Form card is on screen (not created) and two Corrective Actions
       * are on file, so the which-one question offers the card on screen FIRST (card_on_screen, ask_exactly).
       */
      const answered = loopStandIn((view): LoopDecision => {
        const found = lastResult(view, "find_past_forms") as (Out & { card_on_screen?: { form: string } }) | null;
        if (!found) return { tool: "find_past_forms", input: { employee_name: "Tamsin Orwell", form: "CA", open: true, forms_on_file_evidence: evidenceFrom(view, "edit tamsin orwelx ca", 1) } };
        return { text: found.ask_exactly ?? found.which_form_question ?? found.note ?? "" };
      });
      t.loopModel!(answered);
      const yes = await thread.say("yes");
      const out = answered.views.flatMap((view) => view.results).find((result) => result.tool === "find_past_forms")?.output as { card_on_screen?: unknown; ask_exactly?: string; which_form_question?: string } | undefined;
      expect(out?.card_on_screen, "the card on screen was not offered").toEqual({ form: "Coaching Form", created: false });
      expect(out?.which_form_question, "the plain which-one question was asked instead").toBeUndefined();
      expect(yes.content, `the card on screen is not the first option:\n${yes.content}`).toMatch(/^Which one: the Coaching Form on screen, or one of the 2 forms on file \(Corrective Action Form from 2026-11-0\d; Corrective Action Form from 2026-11-0\d\)\?$/m);
    },
  },
];
