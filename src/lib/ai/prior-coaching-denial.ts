import { priorCoachingDenialEnabled } from "@/lib/config/chat-quality-flags";
import { statesFirstOccurrence } from "@/lib/forms/corrective-action-intake";
import { firstAndLastNamedStep, statedPriorActions } from "@/lib/forms/prior-actions";

/**
 * ============================================================================
 * "THERE'S NO PRIOR COACHING ON FILE." IS NOT A NOTE OF PRIOR COACHING
 * ============================================================================
 *
 * QA, 5 Nov 2026: "I need to write up <name> with a written warning for
 * leaving the front desk unattended for 30 minutes on 10/22. There's no prior
 * coaching on file." was answered "Prior coaching note: prior coaching on
 * file. No finalized record was required." The note's reader
 * (`typedPriorCoachingNote`, in the protected `prior-coaching-optional.ts`)
 * starts its match at "prior coaching", so the manager's "no" is dropped.
 *
 * With PRIOR_COACHING_DENIAL_ENABLED on, the caller hands that reader the
 * manager's turns with each sentence the intake reads as a denial
 * (`statesFirstOccurrence`) handled first:
 *
 *   A DATED STEP      a sentence in which `statedPriorActions` finds a dated
 *                     step is kept as written — the note keeps the step and
 *                     its date, as before.
 *   AN UNDATED STEP   "no prior coaching except a verbal in July", "no prior
 *                     coaching except a verbal warning": a step after the one
 *                     the denial names (`firstAndLastNamedStep`), set apart
 *                     from it by `EXCEPTION_BEFORE_STEP`, is kept with or
 *                     without a time — a visible note beats a step dropped
 *                     in silence (QA, 5 Nov 2026). A later step still inside
 *                     the negation ("no prior coaching or warnings in the
 *                     last 6 months") is denied with it (Pau's decision B,
 *                     6 Nov 2026). The sentence is read as the labelled list managers already
 *                     type ("previous coaching: verbal ca 9-1-26") — the
 *                     denial's own words up to its step, a colon, then the
 *                     manager's words from the later step on — so the note
 *                     names the July verbal and, like "coached verbally in
 *                     July", gives it no day: the date is the manager's to
 *                     set on the form.
 *   A PURE DENIAL     anything else is left out, so the reader finds no note
 *                     and the line stays blank.
 *
 * No new words are written; the only new words read are
 * `EXCEPTION_BEFORE_STEP`'s. The denial, step and date readers are the
 * intake's and the Prior actions line's own. Off, the turns are
 * returned as they were.
 */

/** A sentence at a time, as the Prior actions line reads one (a date's "10.1" stays whole). */
const SENTENCE = /(?<=[!?\n])|(?<=\.)(?!\d)/;

/*
 * THE ONLY WORDS THIS MODULE READS — Pau's decision B, 6 Nov 2026 (QA): a step
 * named inside the negation ("no prior coaching or warnings in the last 6
 * months", "no write-ups", "never had a verbal") is part of the denial, and
 * the sentence is left out. A step after one of these words, between the
 * denial's step and the later one, is the exception the manager is stating,
 * and is kept: "except a verbal warning", "other than a written", "but a
 * verbal in July". A minimal, approved exception to the no-phrase-list rule;
 * keep it to these.
 */
const EXCEPTION_BEFORE_STEP = /\b(?:except|other\s+than|but)\b/i;

/** One denial sentence as the note reader is handed it, or null to leave it out. */
function deniedSentence(sentence: string, today: string): string | null {
  if (statedPriorActions(sentence, today).length > 0) return sentence;
  const steps = firstAndLastNamedStep(sentence);
  if (!steps || steps.last.start < steps.first.end) return null;
  // Pau's decision B: a later step still inside the negation is denied with it.
  if (!EXCEPTION_BEFORE_STEP.test(sentence.slice(steps.first.end, steps.last.start))) return null;
  return `${sentence.slice(0, steps.first.end)}: ${sentence.slice(steps.last.start)}`;
}

/** The manager's text with each denial of prior coaching handled; unchanged when nothing denies it. */
export function withoutDeniedPriorCoaching(text: string, today: string): string {
  return (text ?? "")
    .split(SENTENCE)
    .map((sentence) => (statesFirstOccurrence(sentence) ? deniedSentence(sentence, today) : sentence))
    .filter((sentence): sentence is string => sentence !== null)
    .join("");
}

/** The manager text the prior-coaching note is read from: with the flag on, denials handled; off, joined as before. */
export function priorCoachingManagerText(turns: readonly string[], today: string): string {
  return priorCoachingDenialEnabled()
    ? turns.map((turn) => withoutDeniedPriorCoaching(turn, today)).join("\n")
    : turns.join("\n");
}
