import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { FormsActor } from "./access";
import { HR_COMMENT_KIND, HR_DECISION_KIND, HR_REQUEST_KIND, clearRequestBells, formHref, ringBells } from "./hr-approval-bells";
import { accountEmail, listHrApprovers } from "./hr-approval-approvers";
import {
  HR_STATE_LABEL,
  awaitingHr,
  heldForHr,
  hrApprovalEnabled,
  isOverdue,
  mayReadHrDecision,
  templateRoutesToHr,
  waitingLabel,
  type HrApprovalState,
  type HrDecision,
} from "./hr-approval-rules";
import {
  finalizeInstance,
  finalizePreflight,
  loadInstance,
  type FinalizeOptions,
  type InstanceRow,
} from "./instances";

/**
 * ============================================================================
 * HR APPROVAL — WHAT HAPPENS, IN ORDER
 * ============================================================================
 *
 * The rules (who sees what, which forms, Central-time business days) are in
 * `hr-approval-rules.ts`. This file does the writes:
 *
 *   send      the manager's "Finalize and send for approval": Finalize's own
 *             checks run first (required fields, unverified policy), then the
 *             form is marked pending and HR's bell rings. Still a draft.
 *   decide    HR approves (the form is finalized as Finalize always did, and
 *             marked approved in the same write), rejects, or sends it back,
 *             with a note required for anything but approve. The creator's
 *             bell rings.
 *   comment   HR or the creator adds a note; the other's bell rings.
 *   view      the approval state and every note, for the creator and HR only.
 *
 * Every note is in `form_hr_approval_events`, which nothing serves to anybody
 * but the form's creator and HR (`mayReadHrDecision`).
 */

export class HrApprovalError extends Error {
  readonly status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.name = "HrApprovalError";
    this.status = status;
  }
}

const NOTE_LIMIT = 4000;

function cleanNote(note: unknown): string | null {
  if (typeof note !== "string") return null;
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed.slice(0, NOTE_LIMIT) : null;
}

/** "Corrective Action Form for Jane D. at Wornall" — the line every bell and list uses. */
export function formLine(instance: Pick<InstanceRow, "templateName" | "employeeName" | "locationName">): string {
  const where = instance.locationName ? ` at ${instance.locationName}` : "";
  return `${instance.templateName || "Form"} for ${instance.employeeName}${where}`;
}

/**
 * Whether this actor's Finalize sends the form to HR instead. Off with the flag, and while no active approver exists;
 * never for the two coaching forms; never for an HR approver's own form (owner:
 * "her own forms skip this step"); never for a preview identity, which no HR
 * account could answer.
 */
export async function finalizeGoesToHr(actor: FormsActor, instance: InstanceRow): Promise<boolean> {
  if (!hrApprovalEnabled() || !actor.verified || actor.hrApprover === true) return false;
  if (instance.status !== "draft") return false;
  /*
   * NO APPROVER, NO HOLD. With the flag on and nobody on `form_hr_approvers` (or the list unreadable), a form sent to
   * HR would wait with nobody able to approve it — so Finalize finalizes as before until an approver exists.
   */
  if ((await listHrApprovers()).length === 0) return false;
  // By the template's id, which every form row carries: the template's own permission decides (`templateRoutesToHr`).
  const { data, error } = await getSupabaseAdmin()
    .from("form_templates")
    .select("required_permission")
    .eq("id", instance.templateId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the form's template: ${error.message}`);
  const permission = (data as { required_permission?: unknown } | null)?.required_permission;
  return templateRoutesToHr(typeof permission === "string" ? permission : null);
}

async function recordHrEvent(instanceId: string, action: string, actor: string, note: string | null): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("form_hr_approval_events")
    .insert({ instance_id: instanceId, action, actor, note });
  if (error) throw new Error(`Could not record the HR approval step: ${error.message}`);
}

async function displayName(appUserId: string): Promise<string> {
  try {
    const { data } = await getSupabaseAdmin().from("app_users").select("display_name").eq("id", appUserId).maybeSingle();
    const name = (data as { display_name?: unknown } | null)?.display_name;
    return typeof name === "string" && name.trim().length > 0 ? name.trim() : "A manager";
  } catch {
    return "A manager";
  }
}

