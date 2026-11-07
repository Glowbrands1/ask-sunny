import type { AskRequest } from "@/lib/ai/types";
import { proposalNameCorrectionEnabled } from "@/lib/config/chat-quality-flags";

import { nameCorrectionQuestion } from "./name-correction-words";

/**
 * ============================================================================
 * "FIX HER LAST NAME …" ON A CARD NOT YET CREATED
 * ============================================================================
 *
 * PROPOSAL_NAME_CORRECTION_ENABLED (QA, round 5, 8 Nov 2026; ported from Ask Bubbles, the 2 Nov chat behind
 * NAME_CORRECTION_WORDS; here "it's spelled <surname>" also put "Spelled <surname>" on the card as the employee). The
 * manager typed the employee's surname wrong, and on the card (before Create) wrote "fix her last name <surname>".
 * NAME_CORRECTION_WORDS reads that only for an open draft, so the card was proposed again with the old name and the
 * reply said "Nothing on the form has changed yet". A whole name ("change her name to <first> <last>") already
 * re-proposes the card for that person.
 *
 * With the flag on, when no form is open and the reply before this turn drafted a card, the turn is read the way an
 * open draft's is (`name-correction-words.ts`), against the card's employee — plus "her last name is <X>", "it's
 * spelled <X>" and "fix her last name, it is <X>" — and the proposal path is handed "change her name to <the name>".
 * The roster then decides as for any typed name: a roster person is seated; an off-roster spelling gets the
 * existing off-roster confirm. Nothing else on the card is read from this turn. Only the turn the readers see
 * changes; the manager's message is stored as typed. Off, the request as it is.
 */

const LAST_NAME_IS = /^\s*(?:and\s+|ok(?:ay)?[,\s]+)?(?:her|his|their)\s+last\s+name\s+(?:is|should\s+be)\s+(.+?)\s*[.!]?\s*$/i;
const SPELLED = /^\s*(?:ok(?:ay)?[,\s]+)?(?:it'?s|it\s+is|that'?s|her\s+name\s+is|(?:her|his|their)\s+(?:last\s+)?name'?s)\s+spelled\s+(.+?)\s*[.!]?\s*$/i;
/** "fix her last name, it is Fenwick": a comma and "it is / it's" between the ask and the surname. */
const LAST_NAME_COMMA = /^(\s*(?:please\s+)?(?:fix|change|correct|update)\s+(?:her|his|their)\s+last\s+name)\s*,\s*(?:it\s+is|it'?s)\s+/i;

function lastNameQuestion(typed: string, currentName: string): string | null {
  const surname = typed.replace(/^["'“‘]+|["'”’]+$/g, "").trim();
  if (!surname || surname.split(/\s+/).length > 3) return null;
  return `change her name to ${[...currentName.trim().split(/\s+/).slice(0, -1), surname].join(" ")}`;
}

const CHANGE_TO = "change her name to ";

/**
 * A name typed all in lower case ("fix her last name penhallow", "… supposed to be odessa lark penhallow") is
 * capitalised word by word, so the name readers take it as a name; one the manager capitalised is kept as typed.
 */
function asTypedName(rewritten: string | null): string | null {
  if (!rewritten?.startsWith(CHANGE_TO)) return rewritten;
  const name = rewritten.slice(CHANGE_TO.length);
  const words = name.split(/\s+/);
  const fixed = words.map((word) => (word === word.toLowerCase() ? word.replace(/(^|[-'’])(\p{L})/gu, (_, lead: string, letter: string) => lead + letter.toUpperCase()) : word));
  return CHANGE_TO + fixed.join(" ");
}

/** The turn as the proposal path should read it, or null when it is not a name correction of the card's employee. */
export function proposalNameCorrection(question: string, currentName: string): string | null {
  return asTypedName(readCorrection(question, currentName));
}

function readCorrection(question: string, currentName: string): string | null {
  const read = nameCorrectionQuestion(question.replace(LAST_NAME_COMMA, "$1 "), currentName);
  if (read) return read;
  const last = LAST_NAME_IS.exec(question);
  if (last) return lastNameQuestion(last[1]!, currentName);
  const spelled = SPELLED.exec(question);
  if (!spelled) return null;
  const typed = spelled[1]!.trim();
  if (typed.split(/\s+/).length === 1) return lastNameQuestion(typed, currentName);
  return nameCorrectionQuestion(`the correct spelling is ${typed}`, currentName);
}

/** The card's own first line: "I'll draft a **Corrective Action Form** for **<name>** …". */
const CARD_LEAD = /^I'll draft an? \*\*[^*\n]+\*\* for \*\*([^*\n]+)\*\*/m;

/**
 * The employee on the card on screen: the one the reply before this turn drafted, when no form is open. The request
 * carries no card (the route keeps only the turns' words), so it is read from that reply's own first line. Whatever
 * it says, the rewrite only gives the proposal path a name to check against the roster, as a typed name is.
 */
function cardEmployee(request: Pick<AskRequest, "history" | "activeFormInstanceId">): string | null {
  if (request.activeFormInstanceId) return null;
  const last = [...request.history].reverse().find((turn) => turn.role === "assistant");
  return (last && CARD_LEAD.exec(String(last.content ?? ""))?.[1]?.trim()) || null;
}

export function withProposalNameCorrection<T extends AskRequest>(request: T): T {
  if (!proposalNameCorrectionEnabled()) return request;
  const employee = cardEmployee(request);
  if (!employee) return request;
  const question = proposalNameCorrection(request.question, employee);
  return question ? { ...request, question } : request;
}
