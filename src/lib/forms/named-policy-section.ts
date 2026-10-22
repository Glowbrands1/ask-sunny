import { readCaPolicy } from "./ca-policy";
import {
  OFFENSE_MANUAL_SECTIONS,
  findManualSection,
  manualSectionHeadings,
  offenseKeyForManualHeading,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";

/**
 * ============================================================================
 * "VIOLATING VISITORS AT WORK POLICY" — A POLICY THE MANAGER NAMED, FOUND IN
 * THE MANUAL BY ITS OWN HEADING
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026: "create verbal CA for <employee> for
 * violating visitors at work policy on 10-10-26 …" came back with no policy
 * named in the reply, no offense box, and no Direct policy line. The manual
 * has the section — "Visitors in the Workplace", printed page 30 — but only
 * the handful of policies `ca-policy.ts` knows by name (Standards of Conduct,
 * Attendance, Dress Code, …) were ever read out of a manager's words.
 *
 * So a policy the manager names is matched against THE PINNED MANUAL'S OWN
 * SHEET HEADINGS, as the manual prints them, not against a list kept here:
 *
 *   the manager's words and a heading are compared word by word, ignoring
 *   filler ("the", "in", "at", "policy"), a plural "s", and a word that is
 *   the start of the other ("work" / "workplace");
 *
 *   every word the manager used must be in the heading, and every word of the
 *   heading in what they said (a heading word like "usage" or "workplace" may
 *   be left off);
 *
 *   exactly one heading may match. None, or two, and nothing is cited: the
 *   manager completes the policy, as on any form whose offense the manual
 *   does not name. A citation of the wrong section of a real manual looks
 *   checked, and that is the failure this must never produce.
 *
 * Nothing here composes a citation. The headings are the ones
 * `manualSectionHeadings` reads off the sheets (never the contents page), and
 * the heading and its page come from the manual's rows through
 * `findManualSection`, exactly as for a ticked box. `policy-change.ts` reads a
 * heading named whole, after the form exists; this reads the manager's own
 * words for one, before it does. Pure.
 */

/** A phrase the manager used to name a policy, as they wrote it. */
export interface NamedPolicy {
  /** The words between the verb and "policy": "visitors at work". */
  readonly phrase: string;
  /** Where it was found, for "the latest named wins". */
  readonly index: number;
}

/**
 * "violating visitors at work policy", "violated the cell phone policy",
 * "breach of our visitor policy", "against the no visitors policy". The verb is
 * what makes the words a policy's name rather than a mention of one.
 */
const NAMED_POLICY =
  /\b(?:violat(?:ing|ed|es|e|ion\s+of)|broke|breaking|breach(?:ed|ing)?(?:\s+of)?|against|(?:did\s*n[o']?t|didn't|not|failed\s+to|refused\s+to)\s+follow(?:ing)?)\s+(?:the\s+|our\s+|a\s+|company'?s?\s+)?((?:[a-z][a-z'&/-]*\s+){1,5}?)polic(?:y|ies)\b/gi;

/** Words a heading match ignores on either side. */
const FILLER = new Set([
  "the", "a", "an", "in", "at", "on", "of", "for", "to", "and", "with", "from", "our", "company", "companys",
  "company's", "policy", "policies", "rule", "rules", "section",
]);

/**
 * Heading words a manager may leave off: "cell phone" for "Cell Phone Usage",
 * "visitor policy" for "Visitors in the Workplace". Never the words that tell
 * one section from another.
 */
const OPTIONAL_HEADING_WORDS = new Set([
  "usage", "use", "procedure", "procedures", "guidelines", "requirements", "expectations", "workplace",
]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/'s$/, "").replace(/'/g, ""))
    .filter((word) => word !== "" && !FILLER.has(word));
}

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** The same word, a plural of it, or one that starts the other ("work" / "workplace"). */
function sameWord(a: string, b: string): boolean {
  const x = stem(a);
  const y = stem(b);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.startsWith(short);
}

/**
 * Whether the manager's words name this heading.
 *
 * A HEADING THAT PRINTS ALTERNATIVES — "Cell Phone/Smart Watch Policy" — is
 * named by either of them: "the cell phone policy" leaves "smart watch" off,
 * and every word it does use is still the heading's. "Phone" alone still
 * names nothing.
 */
