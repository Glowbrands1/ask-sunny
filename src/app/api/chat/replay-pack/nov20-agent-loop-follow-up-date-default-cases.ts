import { expect, vi } from "vitest";

import { KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView, evidenceFrom } from "./loop-stand-in";

/**
 * ============================================================================
 * THE FOLLOW-UP A FORM PROMISES IS ON THE CALENDAR (Pau, 20 Nov 2026)
 * ============================================================================
 *
 * A live test: the agent loop's Corrective Action said "A follow-up meeting will be scheduled to review progress" in
 * its Action Plan, and `form_instances.follow_up_date` stayed null, so the follow-up never showed on the home page's
 * outstanding follow-ups or in Form Monitoring. Pau's decision: "(a) set the follow-up date automatically, one week
 * after the form date, so you can change it … i choose A then be able to change it also".
 *
 * Through the real chat route, Create and drafting routes, with the loop on. "Test Testy" is the test's own invented
 * person, on no directory.
 */
const REPORT = "Pau's live test (20 Nov 2026): the Action Plan promised a follow-up meeting, follow_up_date stayed null";
const FLAG = "AGENT_LOOP_ENABLED";

const TESTY: DirectoryRow = { id: "e-test-testy", firstName: "Test", lastName: "Testy", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" };

/** The form date is the salon's today, Friday 20 Nov 2026 (Central). */
function start(t: ReplayContext) {
  vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
  t.directory([TESTY]);
  t.as("salon_director", KEARNEY);
  return t.thread();
}

const caCard = (view: LoopView): LoopDecision => ({
  tool: "propose_form",
  input: { payroll_evidence: evidenceFrom(view), template_key: "dpoa", employee_id: TESTY.id, policy: "Attendance", what_happened: "Test Testy was late to her shift.", payroll_deduct: "yes" },
});

const coachingCard = (): LoopDecision => ({
  tool: "propose_form",
  input: { template_key: "coaching", employee_id: TESTY.id, policy: "Attendance", what_happened: "Test Testy was late to her shift." },
});

const followUpOf = (t: ReplayContext, id: string) =>
  (t.rows?.("form_instances") ?? []).find((row) => String(row.id) === id)?.follow_up_date ?? null;

export const NOV20_AGENT_LOOP_FOLLOW_UP_DATE_DEFAULT_CASES: ReplayCase[] = [
  {
    id: "nov20-agent-loop-ca-follow-up-date-defaults-a-week-out",
    title: "\"write up Test Testy for being late to her shift, $20 payroll deduct\": Create sets the follow-up date to the form date + 7 days; \"change the follow up to 12/3\" moves it",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.draftWrites({ action_plan: "Test Testy is expected to arrive on time for every scheduled shift. A follow-up meeting will be scheduled to review progress." });
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form for **Test Testy**." } : caCard(view))));
      await thread.say("write up Test Testy for being late to her shift, $20 payroll deduct");
      const id = await thread.create();
      expect(followUpOf(t, id), "Create left the follow-up date empty").toBe("2026-11-27");

      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { error?: string; follow_up?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id, values: { follow_up_date: "12/3/2026" } } };
        return { text: edit.error ? "I couldn't set that date." : edit.follow_up ?? "Done." };
      });
      t.loopModel!(model);
      const reply = await thread.say("change the follow up to 12/3");
      expect(followUpOf(t, id), `the follow-up date did not move:\n${reply.content}`).toBe("2026-12-03");
      expect(reply.content, "a follow-up date after today was refused").not.toMatch(/after today/i);
      expect(reply.content).toMatch(/Follow-up: Thu, Dec 3 \(change it anytime\)/);
    },
  },
  {
    id: "nov20-agent-loop-ca-follow-up-date-stated-wins",
    title: "\"write up Test Testy for being late to her shift, $20 payroll deduct, follow up 12/1\": the date the manager stated is the follow-up date, not the week-out default",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form for **Test Testy**." } : caCard(view))));
      await thread.say("write up Test Testy for being late to her shift, $20 payroll deduct, follow up 12/1");
      const id = await thread.create();
      expect(followUpOf(t, id)).toBe("2026-12-01");
    },
  },
  {
    id: "nov20-agent-loop-follow-up-moved-by-weekday-no-values",
    title: "\"move the follow up to next Friday\" with no values on a Corrective Action: the follow-up moves to Fri 27 Nov, never refused as after today",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here's the Corrective Action Form for **Test Testy**." } : caCard(view))));
      await thread.say("write up Test Testy for being late to her shift, $20 payroll deduct, follow up 12/1");
      const id = await thread.create();
      const model = loopStandIn((view): LoopDecision => {
        const edit = lastResult(view, "edit_form") as { error?: string; follow_up?: string } | null;
        if (!edit) return { tool: "edit_form", input: { instance_id: id } };
        return { text: edit.error ? `I couldn't: ${edit.error}` : edit.follow_up ?? "Done." };
      });
      t.loopModel!(model);
      const reply = await thread.say("move the follow up to next Friday");
      expect(followUpOf(t, id), `the follow-up did not move:\n${reply.content}`).toBe("2026-11-27");
      expect(reply.content).not.toMatch(/after today/i);
    },
  },
  {
    id: "nov20-agent-loop-coaching-follow-up-said",
    title: "\"coaching form for Test Testy, she was late to her shift, I'll follow up with her next week\": the Coaching Form gets the form date + 7 days",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.draftWrites({ coaching_details: "Test Testy will arrive ten minutes before each shift. We will follow up next week to review her progress." });
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here's the Coaching Form for **Test Testy**." } : coachingCard())));
      await thread.say("coaching form for Test Testy, she was late to her shift, I'll follow up with her next week");
      const id = await thread.create();
      expect(followUpOf(t, id), "a follow-up was said and the date stayed empty").toBe("2026-11-27");
    },
  },
  {
    id: "nov20-agent-loop-coaching-no-follow-up-no-date",
    title: "\"coaching form for Test Testy, she was late to her shift\": no follow-up said or planned, so a Coaching Form gets no follow-up date",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.()) return;
      const thread = start(t);
      t.draftWrites({ coaching_details: "Test Testy will arrive ten minutes before each shift." });
      t.loopModel!(loopStandIn((view) => (lastResult(view, "propose_form") ? { text: "Here's the Coaching Form for **Test Testy**." } : coachingCard())));
      await thread.say("coaching form for Test Testy, she was late to her shift");
      const id = await thread.create();
      expect(followUpOf(t, id), "a Coaching Form with no follow-up got a date").toBeNull();
    },
  },
];
