import { fieldsForVariant, type FormDocument } from "./document";

/**
 * ============================================================================
 * THE EXIT FORM'S OWN SUBMISSION RULES (Pau, 25 Nov 2026)
 * ============================================================================
 *
 * "Can you make it so that dates can NOT be entered into the Date that notice
 * was given and Date that notice was fulfilled fields UNLESS Submitted &
 * Fulfilled Notice box is checked?" — the two notice dates are LOCKED until
 * that box is ticked: the card greys them out, the save route refuses a date
 * typed into them, and any write that leaves the box unticked clears them
 * (`instances.ts` writeValues), so no path — the card, the chat, a draft —
 * can keep a notice date on a form that says notice was not fulfilled.
 *
 * "Permanent Address should capture the complete mailing address, including
 * zip" — the line is refused at Finalize / send for approval unless it reads as
 * a mailing address: a street or box number, then the city, the state and a
 * ZIP code.
 *
 * "On the Exit Form, can the parameters be set so that every field must be
 * completed or the form will not submit to HR?" — the exit form is always
 * checked with `blankBeforeSubmission`, whatever ALL_FIELDS_REQUIRED_ENABLED
 * says; that also refuses a form with no Resignation Details box ticked
 * (`REQUIRED_WHEN.resignation_type`).
 *
 * Keyed by the field keys both apps' exit forms share, so it reaches every
 * published version and every form already open. Pure and browser-safe.
 */

export const NOTICE_DATE_GATE = {
  group: "resignation_notice",
  option: "submitted_fulfilled_notice",
  optionLabel: "Submitted & Fulfilled Notice",
  fields: ["notice_given_date", "notice_fulfilled_date"] as readonly string[],
} as const;

export const PERMANENT_ADDRESS_KEY = "permanent_address";

/** The note under a locked notice date, and the save route's reason for refusing one. */
export const NOTICE_DATE_LOCKED_NOTE = `Tick "${NOTICE_DATE_GATE.optionLabel}" to enter this date.`;

/** Whether `key` is one of the two notice dates. */
export function isNoticeDateField(key: string): boolean {
  return NOTICE_DATE_GATE.fields.includes(key);
}

/** Whether the notice dates are locked, given what is ticked in the notice group. */
export function noticeDatesLocked(noticeTicks: readonly string[] | null | undefined): boolean {
  return !(noticeTicks ?? []).includes(NOTICE_DATE_GATE.option);
}

/** Whether this document is the exit form (both apps' exit forms carry these keys; no other form does). */
export function isExitDocument(document: FormDocument, variantKey: string | null = null): boolean {
  const keys = new Set(fieldsForVariant(document, variantKey).map((field) => field.key));
  const hasNoticeGroup = document.blocks.some(
    (block) => block.kind === "checkbox_group" && block.key === NOTICE_DATE_GATE.group,
  );
  return hasNoticeGroup && keys.has(PERMANENT_ADDRESS_KEY);
}

const STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "district of columbia", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas",
  "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
  "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming", "puerto rico",
];

/** "… <city>, <state> <ZIP>" at the end of the line: a two-letter state or a state's name, then 5 or 9 digits. */
const CITY_STATE_ZIP = new RegExp(
  String.raw`[a-z][a-z .'-]*[,\s]\s*(?:[a-z]{2}|${STATE_NAMES.join("|")})\.?\s*,?\s*\d{5}(?:-\d{4})?\s*$`,
  "i",
);

/**
 * Whether `address` is a complete mailing address: a number in the street (or
 * PO box), then city, state and ZIP — "412 Ashgrove Ln, Apt 3, Lincoln, NE
 * 68508". A street with no city, state or ZIP is not.
 */
export function isCompleteMailingAddress(address: string | null | undefined): boolean {
  const text = (address ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return false;
  const zip = CITY_STATE_ZIP.exec(text);
  if (!zip) return false;
  const street = text.slice(0, zip.index);
  return /\d/.test(street) && /[a-z]/i.test(street);
}

export const PERMANENT_ADDRESS_INCOMPLETE_MESSAGE =
  'Permanent Address must be the complete mailing address — street, city, state and ZIP code (for example "412 Ashgrove Ln, Lincoln, NE 68508").';

/** What the exit form still needs beyond "every field filled": a Permanent Address that is a full mailing address. */
export function exitSubmissionProblems(
  document: FormDocument,
  variantKey: string | null,
  values: readonly { fieldKey: string; value: string | null }[],
): { key: string; label: string }[] {
  if (!isExitDocument(document, variantKey)) return [];
  const address = values.find((row) => row.fieldKey === PERMANENT_ADDRESS_KEY)?.value ?? "";
  // A blank line is `blankBeforeSubmission`'s to name; a filled one must be complete.
  if (address.trim() === "" || isCompleteMailingAddress(address)) return [];
  return [{ key: PERMANENT_ADDRESS_KEY, label: "Permanent Address" }];
}

/**
 * The notice dates a write must clear: the dates currently holding a value
 * while the box is unticked. `ticks` is the notice group as it will stand after
 * the write; `dates` is each date as it will stand.
 */
export function noticeDatesToClear(
  ticks: readonly string[] | null | undefined,
  dates: Readonly<Record<string, string | null | undefined>>,
): string[] {
  if (!noticeDatesLocked(ticks)) return [];
  return NOTICE_DATE_GATE.fields.filter((key) => (dates[key] ?? "").trim() !== "");
}
