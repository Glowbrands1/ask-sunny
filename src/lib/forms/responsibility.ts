import {
  AI_WRITABLE,
  fieldsForVariant,
  checkboxGroupsForVariant,
  numberedListsForVariant,
  responsibilityMap,
  type FieldResponsibility,
  type FormDocument,
  type FormField,
} from "./document";

/**
 * WHO IS ALLOWED TO WRITE WHAT, ENFORCED ON THE OUTPUT.
 *
 * The assistant is told which fields it may draft, and this module assumes that
 * telling it achieved nothing. Every value a model returns is checked against
 * the template's own metadata and dropped if the field is not its to write.
 * The guard runs on the way OUT of the model, so a prompt injection inside a
 * pasted policy document, a confused tool call, or a future model that ignores
 * its instructions all land in the same place: the value is discarded and the
 * field stays as the person left it.
 *
 * THREE RULES, IN ORDER OF HOW MUCH THEY MATTER.
 *
 *   1. A SIGNATURE IS NEVER WRITTEN. Not by the assistant, not by the app, not
 *      by an import. There is no code path that fills one, which is why a
 *      signature block has no key: there is nothing to write into.
 *
 *   2. ONLY `ai` FIELDS TAKE MODEL OUTPUT. `manager`, `employee` and `manual`
 *      belong to people; `system` is filled from the record by the server. A
 *      value returned for any of them is dropped and reported.
 *
 *   3. UNKNOWN KEYS ARE DROPPED. A key that is not in this template version's
 *      document cannot be stored — which also means a model cannot invent a
 *      field, and a stale draft cannot write into a version that no longer has
 *      that field.
 *
 * Nothing here trusts the caller's idea of which fields exist: the map comes
 * from the stored template version, resolved for the variant in play.
 */

export interface DraftValues {
  values: Record<string, string>;
  checked: Record<string, string[]>;
}

export interface EnforcementResult extends DraftValues {
  /** Keys the model wrote that it does not own, with the reason. */
  rejected: { key: string; reason: string }[];
}

/**
 * Keeps only what the assistant is allowed to have written.
 *
 * Returns the accepted values AND what was thrown away, because "the model
 * tried to sign the form" is something an administrator should be able to see
 * rather than something that silently worked.
 */
export function enforceResponsibilities(
  document: FormDocument,
  variantKey: string | null,
  draft: Partial<DraftValues>,
): EnforcementResult {
  const allowed = responsibilityMap(document, variantKey);
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  const rejected: { key: string; reason: string }[] = [];

  const optionKeys = new Map<string, Set<string>>();
  for (const group of checkboxGroupsForVariant(document, variantKey)) {
    optionKeys.set(group.key, new Set(group.options.map((option) => option.key)));
  }

  for (const [key, value] of Object.entries(draft.values ?? {})) {
    const responsibility = allowed.get(key);
    if (!responsibility) {
      rejected.push({ key, reason: "not a field on this template version" });
      continue;
    }
    if (responsibility === "signature") {
      rejected.push({ key, reason: "signature fields are never filled" });
      continue;
    }
    if (!AI_WRITABLE.includes(responsibility)) {
      rejected.push({ key, reason: `${responsibility} fields are not drafted by Ask Sunny` });
      continue;
    }
    if (typeof value !== "string") {
      rejected.push({ key, reason: "value was not text" });
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length > 0) values[key] = trimmed;
  }

  for (const [key, selected] of Object.entries(draft.checked ?? {})) {
    const responsibility = allowed.get(key);
    if (!responsibility) {
      rejected.push({ key, reason: "not a checkbox group on this template version" });
      continue;
    }
    if (!AI_WRITABLE.includes(responsibility)) {
      rejected.push({ key, reason: `${responsibility} groups are not ticked by Ask Sunny` });
      continue;
    }
    const options = optionKeys.get(key) ?? new Set<string>();
    const kept = (Array.isArray(selected) ? selected : []).filter((option) =>
      options.has(option),
    );
    const invented = (Array.isArray(selected) ? selected : []).filter(
      (option) => !options.has(option),
    );
    if (invented.length > 0) {
      rejected.push({ key, reason: `options not on this form: ${invented.join(", ")}` });
    }
    if (kept.length > 0) checked[key] = kept;
  }

  return { values, checked, rejected };
}

