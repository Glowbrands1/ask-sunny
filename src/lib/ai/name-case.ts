import { nameCaseInsensitiveEnabled } from "@/lib/config/chat-quality-flags";
import { describesIncident } from "@/lib/forms/corrective-action-intake";
import { extractJobTitle } from "@/lib/forms/proposal";
import { readSalonMentions } from "@/lib/forms/salon-mention";

import type { AskRequest } from "./types";

/**
 * NAME_CASE_INSENSITIVE_ENABLED: a name is read the same however it is typed.
 *
 * QA, 25-26 Oct 2026 (both apps share the name reader; names invented in the
 * tests): "write up devon harlan for being late" and the same in capitals
 * left the Employee blank while "Write up Devon Harlan …" worked; "Devon
 * harlan, ks manhattan, …" kept "Devon harlan"; a message typed in capitals
 * read "LAST DAY WAS" as a second person; "create a ca for Rory vance" kept
 * the lowercase surname. The name reader looks for capitals. Managers type
 * in lowercase (37% of first turns) and in sentence case.
 *
 * So before any reader sees a manager turn: a turn typed in capitals, and any
 * word in capitals of three letters or more that is not a title or an acronym
 * ("ANSWER", "LAST DAY"), is read in lowercase, and the person named where a form is asked for — after
 * "write up", "ca for", "coaching for", "exit form for", "warning for", "name
 * is", "one of my team members,", or two words that open the turn before a verb or a comma — is written
 * in Title Case. Up to two words (a third only when typed with a capital); a
 * job title, a place, a topic ("cash handling", "dress code"), an incident or
 * a function word is never part of it. One-word names are left as typed.
 * Off, every turn is read as typed.
 *
 * The same file in Ask Bubbles; only `READERS` differs.
 */

/** This app's readers of a title and a place. */
const READERS = {
  title: (word: string): boolean => extractJobTitle(word) !== null,
  place: (word: string): boolean => readSalonMentions(`at ${word}`).length > 0,
};

const FORM_LEAD =
  /\b(?:write\s*(?:-\s*)?up|(?:ca|c\/a|dpoa|corrective\s+action|coaching|coach|warning|write[- ]?up|exit|resignation|transfer|demotion|policy\s+review|follow[- ]?up(?:\s+coaching)?|epp|form|document|documentation)(?:\s+form)?\s+(?:for|on)|(?:employee(?:'s)?|her|his|their|the)\s+name\s+is|name\s+is|this\s+is\s+for|it'?s\s+for|(?:one\s+of\s+)?(?:my|our)\s+(?:team\s+members?|employees?|associates?|tms?)\s*,?)\s+/gi;
const OPENING = /^\s*([A-Za-z][A-Za-z'’-]+)\s+([A-Za-z][A-Za-z'’-]+)(?=\s*,|\s+(?:was|is|has|had|did|didn'?t|came|left|opened|needs|called|took|got)\b)/;
const FUNCTION_WORDS = new Set(
  (
    "a an the at for to in on of and or but who whom was were is are be being been she he they her him his their them my our your it this that " +
    "these those with without from by as about regarding because since after before during until today yesterday tomorrow not no yes " +
    "verbal written final warning coaching coach form forms ca exit policy payroll deduct deduction team member members store salon location " +
    "employee employees staff new hire manager director associate shift lead last day days week weekly month monthly year all any every " +
    "everyone someone somebody me you i we us also then there here please thanks thank"
  ).split(" "),
);
/** Capitalised abbreviations that are not shouting. */
const ACRONYMS = new Set(["JBA", "EFT", "EFTS", "PPTA", "UPTA", "LPSVA", "NCNS", "EPP", "SOP", "PTO", "HR", "USA"]);
/** Topic words: what the form is about, never who. */
const TOPIC_WORDS = new Set(
  (
    "cash handling dress code attendance tardiness tardy late lateness early phone cell cleaning clean deep register shortage drawer visitors " +
    "visitor conduct standards safety uniform behavior behaviour performance sales eft efts spa closing opening duties training theft time clock " +
    "schedule break breaks customer customers guest guests service sanitizing sanitation bed beds products product inventory recipe measuring " +
    "acknowledgements acknowledgement acks onboarding woven ppta upta lpsva tans tanning lotion lotions promo checkins check-ins no-show ncns"
  ).split(" "),
);

export function withNameCase(request: AskRequest): AskRequest {
  if (!nameCaseInsensitiveEnabled()) return request;
  const question = humanCase(request.question);
  let changed = question !== request.question;
  const history = request.history.map((turn) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return turn;
    const content = humanCase(turn.content);
    if (content === turn.content) return turn;
    changed = true;
    return { ...turn, content };
  });
  return changed ? { ...request, question, history } : request;
}

function shouting(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 10) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.8;
}

function nameWord(word: string): boolean {
  const lower = word.toLowerCase();
  return /^[a-z][a-z'’-]*$/.test(lower) && lower.length >= 2 && !FUNCTION_WORDS.has(lower) && !TOPIC_WORDS.has(lower) && !READERS.title(word) && !READERS.place(word);
}

function titleCase(word: string): string {
  return word.replace(/^([a-z])|([-'’][a-z])/g, (letter) => letter.toUpperCase());
}

/** The turn with capitals read as lowercase and the named person in Title Case. */
export function humanCase(text: string): string {
  if (!text?.trim()) return text;
  // A word in capitals ("ANSWER", "LAST DAY", "CALLED") is read in lowercase, so it is never offered as a person;
  // a job title or an acronym the managers use ("TC", "JBA", "EFT") keeps its capitals.
  const source = shouting(text)
    ? text.toLowerCase()
    : text.replace(/\b[A-Z][A-Z'’-]{2,}\b/g, (word) => (ACRONYMS.has(word) || READERS.title(word) ? word : word.toLowerCase()));
  const spans: { start: number; end: number; words: string[] }[] = [];
  const take = (from: number) => {
    const rest = source.slice(from);
    const tokens = [...rest.matchAll(/[A-Za-z][A-Za-z'’-]*/g)];
    const words: string[] = [];
    let end = from;
    for (const token of tokens) {
      const gap = rest.slice(words.length === 0 ? 0 : end - from, token.index);
      if (words.length > 0 && /[^\s]/.test(gap)) break;
      if (words.length === 0 && /[^\s]/.test(rest.slice(0, token.index))) break;
      // "test employee" is the placeholder managers type for a name.
      const placeholder = words.length === 1 && words[0]!.toLowerCase() === "test" && /^employee$/i.test(token[0]);
      if (!placeholder && !nameWord(token[0])) break;
      // A third word only when typed with a capital ("Mary Ann Smith"), never "rowan testcase opend".
      if (words.length === 2 && !/^[A-Z]/.test(token[0])) break;
      if (words.length === 3) break;
      words.push(token[0]);
      end = from + token.index! + token[0].length;
    }
    if (words.length < 2) return;
    const phrase = words.join(" ");
    if (describesIncident(phrase)) return;
    spans.push({ start: from, end, words });
  };
  for (const lead of source.matchAll(FORM_LEAD)) take(lead.index! + lead[0].length);
  const opening = OPENING.exec(source);
  if (opening) take(0);
  let out = source;
  for (const span of spans.sort((a, b) => b.start - a.start)) {
    const segment = out.slice(span.start, span.end);
    out = out.slice(0, span.start) + segment.replace(/[A-Za-z][A-Za-z'’-]*/g, (word) => titleCase(word.toLowerCase())) + out.slice(span.end);
  }
  return out;
}
