/*
 * ============================================================================
 * A POLICY NAMED ONLY IN THE APP'S "ON FILE" LISTING IS NOT THE REQUEST'S POLICY (ON_FILE_LINE_NOT_THE_POLICY_ENABLED)
 * ============================================================================
 *
 * Pau's morning scan (Ask Sunny production, 13 Nov 2026, 22:40-22:45Z), via QA: a dress-code chat. Every card listed the
 * employee's forms on file ("On file in Form Monitoring for <B>: Verbal corrective action (Tardiness/Leaving Early —
 * Late Opening) — finalized 10/26/2026; …"). The manager resent "Write me a CA form for <B> having a black crewneck on
 * during her shift, not a zip up jacket on 11/13 and 11/6" word for word, and the card said "Policy: Late Opening — read
 * from this request". The intent reader reads the whole chat, the app's own replies included; with no policy in the
 * manager's words it picked the heading the app's listing named, which was written back onto the turn as "Policy
 * reference: Late Opening …" and read as the request's policy.
 *
 * A heading the reader picks is dropped when the manager's own messages never name it and an app reply's "On file"
 * listing does: that listing is history, never this request. The heading the request already had is kept, so a request
 * sent again keeps the policy it had.
 */

type Turn = { readonly role: string; readonly content: string };

const ON_FILE_LINE = /^\**On file in [^\n]*$/gim;

function words(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** The heading's words, without a trailing "policy" ("Late Opening Policy" → "late opening"). */
function headingWords(heading: string): string {
  return words(heading).replace(/\s+polic(?:y|ies)$/, "").trim();
}

/** True when `heading` is named in an app "On file" listing and nowhere in the manager's own words. */
export function headingOnlyOnFile(heading: string, question: string, history: readonly Turn[]): boolean {
  const named = headingWords(heading);
  if (!named) return false;
  const manager = words([...history.filter((turn) => turn.role === "user").map((turn) => turn.content), question].join("\n"));
  if (` ${manager} `.includes(` ${named} `)) return false;
  const listings = history
    .filter((turn) => turn.role === "assistant")
    .flatMap((turn) => turn.content.match(ON_FILE_LINE) ?? []);
  return listings.some((line) => ` ${words(line)} `.includes(` ${named} `));
}