/**
 * The fields the assistant is asked to write, in document order.
 *
 * The prompt is built from this rather than from the whole form, so the model
 * is never shown a field it could not fill anyway — and a policy-grounded field
 * is marked, because those come with a different instruction.
 */
export function draftableFields(
  document: FormDocument,
  variantKey: string | null,
): FormField[] {
  return fieldsForVariant(document, variantKey).filter((field) =>
    AI_WRITABLE.includes(field.responsibility),
  );
}

export function draftableCheckboxGroups(document: FormDocument, variantKey: string | null) {
  return checkboxGroupsForVariant(document, variantKey).filter((group) =>
    AI_WRITABLE.includes(group.responsibility),
  );
}

export function draftableNumberedLists(document: FormDocument, variantKey: string | null) {
  return numberedListsForVariant(document, variantKey).filter((list) =>
    AI_WRITABLE.includes(list.responsibility),
  );
}

/**
 * What a person is expected to complete before this form can be finalized.
 *
 * `manual` is excluded deliberately: those are filled on the printed page after
 * it leaves the app, so requiring them on screen would make every DMIT EPP
 * impossible to finalize. Signatures are excluded for the same reason.
 */
export function requiredOfPeople(
  document: FormDocument,
  variantKey: string | null,
): FormField[] {
  return fieldsForVariant(document, variantKey).filter(
    (field) => field.responsibility === "manager" || field.responsibility === "employee",
  );
}

/** Whether a value may be stored against a field by a human editor. */
export function canPersonEdit(responsibility: FieldResponsibility): boolean {
  return (
    responsibility === "ai" ||
    responsibility === "manager" ||
    responsibility === "employee" ||
    responsibility === "system"
  );
}

/**
 * Filters a whole submission the way `enforceResponsibilities` filters a draft,
 * but for a PERSON rather than the assistant.
 *
 * A manager may edit an AI-drafted field — that is the point of drafting — and
 * may not write into a signature or a hand-filled line. The distinction between
 * this and the assistant's guard is exactly `AI_WRITABLE` versus
 * `canPersonEdit`, kept as two functions so neither can be widened by accident
 * while editing the other.
 */
export function enforcePersonEdit(
  document: FormDocument,
  variantKey: string | null,
  submitted: Partial<DraftValues>,
): EnforcementResult {
  const allowed = responsibilityMap(document, variantKey);
  const values: Record<string, string> = {};
  const checked: Record<string, string[]> = {};
  const rejected: { key: string; reason: string }[] = [];

  const optionKeys = new Map<string, Set<string>>();
  for (const group of checkboxGroupsForVariant(document, variantKey)) {
    optionKeys.set(group.key, new Set(group.options.map((option) => option.key)));
  }

  for (const [key, value] of Object.entries(submitted.values ?? {})) {
    const responsibility = allowed.get(key);
    if (!responsibility) {
      rejected.push({ key, reason: "not a field on this template version" });
      continue;
    }
    if (!canPersonEdit(responsibility)) {
      rejected.push({ key, reason: `${responsibility} fields are not completed in the app` });
      continue;
    }
    values[key] = typeof value === "string" ? value : "";
  }

  for (const [key, selected] of Object.entries(submitted.checked ?? {})) {
    const responsibility = allowed.get(key);
    if (!responsibility) {
      rejected.push({ key, reason: "not a checkbox group on this template version" });
      continue;
    }
    if (!canPersonEdit(responsibility)) {
      rejected.push({ key, reason: `${responsibility} groups are not ticked in the app` });
      continue;
    }
    const options = optionKeys.get(key) ?? new Set<string>();
    checked[key] = (Array.isArray(selected) ? selected : []).filter((option) =>
      options.has(option),
    );
  }

  return { values, checked, rejected };
}
