/**
 * ============================================================================
 * THE ADDRESS A MANAGER TYPED, AND ONLY WHERE THEY LABELLED IT ONE
 * ============================================================================
 *
 * REPORTED BY A TESTER (29 September 2026): "provided address and not filled in
 * on form". The Resignation/Exit Form has a Permanent Address line, and it is
 * the manager's to fill — the drafting model may never write it. That rule is
 * right and stays: a model that writes an address invents one. But it left no
 * route at all for the address the MANAGER gave, so it was typed into the chat
 * and then had to be typed again on the form.
 *
 * So this reads it, deterministically, and it is written at creation as the
 * manager's own statement — the same path the payroll-deduct answer takes.
 *
 * ============================================================================
 * NARROW ON PURPOSE
 * ============================================================================
 *
 * An address is read only where the sentence SAYS it is one — "address is",
 * "address:", "lives at", "mailing address", "permanent address" — and only
 * when what follows starts like a street address: a house number, or a PO box.
 * "She works at 1200 Main" is where she works, not where she lives, and is
 * not read. Nothing is looked up, normalised or completed: the value is the
 * manager's words, and the field stays editable.
 */

/** The Resignation/Exit Form's Permanent Address line. */
export const PERMANENT_ADDRESS_KEY = "permanent_address";

/** The one key a stated address may reach, for `applyStatedFacts`. */
export const PERMANENT_ADDRESS_STATED_KEYS: ReadonlySet<string> = new Set([PERMANENT_ADDRESS_KEY]);

/** A stated address as the create route accepts it, or null. */
export function statedAddressValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length >= 6 && trimmed.length <= 200 ? trimmed : null;
}

const LABEL =
  /\b(?:(?:her|his|their|the|employee'?s?|permanent|home|mailing|current|new)\s+)*address(?:\s+(?:is|was|will be))?\s*(?::|-|=)?\s*|\blives?\s+at\s+|\bliving\s+at\s+/gi;

/** A street address starts with a house number or a post-office box. */
const STARTS_LIKE_AN_ADDRESS = /^(?:\d{1,6}[A-Za-z]?\s+\S|p\.?\s*o\.?\s*box\s+\d)/i;

/** A ZIP code ends an address; nothing after it belongs to it. */
const ZIP = /\b\d{5}(?:-\d{4})?\b/;

/**
 * Street-type abbreviations and directions, whose full stop is part of the
 * address rather than the end of the sentence ("123 Main St. Apt 4").
 */
const ABBREVIATION_BEFORE = /\b(?:st|ave|rd|dr|ln|blvd|ct|pl|pkwy|hwy|apt|ste|n|s|e|w|ne|nw|se|sw|no)$/i;

/** The address the manager stated, as typed, or null. The last one stated wins. */
export function readStatedAddress(text: string): string | null {
  let found: string | null = null;
  for (const match of (text ?? "").matchAll(LABEL)) {
    const start = (match.index ?? 0) + match[0].length;
    const address = addressAt(text.slice(start));
    if (address) found = address;
  }
  return found;
}

function addressAt(rest: string): string | null {
  const line = rest.split(/\n/)[0]!.trim();
  if (!STARTS_LIKE_AN_ADDRESS.test(line)) return null;

  let end = line.length;
  const zip = ZIP.exec(line);
  // A ZIP after the house number ends it; the house number itself is not one.
  if (zip && zip.index > 0) end = zip.index + zip[0].length;

  // Otherwise the first sentence break that is not an abbreviation's full stop.
  for (const stop of line.slice(0, end).matchAll(/[.;!?](?=\s|$)/g)) {
    const before = line.slice(0, stop.index);
    if (stop[0] === "." && ABBREVIATION_BEFORE.test(before)) continue;
    end = stop.index!;
    break;
  }

  const address = line
    .slice(0, end)
    // "…66044 and she returned her key": a clause that carries on is not the address.
    .replace(/\s+(?:and|but|so)\s+(?:she|he|they|her|his|their|i|we)\b.*$/i, "")
    .replace(/[\s,;:]+$/, "")
    .trim();
  if (address.length < 6 || address.length > 200) return null;
  return address;
}
