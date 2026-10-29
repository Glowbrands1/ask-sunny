import { caShortcutWordsEnabled, stepDateNotIncidentEnabled } from "@/lib/config/chat-quality-flags";

import { datesInText } from "./form-date-answer";

/**
 * STEP_DATE_NOT_INCIDENT_ENABLED (QA SF4, 27 Oct 2026): "create a
 * CA form for <name>, tan consultant at manhattan, for opening salon late on
 * 9-28-26" / "this should be a written and note a verbal ca was given on
 * 9-1-26" — the step's 9/1 was read as a second incident date, the card's
 * Date went blank and the form was dated today. A sentence that says a step
 * was given, issued, received or signed on a date (the same reading that
 * makes it a Prior actions row, `prior-actions.ts`) dates no incident. Off,
 * nothing is held back.
 */
const STEP_WORD = /\b(?:verbal|written|final|ca|c\/a|corrective|coaching|coached|warning|write-?up)\b/i;
/**
 * CA_SHORTCUT_WORDS_ENABLED: a step word right before its date, with at most
 * "on" or a colon between — "verbal on 10/1", "verbal 10/1", "written: 10/5".
 * Not in a sentence that asks for this form ("create a written on 10/20"),
 * where the date is the incident's.
 */
const STEP_SHORTHAND =
  /\b(?:verbal|written|final(?:\s+written)?|write-?up|coaching)(?:\s+(?:warning|ca|c\/a))?\s*(?:on\s+|:\s*|-\s*)?\d{1,2}[/-]\d{1,2}\b/i;
const ASKS_FOR_THE_FORM = /\b(?:create|make|draft|start|need|want|this is|this should be|it should be|should be)\b/i;
const GIVEN = /\b(?:was|were|been|got|received|had)\s+(?:already\s+|previously\s+|also\s+)?(?:issued|given|signed)\b|\b(?:issued|gave|given|signed|received)\b/i;

export function stepSentenceDates(text: string, today: string): Set<string> {
  const out = new Set<string>();
  if (!stepDateNotIncidentEnabled()) return out;
  for (const sentence of (text ?? "").split(/(?<=[!?\n])|(?<=\.)(?!\d)/)) {
    // CA_SHORTCUT_WORDS_ENABLED: "verbal on 10/1", "verbal 10/1" — the shorthand of "a verbal was given on 10/1".
    const shorthand = caShortcutWordsEnabled() && STEP_SHORTHAND.test(sentence) && !ASKS_FOR_THE_FORM.test(sentence);
    if (!shorthand && (!STEP_WORD.test(sentence) || !GIVEN.test(sentence))) continue;
    for (const found of datesInText(sentence, today)) out.add(found.iso);
  }
  return out;
}
