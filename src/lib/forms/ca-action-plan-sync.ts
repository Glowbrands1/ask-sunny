import "server-only";

import {
  actionPlanManagerOnlyEnabled,
  actionPlanSentencesEnabled,
  attendanceActionPlanEnabled,
} from "@/lib/config/chat-quality-flags";

import { collapseToTwoSentences } from "./action-plan-sentences";
import { attendanceActionPlan, isAttendancePlan, missedMeetingNotLateness } from "./attendance-action-plan";
import { ACTION_PLAN_SOURCE, fixedActionPlanKey, refreshedActionPlan } from "./ca-action-plan";
import { parseFormDocument } from "./document";
import { applyAssistantDraft, loadInstance, type LoadedInstance } from "./instances";
import { PAYROLL_AMOUNT_KEY } from "./payroll-amount-field";
import { planWithPayrollSentence } from "./plan-payroll-sentence";

/**
 * Rebuilds the Corrective Action Form's Action Plan after a change made in chat
 * — a policy added or removed, the payroll answer corrected, the offense box
 * changed — so the plan names what the form now says. Only a plan Ask Sunny
 * built is touched; see `ca-action-plan.ts`. Returns the keys it wrote.
 *
 * `notes` are the manager's words this turn, read only for an amount to deduct.
 * A caller that already holds the form as it was, and knows the boxes it just
 * saved, passes both (`loaded`, `checked`) instead of having it read again.
 *
 * `amountSentence` (CARD_CHANGE_PLAN_REBUILD_ENABLED, the finalized form's
 * Change something panel): with payroll deduct Yes and the Payroll deduction
 * amount filled, the rebuilt plan says "<first name> will be payroll deducted
 * <amount>." before its closing. No other caller passes it.
 */
export async function syncCorrectiveActionPlan(
  instanceId: string,
  actorId: string,
  options: { notes?: string; loaded?: LoadedInstance; checked?: Record<string, string[]>; amountSentence?: boolean } = {},
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
  }) ?? (options.amountSentence ? planBuiltHere(loaded, values) : null);
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
  const rebuilt =
    // MEETING_NOT_LATENESS_PLAN_ENABLED: what the form says happened, and this turn's words.
    attendanceActionPlanEnabled() &&
    isAttendancePlan(attendanceInput) &&
    !missedMeetingNotLateness([values.find((row) => row.fieldKey === "observation")?.value ?? "", options.notes ?? ""].join("\n"))
      ? { ...refreshed, value: attendanceActionPlan(attendanceInput) }
      : actionPlanSentencesEnabled()
        ? { ...refreshed, value: collapseToTwoSentences(refreshed.value) }
        : refreshed;
  const next = options.amountSentence
    ? {
        ...rebuilt,
        value: planWithPayrollSentence(withoutDeductionSentence(rebuilt.value), {
          answer: values.find((row) => row.fieldKey === "payroll_deduct")?.checked?.[0] === "yes" ? "yes" : null,
          amount: values.find((row) => row.fieldKey === PAYROLL_AMOUNT_KEY)?.value?.trim() || null,
          employeeName: loaded.instance.employeeName,
        }),
      }
    : rebuilt;
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

/*
 * `amountSentence` only. The plan as it stands, when the app built it and the
 * rebuild finds nothing to change (production's two-sentence plan names no
 * deduction): the amount sentence still goes on it.
 */
function planBuiltHere(
  loaded: LoadedInstance,
  values: readonly { fieldKey: string; value: string | null; filledBy: string; provenance?: Record<string, unknown> | null }[],
): { key: string; value: string; provenance: Record<string, unknown> } | null {
  const plan = fixedActionPlanKey(loaded.instance.templateKey, parseFormDocument(loaded.version.document), loaded.instance.variantKey);
  const row = plan ? values.find((entry) => entry.fieldKey === plan.key) : undefined;
  if (!plan || !row?.value?.trim() || row.filledBy !== "ai" || row.provenance?.source !== ACTION_PLAN_SOURCE) return null;
  return { key: plan.key, value: row.value, provenance: row.provenance };
}

/* An earlier "<name> will be payroll deducted $10." goes before the new figure (or a No) is written. */
function withoutDeductionSentence(plan: string): string {
  return plan
    .replace(/(^|[.!?]\s+)[^.!?]*\bwill be payroll deducted \$\d[\d,]*(?:\.\d{1,2})?\.(?=\s|$)\s*/g, "$1")
    .trim();
}

