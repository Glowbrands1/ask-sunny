import "server-only";

import { refreshedActionPlan } from "./ca-action-plan";
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
  const loaded = options.loaded ?? (await loadInstance(instanceId));
  if (!loaded || loaded.instance.status !== "draft") return [];
  const saved = options.checked ?? {};
  const values = [
    ...loaded.values.map((row) => (row.fieldKey in saved ? { ...row, checked: saved[row.fieldKey]! } : row)),
    ...Object.entries(saved)
      .filter(([key]) => !loaded.values.some((row) => row.fieldKey === key))
      .map(([fieldKey, checked]) => ({ fieldKey, value: null, checked, filledBy: "manager", provenance: {} })),
  ];
  const next = refreshedActionPlan({
    templateKey: loaded.instance.templateKey,
    document: parseFormDocument(loaded.version.document),
    variantKey: loaded.instance.variantKey,
    employeeName: loaded.instance.employeeName,
    values,
    notes: options.notes,
  });
  if (!next) return [];
  const written = await applyAssistantDraft(
    instanceId,
    { values: { [next.key]: next.value }, checked: {} },
    actorId,
    { [next.key]: next.provenance },
  );
  return next.key in written.accepted.values ? [next.key] : [];
}
