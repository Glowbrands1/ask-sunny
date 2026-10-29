import { answerNotANameEnabled, dateAnswerAppliedEnabled, exitTermsNotNamesEnabled, streetAddressNotANameEnabled } from "@/lib/config/chat-quality-flags";

import { isPayrollWords } from "./payroll-words";

/*
 * The same words as `isDateAnswerWords` in `incident-dates.ts`, held here
 * because that module imports `proposal.ts` and this one is imported by it
 * (see `import-cycles.test.ts`). A test pins the two to the same answers.
 */
const DATE_ANSWER_WORDS = /^(?:the\s+)?(?:most\s+recent|latest|newest|last(?:\s+(?:one|date))?|first(?:\s+one)?|earliest|oldest|second(?:\s+one)?)$/i;

function isDateAnswer(name: string): boolean {
  return dateAnswerAppliedEnabled() && DATE_ANSWER_WORDS.test(name.trim());
}

/**
 * EXIT_TERMS_NOT_NAMES_ENABLED (port from the sibling app, 29 Oct 2026): a
 * manager's exit there, "… drop wage and forfeit bonus. not eligible for
 * rehire …", was asked "Which of them is this Resignation/Exit Form for —
 * <the person>, drop wage or forfeit bonus?". The exit form's own shortcut
 * words name nobody: a candidate made only of them is not a name.
 */
const EXIT_TERMS = new Set([
  "drop", "wage", "wages", "minimum", "forfeit", "forfeited", "forfeits", "bonus", "bonuses",
  "salon", "key", "keys", "item", "items", "returned", "notice", "given", "rehire", "eligible",
  "immediate", "voluntary", "involuntary", "term", "termination", "terminated",
  "payroll", "deduct", "deducted", "deduction", "applies", "apply", "not", "no", "and",
]);

export function isExitTerms(name: string): boolean {
  if (!exitTermsNotNamesEnabled()) return false;
  const words = name.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.length > 0 && words.every((word) => EXIT_TERMS.has(word));
}

/**
 * ============================================================================
 * AN ANSWER TO THE APP'S QUESTION NAMES NOBODY
 * ============================================================================
 *
 * Manager, 26 Oct 2026 (Ask Sunny production): six turns about a late
 * opening, the fourth "yes payrol ldeduct". The name reader in `proposal.ts`
 * took "payrol ldeduct" for a person, so the card's sources restarted at that
 * turn and the account before it never reached the draft: blank. The same
 * with "most recent" answering the date question after a turn in between.
 *
 * With ANSWER_NOT_A_NAME_ENABLED, a candidate that is only payroll wording or
 * only a date answer is not a name. Off, every candidate is kept: main.
 */
export function namesSomebody(name: string): boolean {
  if (isExitTerms(name)) return false;
  if (!answerNotANameEnabled()) return true;
  return !isPayrollWords(name) && !isDateAnswer(name);
}

/**
 * STREET_ADDRESS_NOT_A_NAME_ENABLED (QA, 29 Oct 2026, both apps): an exit's
 * "marnie's address is 125 Ne Oakfield Lane, kearney, NE. 68847" made the
 * chat ask "Which of them … — marnie holloway or Ne Oakfield Lane?". A
 * street address runs from a house number through its street word ("Lane",
 * "St", "Dr" …) to the ZIP code or the end of the sentence; a candidate whose
 * words all sit inside one is part of the address, not a person. "jordan
 * lane" with no house number before it is still a person.
 */
const STREET_WORD =
  "lane|ln|street|st|avenue|ave|road|rd|drive|dr|boulevard|blvd|court|ct|circle|cir|way|place|pl|terrace|ter|trail|trl|parkway|pkwy|highway|hwy|loop|square|sq";
const STREET_ADDRESS = new RegExp(
  `\\b\\d{1,6}\\s+(?:[a-z0-9'.-]+\\s+){0,4}?(?:${STREET_WORD})\\b\\.?(?:[^\\n]{0,60}?\\b\\d{5}(?:-\\d{4})?\\b|[^.\\n]*)`,
  "gi",
);

function addressWords(text: string): Set<string>[] {
  return [...text.matchAll(STREET_ADDRESS)].map((match) => new Set(match[0].toLowerCase().match(/[a-z0-9]+/g) ?? []));
}

/** A filter for the name reader: keeps every name with the flag off. */
export function notInStreetAddress(text: string): (name: string) => boolean {
  if (!streetAddressNotANameEnabled()) return () => true;
  const addresses = addressWords(text);
  if (addresses.length === 0) return () => true;
  return (name) => {
      const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    return !(words.length > 0 && addresses.some((address) => words.every((word) => address.has(word))));
  };
}
