import { cardNameThenWordsCurrentEnabled } from "@/lib/config/chat-quality-flags";
import { displayName, type RosterEmployee } from "@/lib/forms/employee-match";

import type { AskResponse } from "./types";

/**
 * ============================================================================
 * "<A> MISSING HER SHIFTS": THE NAME ENDS WHERE THE ACCOUNT STARTS
 * (CARD_NAME_THEN_WORDS_CURRENT_ENABLED, default off; QA's sf-s38, 8 Nov 2026)
 * ============================================================================
 *
 * "make me an CA for <A> missing her saturday and sunday shifts …": the name reader ran on into the account and read
 * "<A> missing" (also "<A> failing …"). Then:
 *   - Create refused the right card: "This proposal is out of date: the conversation now says the form is for
 *     <A> missing, not <A>" (`forms/proposal-currency.ts`);
 *   - typed in lower case ("for <a> missing her shift"), or in the sibling app, the card itself was for
 *     "<A> Missing", and Create made the form under that name.
 *
 * With the flag on, a reading that is one roster person's whole name followed by a VERB-SHAPED word the manager
 * typed in lower case ("missing", "failing", "not", "was", "never", "who", "left", …) is that person. A capitalised
 * word after the name ("<A> Manning"), or a lower-case one that is no verb shape ("<a> ashby"), is still another name
 * and still checked. Off, nothing changes.
 */
const VERB_SHAPE =
  /^(?:[a-z]{2,}ing|not|never|no|being|been|was|wasn['’]t|is|isn['’]t|has|hasn['’]t|had|hadn['’]t|did|didn['’]t|does|doesn['’]t|who|that|because|due|and|for|to|after|since|keeps|kept|left|came|called|walked|showed|missed|failed|refused|quit|skipped|forgot)$/;

/**
 * The words after the name, if they start with a verb shape typed in lower case: `typed` is the manager's own text,
 * where the case is read (the reading itself may be title-cased).
 */
function verbAfter(nameWords: readonly string[], readWords: readonly string[], typed: string): boolean {
  if (readWords.length <= nameWords.length) return false;
  if (!nameWords.every((word, index) => readWords[index]!.toLowerCase() === word.toLowerCase())) return false;
  const next = readWords[nameWords.length]!;
  if (!VERB_SHAPE.test(next.toLowerCase())) return false;
  const escaped = [...nameWords, next].map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const said = new RegExp(`\\b${escaped}\\b`, "i").exec(typed);
  return said !== null && /^[a-z]/.test(said[0].split(/\s+/).at(-1)!);
}

/** The roster person a reading names, when it is their whole name followed by a verb shape typed in lower case. */
export function rosterPersonThenVerb(read: string, roster: readonly RosterEmployee[], typed: string): string | null {
  const readWords = read.trim().split(/\s+/);
  const found = roster.filter((person) => {
    const name = displayName(person).split(/\s+/);
    return name.length >= 2 && verbAfter(name, readWords, typed);
  });
  return found.length === 1 ? displayName(found[0]!) : null;
}

/** The Create check: the conversation's reading is the card's whole name followed by a verb shape typed in lower case. */
export function readingIsCardThenVerb(read: string, card: string, typed: string): boolean {
  if (!cardNameThenWordsCurrentEnabled()) return false;
  const name = card.trim().split(/\s+/);
  return name.length >= 2 && verbAfter(name, read.trim().split(/\s+/), typed);
}

/** The card: a card for "<A> Missing" is the roster's <A>, and the reply names them so. */
export async function withCardNameThenWords(
  response: AskResponse,
  typed: string,
  roster: () => Promise<readonly RosterEmployee[]>,
): Promise<AskResponse> {
  if (!cardNameThenWordsCurrentEnabled()) return response;
  const read = response.formProposal?.employeeName?.trim();
  if (!read || read.split(/\s+/).length < 3) return response;
  const person = rosterPersonThenVerb(read, await roster(), typed);
  if (!person) return response;
  return {
    ...response,
    content: response.content.split(`**${read}**`).join(`**${person}**`),
    formProposal: { ...response.formProposal!, employeeName: person },
  };
}
