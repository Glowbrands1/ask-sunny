import "server-only";

import {
  actionPlanManagerOnlyEnabled,
  actionPlanSentencesEnabled,
  attendanceActionPlanEnabled,
} from "@/lib/config/chat-quality-flags";

import { collapseToTwoSentences } from "./action-plan-sentences";
import { attendanceActionPlan, isAttendancePlan, missedMeetingNotLateness } from "./attendance-action-plan";
import { fixedActionPlanKey, refreshedActionPlan } from "./ca-action-plan";
import { parseFormDocument } from "./document";
import { applyAssistantDraft, loadInstance, type LoadedInstance } from "./instances";

/**
 * Rebuilds the Corrective Action Form's Action Plan after a change made in chat
 * — a policy added or removed, the payroll answer corrected, the offense box
 * changed — so the plan names what the form now says. Only a plan Ask Sunny
 * built is touched; see `ca-action-plan.ts`. Returns the keys it wrote.
 *
 * `notes` are the manager's words this turn, read only for an amount to deduct.
 * A caller that already holds the form as it was, and knows the boxes it just
 * saved, passes both (`loaded`, `checked`) instead of having it read again.
 */
export async function syncCorrectiveActionPlan(
  instanceId: string,
  actorId: string,
  options: { notes?: string; loaded?: LoadedInstance; checked?: Record<string, string[]> } = {},
): Promise<string[]> {
  // Manager-only: no plan is built, so none is rebuilt either.
  if (actionPlanManagerOnlyEnabled()) return [];
  const loaded = options.loaded ?? (await loadInstance(instanceId));
  if (!loaded || loaded.instance.status !== "draft") return [];
  const saved = options.checked ?? {};
  const values = [
    ...loaded.values.map((row) => (row.fieldKey in saved ? { ...row, checked: saved[row.fieldKey]! } : row)),
    ...Object.entries(saved)
      .filter(([key]) => !loaded.values.some((row) => row.fieldKey === key))
      .map(([fieldKey, checked]) => ({ fieldKey, value: null, checked, filledBy: "manager", provenance: {} })),
  ];
  const refreshed = refreshedActionPlan({
    templateKey: loaded.instance.templateKey,
    document: parseFormDocument(loaded.version.document),
    variantKey: loaded.instance.variantKey,
    employeeName: loaded.instance.employeeName,
    values,
    notes: options.notes,
  });
  if (!refreshed) return [];
  /*
   * ATTENDANCE_ACTION_PLAN_ENABLED: the rebuilt plan of an Attendance policy
   * keeps Pau's attendance wording, so a later edit in chat does not put the
   * generic sentence back. The policies are the ones the plan was rebuilt for
   * (its own provenance), the closing the form's.
   */
  const policies = Array.isArray(refreshed.provenance.policies) ? (refreshed.provenance.policies as string[]) : [];
  const planField = fixedActionPlanKey(
    loaded.instance.templateKey,
    parseFormDocument(loaded.version.document),
    loaded.instance.variantKey,
  );
  const attendanceInput = {
    citedPolicies: policies,
    employeeName: loaded.instance.employeeName,
    payroll: { answer: null, amount: null },
    closing: planField?.closing ?? null,
  };
  const next =
    // MEETING_NOT_LATENESS_PLAN_ENABLED: what the form says happened, and this turn's words.
    attendanceActionPlanEnabled() &&
    isAttendancePlan(attendanceInput) &&
    !missedMeetingNotLateness([values.find((row) => row.fieldKey === "observation")?.value ?? "", options.notes ?? ""].join("\n"))
      ? { ...refreshed, value: attendanceActionPlan(attendanceInput) }
      : actionPlanSentencesEnabled()
        ? { ...refreshed, value: collapseToTwoSentences(refreshed.value) }
        : refreshed;
  const held = values.find((row) => row.fieldKey === next.key)?.value ?? "";
  if (next.value === held) return [];
  const written = await applyAssistantDraft(
    instanceId,
    { values: { [next.key]: next.value }, checked: {} },
    actorId,
    { [next.key]: next.provenance },
  );
  return next.key in written.accepted.values ? [next.key] : [];
}
