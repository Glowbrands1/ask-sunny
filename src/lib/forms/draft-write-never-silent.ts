/*
 * ============================================================================
 * A DRAFT WRITE IS NEVER LOST IN SILENCE (DRAFT_WRITE_NEVER_SILENT_ENABLED)
 * ============================================================================
 *
 * QA's live finding (Sunny round 17, 10 Nov 2026): "create a coaching form for <A>, she missed the monthly meeting on
 * 10/10/26" → Create saved only the Name and Date. The drafting model had run and written Details (the "left out
 * <surname>" line is only built over filled Details), the route answered 200, and nothing was saved: the one writer
 * (`form-write.ts`) refuses a write as a whole when any one field is refused.
 *
 * With the flag on, the draft route retries such a write once without the refused fields, and when that saves nothing
 * either, says so. Pure helpers; the route makes the calls.
 */

export interface DraftValues {
  values: Record<string, string>;
  checked: Record<string, string[]>;
}

/** The draft without the fields the writer refused. */
export function withoutRefused<T extends DraftValues>(draft: T, refused: Iterable<string>): T {
  const keys = new Set(refused);
  return {
    ...draft,
    values: Object.fromEntries(Object.entries(draft.values).filter(([key]) => !keys.has(key))),
    checked: Object.fromEntries(Object.entries(draft.checked).filter(([key]) => !keys.has(key))),
  };
}

export function fieldCount(draft: { values: Record<string, unknown>; checked: Record<string, unknown> }): number {
  return Object.keys(draft.values).length + Object.keys(draft.checked).length;
}

/** The notice when the draft saved nothing. */
export const DRAFT_NOTHING_SAVED_NOTICE =
  "Nothing was saved on this draft: the prefill couldn't be written to the form. Fill it in below, or tell me what it should say and I'll add it.";

/**
 * DRAFT_WROTE_NOTHING_NOTICE_ENABLED: the notice when the draft had no account to write from, so its Details (the
 * narrative) are blank. QA's r21 live check (10 Nov 2026): "make me a coaching form for <name>", the app asked "What
 * happened?", Create saved only the Name and Date, and nothing was said.
 */
export const DRAFT_WROTE_NOTHING_NOTICE =
  "The details are blank: you haven't told me what happened yet, so there was nothing to draft from. Tell me here what happened and I'll write it in, or fill it in below.";
