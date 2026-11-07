import { startsFormRequest } from "@/lib/forms/current-request";

/**
 * ============================================================================
 * A CARD'S POLICY IS READ FROM ITS OWN REQUEST (CARD_POLICY_OWN_REQUEST_ENABLED)
 * ============================================================================
 *
 * QA's live tester (flip 7, 7 Nov 2026): "Coaching form for <A> for being on her phone …", then "Coaching form for
 * <B>". B's card had the right person and salon, but cited Cell Phone/Smart Watch p.19: the form answer's policy line
 * (`server-ask.ts` decorateFormAnswer) is read over every manager turn of the chat, and "Coaching form for <B>" has no
 * incident of its own, so the request-scoped history (REMAP_INCIDENT_FIX) keeps A's turns.
 *
 * The turns are cut at the latest form request that names the card's employee, and only when no earlier turn names
 * them: a request for another person. A form switch with no name ("make it a coaching form instead") and a second
 * request for the same person (SECOND_REQUEST_OWN_ACCOUNT's case) keep every turn, as before.
 */

function nameWords(employeeName: string): RegExp | null {
  const words = employeeName
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}'’-]/gu, ""))
    .filter((word) => word.length >= 2)
    .map((word) => word.replace(/[-'’]/g, (mark) => `\\${mark}`));
  return words.length > 0 ? new RegExp(String.raw`(?<![\p{L}])(?:${words.join("|")})(?![\p{L}])`, "iu") : null;
}

/** The manager turns the card's policy is read from: its own request's, or all of them. */
export function cardPolicyTurns(turns: readonly string[], employeeName: string | null): readonly string[] {
  const named = employeeName ? nameWords(employeeName) : null;
  if (!named) return turns;
  for (let index = turns.length - 1; index > 0; index -= 1) {
    const turn = turns[index] ?? "";
    if (!startsFormRequest(turn) || !named.test(turn)) continue;
    return turns.slice(0, index).some((earlier) => named.test(earlier)) ? turns : turns.slice(index);
  }
  return turns;
}
