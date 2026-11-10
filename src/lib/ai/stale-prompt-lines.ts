import { stalePromptLinesOffEnabled } from "@/lib/config/chat-quality-flags";

/**
 * ============================================================================
 * A PROMPT LINE ABOUT A BOX THE FORM NO LONGER HAS IS LEFT OUT
 * (STALE_PROMPT_LINES_OFF_ENABLED, QA, 5 Nov 2026; default off)
 * ============================================================================
 *
 * The draft prompt's lines are only added to, never edited. Two of them
 * describe revision 6 of the Corrective Action Form:
 *   - the "Other" pair: tick "other" AND name the topic in the matching
 *     write-in field. Revision 7 has no write-in beside Other;
 *   - "under_performance is for results against a sales or performance
 *     target". Revision 7 has no Under Performance box (sales and MSB are the
 *     Standards of Conduct).
 * With the flag on, each is left out when the version being drafted does not
 * have what it describes. That is read from the version itself: a write-in is
 * a field labelled "Other" (`other_offense` on revision 6, `other_topic` on the
 * Coaching Form), and the box is an `under_performance` option. Off, or on a
 * version that has them, the line is written as before.
 */

/** The Other write-in's label on every form that has one. */
const OTHER_WRITE_IN_LABEL = "Other";
const UNDER_PERFORMANCE = "under_performance";

/** True when the flag is on and the version has no write-in beside its Other box. */
export function leaveOutOtherWriteInLine(fields: readonly { readonly label: string }[]): boolean {
  return stalePromptLinesOffEnabled() && !fields.some((field) => field.label.trim() === OTHER_WRITE_IN_LABEL);
}

/** True when the flag is on and the version's Type of Offense has no Under Performance box. */
export function leaveOutUnderPerformanceLine(offenseOffered: readonly string[]): boolean {
  return stalePromptLinesOffEnabled() && !offenseOffered.includes(UNDER_PERFORMANCE);
}

/** The conduct line's first sentence, with no Under Performance sentence after it (the line itself is unchanged). */
export function conductLineWithoutUnderPerformance(standardsOfConduct: string): string {
  return `Type of Offense: assigned work, a required deadline, or required Woven items or training not completed, and a manager's direction not followed, are ${standardsOfConduct}.`;
}
