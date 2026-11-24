import { AsyncLocalStorage } from "node:async_hooks";

import { editableDraft, heldForHr, type HrApprovalState } from "./hr-approval-rules";

/**
 * ============================================================================
 * A CHAT EDIT OF A FORM WAITING FOR HR (owner, 24 Nov 2026)
 * ============================================================================
 *
 * Its creator and anyone who sent it may change a form while it waits for HR, and HR sees the updated version
 * (`mayEditWhileWithHr`). The card's Save did that from the start. Asked "Should I let chat edits work there too, like
 * edits on the form?", the owner answered: "sure".
 *
 * The chat's writers refuse a waiting form, and the database lets its values change only through
 * `form_hr_approval_write_values`. So the chat's edit runs inside this scope, for that ONE form, after the tool has
 * checked the person may edit it. Inside it, and only for that form, the writers take the path past the hold. Nothing
 * outside the scope, and no other form, is affected.
 */
const scope = new AsyncLocalStorage<{ instanceId: string }>();

export function withHrEditScope<T>(instanceId: string, run: () => Promise<T>): Promise<T> {
  return scope.run({ instanceId }, run);
}

/** Whether this write is the checked chat edit of this waiting form. */
export function inHrEditScope(instanceId: string): boolean {
  return scope.getStore()?.instanceId === instanceId;
}

/** `editableDraft`, plus the waiting form being edited inside its scope. */
export function editableDraftNow(instance: { id: string; status: string; hrApprovalState?: HrApprovalState | null }): boolean {
  if (editableDraft(instance)) return true;
  return instance.status === "draft" && heldForHr(instance.hrApprovalState ?? null) && inHrEditScope(instance.id);
}
