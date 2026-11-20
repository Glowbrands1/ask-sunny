/**
 * ============================================================================
 * THE TIMES ON THE CARD REACH THE SAVED ACCOUNT (Runner 2's c198, 17 Nov saved-form run on 33863575; QA, 20 Nov 2026)
 * ============================================================================
 *
 * c198: the agent loop's card read "On 11/3/26 she was scheduled until 9:15PM and clocked out at 9:01. She also took down
 * the spray booths down at 8:11 PM before the Salon was closed." The draft writer saved an observation with only 8:11 PM:
 * 9:15PM and 9:01 were lost. Times the manager typed must reach the account and the write-up. After drafting, a clock time
 * of the card's own account that the drafted account no longer holds brings back the card's sentence that holds it,
 * word for word. A time is read by its shape (h:mm, or an hour with am/pm), never by a word list.
 */

const CLOCK = /\b(\d{1,2})\s*[:;]\s*(\d{2})(?:\s*([ap])\.?\s*m\b\.?)?|\b(\d{1,2})\s*([ap])\.?\s*m\b\.?/gi;

/** Each clock time in the text, as "h:mm" ("9:15PM", "9:15 p.m." and "9:15" are one time; "8 PM" is "8:00"). */
export function clockTimes(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CLOCK)) {
    const hour = Number(match[1] ?? match[4]);
    const minutes = match[2] ?? "00";
    if (hour > 23 || Number(minutes) > 59) continue;
    const key = `${hour}:${minutes}`;
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

/**
 * The drafted account with the card's sentences that hold the times it lost added back (in the card's order, after the
 * drafted text); the drafted account itself when it lost none. Empty or missing inputs change nothing.
 */
export function withCardTimes(drafted: string, cardAccount: string | null | undefined): string {
  const card = (cardAccount ?? "").trim();
  if (!card || !drafted.trim()) return drafted;
  const kept = new Set(clockTimes(drafted));
  const lost = clockTimes(card).filter((time) => !kept.has(time));
  if (lost.length === 0) return drafted;
  const sentences = card.split(/(?<=[.!?])\s+/).filter((sentence) => clockTimes(sentence).some((time) => lost.includes(time)));
  if (sentences.length === 0) return drafted;
  const body = drafted.replace(/\s+$/, "");
  return `${body}${/[.!?]$/.test(body) ? "" : "."} ${sentences.join(" ")}`;
}