/** The manager's "Finalize and send for approval". Throws Finalize's own errors while the form can still be fixed. */
export async function sendForHrApproval(
  instanceId: string,
  actor: FormsActor,
  followUpDate: string | null,
  options: FinalizeOptions = {},
): Promise<InstanceRow> {
  const before = await loadInstance(instanceId);
  if (!before) throw new HrApprovalError("That form no longer exists.", 404);
  if (before.instance.status !== "draft") throw new HrApprovalError("This form is already finalized.");
  if (heldForHr(before.instance.hrApprovalState)) throw new HrApprovalError("This form is already waiting for HR approval.");
  if (before.instance.createdBy !== actor.id) {
    throw new HrApprovalError("Only the manager who created this form can send it for approval.", 403);
  }

  finalizePreflight(before, options);

  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("form_instances")
    .update({
      hr_approval_state: "pending",
      hr_approval_requested_at: now,
      hr_approval_follow_up_date: followUpDate,
      hr_approval_decided_at: null,
      hr_approval_decided_by: null,
    })
    .eq("id", instanceId)
    .eq("status", "draft")
    .or("hr_approval_state.is.null,hr_approval_state.eq.changes_requested,hr_approval_state.eq.rejected")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not send the form for approval: ${error.message}`);
  if (!data) throw new HrApprovalError("This form changed while you were sending it. Reload it and try again.");

  await recordHrEvent(
    instanceId,
    "submitted",
    actor.id,
    options.acknowledgeUnverifiedPolicy === true ? "Sent with an unverified policy reference, acknowledged by the manager." : null,
  );

  const [approvers, creator] = await Promise.all([listHrApprovers(), displayName(actor.id)]);
  await ringBells(
    approvers
      .filter((approver) => approver.id !== actor.id)
      .map((approver) => ({
        recipientEmail: approver.email,
        kind: HR_REQUEST_KIND,
        title: "A form is waiting for your approval",
        body: `${formLine(before.instance)}, sent by ${creator}.`,
        href: formHref(instanceId),
      })),
  );

  const after = await loadInstance(instanceId);
  return (after ?? before).instance;
}

/** HR's Approve, Reject or Send back. A note is required for anything but Approve. */
export async function decideHrApproval(
  instanceId: string,
  actor: FormsActor,
  decision: HrDecision,
  noteInput: unknown,
): Promise<InstanceRow> {
  if (actor.hrApprover !== true) throw new HrApprovalError("Only HR can decide on this form.", 403);
  const before = await loadInstance(instanceId);
  if (!before) throw new HrApprovalError("That form no longer exists.", 404);
  if (!heldForHr(before.instance.hrApprovalState)) throw new HrApprovalError("This form is not waiting for HR approval.");
  const note = cleanNote(noteInput);
  if (decision !== "approve" && !note) {
    throw new HrApprovalError(
      decision === "reject" ? "Add a note saying why the form is rejected." : "Add a note saying what needs to change.",
      400,
    );
  }

  const supabase = getSupabaseAdmin();
  let instance: InstanceRow;
  if (decision === "approve") {
    // Read the follow-up date the manager chose when they sent it.
    const { data } = await supabase.from("form_instances").select("hr_approval_follow_up_date").eq("id", instanceId).maybeSingle();
    const followUp = (data as { hr_approval_follow_up_date?: unknown } | null)?.hr_approval_follow_up_date;
    /*
     * THE FORM'S OWN HISTORY SAYS THE MANAGER FINALIZED IT — they pressed "Finalize and send for approval", and it
     * takes effect now. HR's approval is recorded only in the approval history, which only the creator and HR read
     * (owner: "im the only one to see [HR's] note or approval"); the general history is served to every reader of
     * the finalized form, so naming HR there would tell them.
     */
    instance = await finalizeInstance(instanceId, before.instance.createdBy, typeof followUp === "string" ? followUp : null, {
      // HR approving is the acknowledgement: they have read the form, edited it if they chose to, and approved it.
      acknowledgeUnverifiedPolicy: true,
      fromHrApproval: true,
      hrDecidedBy: actor.id,
    });
  } else {
    const state: HrApprovalState = decision === "reject" ? "rejected" : "changes_requested";
    const { data, error } = await supabase
      .from("form_instances")
      .update({ hr_approval_state: state, hr_approval_decided_at: new Date().toISOString(), hr_approval_decided_by: actor.id })
      .eq("id", instanceId)
      .eq("hr_approval_state", "pending")
      .select("id")
      .maybeSingle();
    if (error) throw new Error(`Could not record the decision: ${error.message}`);
    if (!data) throw new HrApprovalError("This form changed while you were deciding. Reload it and try again.");
    const reloaded = await loadInstance(instanceId);
    instance = (reloaded ?? before).instance;
  }

  const action = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "changes_requested";
  await recordHrEvent(instanceId, action, actor.id, note);
  await clearRequestBells(instanceId);

  const creatorEmail = await accountEmail(before.instance.createdBy);
  if (creatorEmail) {
    const title =
      decision === "approve"
        ? "HR approved your form"
        : decision === "reject"
          ? "HR rejected your form"
          : "HR sent your form back for changes";
    await ringBells([
      {
        recipientEmail: creatorEmail,
        kind: HR_DECISION_KIND,
        title,
        body: note ? `${formLine(before.instance)}. HR's note: ${note}` : `${formLine(before.instance)}.`,
        href: formHref(instanceId),
      },
    ]);
  }
  return instance;
}

