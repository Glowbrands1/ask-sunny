import { expect, vi } from "vitest";

import { hrApprovalEnabled } from "@/lib/forms/hr-approval-rules";

import { KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * "WAS MY CA FOR <P> APPROVED?" AFTER HR APPROVED IT FROM "SENT BACK" (Pau, via QA, 23 Nov 2026; CLAUDE.md rule 5)
 * ============================================================================
 *
 * HR may now approve a form it sent back once the manager has replied with a note. The AI reads the approval state
 * through read_hr_approvals, scoped as the owner ruled: the asker's own forms (created or sent), HR's queue for HR,
 * nothing for anybody else. The manager who sent it asks in their words and is told it is approved; another salon's
 * manager asking the same gets nothing about it. The employee and the second manager are invented.
 */
const REPORT = "Pau, via QA, 23 Nov 2026: \"when manager replies in note, there should be approve button here please and notify manager\"";
const FLAGS = ["AGENT_LOOP_ENABLED", "FORMS_HR_APPROVAL_ENABLED"];
const OTHER_SALON = { level: "salon", primaryAreaId: "loc-0101", alsoCoversAreaIds: [] };

const ROSALIND: DirectoryRow = {
  id: "e-rosalind-penhallow",
  firstName: "Rosalind",
  lastName: "Penhallow",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** A Kearney salon director's CA for Rosalind, sent to HR, sent back, replied to, and approved by HR from there. */
async function approvedFromSentBack(t: ReplayContext): Promise<string> {
  vi.setSystemTime(new Date("2026-11-23T16:00:00Z"));
  t.directory([ROSALIND]);
  t.as("salon_director", KEARNEY);
  const thread = t.thread();
  t.loopModel!(loopStandIn((view) =>
    lastResult(view, "propose_form")
      ? { text: "Here's the Corrective Action Form for **Rosalind Penhallow**." }
      : { tool: "propose_form", input: { template_key: "dpoa", employee_id: ROSALIND.id, policy: "Attendance", what_happened: "Rosalind Penhallow was late to her shift." } },
  ));
  await thread.say("write up Rosalind Penhallow for being late to her shift");
  const id = await thread.create();
  const row = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id);
  expect(row, "the card created no form").toBeDefined();
  // As `decideHrApproval` leaves it after approving from "sent back": finalized and approved in one write.
  row!.status = "finalized";
  row!.finalized_at = "2026-11-23T15:30:00Z";
  row!.hr_approval_state = "approved";
  row!.hr_approval_requested_at = "2026-11-20T15:00:00Z";
  row!.hr_approval_decided_at = "2026-11-23T15:30:00Z";
  row!.updated_at = "2026-11-23T15:30:00Z";
  return id;
}

function asksHr(t: ReplayContext) {
  const model = loopStandIn((view: LoopView): LoopDecision =>
    lastResult(view, "read_hr_approvals") ? { text: "Here is where your forms are with HR." } : { tool: "read_hr_approvals", input: {} },
  );
  t.loopModel!(model);
  return () => (model.views.flatMap((view) => view.results.filter((result) => result.tool === "read_hr_approvals")).at(-1)?.output ?? {}) as Record<string, unknown>;
}

export const NOV23_HR_APPROVE_SENT_BACK_CASES: ReplayCase[] = [
  {
    id: "nov23-hr-approve-sent-back-manager-asks-was-it-approved",
    title: '"was my CA for Rosalind approved?" after HR approved it from sent back: read_hr_approvals gives their form, approved',
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await approvedFromSentBack(t);
      const result = asksHr(t);
      await t.thread().say("was my CA for Rosalind approved?");
      const forms = result().your_forms_with_hr as Record<string, unknown>[] | undefined;
      expect(forms, "the manager's approved form did not reach the model").toHaveLength(1);
      expect(JSON.stringify(forms![0])).toMatch(/Corrective Action Form for Rosalind Penhallow/);
      expect(forms![0]!.state).toBe("Approved by HR");
    },
  },
  {
    id: "nov23-hr-approve-sent-back-other-salon-manager-gets-nothing",
    title: 'control: another salon\'s manager asking "was the CA for Rosalind approved?" gets nothing about it',
    report: REPORT,
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const id = await approvedFromSentBack(t);
      t.as("salon_director", OTHER_SALON, "sd-larkspur-other");
      const result = asksHr(t);
      await t.thread().say("was the CA for Rosalind approved?");
      const output = JSON.stringify(result());
      expect(output, "read_hr_approvals was not called").not.toBe("{}");
      expect(output, "another salon's approved form reached the model").not.toContain(id);
      expect(output).not.toMatch(/Rosalind Penhallow/);
    },
  },
];
