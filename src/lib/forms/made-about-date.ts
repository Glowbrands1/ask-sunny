import { madeAbout } from "@/lib/ai/make-it-about";

import { datesInText } from "./form-date-answer";

/**
 * STEP_B_MAKE_IT_ABOUT_ACCOUNT_ENABLED (QA's live round-6 trace, Ask Bubbles, 9 Nov 2026): the one date the made-about
 * incident is told with ("make it about leaving the front desk unattended on 11/6/26" → 2026-11-06), or null (no
 * "make it about", no date, or more than one). The new account follows this date, not the form's old one.
 */
export function madeAboutDate(question: string, today: string | undefined): string | null {
  const about = madeAbout(question);
  if (!about || !today) return null;
  const dates = [...new Set(datesInText(about, today).flatMap((date) => (date.iso ? [date.iso] : [])))];
  return dates.length === 1 ? dates[0]! : null;
}

/*
 * MADE_ABOUT_ALL_OR_NOTHING_ENABLED (QA's live round-7 test, Ask Bubbles, 9 Nov 2026): the old path's revision may let the
 * old account's date go only while Step B writes the Date and the topic with the account (`form-patch-turn.ts`). Handed
 * to the old path alone, "make it about leaving the front desk unattended on 11/6/26" rewrote Details and left Other and
 * the Date: a half-changed draft.
 */
const coordinated = new Map<string, number>();

/** Step B is writing a made-about account on this draft, with its Date and topic. */
export function noteMadeAboutWrite(instanceId: string): void {
  coordinated.set(instanceId, (coordinated.get(instanceId) ?? 0) + 1);
}

export function endMadeAboutWrite(instanceId: string): void {
  const count = (coordinated.get(instanceId) ?? 0) - 1;
  if (count > 0) coordinated.set(instanceId, count);
  else coordinated.delete(instanceId);
}

export function madeAboutWriteNoted(instanceId: string): boolean {
  return coordinated.has(instanceId);
}

/** "leaving the front desk unattended on 11/6/26" → "Leaving the front desk unattended": the incident, without its date. */
export function madeAboutTopic(question: string, today: string | undefined): string | null {
  const about = madeAbout(question);
  if (!about || !today) return null;
  const text = about
    .replace(/(?:\s+(?:on|from|dated))?\s*(?<![\d/.-])\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?(?![\d/.-])/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+(?:on|from|for|dated|of)\s*$/i, "")
    .replace(/[\s,.;:-]+$/, "")
    .trim();
  return text.length >= 3 ? text.charAt(0).toUpperCase() + text.slice(1) : null;
}
