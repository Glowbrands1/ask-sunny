/**
 * ============================================================================
 * WHAT THE MANAGER KNOWS, AND HOW THEY KNOW IT (port of Ask Bubbles' `forms/evidence-basis.ts`, in part)
 * ============================================================================
 *
 * Ask Bubbles keeps the standing of every drafted statement: reported, observed, documented, confirmed. This app had no
 * such reading. REPORTED_NOT_OBSERVED_ENABLED (14 Nov 2026) brings its first part: what the manager saw herself
 * (`FIRST_HAND`), and a statement she gave without a source is written as she stated it, never as observed. The rest of
 * the sibling's rules and guard (unstated evidence, confirmations, reported-only notices) are not ported here.
 *
 * Pure and browser-safe.
 */

/** The manager saw it, or established it, themselves. */
const FIRST_HAND = [
  /\b(?:i|we)\s+(?:saw|see|observed|watched|witnessed|noticed|caught|found|checked|confirmed|verified|reviewed)\b/i,
  /\b(?:i|we)\s+heard\s+(?:her|him|them|it)\b/i,
  /\bin\s+front\s+of\s+me\b/i,
];

/*
 * ============================================================================
 * A STATEMENT WITH NO STATED SOURCE IS WRITTEN AS SHE STATED IT (REPORTED_NOT_OBSERVED_ENABLED)
 * ============================================================================
 *
 * Port of Ask Bubbles (QA's Bubbles Create check, 14 Nov 2026, Pau-approved): "she was late on 11/3/26" + "she yelled at a guest and she
 * maybe forgot" was saved as "… Employee A was also observed yelling at a guest." The manager never said she saw
 * it; the record now says someone did. The rules ask for the plain statement; the guard turns "was (also) observed /
 * seen / witnessed <doing>" into "was (also) <doing>" and drops "It was observed that", unless the manager's own words
 * say she saw it (`FIRST_HAND`). The "Observed:" section label is the form's layout and stays. Pure; the caller gates it.
 */

/** The rule the drafting prompt adds with REPORTED_NOT_OBSERVED_ENABLED. */
export const STATED_NOT_OBSERVED_RULE =
  "Something the manager states without saying how they know it is written plainly, as they stated it (\"<Name> yelled at a guest\"): never as observed, seen, witnessed, noticed or confirmed by anyone.";

const OBSERVED_DOING = /\b(was|were)(\s+also)?\s+(?:observed|seen|witnessed|noticed|caught)\s+(?=[a-z]+ing\b)/gi;
const OBSERVED_TO_BE = /\b(was|were)(\s+also)?\s+(?:observed|seen|witnessed|noticed)\s+to\s+be\b/gi;
const IT_WAS_OBSERVED = /\b(?:it\s+was|it\s+has\s+been)\s+(?:observed|seen|witnessed|noticed)\s+that\s+/gi;

/** The text without an observation the manager never claimed; unchanged when her words say she saw it. */
export function withoutUnstatedObservation(text: string, source: string): string {
  if (FIRST_HAND.some((pattern) => pattern.test(source))) return text;
  return text
    .replace(OBSERVED_DOING, (_match, verb: string, also: string | undefined) => `${verb}${also ?? ""} `)
    .replace(OBSERVED_TO_BE, (_match, verb: string, also: string | undefined) => `${verb}${also ?? ""}`)
    .replace(IT_WAS_OBSERVED, "")
    .replace(/(^|[.!?]\s+|\n)([a-z])/g, (_match, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);
}
