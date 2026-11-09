import { exitLetterAddresseeEnabled, exitLetterSignerNotSubjectEnabled } from "@/lib/config/chat-quality-flags";

import type { AskRequest } from "./types";

/*
 * ============================================================================
 * A LETTER'S SIGN-OFF IS NOT THE FORM'S PERSON (EXIT_LETTER_SIGNER_NOT_SUBJECT_ENABLED)
 * ============================================================================
 *
 * Ported from the sibling app (QA's round-6 live test there, 9 Nov 2026; pre-existing here too): "create an exit form
 * for <B>, <title> at <salon>. Here is the termination letter: '<B>, your employment … <C>, District Manager'" was
 * answered "Which of them is this Resignation/Exit Form for — <B>, <C> or District Manager'?": the letter's closing
 * "<C>, District Manager'" read as two more people, the bare title with its closing quote as one of them.
 *
 * With the flag on, when the turn names the form's person ("… form for <B>") and ends a letter with a sign-off of
 * another name and a title ("<C>, District Manager", a closing quote or not), the proposal reads the turn without that
 * sign-off: the signer is never offered. The manager's words are otherwise unchanged; the draft still reads the whole
 * letter. Off, the turn as it was.
 */

const TITLE = String.raw`(?:(?:district|regional|area|general|assistant|store|salon|shift|operations|human\s+resources|hr|people)\s+)*(?:manager|director|supervisor|lead|coordinator|owner|partner|business\s+partner|dm|rm|gm|asm|hr)`;
const NAME = String.raw`\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,2}`;
/** The letter's last sentence: "<Name>, <Title>" and nothing after it but a closing quote. */
const SIGN_OFF = new RegExp(String.raw`(^|[.!?]\s+|\n\s*)(${NAME})\s*,\s*(${TITLE})\s*(['"’”]?)\s*$`, "iu");
/** A closing, then the signer's name and title on lines of their own: "Sincerely,\n<C>\nDistrict Manager". */
const SIGN_OFF_LINES = new RegExp(
  String.raw`((?:^|\n)\s*(?:sincerely|regards|best\s+regards|kind\s+regards|respectfully|thank\s+you|thanks)\s*,?)\s*\n\s*(${NAME})\s*,?\s*\n\s*(${TITLE})\s*(['"’”]?)\s*$`,
  "iu",
);
/** The form's person, named in the request: "an exit form for <B>", "a CA for <B>". */
const FORM_FOR = new RegExp(String.raw`\b(?:form|ca|exit|termination|resignation|coaching|corrective\s+action)\s+for\s+(${NAME})`, "iu");

/*
 * EXIT_LETTER_ADDRESSEE_ENABLED (QA, the live Sunny test of rounds 7c and 8, 9 Nov 2026; default off): "I need an exit
 * form with this information." and a letter "<A>, … your employment is terminated, effective 11/08/2026 … <C>, District
 * Manager" names nobody after "form for", so the sign-off was kept and the card's Job Title was "District Manager".
 * With this flag on, the letter's own salutation — "<A>," starting a line (or the letter, after a quote or a sentence) and followed
 * by the letter's words ("your", "this", "we", "you", a new line) — names the form's person when nothing else does.
 */
const ADDRESSEE = new RegExp(String.raw`(?:^|\n|[.!?]\s+|[:'"“‘]\s*)(${NAME})\s*,\s*(?=\n|(?:your|this|we|you|it|after|following|on)\b)`, "u");

function samePersonWords(a: string, b: string): boolean {
  const first = (name: string) => name.trim().split(/\s+/)[0]!.toLowerCase();
  return first(a) === first(b);
}

/** The turn as the proposal reads it: without a letter's sign-off when it names another person than the form's. */
export function withoutLetterSigner(request: Pick<AskRequest, "question">): string {
  const question = request.question;
  if (!exitLetterSignerNotSubjectEnabled()) return question;
  const subject = FORM_FOR.exec(question)?.[1] ?? (exitLetterAddresseeEnabled() ? ADDRESSEE.exec(question)?.[1] : undefined);
  const end = question.trimEnd();
  const signOff = SIGN_OFF.exec(end);
  if (signOff) {
    if (!subject || samePersonWords(subject, signOff[2]!)) return question;
    return `${end.slice(0, signOff.index)}${signOff[1]!.trimEnd()}${signOff[4]}`.trimEnd();
  }
  // EXIT_LETTER_ADDRESSEE_ENABLED: "Sincerely,\n<C>\nDistrict Manager" — the name and the title on lines of their own.
  const lines = exitLetterAddresseeEnabled() ? SIGN_OFF_LINES.exec(end) : null;
  if (!lines || !subject || samePersonWords(subject, lines[2]!)) return question;
  return `${end.slice(0, lines.index)}${lines[1]!}${lines[4]}`.trimEnd();
}
