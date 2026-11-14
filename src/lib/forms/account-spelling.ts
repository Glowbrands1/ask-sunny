import { PRODUCTION_SALONS } from "@/data/salons";
import { accountTyposFixedEnabled } from "@/lib/config/chat-quality-flags";

import { accountNames } from "./account-names";

import { correctedText } from "./typo-match";
import { NEVER_CORRECTED, typoVocabulary } from "./typo-vocabulary";

/**
 * ============================================================================
 * THE CARD'S ACCOUNT, WITH THE OBVIOUS TYPOS MENDED
 * ============================================================================
 *
 * ACCOUNT_TYPOS_FIXED_ENABLED (QA, the Sunny sanitation report, 10 Nov 2026 18:49Z; default off). "please make a ca for
 * <name> for not doing th e10 minute sanitaion" put "**Observation of Offense:** not doing th e10 minute sanitaion" on the
 * card. On: the card's account keeps the manager's words with the obvious slips mended — a word broken before a number
 * ("th e10" → "the 10"), a misspelling one edit from a known word ("sanitaion" → "sanitation"; `typo-match.ts`'s rules: same
 * first letter, no tie, never a name or a listed real word), and "10 minute sanitation" → "10-minute sanitation". Nothing
 * is reworded, and dates, numbers and titles are left as typed (FORM_INPUT_FIDELITY, S#166, is about those; it is untouched).
 * Off: the text as written.
 */
const ACCOUNT_WORDS = [
  "sanitation", "sanitize", "sanitized", "cleaning", "cleaned", "minute", "minutes", "morning", "evening", "closing",
  "opening", "register", "drawer", "shift", "lotion", "towels", "customer", "complaint", "schedule", "completed",
];
const SHORT_WORDS = new Set(["the", "a", "an", "to", "of", "in", "on", "at", "for", "and", "her", "his", "my", "our"]);

/** "th e10" → "the 10": a short word whose last letter slipped onto the number after it. */
function withWordBreaksMended(text: string): string {
  return text.replace(/\b([a-z]{1,4}) ([a-z])(\d)/gi, (whole, head: string, tail: string, digit: string) =>
    SHORT_WORDS.has(`${head}${tail}`.toLowerCase()) && !SHORT_WORDS.has(head.toLowerCase()) ? `${head}${tail} ${digit}` : whole,
  );
}

/** "10 minute sanitation" → "10-minute sanitation": a number and a unit before the noun they describe. */
function withUnitHyphen(text: string): string {
  return text.replace(/\b(\d+) (minute|hour|day|week)\b(?=\s+[a-z])/gi, "$1-$2");
}

/*
 * QA's bar (the sibling gate's #772 probe, 14 Nov 2026; ported): the account's spelling never edits
 *   - inside a quoted span of any kind ("…", '…', “…”, ‘…’): "registr" in 'that is not my registr' stays;
 *   - a capitalised word, so it never changes a word's case ("Keyhodler Dariel" stays);
 *   - a roster name (every person on the turn's roster, `account-names.ts`, not only the employee) or a close typo of
 *     one ("Manuel saw her", "manuel saw her" stay);
 *   - a salon name: salon words are not in its list, and a word a letter from one is left ("kearny salon", "Lincon").
 */
// A quote left open to the end of the text (the Issue reader can drop a closing quote mark) is quoted to the end; an
// apostrophe between two letters ("isn't") is part of the quote, not its end (Gate-Sunny-2, #983).
const QUOTED = /"[^"\n]*(?:"|$)|“[^”\n]*(?:”|$)|‘(?:[^’\n]|(?<=[A-Za-z])’(?=[A-Za-z]))*(?:’|$)|(?<![A-Za-z0-9])'(?:[^'\n]|(?<=[A-Za-z])'(?=[A-Za-z]))+(?:'(?![A-Za-z0-9])|$)/g;

function salonWords(): ReadonlySet<string> {
  return new Set(PRODUCTION_SALONS.flatMap((salon) => salon.name.toLowerCase().split(/[^a-z]+/)).filter((word) => word.length >= 3));
}

function oneEditApart(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (left.length < right.length) j += 1;
    else if (left[i] === right[j + 1] && left[i + 1] === right[j]) {
      i += 2;
      j += 2;
    } else {
      i += 1;
      j += 1;
    }
  }
  return edits + (left.length - i) + (right.length - j) <= 1;
}

/** The account as the card shows it. Names, salon words, capitalised words and quoted spans are never corrected. */
export function cardAccountText(text: string, name: string | null | undefined): string {
  if (!accountTyposFixedEnabled()) return text;
  const people = new Set([...(name ?? "").toLowerCase().split(/\s+/).filter(Boolean), ...accountNames()]);
  const salons = salonWords();
  const list = [...new Set([...typoVocabulary(), ...ACCOUNT_WORDS])].filter((word) => !salons.has(word));
  const near = (word: string, words: ReadonlySet<string>) => [...words].some((other) => other.length >= 4 && oneEditApart(word, other));
  // `correctedText` asks about a word lowercased, so the capitalised words are collected first.
  let capitalised: ReadonlySet<string> = new Set();
  const keep = (word: string) => {
    const lower = word.toLowerCase();
    return (
      capitalised.has(lower) ||
      NEVER_CORRECTED.has(word) ||
      people.has(lower) ||
      near(lower, people) ||
      salons.has(lower) ||
      near(lower, salons)
    );
  };
  const mend = (piece: string) => {
    capitalised = new Set([...piece.matchAll(/\b[A-Z][A-Za-z]*/g)].map((match) => match[0].toLowerCase()));
    return withUnitHyphen(correctedText(withWordBreaksMended(piece), list, keep).text);
  };
  // Quoted spans are kept exactly as typed; only the text between them is mended.
  let out = "";
  let last = 0;
  for (const match of text.matchAll(QUOTED)) {
    out += mend(text.slice(last, match.index)) + match[0];
    last = match.index! + match[0].length;
  }
  return out + mend(text.slice(last));
}
