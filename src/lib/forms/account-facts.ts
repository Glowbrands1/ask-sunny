/**
 * ============================================================================
 * THE FACT IN A CLAUSE, OR NONE (CARD_ACCOUNT_DROPS_NON_FACTS_ENABLED)
 * ============================================================================
 *
 * QA's Bubbles 17w live chat and v2-Gate-Sunny-3's 78 probes (14 Nov 2026), on a card for "<A> was late on 11/3/26":
 * the turn after it went whole into the card's account, or a fact in it was lost. One reading for every place a card
 * joins a later turn (the card check's added facts, the Issue across turns, the Observation line):
 *
 *   kept, cleaned    "also she didn't clean" → "she didn't clean"; "make it a written warning, she yelled at a guest" and
 *                    "this is a final warning she yelled at a guest" → "she yelled at a guest" (the level is the form's);
 *                    "she yelled at a guest i guess" / ", maybe twice" → "she yelled at a guest" (the hedge dropped);
 *                    "… as a TC", "she works as a <title> and yelled …" → no title; "… at <store or salon>" → no place.
 *   none             a hedged account ("i think …", "not sure but …", "apparently …", "possibly …", "she maybe / might
 *                    have / probably …"): never established, so never on the card; history ("she had a verbal last month",
 *                    "she has been late 3 times this month", "she was previously warned …", "last week she …"): prior
 *                    actions, not this incident; a denied fault ("she was not late", "she didn't yell at a guest"); a
 *                    clause that only places or dates it ("it happened at <place>", "it was on 11/3").
 *
 * Pure: no flag, no I/O. Places and titles are the caller's (each app's own), so no company's words are here.
 */

export interface FactContext {
  /** The text is only a place (a store or salon, its city or street). */
  readonly onlyPlace: (text: string) => boolean;
  /** The text is only a job title or role ("team member", "assistant salon director"). */
  readonly onlyTitle: (text: string) => boolean;
}

/** "then" is not filler: it is a time lead, kept with the fact (the sibling's G4-893: "then she walked out" lost "then"). */
const LEAD_FILLER = /^(?:(?:and|also|plus|but|oh|ok|okay|so)\s*,?\s+)+/i;
const LEVEL_WORDS = String.raw`(?:(?:verbal|written|final|first|second|last)\s+){0,2}(?:warning|ca|c\/a|write[- ]?up|corrective\s+action)`;
/** "make it a written warning, ", "this is a final warning ", "it should be a written, ": the level is the form's, not what happened. */
const LEVEL_LEAD = new RegExp(
  String.raw`^(?:make\s+(?:it|this)|(?:it|this)\s+(?:is|should\s+be|will\s+be)|(?:give|do)\s+(?:her|him|them)?)\s+(?:a|an|her|his|their|the)?\s*${LEVEL_WORDS}\s*[,.;:-]?\s*`,
  "i",
);
/** ", written", " written warning please": a level after the account. */
const LEVEL_TAIL = new RegExp(String.raw`\s*[,;-]?\s*(?:(?:a|an)\s+)?(?:(?:verbal|written|final)(?:\s+(?:warning|ca|c\/a|write[- ]?up))?|${LEVEL_WORDS})(?:\s+please)?\s*$`, "i");

