import { expect, vi } from "vitest";

import { hrApprovalEnabled } from "@/lib/forms/hr-approval-rules";

import { KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * HR APPROVAL OF FORMS (owner request, 23 Nov 2026; CLAUDE.md rule 5)
 * ============================================================================
 *
 * Every form but the Coaching Form waits for HR after "Finalize and send to HR for approval", and while it waits only the
 * manager who created it and HR may know it exists (owner: "only me and HR can see its waiting and im the only one
 * to see HR's note or approval"). The AI reads the step through read_hr_approvals, scoped like the page:
 *
 *   the manager who sent it    "has HR approved it?"          their own form, waiting for HR
 *   HR                         "what's waiting on me?"        every form waiting for them
 *   an administrator           "does <name> have any write-ups?"  nothing: the waiting form is not on file for them
 *
 * The employee, the HR account and the administrator are invented. The form is marked as sent the way
 * `sendForHrApproval` marks it, on the row the card created.
 */
const REPORT = "Owner request, 23 Nov 2026: HR approval of every form but the Coaching Form; only the creator and HR see a waiting form";
const FLAGS = ["AGENT_LOOP_ENABLED", "FORMS_HR_APPROVAL_ENABLED"];
const GLOBAL = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
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

/** A Corrective Action draft for Peregrine Ashdown, created from a card by a Kearney salon director, then sent to HR. */
async function sentToHr(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-23T16:00:00Z"));
  t.directory([PEREGRINE]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  t.loopModel!(loopStandIn((view) =>
    lastResult(view, "propose_form")
      ? { text: "Here's the Corrective Action Form for **Peregrine Ashdown**." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_id: PEREGRINE.id, policy: "Attendance", what_happened: "Peregrine Ashdown was late to his shift." } },
  ));
  await thread.say("write up Peregrine Ashdown for being late to his shift");
  const id = await thread.create();
  const row = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id);
  expect(row, "the card created no form").toBeDefined();
  // As `sendForHrApproval` leaves it: still a draft, pending HR.
  row!.hr_approval_state = "pending";
  row!.hr_approval_requested_at = "2026-11-20T15:00:00Z";
  return id;
}

function asksHr(t: ReplayContext, role: string, scope: unknown, subject?: string) {
  t.as(role, scope, subject);
  const model = loopStandIn((view: LoopView): LoopDecision =>
    lastResult(view, "read_hr_approvals") ? { text: "Here is where your forms are with HR." } : { tool: "read_hr_approvals", input: {} },
  );
  t.loopModel!(model);
  return () => (model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_hr_approvals")).at(-1)?.output ?? {}) as Record<string, unknown>;
}

export const NOV23_HR_APPROVAL_CASES: ReplayCase[] = [
  {
    id: "nov23-hr-approval-manager-asks-has-hr-approved-it",
    title: 'the manager who sent it: "has HR approved Peregrine\'s write up yet?": read_hr_approvals gives their form, waiting for HR',
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await sentToHr(t);
      const result = asksHr(t, "salon_director", KEARNEY);
      await t.thread().say("has HR approved Peregrine's write up yet?");
      const output = result();
      const forms = output.your_forms_with_hr as Record<string, unknown>[];
      expect(forms, "the manager's own waiting form did not reach the model").toHaveLength(1);
      expect(JSON.stringify(forms[0])).toMatch(/Corrective Action Form for Peregrine Ashdown/);
      expect(forms[0]!.state).toBe("Waiting for HR approval");
    },
  },
  {
    id: "nov23-hr-approval-hr-asks-whats-waiting-on-me",
    title: 'HR: "what\'s waiting on me?": read_hr_approvals lists the form waiting for their approval, overdue after one business day',
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await sentToHr(t);
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      const result = asksHr(t, "district_manager", GLOBAL, HR_ACCOUNT);
      await t.thread().say("what's waiting on me?");
      const output = result();
      expect(output.reader).toBe("HR approver");
      const waiting = output.waiting_for_you as Record<string, unknown>[];
      expect(waiting, "the form waiting for HR did not reach the model").toHaveLength(1);
      expect(JSON.stringify(waiting[0])).toMatch(/Corrective Action Form for Peregrine Ashdown/);
      // Sent Friday 20 Nov 9:00 AM Central; Monday 23 Nov 10:00 AM is past one business day.
      expect(waiting[0]!.overdue).toBe(true);
    },
  },
  {
    id: "nov23-hr-approval-admin-gets-nothing-while-it-waits",
    title: 'an administrator: "does Peregrine Ashdown have any write ups?": the form waiting for HR is not on file for them, and nothing about it reaches the model',
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const id = await sentToHr(t);
      t.as("admin", GLOBAL, "admin-tamsin-reeve");
      const model = loopStandIn((view: LoopView): LoopDecision =>
        lastResult(view, "find_past_forms")
          ? { text: "There are no forms on file for Peregrine Ashdown." }
          : { tool: "find_past_forms", input: { employee_name: "Peregrine Ashdown", forms_on_file_evidence: evidenceFrom(view) } },
      );
      t.loopModel!(model);
      await t.thread().say("does Peregrine Ashdown have any write ups?");
      const seen = JSON.stringify(model.views.flatMap((view) => view.results.filter((result) => result.tool === "find_past_forms")));
      expect(seen, "find_past_forms was not called").not.toBe("[]");
      expect(seen, "the waiting form reached an administrator").not.toContain(id);
      expect(seen).not.toMatch(/Corrective Action Form/);
    },
  },
];
