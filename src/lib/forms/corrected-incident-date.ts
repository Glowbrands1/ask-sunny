import { correctedDateKeptEnabled } from "@/lib/config/chat-quality-flags";

import { correctedFormDate, priorSteps } from "./form-date-answer";

/**
 * ============================================================================
 * THE INCIDENT DATE THE MANAGER CORRECTED IS THE FORM'S DATE (CORRECTED_DATE_KEPT_ENABLED, default off)
 * ============================================================================
 *
 * QA's round-5 trace (8 Nov 2026) of corrective-action-conversation-qa Q6 with production's flags: "create a CA for
 * <name> for not attending the monthly meeting on 10-20-26 …", then "the meeting was actually on 10-19-26". The
 * proposal dates the card 10-19 (`decideFormDate`'s correction), but the next step (PRIOR_SENTENCE_FIX's
 * `statedFormDate`, `ai/keep-filled-slots.ts`) sees two incident dates, 10-19 and 10-20, and dates the card null
 * ("which date?"). Create then saved today's date.
 *
 * With the flag on, among several candidate dates the one the manager corrected the incident to
 * (`correctedFormDate`: "actually on 10-19-26", "it was 10-19, not 10-20") is the date. A corrected PRIOR STEP's date
 * ("sorry, the verbal ca was on 9-2-26 not 9-1-26") is that step's, never the form's. Null when nothing applies; off,
 * always null.
 */
export function correctedIncidentDate(turns: readonly string[], candidates: readonly string[], today: string): string | null {
  if (!correctedDateKeptEnabled() || candidates.length < 2) return null;
  const corrected = correctedFormDate(turns, today);
  if (!corrected || !candidates.includes(corrected)) return null;
  const stepDates = new Set(priorSteps(turns.join("\n\n"), today).map((step) => step.iso));
  return stepDates.has(corrected) ? null : corrected;
}