const HEDGE_LEAD =
  /^(?:i\s+(?:think|guess|believe|heard|assume|suspect)|not\s+(?:sure|certain)(?:\s+(?:but|if))?|maybe|possibly|probably|apparently|supposedly|allegedly|perhaps|i'?m\s+not\s+sure(?:\s+but)?)\b/i;
const SUBJECT = String.raw`(?:she|he|they|[A-Z][a-z'’-]+)`;
/** "she gets a verbal warning", "he should get a written": the level is the form's, not what happened. */
const GETS_LEVEL = new RegExp(
  String.raw`^${SUBJECT}\s+(?:also\s+)?(?:gets?|got|getting|will\s+get|should\s+get|is\s+getting|receives?|received|deserves?|needs?)\s+(?:(?:a|an|her|his|their|the|another)\s+)?(?:(?:verbal|written|final)(?:\s|$)|${LEVEL_WORDS})`,
  "i",
);
const HEDGED_VERB = new RegExp(String.raw`^${SUBJECT}\s+(?:maybe|probably|possibly|perhaps|might|may|must\s+have|could\s+have)\b`, "i");
/** " i guess", ", maybe twice", ", probably": a hedge after the account; the account is kept without it. */
const HEDGE_TAIL = /\s*,?\s+(?:i\s+(?:guess|think|believe)|maybe(?:\s+[\w'’]+){0,2}|probably|possibly|perhaps|or\s+something)\s*$/i;

/** History: an earlier step or a pattern, not this incident (it belongs in prior actions). */
const HISTORY =
  /\b(?:last\s+(?:week|month|year|time)|previously|in\s+the\s+past|before\s+this|had\s+(?:a|an)\s+(?:(?:verbal|written|final)\s+)?(?:warning|ca|c\/a|write[- ]?up|coaching)|(?:has|have)\s+been\s+[\w'’]+\s+\d+\s+times|\d+\s+times\s+(?:this|last)\s+(?:week|month|year)|(?:was|were|has\s+been)\s+(?:already\s+)?(?:warned|coached|written\s+up)|(?:coached|warned|written\s+up)\s+on\s+\d)/i;

const NEGATION = String.raw`(?:never|not|did\s+not|didn['’]?t|was\s+not|wasn['’]?t|has\s+not|hasn['’]?t|is\s+not|isn['’]?t)`;
/** A denied fault ("she was not late") or a denied misconduct ("she didn't yell at a guest"). An omission of a duty ("she didn't clean") is a fact. */
const DENIED = new RegExp(
  String.raw`^${SUBJECT}\s+(?:(?:is|was|were|has|had)\s+)?${NEGATION}\s+(?:(?:really|actually|even)\s+)?(?:late|tardy|absent|rude|yell\w*|scream\w*|curs\w*|cuss\w*|swear\w*|steal\w*|lie|lied|argu\w*|fight\w*|hit|push\w*|threaten\w*|harass\w*|insult\w*)\b`,
  "i",
);
/** "it happened at <place>", "this was at the <place> store", "it was on 11/3": where or when, nothing that happened. */
const ONLY_WHERE_OR_WHEN = /^(?:it|this|that|the\s+incident)\s+(?:happened|was|occurred|took\s+place)\s+(?:at|in|on|during)\b/i;

const AS_TITLE = /\s+as\s+(?:a|an|the|our)\s+((?:[\w'’-]+\s*){1,4})$/i;
const WORKS_AS = new RegExp(String.raw`^(${SUBJECT})\s+(?:works|worked|is\s+working)\s+as\s+(?:a|an|the|our)\s+.+?\s+and\s+(?:then\s+)?(.+)$`, "i");
/** The last " at / in (the) …" phrase of the clause: its offset and what follows it. */
function lastPlacePhrase(text: string): { readonly index: number; readonly words: string } | null {
  let found: { index: number; words: string } | null = null;
  for (const match of text.matchAll(/\s+(?:at|in)\s+(?:the\s+)?/gi)) {
    const words = text.slice(match.index! + match[0].length).trim();
    if (words !== "" && words.split(/\s+/).length <= 5) found = { index: match.index!, words };
  }
  return found;
}
/** "she works as a team member": who she is, nothing that happened. */
const WORKS_AS_ONLY = new RegExp(String.raw`^${SUBJECT}\s+(?:works|worked|is\s+working|is\s+employed)\s+as\s+(?:a|an|the|our)?\s*(.+)$`, "i");

/** What is left of "she works at <place>" once the place is set aside: where she works, nothing that happened. */
const WORKS_THERE = new RegExp(String.raw`^${SUBJECT}\s+(?:works|worked|is\s+working|was\s+working|is|was|is\s+employed)$`, "i");

/** A short all-capitals abbreviation the manager typed for a title ("TM", "TC", "AGM"). */
function abbreviation(text: string): boolean {
  return /^[A-Z]{2,4}$/.test(text.trim());
}

/** The clause without a leading filler ("also", "and then") or a level said before the account ("make it a written warning, "). */
export function withoutLeads(clause: string): string {
  let text = clause.trim();
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(LEAD_FILLER, "").replace(LEVEL_LEAD, "").trim();
  }
  return text;
}

/** The whole sentence is hedged ("not sure but she …", "i think she …"): never established, so no part of it is a fact. */
export function hedgedAccount(sentence: string): boolean {
  const text = withoutLeads(sentence.trim());
  return HEDGE_LEAD.test(text) || HEDGED_VERB.test(text);
}

/** A fact that says nothing an earlier one does not: every word of it is in one of them ("she was late" after "she was late on 11/3/26"). */
export function repeatsAFact(fact: string, earlier: readonly string[]): boolean {
  const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}'’]+/u).filter((word) => word.length > 0);
  const mine = words(fact);
  return earlier.some((kept) => {
    const have = new Set(words(kept));
    return mine.every((word) => have.has(word));
  });
}

/** The fact the clause states, cleaned of level, hedge, title and place; null when it states none. */
export function factOfClause(clause: string, context: FactContext): string | null {
  let text = withoutLeads(clause.trim().replace(/[.!]+$/, ""));
  let previous = "";
  if (text === "" || HEDGE_LEAD.test(text) || HEDGED_VERB.test(text)) return null;
  if (HISTORY.test(text) || DENIED.test(text) || ONLY_WHERE_OR_WHEN.test(text)) return null;
  if (GETS_LEVEL.test(text)) return null;
  const worksAs = WORKS_AS_ONLY.exec(text);
  if (worksAs && !/\s+and\s+/i.test(worksAs[1]!) && (context.onlyTitle(worksAs[1]!) || abbreviation(worksAs[1]!))) return null;
  const works = WORKS_AS.exec(text);
  if (works) text = `${works[1]} ${works[2]}`;
  previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(HEDGE_TAIL, "").replace(LEVEL_TAIL, "").trim();
    const title = AS_TITLE.exec(text);
    if (title && (context.onlyTitle(title[1]!) || abbreviation(title[1]!))) text = text.slice(0, title.index).trim();
    const place = lastPlacePhrase(text);
    if (place && context.onlyPlace(place.words)) {
      text = text.slice(0, place.index).trim();
      // "she works at <salon>": where she works, never a fact (the sibling's G4-893: "she works" was added).
      if (WORKS_THERE.test(text)) return null;
    }
  }
  text = text.replace(/[\s,;:-]+$/, "").trim();
  return text.split(/\s+/).length >= 2 ? text : null;
}
