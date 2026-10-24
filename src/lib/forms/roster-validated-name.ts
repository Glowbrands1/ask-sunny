import { NOT_A_NAME, NOT_A_TYPED_NAME } from "./name-words";
import { matchEmployeeName, type RosterEmployee } from "./employee-match";
import { extractEmployeeNames } from "./proposal";

/**
 * The employee on the card, read in code.
 *
 * A candidate span is taken from the manager's words. Salon and city names,
 * field labels ("Job title"), and promo or product tokens are stripped.
 * What remains is fuzzy-matched to the roster. An exact roster row lends its
 * spelling. Anything else — a close spelling, or nobody on the roster — stays
 * as typed. The model does not write this field.
 */

const PHRASES =
  /\b(?:job title|employee(?:'s)? name|tanning consultant|salon director|assistant salon manager|assistant salon director|team member(?: part time)?|primary salon|dress code)\b/gi;

const LABEL = new Set([
  "job", "title", "location", "salon", "salons", "date", "warning", "level",
  "payroll", "policy", "observation", "form", "coaching", "corrective", "action",
  "based", "primary", "team", "member", "members", "tanning", "consultant",
  "director", "assistant", "manager", "opening", "verbal", "written", "under",
  "performance", "tan", "store", "create", "ca", "below", "received", "recei",
  "use", "todays", "rehire", "ne", "ks", "sd",
  "say", "says", "pets", "pet", "expenses", "incurred",
  "exit", "creating", "assist", "assisting", "cite", "workplace", "animals", "animal",
  "show", "draft", "edits",
]);

const PROMO = new Set([
  "ppta", "upta", "lpsva", "cc", "spa", "tans", "product", "products", "uniform",
]);

const NOT_A_REPLY = /^(?:yes|yeah|yep|yup|no|nope|ok|okay)$/i;

function asTyped(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => {
      if (/[A-Z]/.test(word) && /[a-z]/.test(word)) return word;
      if (word.length <= 3 && word === word.toUpperCase()) return word;
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function salonWords(salonNames: readonly string[]): Set<string> {
  const words = new Set<string>();
  for (const name of salonNames) {
    for (const word of name.toLowerCase().split(/[^a-z]+/)) {
      if (word.length >= 4) words.add(word);
    }
  }
  return words;
}

/** A name with the label and place tokens removed, or null when nothing remains. */
export function cleanPersonName(name: string | null | undefined, salonNames: readonly string[]): string | null {
  if (!name?.trim()) return null;
  const stripped = stripNonNameTokens(name, salonNames);
  if (!stripped) return null;
  return asTyped(stripped);
}

/** Drop tokens that are not a person's name. An empty result is not a name. */
export function stripNonNameTokens(span: string, salonNames: readonly string[]): string | null {
  const places = salonWords(salonNames);
  let text = span.replace(PHRASES, " ");
  text = text.replace(/^\s*employee\s+/i, " ");
  // "at empire", "at shawnee" — the place is not part of the name.
  text = text.replace(/\bat\s+[A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*){0,2}/gi, " ");
  const words = text.split(/[^A-Za-z'’-]+/).filter(Boolean).filter((word) => {
    const key = word.toLowerCase();
    if (LABEL.has(key) || PROMO.has(key) || places.has(key)) return false;
    if (NOT_A_NAME.has(key) || NOT_A_TYPED_NAME.has(key)) return false;
    // "ima employee, tan consultant" — a lower-case employee is the role.
    // "Test Employee" keeps the capitalised surname.
    if (key === "employee" && word === key) return false;
    return true;
  });
  if (words.length === 0 || words.length > 4) return null;
  return words.join(" ");
}

function nameIs(text: string): string | null {
  const labelled = /(?:employee(?:'s)?\s+name|name)\s+is\s+([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3})/i.exec(text)?.[1];
  if (labelled) return labelled;
  // The saved slot is repeated as its own line: "The employee is Betty Sue."
  return /(?:^|\n)\s*the employee is\s+([A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3})/i.exec(text)?.[1] ?? null;
}

function forSpan(text: string): string | null {
  const match = /\bfor\s+((?:(?!\bfor\b)[^.\n]){0,80})/i.exec(text);
  if (!match?.[1]) return null;
  return match[1].split(/\bwho\b|\bwhich\b/i)[0]?.trim() ?? null;
}

function leadingName(text: string): string | null {
  const comma = /^([A-Za-z][A-Za-z'’-]+(?:\s+[A-Za-z][A-Za-z'’-]+){0,2})\s*,/.exec(text.trim());
  if (comma?.[1]) return comma[1];
  const words = /^([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,2})\b/.exec(text.trim());
  return words?.[1] ?? null;
}

function wholeName(text: string): string | null {
  const trimmed = text.trim();
  if (NOT_A_REPLY.test(trimmed)) return null;
  if (!/^[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3}$/.test(trimmed)) return null;
  return trimmed;
}

function candidateSpans(text: string): string[] {
  return [nameIs(text), forSpan(text), leadingName(text), wholeName(text), text, ...extractEmployeeNames(text)].filter(
    (span): span is string => Boolean(span?.trim()),
  );
}

/**
 * The name this turn states on purpose, or null when it states none.
 * A later "create the form" does not clear a name already stored.
 */
export function rosterValidatedName(
  text: string,
  roster: readonly RosterEmployee[],
  salonNames: readonly string[],
): string | null {
  const strippedOf = (span: string | null) => (span ? stripNonNameTokens(span, salonNames) : null);
  for (const span of candidateSpans(text)) {
    const stripped = strippedOf(span);
    if (!stripped || roster.length === 0) continue;
    const match = matchEmployeeName(stripped, roster);
    if (match.kind === "exact") return match.name;
  }
  const preferred = strippedOf(nameIs(text)) ?? strippedOf(leadingName(text)) ?? strippedOf(wholeName(text));
  if (preferred) return asTyped(preferred);
  const span = forSpan(text);
  if (span && span.trim().split(/\s+/).length <= 8) {
    const subject = strippedOf(span);
    if (subject && !LABEL.has(subject.toLowerCase())) return asTyped(subject);
  }
  if (!forSpan(text)) {
    const rest = strippedOf(text);
    if (rest && rest.split(" ").length <= 3 && !LABEL.has(rest.toLowerCase())) {
      // One leftover word from a long sentence ("Can you create…") is not a name.
      if (rest.split(" ").length === 1 && text.trim().split(/\s+/).length > 4) return null;
      return asTyped(rest);
    }
  }
  return null;
}

function shortForName(
  question: string,
  roster: readonly RosterEmployee[],
  salonNames: readonly string[],
): string | null {
  const span = forSpan(question);
  if (!span || span.trim().split(/\s+/).length > 8) return null;
  const stripped = stripNonNameTokens(span, salonNames);
  if (!stripped || stripped.split(" ").length > 3) return null;
  return rosterValidatedName(stripped, roster, salonNames);
}

/** A name this turn gives on purpose, ignoring a long "for September…" clause. */
function renameTarget(
  question: string,
  roster: readonly RosterEmployee[],
  salonNames: readonly string[],
): string | null {
  const labelled = nameIs(question);
  if (labelled) return rosterValidatedName(labelled, roster, salonNames);
  const lead = leadingName(question);
  if (lead) {
    const named = rosterValidatedName(lead, roster, salonNames);
    if (named) return named;
  }
  const whole = wholeName(question);
  if (whole) return rosterValidatedName(whole, roster, salonNames);
  return shortForName(question, roster, salonNames);
}

/**
 * A stored name changes only when this turn names somebody on purpose.
 * "erin" does not shorten "Erin Nelson". A narrative mention is not a change.
 */
export function employeeNamedOnPurpose(
  question: string,
  previous: string | null,
  roster: readonly RosterEmployee[],
  salonNames: readonly string[],
): string | null {
  const next = previous
    ? renameTarget(question, roster, salonNames)
    : rosterValidatedName(question, roster, salonNames);
  if (!next) return null;
  if (!previous) return next;
  const prior = previous.trim().toLowerCase();
  const typed = next.trim().toLowerCase();
  if (typed === prior) return next;
  if (prior.startsWith(`${typed} `) || prior.endsWith(` ${typed}`)) return null;
  return next;
}
