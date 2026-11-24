import { expect, vi } from "vitest";

import { hrApprovalEnabled } from "@/lib/forms/hr-approval-rules";

import { KEARNEY, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision, type LoopView } from "./loop-stand-in";

/**
 * ============================================================================
 * HR APPROVAL OF FORMS (owner request, 23 Nov 2026; CLAUDE.md rule 5)
 * ============================================================================
 *
 * Every form but the Coaching Form waits for HR after "Finalize and send for approval", and while it waits only the
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
  return (await sentToHrIn(t)).id;
}

/** The same, with the thread the card was opened in (a chat edit of the form happens there). */
async function sentToHrIn(t: ReplayContext): Promise<{ id: string; thread: ReturnType<ReplayContext["thread"]> }> {
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
  return { id, thread };
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
    id: "nov24-hr-approval-edit-form-saves-while-hr-has-it",
    title:
      'the salon director who made it, on a form waiting for HR: "change the date on Peregrine Ashdown\'s write up to 11/12": edit_form saves it, the form stays with HR, HR is told, and the edit is in the approval history',
    report: 'Owner, 24 Nov 2026, asked "Should I let chat edits work there too, like edits on the form?": "sure"',
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const id = await sentToHr(t);
      const creator = String((t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id)!.created_by);
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      t.addRows!("app_users", [{ id: HR_ACCOUNT, email: "hr.wren@example.com", display_name: "Wren", status: "active" }]);
      t.addRows!("form_hr_approval_events", [{ instance_id: id, action: "submitted", actor: creator, note: null, created_at: "2026-11-20T15:00:00Z" }]);

      t.as("salon_director", KEARNEY);
      const model = loopStandIn((view: LoopView): LoopDecision =>
        lastResult(view, "edit_form") !== null || view.results.some((result) => result.tool === "edit_form")
          ? { text: "Changed the date; HR sees the updated form." }
          : { tool: "edit_form", input: { instance_id: id, values: { form_date: "2026-11-12" }, forms_on_file_evidence: evidenceFrom(view, "Peregrine Ashdown's write up") } },
      );
      t.loopModel!(model);
      await t.thread().say("change the date on Peregrine Ashdown's write up to 11/12");
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "edit_form")).at(-1)?.output as Record<string, unknown> | undefined;
      expect(output?.error, `edit_form refused the creator's edit:\n${JSON.stringify(output)}`).toBeUndefined();
      expect(t.values(id).form_date, "the waiting form was not changed").toBe("2026-11-12");
      const row = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id);
      expect(row?.hr_approval_state, "the chat edit took the form away from HR").toBe("pending");
      const events = (t.rows?.("form_hr_approval_events") ?? []).filter((event) => event.instance_id === id).map((event) => [event.action, event.actor]);
      expect(events, "the edit is not in the approval history").toContainEqual(["edited", creator]);
      const told = (t.rows?.("app_notifications") ?? []).filter((bell) => bell.kind === "form_hr_approval_updated");
      expect(told.map((bell) => [bell.recipient_email, bell.title])).toEqual([["hr.wren@example.com", "A form waiting for your approval was updated"]]);
    },
  },
  {
    id: "nov24-hr-approval-edit-form-other-manager-changes-nothing",
    title: 'control: another salon director at the same salon, on that form waiting for HR: "change the date on Peregrine Ashdown\'s write up to 11/12": nothing changes',
    report: "Owner, 24 Nov 2026: only the manager who made it, whoever sent it, and HR change a form while HR has it",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const id = await sentToHr(t);
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      t.addRows!("app_users", [{ id: HR_ACCOUNT, email: "hr.wren@example.com", display_name: "Wren", status: "active" }]);
      const before = t.values(id).form_date;
      t.as("salon_director", KEARNEY, "sd-other-tansy-brook");
      const model = loopStandIn((view: LoopView): LoopDecision =>
        lastResult(view, "edit_form") !== null || view.results.some((result) => result.tool === "edit_form")
          ? { text: "I can't change that one." }
          : { tool: "edit_form", input: { instance_id: id, values: { form_date: "2026-11-12" }, forms_on_file_evidence: evidenceFrom(view, "Peregrine Ashdown's write up") } },
      );
      t.loopModel!(model);
      await t.thread().say("change the date on Peregrine Ashdown's write up to 11/12");
      const output = model.views.flatMap((view) => view.results.filter((result) => result.tool === "edit_form")).at(-1)?.output as Record<string, unknown> | undefined;
      expect(output?.error, `edit_form wrote another manager's waiting form:\n${JSON.stringify(output)}`).toBeDefined();
      expect(t.values(id).form_date, "a form waiting for HR was changed by somebody else").toBe(before);
    },
  },
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
    id: "nov23-hr-approval-hr-sees-the-sibling-apps-queue",
    title:
      'HR: "what\'s waiting on me?" with the sibling link set: read_hr_approvals gives this app\'s form AND, under other_app, the form waiting for them in the sibling app',
    report: 'Owner, 23 Nov 2026: "can we pls add both views sunny/bubbles for colene so she doesnt have to go back and forth just make a 1 tab for sunny 1 tab for bubbles"',
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await sentToHr(t);
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      t.addRows!("app_users", [{ id: HR_ACCOUNT, email: "hr.wren@example.com", display_name: "Wren", status: "active" }]);
      const before = process.env.SIBLING_HR_SECRET;
      process.env.SIBLING_HR_SECRET = "replay-secret-0123456789abcdef0123456789";
      // The sibling app's server, answering as `hrQueueForPartner` does.
      const sibling = vi.fn(async () =>
        Response.json({
          app: "Sibling App",
          approver: true,
          forms: [
            {
              line: "Exit Form for Marlowe Fenwick at Invented Place",
              from: "Ines",
              state: "pending",
              requestedAt: "2026-11-23T14:00:00Z",
              waiting: "Sent today",
              overdue: false,
              path: "/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f",
            },
          ],
        }),
      );
      vi.stubGlobal("fetch", sibling);
      try {
        const result = asksHr(t, "district_manager", GLOBAL, HR_ACCOUNT);
        await t.thread().say("what's waiting on me in both apps?");
        const output = result();
        expect(JSON.stringify(output.waiting_for_you), "this app's waiting form did not reach the model").toMatch(/Peregrine Ashdown/);
        const other = output.other_app as Record<string, unknown> | undefined;
        expect(other, "the sibling app's queue did not reach the model").toBeDefined();
        expect(other!.app).toBe("Sibling App");
        expect(JSON.stringify(other!.waiting_for_you)).toMatch(/Exit Form for Marlowe Fenwick/);
        // Asked once, for this approver's own email only.
        expect(sibling).toHaveBeenCalledTimes(1);
        expect(String((sibling.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/partner\/hr-queue$/);
        expect(String(((sibling.mock.calls[0] as unknown[])[1] as RequestInit).body)).toContain('"approverEmail":"hr.wren@example.com"');
      } finally {
        vi.unstubAllGlobals();
        if (before === undefined) delete process.env.SIBLING_HR_SECRET;
        else process.env.SIBLING_HR_SECRET = before;
      }
    },
  },
  {
    id: "nov24-hr-approval-manager-edits-while-waiting-hr-reads-the-update",
    title:
      'owner: "have the option to edit the form but also make ure the edited form carries over to [HR] as approver so she sees the updated version": the manager saves the waiting form on the card, it stays with HR, and HR\'s "what\'s waiting on me?" still lists it',
    report:
      "Owner request, 24 Nov 2026: the sender is told HR approves the form before it is final and gets a notification; they may still edit it, and HR sees the updated version",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled() || !t.saveOnCard) return;
      const id = await sentToHr(t);
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      t.addRows!("app_users", [{ id: HR_ACCOUNT, email: "hr.wren@example.com", display_name: "Wren", status: "active" }]);

      // The salon director who sent it saves a change on the card, through the real route.
      t.as("salon_director", KEARNEY);
      await t.saveOnCard(id, { form_date: "2026-11-20" });
      expect(t.values(id).form_date, "the manager's change to the waiting form was not saved").toBe("2026-11-20");
      const row = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id);
      expect(row?.hr_approval_state, "editing took the form away from HR").toBe("pending");
      const updated = (t.rows?.("app_notifications") ?? []).filter((bell) => bell.kind === "form_hr_approval_updated");
      expect(updated.map((bell) => bell.recipient_email), "HR was not told the form was updated").toEqual(["hr.wren@example.com"]);

      // HR reads the same, updated form.
      const result = asksHr(t, "district_manager", GLOBAL, HR_ACCOUNT);
      await t.thread().say("what's waiting on me?");
      const waiting = result().waiting_for_you as Record<string, unknown>[];
      expect(waiting, "the edited form left HR's queue").toHaveLength(1);
      expect(JSON.stringify(waiting[0])).toMatch(/Corrective Action Form for Peregrine Ashdown/);
    },
  },
  /*
   * CHANGED ON PURPOSE (24 Nov 2026). This case asserted that the chat refuses the manager's edit of the form they sent
   * to HR ("waiting for HR approval", change it on the form). Asked which should happen when the manager who sent a form
   * asks the chat to change it while it waits, the owner chose "Chat edits it": the creator, its senders and HR may, as
   * on the form, and HR is told. The intent kept from "never a general save error": the chat saves it, the reply is no
   * save failure, and the form stays with HR. (The refusal stays for anybody else: nov24-hr-approval-edit-form-other-manager-changes-nothing.)
   */
  {
    id: "nov24-hr-approval-chat-edit-of-a-waiting-form-saves-never-a-save-error",
    title:
      'the manager asks the chat to change the form they sent to HR ("change the date on Peregrine\'s write up to 11/20"): edit_form saves it, never a general save error, and the form stays with HR',
    report: 'Owner, 24 Nov 2026: "In both apps, the chat should say "waiting for HR approval" instead of a general save error."; then, of the creator\'s chat edit: "Chat edits it"',
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      const { id, thread } = await sentToHrIn(t);
      // An active HR approver, as in production, so the hold is live.
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      t.addRows!("app_users", [{ id: HR_ACCOUNT, email: "hr.wren@example.com", display_name: "Wren", status: "active" }]);
      const model = loopStandIn((view: LoopView): LoopDecision => {
        const edited = lastResult(view, "edit_form") as Record<string, unknown> | undefined;
        return edited ? { text: edited.error ? String(edited.error) : "Changed the date; HR sees the updated form." } : { tool: "edit_form", input: { instance_id: id, values: { form_date: "2026-11-20" } } };
      });
      t.loopModel!(model);
      const reply = await thread.say("change the date on Peregrine's write up to 11/20");
      const result = lastResult(model.views.at(-1)!, "edit_form") as Record<string, unknown>;
      expect(result?.error, `edit_form refused the creator's chat edit:\n${JSON.stringify(result)}`).toBeUndefined();
      expect(t.values(id).form_date, "the chat did not change the form").toBe("2026-11-20");
      expect(reply.content, "a generic save failure reached the manager").not.toMatch(/couldn't save|could not be saved|not_draft/i);
      const row = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id);
      expect(row?.hr_approval_state, "the form left HR").toBe("pending");
    },
  },
  {
    id: "nov23-hr-approval-archived-form-leaves-hrs-queue",
    title: 'HR: "what\'s waiting on me?" after a duplicate pending draft was archived: read_hr_approvals lists only the form still in use',
    report: "QA, 23 Nov 2026: a duplicate exit draft archived while still pending kept showing in HR's \"Needs your decision\"",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await sentToHr(t);
      const duplicate = await sentToHr(t);
      // As `archiveInstance` leaves it: archived, its HR state untouched.
      const row = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === duplicate);
      row!.archived_at = "2026-11-23T15:30:00Z";
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      const result = asksHr(t, "district_manager", GLOBAL, HR_ACCOUNT);
      await t.thread().say("what's waiting on me?");
      // The two forms read the same; the reader gives the model no ids, so the count is what tells them apart.
      const waiting = result().waiting_for_you as Record<string, unknown>[];
      expect(waiting, "the archived duplicate reached HR's queue, or the form still in use did not").toHaveLength(1);
      expect(JSON.stringify(waiting[0])).toMatch(/Corrective Action Form for Peregrine Ashdown/);
      expect(row!.hr_approval_state, "archiving changed the stored state").toBe("pending");
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
  {
    id: "nov23-hr-approval-admin-edit-never-reaches-a-revision-waiting-for-hr",
    title:
      'an administrator: "change the date on Peregrine\'s write up to 11/12" while the store manager\'s revision of it waits for HR: nothing about the revision, its sender or HR reaches the model, and nothing is written',
    report:
      'Owner, 23 Nov 2026: "are u sure this doesnt leak information, that other people cant see what a certain manager created? make sure history also in chat people dont see what a certain person created pls."',
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      // The store manager's Corrective Action, finalized; then their revision of it, sent to HR.
      const id = await sentToHr(t);
      const original = (t.rows?.("form_instances") ?? []).find((candidate) => candidate.id === id)!;
      const manager = String(original.created_by);
      original.hr_approval_state = "approved";
      original.status = "finalized";
      original.finalized_at = "2026-11-20T16:00:00Z";
      const revision = "0c1d2e3f-4a5b-4c6d-8e7f-8091a2b3c4d5";
      t.addRows!("form_instances", [
        {
          ...original,
          id: revision,
          status: "draft",
          finalized_at: null,
          revises_instance_id: id,
          hr_approval_state: "pending",
          hr_approval_requested_at: "2026-11-23T15:00:00Z",
          hr_approval_requested_by: manager,
          hr_approval_senders: [manager],
        },
      ]);
      const before = JSON.stringify(t.values(id));

      t.as("admin", GLOBAL, "admin-tamsin-reeve");
      const model = loopStandIn((view: LoopView): LoopDecision =>
        lastResult(view, "edit_form") !== null || view.results.some((result) => result.tool === "edit_form")
          ? { text: "I couldn't change that form." }
          : {
              tool: "edit_form",
              input: { instance_id: id, values: { form_date: "2026-11-12" }, forms_on_file_evidence: evidenceFrom(view, "Peregrine Ashdown's write up") },
            },
      );
      t.loopModel!(model);
      const reply = await t.thread().say("change the date on Peregrine Ashdown's write up to 11/12");

      const seen = JSON.stringify(model.views.flatMap((view) => view.results));
      expect(seen, "edit_form was not called (the case proves nothing)").toContain("edit_form");
      expect(seen, "the revision waiting for HR reached an administrator").not.toContain(revision);
      expect(seen, "the store manager's account reached an administrator").not.toContain(manager);
      expect(seen).not.toMatch(/HR approval|waiting for HR|hr_approval/i);
      /*
       * One plain answer, naming nothing. The agent loop already answered this way before the leak audit (its edit
       * errors are "could not be changed just now"); the leak was the card's "Edit as new draft" route
       * (hr-approval-visibility.test.ts, which fails on the old code). This case keeps the chat path to that.
       */
      expect(seen, "the refusal is not a plain one").toMatch(/could not be changed just now|can't be edited right now/);
      expect(seen).not.toMatch(/No such form/);
      expect(reply.content).not.toMatch(/HR/);
      expect(JSON.stringify(t.values(id)), "the finalized form was written").toBe(before);
    },
  },
  /*
   * QA on #1280 (24 Nov 2026): read_hr_approvals checks the HR approval page's own permission only where the page would:
   * an HR approver reads their queue and a manager who sent a form reads their own forms' state, whatever their role;
   * someone with neither and without Form Monitoring is refused. The "employee" role has no view_form_monitoring.
   */
  {
    id: "nov24-hr-approval-approver-without-form-monitoring-reads-the-queue",
    title: 'an HR approver whose role lacks Form Monitoring: "what\'s waiting on me?" still lists the form waiting for them (never refused)',
    report: "QA on #1280, 24 Nov 2026: the new page-permission check must not refuse an HR approver",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await sentToHr(t);
      t.addRows!("form_hr_approvers", [{ app_user_id: HR_ACCOUNT, revoked_at: null }]);
      const result = asksHr(t, "employee", GLOBAL, HR_ACCOUNT);
      await t.thread().say("what's waiting on me?");
      const output = result();
      expect(output.refused, JSON.stringify(output).slice(0, 300)).toBeUndefined();
      expect(output.reader).toBe("HR approver");
      expect(output.waiting_for_you as unknown[], "the waiting form did not reach the model").toHaveLength(1);
    },
  },
  {
    id: "nov24-hr-approval-sender-without-form-monitoring-reads-their-own-form",
    title: 'the manager who sent it, with a role that lacks Form Monitoring: "has HR approved Peregrine\'s write up yet?" still gives their own form, waiting for HR (never refused)',
    report: "QA on #1280, 24 Nov 2026: a sender (the #1303 receipt) is never refused about their own form",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await sentToHr(t);
      const result = asksHr(t, "employee", KEARNEY);
      await t.thread().say("has HR approved Peregrine's write up yet?");
      const output = result();
      expect(output.refused, JSON.stringify(output).slice(0, 300)).toBeUndefined();
      const forms = output.your_forms_with_hr as Record<string, unknown>[];
      expect(forms, "the sender's own waiting form did not reach the model").toHaveLength(1);
      expect(forms[0]!.state).toBe("Waiting for HR approval");
    },
  },
  {
    id: "nov24-hr-approval-no-page-no-forms-is-refused",
    title: "control: someone whose role lacks Form Monitoring, who is not HR and sent no form, is refused in one line and nothing is read",
    report: "QA on #1280, 24 Nov 2026: the check refuses only someone with nothing to see",
    status: "fixed",
    fixFlags: FLAGS,
    async run(t) {
      if (!t.loopOn?.() || !hrApprovalEnabled()) return;
      await sentToHr(t);
      const result = asksHr(t, "employee", KEARNEY, "someone-else");
      await t.thread().say("has HR approved my form?");
      const output = result();
      expect(String(output.refused ?? ""), JSON.stringify(output).slice(0, 300)).toMatch(/cannot open, and they have no forms with HR/);
      expect(output.your_forms_with_hr).toBeUndefined();
    },
  },
];
