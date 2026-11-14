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
 * A heading the reader picks is dropped when the manager's own messages never name or describe it (every topic word of
 * the heading has a word of theirs starting the same way: "opened … late" is Late Opening) and an app reply's "On file"
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

const NOT_A_TOPIC_WORD = new Set(["the", "and", "of", "for", "to", "in", "on", "a", "an", "policy", "policies"]);

/**
 * The manager's words say what the heading is about, named or described (Gate-Sunny-3, 14 Nov 2026): every topic word of
 * the heading has a word of theirs that starts the same way ("Late Opening" ← "she opened the salon 25 minutes late",
 * "late openng"). A heading the manager describes is theirs, even when the same policy is also on file.
 */
function managerSaysIt(heading: string, managerText: string): boolean {
  const topic = headingWords(heading)
    .split(" ")
    .filter((word) => word.length >= 3 && !NOT_A_TOPIC_WORD.has(word));
  if (topic.length === 0) return false;
  const said = words(managerText).split(" ").filter(Boolean);
  const stem = (word: string) => word.slice(0, Math.min(4, word.length));
  return topic.every((word) => said.some((theirs) => theirs.length >= 3 && stem(theirs) === stem(word)));
}

/** True when `heading` is named in an app "On file" listing and the manager's own words neither name nor describe it. */
export function headingOnlyOnFile(heading: string, question: string, history: readonly Turn[]): boolean {
  const named = headingWords(heading);
  if (!named) return false;
  const managerText = [...history.filter((turn) => turn.role === "user").map((turn) => turn.content), question].join("\n");
  const manager = words(managerText);
  if (` ${manager} `.includes(` ${named} `) || managerSaysIt(heading, managerText)) return false;
  const listings = history
    .filter((turn) => turn.role === "assistant")
    .flatMap((turn) => turn.content.match(ON_FILE_LINE) ?? []);
  return listings.some((line) => ` ${words(line)} `.includes(` ${named} `));
}
