import "server-only";

import type { AskResponse } from "@/lib/ai/types";

import { checkboxGroupsForVariant, interpolate, parseFormDocument } from "./document";
import { updatedLines } from "./form-diff-reply";
import { snapshotDiff, snapshotOf, type FormSnapshot } from "./form-snapshot";
import { authorizeInstance } from "./instance-scope";
import type { LoadedInstance } from "./instances";

/**
 * ============================================================================
 * NO FALSE "UPDATED" (FORM_EDIT_NOOP_GUARD_ENABLED, STEP 4)
 * ============================================================================
 *
 * Design of 4 Nov 2026. On a turn the edit tool was offered, the reply about
 * the form comes only from what the saved form shows changed — the open form
 * read before the turn and again after it (`snapshotDiff`) — whichever path
 * wrote: the tool itself (`form-edit-tool.ts`), or the old chain it handed off
 * to (the redraft, the same-form copy, the revision). One "Updated: <label>:
 * <value>" line per real change; nothing changed, "I didn't change anything
 * on the form. Tell me which part to change and what it should say."
 * (`updatedLines`). The path's own words are never kept beside an edit.
 *
 * Read with "view" authorization; no model is called and nothing is written.
 * Loaded only by the chat route's guarded `await import()`.
 */

/** Each checkbox group's option labels, by group and option key. */
export function optionLabelsOf(loaded: LoadedInstance): Record<string, Record<string, string>> {
  const document = parseFormDocument(loaded.version.document);
  return Object.fromEntries(
    checkboxGroupsForVariant(document, loaded.instance.variantKey).map((group) => [
      group.key,
      Object.fromEntries(group.options.map((option) => [option.key, interpolate(option.label, null) || option.key])),
    ]),
  );
}

/** The open form as saved before the turn. Null when it cannot be read. */
export async function formBeforeTurn(instanceId: string, request: Request): Promise<FormSnapshot | null> {
  try {
    const { loaded } = await authorizeInstance(request, instanceId, "view");
    return snapshotOf(loaded);
  } catch {
    return null;
  }
}

/**
 * The answer about the form, from the saved diff. `keepUnchanged`: a path's
 * answer that wrote nothing and claims nothing (the copy's "replace them?")
 * is kept when the form did not change.
 */
export async function replyFromSavedDiff(input: {
  readonly request: Request;
  readonly before: FormSnapshot;
  readonly answer: AskResponse;
  readonly keepUnchanged?: boolean;
}): Promise<AskResponse> {
  let loaded: LoadedInstance;
  try {
    ({ loaded } = await authorizeInstance(input.request, input.before.instanceId, "view"));
  } catch {
    return input.answer;
  }
  const after = snapshotOf(loaded);
  const changed = snapshotDiff(input.before, after);
  if (changed.length === 0 && input.keepUnchanged) return input.answer;
  const { formUpdate: _claimed, ...rest } = input.answer;
  void _claimed;
  return {
    ...rest,
    content: updatedLines(changed, after.labels, optionLabelsOf(loaded)),
    citations: [],
    coverage: "not_applicable",
    ...(changed.length > 0 ? { formUpdate: { instanceId: input.before.instanceId, updated: changed.map((change) => change.key) } } : {}),
  };
}
