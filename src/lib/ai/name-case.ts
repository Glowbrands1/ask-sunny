import { nameCaseInsensitiveEnabled } from "@/lib/config/chat-quality-flags";
import { describesIncident } from "@/lib/forms/corrective-action-intake";
import { extractJobTitle } from "@/lib/forms/proposal";
import { readSalonMentions } from "@/lib/forms/salon-mention";

import type { AskRequest, AskResponse } from "./types";

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
 * The same file in the sibling app; only `READERS` differs.
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
      // QA-5, 26 Oct 2026: after a particle ("van der berg") the third word is the surname.
      if (words.length === 2 && !/^[A-Z]/.test(token[0]) && !PARTICLES.has(words[1]!.toLowerCase())) break;
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
    // A word with a capital inside it ("rOsAlYn", "McDonald") is kept as typed; titleCaseName says how.
    out = out.slice(0, span.start) + titleCaseName(segment) + out.slice(span.end);
  }
  return out;
}

/**
 * The card's name in Title Case, word by word (QA coordinator, 26 Oct 2026: a
 * form goes to HR, and "rory vance" on it looks wrong). A word typed all in
 * lowercase or all in capitals is written in Title Case, with its hyphen and
 * apostrophe parts ("mary-jane" → "Mary-Jane", "o'brien" → "O'Brien"); a word
 * with a capital inside it ("McDonald", "DeShawn", "rOsAlYn") is kept as
 * typed, and so is a particle after the first word ("Van der Berg", "de la
 * Cruz"). Only a name the manager typed is changed: a name spelled in a way
 * no manager turn has is the directory's spelling, and it wins. The reply is
 * changed on whole words only ("ann" never inside "Planning"). Off, the reply
 * is as it is.
 */
export function withNameTitleCase(response: AskResponse, request: AskRequest): AskResponse {
  if (!nameCaseInsensitiveEnabled()) return response;
  const name = response.formProposal?.employeeName;
  if (!name) return response;
  const titled = titleCaseName(name);
  if (titled === name) return response;
  const typed = [request.question, ...request.history.filter((turn) => turn.role === "user").map((turn) => turn.content)].filter(
    (turn): turn is string => typeof turn === "string",
  );
  const asTyped = wholeWord(name);
  if (!typed.some((turn) => asTyped.test(turn) || asTyped.test(humanCase(turn)))) return response;
  return {
    ...response,
    content: inReply(response.content, name, titled),
    formProposal: { ...response.formProposal!, employeeName: titled },
  };
}

/**
 * QA-5, 26 Oct 2026: a one-word name can be an ordinary word ("will": "She
 * Will sign and Will be late"). A one-word name is changed only where the
 * reply shows it as the name, in bold ("**will**", "**will**'s"); a longer
 * name on whole words.
 */
function inReply(content: string, name: string, titled: string): string {
  if (/\s/.test(name.trim())) return content.replace(new RegExp(wholeWord(name).source, "g"), titled);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(`\\*\\*${escaped}(?=\\*\\*|['’]s\\*\\*)`, "g"), `**${titled}`);
}

/** Name particles kept in lowercase after the first word. */
const PARTICLES = new Set(["van", "der", "den", "de", "la", "le", "von", "bin", "ibn", "du", "di", "da", "del", "y"]);

export function titleCaseName(name: string): string {
  let first = true;
  return name.replace(/[A-Za-z][A-Za-z'’-]*/g, (word) => {
    const atStart = first;
    first = false;
    const plain = word === word.toLowerCase() || word === word.toUpperCase();
    if (!plain) return word;
    if (!atStart && PARTICLES.has(word.toLowerCase())) return word.toLowerCase();
    // "al-amin", "el-sayed": the prefix stays lowercase after the first word.
    return word
      .toLowerCase()
      .replace(/(^|[-'’])([a-z])/g, (_, mark: string, letter: string) => `${mark}${letter.toUpperCase()}`)
      .replace(/^(Al|El)-/, (prefix) => (atStart ? prefix : prefix.toLowerCase()));
  });
}

function wholeWord(name: string): RegExp {
  return new RegExp(`(?<![A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`);
}
