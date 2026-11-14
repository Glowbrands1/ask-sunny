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

/*
 * QA's rulings on the sibling app's Gate-Bubbles-5 #911 probes (14 Nov 2026; ported):
 *   1. the manager's own word is kept: "she was observed sleeping in the back room" saves "was observed sleeping …";
 *   2. "seen" (and "witnessed", "noticed") gets the same guard as "observed", with or without an "-ing" after it
 *      ("was seen on her phone" → "was on her phone");
 *   3. the source is decided per clause: "I saw her yelling at a guest … and she was also late" keeps "observed"
 *      for the yelling only, never for "arriving late".
 * A draft sentence keeps its "observed / seen / witnessed" only when a clause of the manager's words that gives a source
 * (she saw it, a camera showed it, or she said it was observed) names the same action. Never before "by" ("was seen
 * by a guest" names who saw it).
 */
const OBSERVED_WORD = String.raw`(?:observed|seen|witnessed|noticed|caught)`;
const OBSERVED_PASSIVE = new RegExp(String.raw`\b(was|were)(\s+also)?\s+${OBSERVED_WORD}\s+(?:to\s+be\s+)?(?!by\b|that\b)`, "i");
const IT_WAS_OBSERVED = /\b(?:it\s+was|it\s+has\s+been)\s+(?:observed|seen|witnessed|noticed)\s+that\s+/i;
/** A clause of the manager's words that says how she knows: she saw it, a recording showed it, or she said it was observed. */
const SOURCE_CUES: readonly RegExp[] = [
  ...FIRST_HAND,
  new RegExp(String.raw`\b(?:was|were)\s+(?:also\s+)?(?:observed|seen|witnessed)\b`, "i"),
  /\b(?:camera|cameras|video|footage|cctv|recording)\b/i,
];
const NOT_AN_ACTION = new Set(["that", "this", "with", "from", "their", "there", "they", "them", "were", "also", "have", "been", "employee", "november"]);

function actionWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 4 && !NOT_AN_ACTION.has(word))
      .map((word) => word.replace(/(?:ing|ed|es|s)$/, "")),
  );
}

/** The action words of each clause of the manager's words that gives a source. */
function sourcedActions(source: string): Set<string>[] {
  return source
    .split(/[.!?\n]+|\s+and\s+|,\s+|;\s+/i)
    .filter((clause) => SOURCE_CUES.some((cue) => cue.test(clause)))
    .map(actionWords);
}

/** The text without an observation the manager never claimed; a sentence whose action she gave a source for is kept. */
export function withoutUnstatedObservation(text: string, source: string): string {
  const sourced = sourcedActions(source);
  const backed = (after: string) => {
    const words = actionWords(after);
    return sourced.some((clause) => [...words].some((word) => clause.has(word)));
  };
  return text.replace(/[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g, (sentence) => {
    let next = sentence;
    const passive = OBSERVED_PASSIVE.exec(next);
    if (passive && !backed(next.slice(passive.index + passive[0].length))) {
      next = `${next.slice(0, passive.index)}${passive[1]}${passive[2] ?? ""} ${next.slice(passive.index + passive[0].length)}`;
    }
    const itWas = IT_WAS_OBSERVED.exec(next);
    if (itWas && !backed(next.slice(itWas.index + itWas[0].length))) {
      const rest = next.slice(itWas.index + itWas[0].length);
      next = `${next.slice(0, itWas.index)}${rest.charAt(0).toUpperCase()}${rest.slice(1)}`;
    }
    return next;
  });
}
