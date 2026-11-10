import { caShortcutWordsEnabled, incidentDateSharedWithStepEnabled, stepDateNotIncidentEnabled } from "@/lib/config/chat-quality-flags";

import { datesInText } from "./form-date-answer";
import { withYearlessDatesWritten } from "./late-open";

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
    // INCIDENT_DATE_SHARED_WITH_STEP_ENABLED (D3): a day that is also the incident's stays an incident date.
    const incident = incidentDateSharedWithStepEnabled() ? incidentGoverned(sentence, today) : new Set<string>();
    for (const found of datesInText(sentence, today)) if (!incident.has(found.iso)) out.add(found.iso);
  }
  return out;
}

/*
 * INCIDENT_DATE_SHARED_WITH_STEP_ENABLED (QA's prod-env reading, 10 Nov 2026, D3): "ca for <name>, she was late on 10-21
 * and i gave her a verbal on 10-21" and "… gave her a verbal on 10-21 for being late on 10-21" dated the form today:
 * the sentence says a step was given, so every date in it was set aside, though 10-21 is also the incident's day. A date
 * an incident cue governs stays the incident's: an incident word right before it ("late on 10-21"), or the step it dates
 * given for the incident ("a verbal on 10-21 for being late"). Not after an earlier-step cue ("previous coaching on
 * 10-21 for being late" is history).
 */
const STEP_BEFORE_DATE =
  /\b(?:verbal|written|final|coaching|coached|ca|c\/a|corrective(?:\s+action)?|warning|write-?up|issued|given|signed|received)\b[^.!?\n\d]{0,12}?(?:\bon\s+|\bdated\s+)?\(?\s*$/i;
const INCIDENT_BEFORE_DATE =
  /\b(?:late|tardy|absent|no[\s-]*call|no[\s-]*show|missed|left\s+early|walked\s+(?:off|out)|happened|occurred|incident)\b[^.!?\n\d]{0,20}?(?:\bon\s+)?\s*$/i;
const GIVEN_FOR_AFTER = /^\s*,?\s*(?:for|because)\b/i;
const EARLIER_STEP = /\b(?:previous(?:ly)?|prior|past|earlier|already)\b/i;

/** INCIDENT_DATE_SHARED_WITH_STEP_ENABLED: every date an incident cue governs, sentence by sentence (the caller checks the flag). */
export function incidentGovernedDates(text: string, today: string): Set<string> {
  const out = new Set<string>();
  // "10-21" is read with its year written out, as the incident dates are (`withYearlessDatesWritten`).
  const written = withYearlessDatesWritten(text ?? "", today);
  for (const sentence of written.split(/(?<=[!?\n])|(?<=\.)(?!\d)/)) for (const iso of incidentGoverned(sentence, today)) out.add(iso);
  return out;
}

function incidentGoverned(sentence: string, today: string): Set<string> {
  const out = new Set<string>();
  for (const found of datesInText(sentence, today)) {
    const before = sentence.slice(0, found.index);
    if (EARLIER_STEP.test(before)) continue;
    const near = before.slice(-40);
    const governed = STEP_BEFORE_DATE.test(near)
      ? GIVEN_FOR_AFTER.test(sentence.slice(found.end))
      : INCIDENT_BEFORE_DATE.test(near);
    if (governed) out.add(found.iso);
  }
  return out;
}