/** A note from HR or from the form's creator. The other one's bell rings. */
export async function commentOnHrApproval(instanceId: string, actor: FormsActor, noteInput: unknown): Promise<void> {
  const loaded = await loadInstance(instanceId);
  if (!loaded) throw new HrApprovalError("That form no longer exists.", 404);
  if (!mayReadHrDecision(actor, loaded.instance)) throw new HrApprovalError("That form no longer exists.", 404);
  const note = cleanNote(noteInput);
  if (!note) throw new HrApprovalError("Write a note first.", 400);

  await recordHrEvent(instanceId, "commented", actor.id, note);

  const fromHr = actor.hrApprover === true && actor.id !== loaded.instance.createdBy;
  const recipients = fromHr
    ? [await accountEmail(loaded.instance.createdBy)].filter((email): email is string => Boolean(email))
    : (await listHrApprovers()).filter((approver) => approver.id !== actor.id).map((approver) => approver.email);
  await ringBells(
    recipients.map((recipientEmail) => ({
      recipientEmail,
      kind: HR_COMMENT_KIND,
      title: fromHr ? "HR added a note to your form" : "A manager replied on a form you are approving",
      body: `${formLine(loaded.instance)}: ${note}`,
      href: formHref(instanceId),
    })),
  );
}

/** HR changed a waiting form's values: recorded in the approval history, which the creator sees. */
export async function recordHrEdit(instanceId: string, actor: FormsActor): Promise<void> {
  await recordHrEvent(instanceId, "edited", actor.id, null);
}

/** A waiting form was deleted: HR's bell stops pointing at it. */
export async function withdrawnFromHr(instance: InstanceRow): Promise<void> {
  if (!awaitingHr(instance.hrApprovalState)) return;
  await clearRequestBells(instance.id);
}

export interface HrApprovalEntry {
  action: string;
  /** "HR" or "You" or the creator's name, never an account id. */
  by: string;
  note: string | null;
  at: string;
}

export interface HrApprovalView {
  state: HrApprovalState;
  label: string;
  requestedAt: string | null;
  waiting: string | null;
  overdue: boolean;
  /** The reader is HR and may decide now. */
  canDecide: boolean;
  /** The reader is HR and may edit the values now. */
  canEdit: boolean;
  history: HrApprovalEntry[];
}

/**
 * The approval panel for this reader, or null — for everybody but the form's
 * creator and HR, whatever the form's state, so nobody else learns there was
 * an approval at all.
 */
