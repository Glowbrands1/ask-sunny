import { PRODUCTION_SALONS, type ProductionSalon } from "@/data/salons";
import { placeSpanGuardEnabled } from "@/lib/config/chat-quality-flags";

/**
 * "Dodge, NE" and "at empire, sd" — a place, then a roster state.
 *
 * One salon in that state whose name contains every place word is that salon.
 * None is an unknown store: the caller asks, and does not invent one.
 */

export type PlaceStateRead =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly salon: ProductionSalon }
  | { readonly kind: "unknown"; readonly state: string };

export function readPlaceState(text: string): PlaceStateRead {
  const states = [...new Set(PRODUCTION_SALONS.map((salon) => salon.state.toUpperCase()))];
  if (states.length === 0) return { kind: "none" };
  const pattern = new RegExp(
    String.raw`\b(?:at|in|location\s+is)\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,4}?)\s*,\s*(${states.join("|")})\b`,
    "gi",
  );
  const matches = placeSpanGuardEnabled() ? guardedMatches(text, pattern) : [...text.matchAll(pattern)];
  if (matches.length === 0) return { kind: "none" };
  const match = matches[matches.length - 1]!;
  const place = match[1]!.replace(/\s+location$/i, "").trim();
  const state = match[2]!.toUpperCase();
  const salon = uniqueSalon(place, state);
  return salon ? { kind: "one", salon } : { kind: "unknown", state };
}

function uniqueSalon(place: string, state: string): ProductionSalon | null {
  const words = place.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
  if (words.length === 0) return null;
  const hits = PRODUCTION_SALONS.filter((salon) => {
    if (salon.state.toUpperCase() !== state) return false;
    return words.every((word) => new RegExp(String.raw`\b${word}\b`, "i").test(salon.name));
  });
  return hits.length === 1 ? hits[0]! : null;
}

/*
 * ============================================================================
 * A POLICY IS NOT A PLACE (PLACE_SPAN_GUARD_ENABLED)
 * ============================================================================
 *
 * "in the workplace policy", "in the dress code section", "in the handbook":
 * the manager is pointing at a document. No salon name carries one of these
 * words. Ported from Ask Bubbles (conv_mvmcetjw2i4vtwz, 24 Oct 2026), where
 * "cite animals in the workplace policy" followed by "store location is …"
 * was read as a typed store called "workplace policy".
 */
const DOCUMENT_WORDS = /\b(?:polic(?:y|ies)|manuals?|handbooks?|sections?|procedures?|guidelines?|sops?|rules?|forms?)\b/i;

/** Whether a span names a document rather than a place. */
export function isDocumentPhrase(span: string): boolean {
  return DOCUMENT_WORDS.test(span);
}

/*
 * The turns arrive joined by line breaks, and the place words may run across
 * them: "cite animals in the workplace policy" then "at Kearney, NE" read as
 * "in the workplace policy at Kearney, NE", a place no salon answers to, which
 * blanked the salon the manager named. With the guard each turn is read on
 * its own, and a span that names a document is skipped; the search then
 * resumes one character on, so "… policy at Kearney, NE" in one message still
 * finds "at Kearney, NE".
 */
function guardedMatches(text: string, pattern: RegExp): RegExpExecArray[] {
  const found: RegExpExecArray[] = [];
  for (const turn of text.split(/\r?\n/)) {
    const scan = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = scan.exec(turn)) !== null) {
      if (isDocumentPhrase(match[1]!)) {
        scan.lastIndex = match.index + 1;
        continue;
      }
      found.push(match);
    }
  }
  return found;
}
