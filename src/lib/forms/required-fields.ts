import { fieldsForVariant, type FormDocument } from "./document";

/**
 * ============================================================================
 * REQUIRED FIELDS (HR via Pau, 19 Nov 2026)
 * ============================================================================
 *
 * A field the version marks `required` must hold a value before the form is
 * finalized — the two history boxes on the Corrective Action Form. A DRAFT may
 * stay blank while the manager works on it; only Finalize refuses. Read from
 * the stored values, so neither the model nor a stale screen can skip it.
 * Versions published without the mark keep filing with the field optional.
 * Pure and browser-safe.
 */
export const REQUIRED_FIELDS_BLANK = "required_fields_blank";

export interface RequiredFieldRow {
  readonly fieldKey: string;
  readonly value: string | null;
}

export function blankRequiredFields(
  document: FormDocument,
  variantKey: string | null,
  values: readonly RequiredFieldRow[],
): { key: string; label: string }[] {
  const rows = new Map(values.map((row) => [row.fieldKey, row.value ?? ""]));
  return fieldsForVariant(document, variantKey)
    .filter((field) => field.required === true)
    .filter((field) => (rows.get(field.key) ?? "").trim() === "")
    .map((field) => ({ key: field.key, label: field.label }));
}

export function requiredFieldsMessage(blank: readonly { label: string }[]): string {
  const names = blank.map((field) => `"${field.label}"`).join(" and ");
  return `${names} ${blank.length === 1 ? "is" : "are"} required. Fill ${blank.length === 1 ? "it" : "them"} in before finalizing this form.`;
}