export function namesHeading(phrase: string, heading: string): boolean {
  const said = words(phrase);
  const printed = words(heading);
  if (said.length === 0 || printed.length === 0) return false;
  const covered = (part: readonly string[]) =>
    part.every((word) => OPTIONAL_HEADING_WORDS.has(word) || said.some((other) => sameWord(word, other)));
  return (
    said.every((word) => printed.some((other) => sameWord(word, other))) &&
    (covered(printed) || headingAlternatives(heading).some((part) => part.length > 0 && covered(part)))
  );
}

/** "Cell Phone/Smart Watch Policy" → [cell, phone], [smart, watch]; a heading with no slash has none. */
function headingAlternatives(heading: string): string[][] {
  const parts = heading.split("/");
  return parts.length < 2 ? [] : parts.map(words);
}

/** Every policy the manager named, in the order they named them. Questions name none. */
/*
 * "THE CELL PHONE POLICY." — a line that is only a policy's name: the answer to
 * "Which policy applies?" (ported from Ask Bubbles, QA follow-up 22 Oct 2026).
 */
const POLICY_LINE = /^\s*(?:the\s+|our\s+)?((?:[a-z][a-z'&/-]*\s+){1,5}?)polic(?:y|ies)\s*[.!]?\s*$/i;

export function namedPolicies(text: string): NamedPolicy[] {
  const found: NamedPolicy[] = [];
  for (const sentence of (text ?? "").matchAll(/[^.!?\n]+[.!?]*/g)) {
    if (/\?\s*$/.test(sentence[0])) continue;
    // A line that is only the name — not "violation of company policy", which names none.
    const line = /\b(?:violat|breach|broke|against|follow)/i.test(sentence[0]) ? null : POLICY_LINE.exec(sentence[0]);
    if (line && words(line[1]!).length > 0) found.push({ phrase: line[1]!.trim(), index: sentence.index });
    for (const match of sentence[0].matchAll(NAMED_POLICY)) {
      const phrase = match[1]!.trim();
      if (words(phrase).length === 0) continue;
      found.push({ phrase, index: sentence.index + match.index });
    }
  }
  return found;
}

export interface NamedManualSection {
  /** What the manager called it. */
  readonly phrase: string;
  /** The section, as the manual names and paginates it. */
  readonly section: ManualSection;
  /** The offense box that section is cited under: its own box where it has one, otherwise Violation of Company Policies. */
  readonly offenseKey: string;
}

/**
 * The manual section the manager named, or null.
 *
 * THE LATEST NAMED POLICY THAT THE MANUAL ANSWERS, and only one that answers
 * unambiguously. A phrase no heading matches cites nothing.
 */
export function namedManualSection(input: {
  readonly text: string;
  readonly chunks: readonly ManualChunk[] | null;
}): NamedManualSection | null {
  if (!input.chunks || input.chunks.length === 0) return null;
  const headings = manualSectionHeadings(input.chunks);
  for (const named of [...namedPolicies(input.text)].reverse()) {
    const matches = [...new Set(headings.filter((heading) => namesHeading(named.phrase, heading)))];
    if (matches.length !== 1) continue;
    const section = findManualSection(input.chunks, matches);
    if (!section) continue;
    return { phrase: named.phrase, section, offenseKey: offenseKeyForManualHeading(section.heading) };
  }
  return null;
}

/**
 * ============================================================================
 * "REMY WAS TALKING ON HER CELL PHONE" — A POLICY THE MANAGER DESCRIBED
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026: "create a verbal corrective action
 * form for <employee>. on 10-20-26 <employee> was talking on her cell phone
 * for over 30 minutes" was cited under the Standards of Conduct. The manual
 * has a section for it — "Cell Phone/Smart Watch Policy", printed page 19 —
 * but the manager described the conduct rather than naming a policy, so the
 * reading above never ran and the model's catch-all box stood.
 *
 * So the manager's ACCOUNT is read against the same pinned sheet headings, at
 * runtime, by the words that tell one heading from another:
 *
 *   A HEADING'S DISTINCTIVE WORDS are its own, less filler and less the words
 *   every salon account uses (company, employee, work, time, client, salon,
 *   shift, form, action, payroll, …). A heading with one word of its own at
 *   all ("Shoes", "Attendance", "Overtime") never answers; each side of a
 *   heading's slash is its own candidate ("Cell Phone", "Smart Watch").
 *
 *   THE ACCOUNT MUST USE ALL OF THEM, IN ORDER — "cell phone", "smart watch"
 *   — with only filler between. A word that merely appears ("left the door
 *   open" is not the Open Door Policy) does not. One relaxation: the object
 *   the employee had — "on her phone" — names the thing a two-word heading is
 *   about ("Cell Phone") when that word is in no other heading of the manual.
 *
 *   INCIDENTAL MENTIONS ARE NOT ACCOUNTS: "her phone number", "called in by
 *   phone", a question, or a sentence that states a rule ("belts must not
 *   hold cell phones") names nothing.
 *
 *   EXACTLY ONE HEADING, counted over every heading of the manual. None, or
 *   two ("a belt that holds her cell phone", social media under two
 *   headings), and nothing is cited, as for a named policy.
 *
 *   AND ONLY A SECTION THE MANUAL TITLES A POLICY. Checked against all of the
 *   real manual's headings: an account's ordinary words say plenty of
 *   section names that are not policies ("payroll deduct applies" is
 *   Payroll Deductions on every form that answered the payroll question;
 *   "time records", "shift replacement", "visitors"). A section the manual
 *   calls a Policy ("Cell Phone/Smart Watch Policy", "Social Media Policy")
 *   is one a manager can be held to from their own description; any other is
 *   cited only when the manager names it.
 *
 * NEVER OVER WHAT ALREADY DECIDES THE POLICY. A policy the manager named —
 * one `ca-policy.ts` knows, or any "violating the … policy", found or not —
 * and an account that reads as attendance, a late opening, dress code, or a
 * conduct incident the Standards of Conduct lists, each leave this silent.
 * The drafting route also leaves a box with its own specific section
 * (Tardiness, Absenteeism, Dress Code) standing; the Standards of Conduct is
 * the manual's catch-all, and the section the account describes is the more
 * specific of the two.
 *
 * Pure. The headings, their pages and the box come from the manual's rows,
 * exactly as for a named policy.
 */

/** Words every account uses, which tell no heading from another. */
const GENERIC = new Set([
  "employee", "employer", "employment", "work", "worked", "working", "workplace", "time", "times", "day",
  "days", "hour", "hours", "minute", "minutes", "customer", "client", "guest", "salon", "store", "location",
  "shop", "shift", "manager", "management", "team", "staff", "general", "other", "new", "service",
  "product", "procedure", "use", "usage", "using", "used", "requirement", "information", "record", "form",
  "action", "request", "status", "statement", "notification", "report", "reporting", "overview", "safety",
  "outside", "termination", "account", "property", "pay", "payroll", "deduct", "deduction", "benefit",
  "corrective", "warning", "verbal", "written", "final", "coaching", "manual", "jba", "proper", "no",
  "non", "related", "recommendation", "guideline", "regulation", "it", "as", "per", "is", "be", "&",
]);

/** Words that may stand between a heading's words in an account: "talking on the cell phone". */
const BETWEEN = new Set([...FILLER, "her", "his", "their", "my", "your", "its", "own", "personal"]);

/** Whose thing it was: "on HER phone". */
const POSSESSIVE = new Set(["her", "his", "their", "my", "your"]);

/** What makes the word a label for something else: "phone number". */
const SOMETHING_ELSE = new Set(["number", "numbers", "no", "#", "list", "book"]);

/** A means of communication, not conduct: "called in by phone". */
const BY_MEANS = /\b(?:by|via|over\s+the|through\s+the)\s*$/;

/** A sentence stating a rule rather than what happened. */
const RULE = /\b(?:must|shall|may\s+not|(?:is|are)\s+not\s+(?:allowed|permitted)|not\s+permitted|prohibited|polic(?:y|ies)\s+(?:says?|states?))\b/i;

/** An account a box with its own section governs: attendance, a late opening, dress code. */
const OWN_BOX =
  /\b(?:late|lateness|tardy|tardiness|left early|leaving early|clocked out early|absent|absence|absences|absenteeism|no[- ]call|no[- ]show|called (?:out|off)|call[- ]?off|missed (?:her|his|their|a|the) shift|open(?:ed|ing)? (?:the |our |her |his )?(?:salon|store|location|shop|doors)|opener|dress(?:ed)?(?: code)?|uniform|apron|shirts?|pants|jeans|shorts|leggings|shoes|sneakers|sandals|flip[- ]flops|slippers|belts?|hair|beard|jewelry|piercings?|tattoos?|make[- ]?up|nails)\b/i;

/** The manual titles the section a policy: "Cell Phone/Smart Watch Policy", "Social Media Policy". */
const TITLED_POLICY = /\bpolic(?:y|ies)\b/i;

function plain(word: string): string {
  const w = word.replace(/'s$/, "").replace(/'/g, "");
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(?:ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/**
 * The same word, a plural of it, or — for a heading noun made from a verb —
 * the verb's -ing form: a friend VISITING is a visitor. Not "visit" or
 * "visited": a district manager's salon visit is not a visitor.
 */
function sameAccountWord(said: string, printed: string): boolean {
  const a = plain(said);
  const b = plain(printed);
  if (a === b) return true;
  const made = /^(.{4,}?)(?:or|ion)$/.exec(b);
  return made !== null && a === `${made[1]}ing`;
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9'#&]+/)
    .filter((token) => token !== "");
}

interface Candidate {
  readonly heading: string;
  /** The words an account must use, in order. */
  readonly required: readonly string[];
  /** Words that may stand alone after a possessive — "her phone" — because they name this heading only. */
  readonly objects: readonly string[];
}

function candidatesOf(headings: readonly string[]): Candidate[] {
  const parts = headings.flatMap((heading) =>
    heading.split("/").map((part) => ({ heading, content: words(part).map(plain), alternative: heading.includes("/") })),
  );
  const out: Candidate[] = [];
  for (const { heading, content, alternative } of parts) {
    if (content.length < 2) continue;
    const required = content.filter((word) => !GENERIC.has(word) && !OPTIONAL_HEADING_WORDS.has(word));
    if (required.length === 0) continue;
    /*
     * ONE WORD OF ITS OWN IS ENOUGH only beside words the manager may leave
     * off anyway ("Visitors in the Workplace"). Beside any other word it is
     * not: "Schedule Requests", "Disciplinary Action", "Leave Requests".
     */
    if (required.length === 1 && content.some((word) => word !== required[0] && !OPTIONAL_HEADING_WORDS.has(word))) continue;
    /*
     * A HEADING THAT LISTS ALTERNATIVES NAMES THINGS — a cell phone, a smart
     * watch — and the employee's own one ("her phone", "his cell") is that
     * thing, where no other heading has the word.
     */
    const objects =
      alternative && content.length === 2 && required.length === 2
        ? required.filter(
            (word) =>
              !parts.some((other) => other.heading !== heading && other.content.some((printed) => sameAccountWord(word, printed))),
          )
        : [];
    out.push({ heading, required, objects });
  }
  return out;
}

/** Where in these account words the candidate's words are used, as the manager wrote them, or null. */
function usedIn(said: readonly string[], candidate: Candidate): string | null {
  const before = (index: number) => said.slice(Math.max(0, index - 2), index).join(" ");
  const settles = (end: number) => {
    const next = said[end + 1];
    return next === undefined || !SOMETHING_ELSE.has(next);
  };
  for (let start = 0; start < said.length; start += 1) {
    if (!sameAccountWord(said[start]!, candidate.required[0]!)) continue;
    if (BY_MEANS.test(before(start))) continue;
    let at = start;
    let ok = true;
    for (const word of candidate.required.slice(1)) {
      let next = at + 1;
      while (next < said.length && next - at <= 3 && BETWEEN.has(said[next]!) && !sameAccountWord(said[next]!, word)) next += 1;
      if (next >= said.length || !sameAccountWord(said[next]!, word)) {
        ok = false;
        break;
      }
      at = next;
    }
    if (ok && settles(at)) return said.slice(start, at + 1).join(" ");
  }
  for (const object of candidate.objects) {
    for (let index = 1; index < said.length; index += 1) {
      if (!sameAccountWord(said[index]!, object) || !POSSESSIVE.has(said[index - 1]!)) continue;
      if (BY_MEANS.test(before(index - 1))) continue;
      const next = said[index + 1];
      if (next !== undefined && !BETWEEN.has(next) && !/^(?:while|during|when|instead|until|for)$/.test(next)) continue;
      return said[index]!;
    }
  }
  return null;
}

/**
 * Whether an account could describe a section at all: no policy named, and
 * nothing else deciding it (attendance, a late opening, dress code, a conduct
 * incident). Cheap, so a caller can skip reading the manual when it is false.
 */
export function mayDescribeSection(text: string): boolean {
  if (namedPolicies(text).length > 0) return false;
  const reading = readCaPolicy(text);
  if (reading.stated !== null || reading.suggestion !== null || reading.ambiguous !== null) return false;
  return !OWN_BOX.test(text);
}

/**
 * The manual section the manager's account describes, or null. See above:
 * only where no policy was named and nothing else decides it, only where
 * exactly one heading of the manual answers, and only a section the manual
 * titles a Policy.
 */
export function describedManualSection(input: {
  readonly text: string;
  readonly chunks: readonly ManualChunk[] | null;
}): NamedManualSection | null {
  const found = describedHeadings(input);
  /* One heading of the whole manual, and one the manual calls a policy. */
  if (!found || found.size !== 1) return null;
  const [heading, phrase] = [...found.entries()][0]!;
  return citable(input.chunks!, heading, phrase);
}

/** Every heading the account describes, by its distinctive words — or null where something else decides the policy. */
function describedHeadings(input: {
  readonly text: string;
  readonly chunks: readonly ManualChunk[] | null;
}): Map<string, string> | null {
  if (!input.chunks || input.chunks.length === 0) return null;
  const text = input.text ?? "";
  if (!mayDescribeSection(text)) return null;

  const candidates = candidatesOf(manualSectionHeadings(input.chunks));
  const found = new Map<string, string>();
  for (const sentence of text.matchAll(/[^.!?\n]+[.!?]*/g)) {
    if (/\?\s*$/.test(sentence[0]) || RULE.test(sentence[0])) continue;
    const said = tokens(sentence[0]);
    for (const candidate of candidates) {
      if (found.has(candidate.heading)) continue;
      const phrase = usedIn(said, candidate);
      if (phrase) found.set(candidate.heading, phrase);
    }
  }
  return found;
}

/** A heading the account describes, as the section it cites, when the manual titles it a Policy. */
function citable(chunks: readonly ManualChunk[], heading: string, phrase: string): NamedManualSection | null {
  if (!TITLED_POLICY.test(heading)) return null;
  const section = findManualSection(chunks, [heading]);
  return section ? { phrase, section, offenseKey: offenseKeyForManualHeading(section.heading) } : null;
}

/**
 * ============================================================================
 * TWO POLICIES DESCRIBED: OFFERED, NEVER CHOSEN
 * ============================================================================
 *
 * QA follow-up, 22 Oct 2026 (ported from Ask Bubbles): "scrolling social
 * media on her phone" answers both the Cell Phone/Smart Watch Policy and the
 * Social Media Policy, so `describedManualSection` (rightly) chooses neither
 * — and the draft's own guess, often the catch-all Standards of Conduct,
 * stood with nothing said. Where two or more headings the manual titles a
 * Policy answer the account, these are they, in the manual's order, for the
 * manager to choose between. One Policy heading beside a heading that is not
 * one offers nothing, as before.
 */
export function describedManualChoices(input: {
  readonly text: string;
  readonly chunks: readonly ManualChunk[] | null;
}): NamedManualSection[] | null {
  const found = describedHeadings(input);
  if (!found || found.size < 2) return null;
  const sections = [...found.entries()]
    .map(([heading, phrase]) => citable(input.chunks!, heading, phrase))
    .filter((entry): entry is NamedManualSection => entry !== null);
  if (sections.length < 2) return null;
  return sections.sort((a, b) => a.section.page - b.section.page);
}

/**
 * The boxes whose own section is specific — Tardiness and Absenteeism cite
 * Attendance, Dress Code the Dress Code. A described section never replaces
 * one the draft ticked. The Standards of Conduct is not among them: it is the
 * manual's catch-all ("Failing to follow the policies and procedures of The
 * Company"), and the section the account describes is the policy it means.
 */
export const SPECIFIC_SECTION_BOXES: ReadonlySet<string> = new Set(
  Object.keys(OFFENSE_MANUAL_SECTIONS).filter((key) => key !== "standards_of_conduct"),
);