export async function hrApprovalViewFor(actor: FormsActor, instance: InstanceRow, now: Date = new Date()): Promise<HrApprovalView | null> {
  const state = instance.hrApprovalState;
  if (!state || !mayReadHrDecision(actor, instance)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("form_hr_approval_events")
    .select("action, actor, note, created_at")
    .eq("instance_id", instance.id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Could not read the approval history: ${error.message}`);
  const creatorName = await displayName(instance.createdBy);
  const history = ((data ?? []) as { action: string; actor: string; note: string | null; created_at: string }[]).map((row) => ({
    action: row.action,
    by: row.actor === actor.id ? "You" : row.actor === instance.createdBy ? creatorName : "HR",
    note: row.note,
    at: row.created_at,
  }));
  const hr = actor.hrApprover === true;
  return {
    state,
    label: HR_STATE_LABEL[state],
    requestedAt: instance.hrApprovalRequestedAt,
    waiting: state === "pending" ? waitingLabel(instance.hrApprovalRequestedAt, now) : null,
    overdue: state === "pending" && isOverdue(instance.hrApprovalRequestedAt, now),
    canDecide: hr && state === "pending",
    canEdit: hr && state === "pending",
    history,
  };
}

export interface HrQueueRow {
  id: string;
  line: string;
  templateName: string;
  employeeName: string;
  locationName: string | null;
  createdBy: string;
  createdByName: string;
  state: HrApprovalState;
  requestedAt: string | null;
  waiting: string;
  overdue: boolean;
}

/**
 * HR's tab: every form waiting for them, oldest first, then the ones they sent
 * back or rejected that the manager has not sent again. Empty for anybody but
 * an HR approver, and with the flag off.
 */
export async function listHrQueue(actor: FormsActor, now: Date = new Date()): Promise<HrQueueRow[]> {
  if (!hrApprovalEnabled() || actor.hrApprover !== true) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("form_instance_overview")
    .select("id, template_name, employee_name, location_name, created_by, hr_approval_state, hr_approval_requested_at")
    .in("hr_approval_state", ["pending", "changes_requested", "rejected"])
    .eq("status", "draft")
    .order("hr_approval_requested_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Could not read the forms waiting for approval: ${error.message}`);
  const rows = (data ?? []) as {
    id: string;
    template_name: string | null;
    employee_name: string;
    location_name: string | null;
    created_by: string;
    hr_approval_state: HrApprovalState;
    hr_approval_requested_at: string | null;
  }[];
  const creators = [...new Set(rows.map((row) => row.created_by))];
  const names = new Map<string, string>();
  if (creators.length > 0) {
    const users = await getSupabaseAdmin().from("app_users").select("id, display_name").in("id", creators);
    for (const user of (users.data ?? []) as { id: string; display_name: string | null }[]) {
      if (user.display_name) names.set(user.id, user.display_name);
    }
  }
  const order: Record<HrApprovalState, number> = { pending: 0, changes_requested: 1, rejected: 2, approved: 3 };
  return rows
    .map((row) => ({
      id: row.id,
      line: formLine({ templateName: row.template_name ?? "", employeeName: row.employee_name, locationName: row.location_name }),
      templateName: row.template_name ?? "Form",
      employeeName: row.employee_name,
      locationName: row.location_name,
      createdBy: row.created_by,
      createdByName: names.get(row.created_by) ?? "A manager",
      state: row.hr_approval_state,
      requestedAt: row.hr_approval_requested_at,
      waiting: waitingLabel(row.hr_approval_requested_at, now),
      overdue: row.hr_approval_state === "pending" && isOverdue(row.hr_approval_requested_at, now),
    }))
    .sort((a, b) => order[a.state] - order[b.state]);
}

/** HR's count for the Overview card and the tab badge. */
export async function hrQueueSummary(actor: FormsActor, now: Date = new Date()): Promise<{ pending: number; overdue: number } | null> {
  if (!hrApprovalEnabled() || actor.hrApprover !== true) return null;
  try {
    const rows = await listHrQueue(actor, now);
    const pending = rows.filter((row) => row.state === "pending");
    return { pending: pending.length, overdue: pending.filter((row) => row.overdue).length };
  } catch {
    return null;
  }
}

export interface MyHrFormRow {
  id: string;
  line: string;
  state: HrApprovalState;
  label: string;
  requestedAt: string | null;
}

/** The forms this manager sent to HR that are not approved yet, newest first. Only ever their own. */
export async function listMyFormsWithHr(actor: FormsActor): Promise<MyHrFormRow[]> {
  if (!hrApprovalEnabled() || !actor.verified) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("form_instance_overview")
    .select("id, template_name, employee_name, location_name, hr_approval_state, hr_approval_requested_at")
    .eq("created_by", actor.id)
    .in("hr_approval_state", ["pending", "changes_requested", "rejected"])
    .eq("status", "draft")
    .order("hr_approval_requested_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not read your forms with HR: ${error.message}`);
  return ((data ?? []) as {
    id: string;
    template_name: string | null;
    employee_name: string;
    location_name: string | null;
    hr_approval_state: HrApprovalState;
    hr_approval_requested_at: string | null;
  }[]).map((row) => ({
    id: row.id,
    line: formLine({ templateName: row.template_name ?? "", employeeName: row.employee_name, locationName: row.location_name }),
    state: row.hr_approval_state,
    label: HR_STATE_LABEL[row.hr_approval_state],
    requestedAt: row.hr_approval_requested_at,
  }));
}

export interface HrDecidedRow extends MyHrFormRow {
  /** HR's latest note to this manager on the form, if any. */
  latestNote: string | null;
}

/**
 * What the AI may read about HR approval for this asker (`read_hr_approvals`, CLAUDE.md rule 5): HR gets their queue;
 * anybody else gets only the forms THEY created that went to HR — waiting, sent back, rejected, or approved in the last
 * 30 days — with HR's latest note on each. Never another manager's form, never another manager's note.
 */
export async function readHrApprovalsFor(subject: string, verified: boolean, now: Date = new Date()): Promise<
  | { kind: "off" }
  | { kind: "hr"; queue: HrQueueRow[] }
  | { kind: "manager"; forms: HrDecidedRow[] }
> {
  if (!hrApprovalEnabled() || !verified || !subject) return { kind: "off" };
  const { resolveHrApprover } = await import("./hr-approval-approvers");
  const hrApprover = await resolveHrApprover(subject);
  const actor: FormsActor = { id: subject, role: null, verified: true, scope: null, visibility: null, hrApprover };
  if (hrApprover) return { kind: "hr", queue: await listHrQueue(actor, now) };

  const supabase = getSupabaseAdmin();
  const open = await listMyFormsWithHr(actor);
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const approved = await supabase
    .from("form_instance_overview")
    .select("id, template_name, employee_name, location_name, hr_approval_state, hr_approval_requested_at")
    .eq("created_by", subject)
    .eq("hr_approval_state", "approved")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (approved.error) throw new Error(`Could not read your approved forms: ${approved.error.message}`);
  const approvedRows: MyHrFormRow[] = ((approved.data ?? []) as {
    id: string;
    template_name: string | null;
    employee_name: string;
    location_name: string | null;
    hr_approval_requested_at: string | null;
  }[]).map((row) => ({
    id: row.id,
    line: formLine({ templateName: row.template_name ?? "", employeeName: row.employee_name, locationName: row.location_name }),
    state: "approved",
    label: HR_STATE_LABEL.approved,
    requestedAt: row.hr_approval_requested_at,
  }));
  const rows = [...open, ...approvedRows];
  const notes = new Map<string, string>();
  if (rows.length > 0) {
    const events = await supabase
      .from("form_hr_approval_events")
      .select("instance_id, actor, note, created_at")
      .in("instance_id", rows.map((row) => row.id))
      .neq("actor", subject)
      .not("note", "is", null)
      .order("created_at", { ascending: true })
      .limit(500);
    for (const event of (events.data ?? []) as { instance_id: string; note: string | null }[]) {
      if (event.note) notes.set(event.instance_id, event.note);
    }
  }
  return { kind: "manager", forms: rows.map((row) => ({ ...row, latestNote: notes.get(row.id) ?? null })) };
}
