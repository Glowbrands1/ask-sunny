import { readQuestion } from "@/lib/ai/question-not-form";

import { withoutMessageIdTags } from "./evidence";

/*
 * ============================================================================
 * ADVICE ABOUT COACHING IS ANSWERED. IT IS NEVER A FORM INTAKE.
 * ============================================================================
 *
 * QA, live on the agent loop (Standard mode), 24 Nov 2026, twice: "Coach a leader on running better follow-up
 * conversations" was answered only "Who is this Coaching Form for?". On 16 Nov the same words got a full answer
 * ("Running strong follow-up is where most coaching actually succeeds or fails…"). The loop had nothing that told advice
 * about coaching from a request for a Coaching Form: the model called propose_form with no person, and the tool's
 * ask_exactly is the who-question. The old chat path reads such turns with `isQuestionNotForm`
 * (`src/lib/ai/question-not-form.ts`); the loop never did.
 *
 * This is that reading for the loop's propose_form, plus the one shape the old reader leaves as a statement: an advice
 * imperative ("coach a leader on …", "give me tips for …", "walk me through …") whose object is nobody in particular
 * and which names no form. Pure; reads the manager's words only, never the model's.
 *
 * Only advice is held back. A request for a form still makes its card however it is phrased ("Create a coaching
 * form.", "coaching form for <name>", "write up <name>", "coach <name> on being late", "is it okay if you make a CA
 * for <name>"): anything that asks for a form, or names one person, is left on the path it had.
 */

/** A form or paperwork the manager may be asking for. */
const FORM_WORD = /\b(?:forms?|documents?|docs?|paperwork|write-?\s?ups?|ca|cards?|drafts?|templates?)\b/i;

/** "ca for <name>", "a coaching form for Remy", "write-up for her": a form for someone. */
const FORM_FOR = /\b(?:forms?|ca|coaching|corrective\s+action|write-?\s?up|exit|verbal|written|warning|documents?)\s+for\s+(?!(?:a|an|any|my|our|the|new|someone|somebody|anyone|leaders?|managers?|employees?|people|staff|team)\b)\S/i;

/** "is it okay if you make a coaching form", "would you mind if you wrote up …": asks the app to make one. */
const YOU_MAKE =
  /\b(?:you|u)\s+(?:\w+\s+){0,2}?(?:create|make|draft|write|start|prepare|do|fill|open|put\s+together|draw)\b[^.?!]{0,40}?\b(?:forms?|documents?|docs?|ca|write-?\s?ups?|coaching|corrective\s+action|warning|verbal|written)\b/i;

/** Somebody in general, never a named person: "a leader", "my new managers", "someone", "one of my leads". */
const GENERIC_PERSON = String.raw`(?:(?:a|an|any|my|our|your|the|new|other|one\s+of\s+my|some)\s+(?:[a-z-]+\s+){0,2}?)?(?:leaders?|managers?|supervisors?|leads?|employees?|team(?:\s+members?)?|staff|associates?|hires?|direct\s+reports?|reports|people|crew|coworkers?|colleagues?|someone|somebody|anyone)\b`;

/** "can you coach Remy on being late?": asked of the app for one person, which may be the form; left on its path. */
const YOU_COACH_PERSON = new RegExp(String.raw`\b(?:you|u)\s+(?:please\s+)?(?:coach|counsel|discipline)\s+(?!me\b|us\b|${GENERIC_PERSON})\S`, "i");

/** An advice imperative at the head of a clause. */
const ADVICE_IMPERATIVE = new RegExp(
  [
    // "coach a leader on …", "train my new leads to …", "help someone run …"
    String.raw`^(?:please\s+)?(?:coach|teach|train|mentor|guide|help|prepare|develop|support|show)\s+${GENERIC_PERSON}`,
    // "coach me on …", "teach me how …", "walk me through …", "tell me how …"
    String.raw`^(?:please\s+)?(?:coach\s+me|teach\s+me|show\s+me\s+how|walk\s+me\s+through|tell\s+me\s+how|explain\s+(?:how|what|why|when|the\s+best)|help\s+me\s+(?:coach|prepare\s+for|practice|plan|understand|run|lead|have|get\s+better|improve))\b`,
    // "give me tips for …", "share some ideas …", "a checklist for follow-ups", "role-play a follow-up"
    String.raw`^(?:please\s+)?(?:(?:give|share|suggest|recommend|send)\s+(?:me\s+|us\s+)?)?(?:some\s+|a\s+few\s+|a\s+|an\s+)?(?:tips|advice|ideas|suggestions|checklist|talking\s+points|script|examples|best\s+practices|role-?\s?play|steps|questions\s+to\s+ask)\b`,
    String.raw`^(?:please\s+)?role-?\s?play\b`,
  ].join("|"),
  "i",
);

/** Words ahead of the clause that carry nothing (the old reader's filler). */
const FILLER = /^(?:(?:hey|hi|hello|ok(?:ay)?|so|and|also|um+|uh+|quick\s+question|question|thanks|thank\s+you)\b[\s,:;!.-]*)+/i;

function clausesOf(text: string): string[] {
  return text
    .split(/(?<=[?!.])\s+|\n+/)
    .map((part) => part.trim().replace(FILLER, "").trim())
    .filter(Boolean);
}

type Turn = { readonly role: string; readonly content: unknown };

/**
 * Whether the manager's words in this request ask for advice and for no form: an asking clause or a short lookup (the
 * old path's `readQuestion`), or an advice imperative about nobody in particular, with no clause that asks for a form.
 */
export function adviceNotForm(question: string, history: readonly Turn[] = []): boolean {
  const said = withoutMessageIdTags(question).trim();
  if (!said) return false;
  const turns = history.map((turn) => ({ role: turn.role, content: typeof turn.content === "string" ? turn.content : "" }));
  const read = readQuestion(said, turns);
  /*
   * A question, but never one that also carries a form for someone ("ca for <name>, … What was observed this weekend is
   * that …", the nov22 replay case): an account told without "?" is long, and a question is short or asks with "?". A
   * question about a form or the card ("can i review the card", "what's on the form?") is about that form, never advice
   * (the sibling app's U35 replay: the card on screen was re-shown, and refusing it lost the card).
   */
  if (read.question) return (/\?/.test(said) || said.split(/\s+/).length <= 16) && !FORM_WORD.test(said) && !FORM_FOR.test(said) && !YOU_MAKE.test(said) && !YOU_COACH_PERSON.test(said);
  if (read.branch !== "STATEMENT") return false;
  const parts = clausesOf(said);
  return parts.some((part) => ADVICE_IMPERATIVE.test(part)) && !FORM_WORD.test(said);
}

/** The one question a form intake asks when nobody is named: "Who is this Coaching Form for?". */
export function onlyAsksWho(reply: string): boolean {
  const text = reply.trim();
  return text.length < 300 && /\bwho\s+is\s+(?:this|it|the)\b[^?]{0,80}\bfor\?/i.test(text) && text.split(/(?<=[.!?])\s+/).length <= 3;
}
