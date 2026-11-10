/**
 * ============================================================================
 * "MAKE IT ABOUT <X>": <X> IS THE ACCOUNT, THE INSTRUCTION IS NOT
 * ============================================================================
 *
 * PROPOSAL_MAKE_IT_ABOUT_ENABLED (QA's Sunny flip-9 tester, item 9, 8 Nov 2026). On a proposal card, "I need you to
 * make it about showing up late and please list the policy make the date for 10/14/26." was read as more of what
 * happened: the card's Observation and the drafting model's notes held the instruction word for word. A manager who
 * says what the form is to be about has given its account: <X> ("showing up late"), and the account said before it
 * is set aside. The rest of the sentence ("please list the policy", "make the date for …") is an ask, read by the
 * date and policy readers; it is not account.
 *
 * Pure: the caller decides when the flag applies (MADE_FOR_IS_MADE_ABOUT, below, is read here: every reader of a made-about
 * turn calls `madeAbout`).
 */

import { madeForIsMadeAboutEnabled } from "@/lib/config/chat-quality-flags";

/** "make it about", "make this about", "make the form be about". */
const MAKE_IT_ABOUT =
  /\bmake\s+(?:it|this|that|the\s+(?:form|document|coaching(?:\s+(?:form|document))?|ca|c\/a|corrective\s+action(?:\s+form)?|write-?up))\s+(?:be\s+)?about\s+/i;

/*
 * MADE_FOR_IS_MADE_ABOUT_ENABLED (QA's live Sunny r20, 10 Nov 2026, 10:40:28Z): on a saved Coaching draft, "can you make it
 * for missing out monthly meeting" answered "I haven't changed the Coaching Form …": "make it FOR <topic>" was not read
 * as a made-about, so the account could not be replaced. "for" followed by what happened ("missing …", "not clocking in",
 * "being late") says what the form is about. Not a date, a person, a salon or a level ("for 10/14/26", "for Perrin", "for
 * Kearney", "for a verbal"): those are not an -ing account. Nor a time of day ("for morning shift").
 */
const MAKE_IT_FOR =
  /\bmake\s+(?:it|this|that|the\s+(?:form|document|coaching(?:\s+(?:form|document))?|ca|c\/a|corrective\s+action(?:\s+form)?|write-?up))\s+(?:be\s+)?for\s+(?=(?:not\s+|never\s+)?(?!(?:morning|evening|during|spring|thing|nothing|something|anything|everything|building|clothing|wedding|king)\b)[a-z]+ing\b)/i;

/** Where <X> ends: a sentence end, or the next ask joined on ("and please list …", "make the date …"). */
const ENDS =
  /[.;!?\n]|,?\s+(?:and\s+)?(?:please|pls)\b|,?\s+and\s+(?:also\s+)?(?:list|cite|add|make|change|set|put|use|include|reference|remove|date|switch|update)\b|,?\s+(?:make|set|change|put|update)\s+(?:the\s+)?(?:date|policy|title|salon|location)\b|,?\s+(?:list|cite|reference)\s+the\s+polic/i;

/**
 * MADE_FOR_IS_MADE_ABOUT_ENABLED: the manager's sentence as the old path's revision reads a made-about ("make it about
 * <X>"), when it said "make it for <X>". The revision (`forms/revision.ts`, protected) knows only "about": it would read the
 * turn as a rewording and refuse the new account for dropping the old one. Unchanged otherwise.
 */
export function asMadeAboutWording(text: string): string {
  if (MAKE_IT_ABOUT.test(text ?? "") || !madeForIsMadeAboutEnabled()) return text;
  const found = MAKE_IT_FOR.exec(text ?? "");
  if (!found) return text;
  const at = found.index + found[0].length;
  return `${text.slice(0, at).replace(/\bfor\s+$/i, "about ")}${text.slice(at)}`;
}

/**
 * <X> from one sentence or turn, or null when it does not say what the form is about. `aboutOnly`: "make it about" alone
 * (MADE_FOR_IS_MADE_ABOUT: where a "for" turn must keep its reader's own account, `forms/form-patch-turn.ts`).
 */
export function madeAbout(text: string, options: { readonly aboutOnly?: boolean } = {}): string | null {
  const found = MAKE_IT_ABOUT.exec(text ?? "") ?? (madeForIsMadeAboutEnabled() && !options.aboutOnly ? MAKE_IT_FOR.exec(text ?? "") : null);
  if (!found) return null;
  const rest = text.slice(found.index + found[0].length);
  const end = ENDS.exec(rest);
  const about = (end ? rest.slice(0, end.index) : rest)
    .replace(/\s+/g, " ")
    .replace(/\s+(?:and|but|then|also)\s*$/i, "")
    .replace(/^["“']|["”']$/g, "")
    .trim();
  return about.length >= 3 ? about : null;
}

function sentencesOf(turn: string): string[] {
  return turn
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** <X> as a sentence: "showing up late" → "Showing up late." */
function asSentence(about: string): string {
  const text = about.charAt(0).toUpperCase() + about.slice(1);
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/** The last "make it about <X>" in these turns, as a sentence ("Showing up late."), or null. */
export function latestMadeAbout(turns: readonly string[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const sentences = sentencesOf(turns[index] ?? "");
    for (let at = sentences.length - 1; at >= 0; at -= 1) {
      const about = madeAbout(sentences[at]!);
      if (about) return asSentence(about);
    }
  }
  return null;
}

const OBSERVATION_LINE = "**Observation of Offense:**";

/**
 * The card's Observation line is <X> when the turns say what the form is about: the line the readers wrote is
 * replaced (or added) with it. The manager said it, so no account filter stands between it and the card.
 */
export function withObservationMadeAbout(content: string, turns: readonly string[]): string {
  const about = latestMadeAbout(turns);
  if (!about) return content;
  const kept = content
    .split("\n")
    .filter((line) => !line.trim().startsWith(OBSERVATION_LINE))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${kept}\n\n${OBSERVATION_LINE} ${about}`.trim();
}

/**
 * The account turns with the last "make it about <X>" applied: the turns before it are set aside, its sentence is
 * <X>, and the sentences and turns after it stay. Unchanged when no turn says it.
 */
export function turnsMadeAbout(turns: readonly string[]): readonly string[] {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const sentences = sentencesOf(turns[index] ?? "");
    for (let at = sentences.length - 1; at >= 0; at -= 1) {
      const about = madeAbout(sentences[at]!);
      if (!about) continue;
      const turn = [asSentence(about), ...sentences.slice(at + 1)].join(" ");
      return [turn, ...turns.slice(index + 1)];
    }
  }
  return turns;
}

/** The draft's notes (the manager's turns, joined) with the last "make it about <X>" applied. */
export function notesMadeAbout(notes: string): string {
  const turns = (notes ?? "").split(/\n{2,}/);
  const made = turnsMadeAbout(turns);
  return made === turns ? notes : made.join("\n\n");
}
