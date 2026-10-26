import { priorSentenceFixEnabled } from "@/lib/config/chat-quality-flags";

/**
 * PRIOR_SENTENCE_FIX_ENABLED applies to a Corrective Action only (QA, 26 Oct
 * 2026: on a Coaching Form "i coached her on 10-16" is the form's own date,
 * and the flag left "create a coaching form for … i coached her on 10-16"
 * undated). True when the flag is on and `text` — the conversation, or the
 * draft's notes — names a Corrective Action and no Coaching Form. The same
 * test `sentenceFixOn` in `form-date-answer.ts` applies to the held-step
 * reading; every other rule of the flag asks this one.
 */
const NAMES_CORRECTIVE_ACTION = /\b(?:cas?|c\/a|corrective\s+actions?|dpoa)\b/i;
const NAMES_COACHING_FORM = /\bcoaching\s+(?:form|document|doc)\b/i;

export function priorSentenceFixFor(text: string): boolean {
  return priorSentenceFixEnabled() && NAMES_CORRECTIVE_ACTION.test(text ?? "") && !NAMES_COACHING_FORM.test(text ?? "");
}
