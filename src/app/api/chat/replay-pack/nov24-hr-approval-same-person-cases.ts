import { expect, vi } from "vitest";

import { hrApprovalEnabled } from "@/lib/forms/hr-approval-rules";

import { KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * A SECOND FORM FOR SOMEONE WHOSE FIRST IS WITH HR (owner, 24 Nov 2026)
 * ============================================================================
 *
 * The owner: "should be able to create new form same person not block them, if they created 1 again for the same
 * person, it should open the one they sent to hr so they can edit it if same problem, if not same problem they can still
 * get notified they created a ca form prior fro X offense and policy and be able to edit it".
 *
 *   same form, same date        the form already with HR is opened to change; no second form
 *   another incident            a new card, and one line naming the form with HR, its policy and offense
 *   another manager's form      never named (only its creator, its senders and HR know it exists)
 *
 * Invented people and accounts.
 */
const REPORT =
  'Owner, 24 Nov 2026: "if they created 1 again for the same person, it should open the one they sent to hr so they can edit it if same problem, if not same problem they can still get notified they created a ca form prior fro X offense and policy"';
const FLAGS = ["AGENT_LOOP_ENABLED", "FORMS_HR_APPROVAL_ENABLED"];
const HR_ACCOUNT = "hr-wren-oakfield";

const PEREGRINE: DirectoryRow = {
  id: "e-peregrine-ashdown",
  firstName: "Peregrine",
  lastName: "Ashdown",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

const card = (whatHappened: string, policy: string) => (view: LoopView): LoopDecision =>
  lastResult(view, "propose_form")
    ? { text: "Done." }
    : { tool: "propose_form", input: { template_key: "dpoa", employee_id: PEREGRINE.id, policy, what_happened: whatHappened } };

/** A Kearney salon director's CA for Peregrine (late on 11/20), created from a card and sent to HR. Returns its id. */
async function sentToHr(t: ReplayContext, subject?: string): Promise<string> {
  vi.setSystemTime(new Date("2026-11-23T16:00:00Z"));
  t.directory([PEREGRINE]);
  t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
  t.addRows!("app_users", [{ id: HR_ACCOUNT, email: "hr.wren@example.com", display_name: "Wren", status: "active" }]);
  t.as("salon_director", KEARNEY, subject);
  const thread = t.thread();
  t.loopModel!(loopStandIn(card("Peregrine Ashdown was late to his shift on 11/20.", "Attendance")));
  await thread.say("write up Peregrine Ashdown for being late to his shift on 11/20");
  const id = await thread.create();
  const row = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id)!;
  // As `sendForHrApproval` leaves it.
  row.hr_approval_state = "pending";
  row.hr_approval_requested_at = "2026-11-23T17:00:00Z";
  row.hr_approval_requested_by = row.created_by;
  row.hr_approval_senders = [row.created_by];
  vi.setSystemTime(new Date("2026-11-24T16:00:00Z"));
  return id;
}

const proposeOutput = (model: { views: LoopView[] }) =>
  model.views.flatMap((view) => view.results.filter((result) => result.tool === "propose_form")).at(-1)?.output as Record<string, unknown> | undefined;
const peregrineForms = (t: ReplayContext) => (t.rows?.("form_instances") ?? []).filter((row) => row.employee_name === "Peregrine Ashdown");

export const NOV24_HR_APPROVAL_SAME_PERSON_CASES: ReplayCase[] = [
  {
    id: "nov24-same-person-same-problem-opens-the-form-with-hr",
    title: 'the same salon director, a day later: "write up Peregrine Ashdown for being late to his shift on 11/20": the CA already with HR is opened to change; no second form',
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const first = await sentToHr(t);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn(card("Peregrine Ashdown was late to his shift on 11/20.", "Attendance"));
      t.loopModel!(model);
      const reply = await t.thread().say("write up Peregrine Ashdown for being late to his shift on 11/20");
      const output = proposeOutput(model);
      expect(output, `propose_form did not open the form with HR:\n${JSON.stringify(output)}`).toMatchObject({ opened: true, same_form_with_hr: true });
      expect(String(output!.say_exactly)).toMatch(/^You already sent HR a Corrective Action Form for Peregrine Ashdown dated 11\/20\/2026 \(Attendance Policy: [^\n]*late to (?:his|the) shift on 11\/20\.\)\. It's still waiting for HR\. I've opened it so you can change it; HR sees your changes\.$/);
      expect(reply.formOpened?.instanceId, "the form with HR is not open on the manager's screen").toBe(first);
      expect(reply.formProposal, "a second card was offered").toBeUndefined();
      expect(peregrineForms(t), "a second form was made").toHaveLength(1);
    },
  },
  {
    id: "nov24-same-person-other-problem-new-card-names-the-form-with-hr",
    title: 'the same salon director: "write up Peregrine Ashdown for leaving the front desk unattended on 11/23": a new card, and one line naming the CA with HR with its policy and offense',
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const first = await sentToHr(t);
      t.as("salon_director", KEARNEY);
      const model = loopStandIn(card("Peregrine Ashdown left the front desk unattended on 11/23.", "Standards of Conduct"));
      t.loopModel!(model);
      const thread = t.thread();
      const reply = await thread.say("write up Peregrine Ashdown for leaving the front desk unattended on 11/23");
      const output = proposeOutput(model);
      expect(reply.formProposal, "no card for the new incident").toBeDefined();
      const withHr = (output?.facts as Record<string, unknown> | undefined)?.with_hr as { forms: { instance_id: string; policy: string | null; offense: string | null }[]; say_exactly: string } | undefined;
      expect(withHr, `the CA with HR was not named:\n${JSON.stringify(output)}`).toBeDefined();
      expect(withHr!.forms.map((form) => form.instance_id)).toEqual([first]);
      expect(withHr!.forms[0]!.policy, "the form with HR has no policy named").toBeTruthy();
      expect(withHr!.say_exactly).toMatch(/^You already sent HR a Corrective Action Form for Peregrine Ashdown dated 11\/20\/2026 \(Attendance Policy: [^\n]*late to (?:his|the) shift on 11\/20\.\)\. It's still waiting for HR; you can open it to change it\.$/);
      const second = await thread.create();
      expect(second).not.toBe(first);
      expect(peregrineForms(t), "the new incident's form was not made").toHaveLength(2);
    },
  },
  {
    id: "nov24-same-person-another-managers-form-with-hr-is-not-named",
    title: "control: another salon director's CA for Peregrine is with HR; a second salon director's request for Peregrine names nothing about it",
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const first = await sentToHr(t, "sd-other-tansy-brook");
      t.as("salon_director", KEARNEY);
      const model = loopStandIn(card("Peregrine Ashdown was late to his shift on 11/20.", "Attendance"));
      t.loopModel!(model);
      const reply = await t.thread().say("write up Peregrine Ashdown for being late to his shift on 11/20");
      const seen = JSON.stringify(model.views.flatMap((view) => view.results));
      expect(seen, "another manager's form with HR reached the model").not.toContain(first);
      expect(seen).not.toMatch(/with_hr|already sent HR/);
      expect(reply.formOpened, "another manager's form was opened").toBeUndefined();
    },
  },
];
