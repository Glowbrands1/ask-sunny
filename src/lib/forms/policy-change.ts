import { policyEverydayHeadingEnabled } from "@/lib/config/chat-quality-flags";

import { readCaPolicy, statedOffenseKeys } from "./ca-policy";
import {
  boxSectionNames,
  findManualSection,
  headingKey,
  manualSectionHeadings,
  sectionHeadingsFor,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";

/**
 * ============================================================================
 * "ADD THE LATE OPENING POLICY TO THIS FORM" — A POLICY CHANGE, MID-CONVERSATION
 * ============================================================================
 *
 * Production feedback, 20 Oct 2026: with a Corrective Action Form open in the
 * conversation, "can you add late opening policy to the direct policy section
 * of this form" was answered "No form has been created yet". The manager had
 * to start another form to get a policy onto the one in front of them.
 *
 * A policy is not something the model writes, and that does not change here.
 * What changes is that the MANAGER may name one, in plain words, at any point:
 *
 *   "add the late opening policy"            ADD     keeps what is cited, adds it
 *   "use the dress code policy instead"      REPLACE cites only that section
 *   "take the attendance policy off"         REMOVE  drops that section
 *
 * The section is looked up in the pinned manual BY ITS OWN HEADING — the same
 * headings `findManualSection` trusts — so "Late Opening" can only resolve to
 * the place the manual prints "Late Opening", and the wording that goes on the
 * form is the manual's, copied. A name the manual does not print resolves to
 * nothing, and the manager is told so rather than given a near miss.
 *
 * PURE: no I/O. `chat-policy-change.ts` loads, resolves and saves.
 */

export type PolicyChangeMode = "add" | "replace" | "remove";

/** A question about a policy is answered from the knowledge base, not written onto a form. */
const ASKS_ABOUT =
  /^\s*(?:what|why|how|when|where|who|which|is|are|does|do|did|was|were|should|will|would)\b(?!\s+you\b)[^.!]*\?\s*$/i;

/** The turn is about a policy line — the policy, the manual, its section. */
const NAMES_A_POLICY = /\b(?:polic(?:y|ies)|manual|handbook)\b/i;

const REMOVE = /\b(?:remove|delete|drop|take\s+(?:\w+\s+){0,4}?(?:out|off)|get rid of|no longer|leave out|clear)\b/i;
const REPLACE_STRONG = /\b(?:instead|replace|replacing|switch|swap|change|rather than|not the|wrong)\b/i;
const ADD = /\b(?:add|adding|include|including|insert|append|also|too|as well|both|plus|attach|cite|quote|put|pull in)\b/i;
const REPLACE_WEAK = /\b(?:use|apply|set|make|should be|update|go with)\b/i;

/*
 * A POLICY NAMED THE WAY MANAGERS ANSWER — "actually it should be attendance",
 * "make it standards of conduct", or a bare "attendance" to Ask Bubbles' own
 * "Which policy applies?" (QA, 22 Oct 2026: each left the open form as it
 * was). The whole turn is the answer, so "make sure her attendance improves"
 * is not one.
 */
const POLICY_NAME = String.raw`(?:standards? of conduct|code of conduct|attendance|tardiness|absenteeism|dress code|under[- ]?performance|violation of company polic(?:y|ies))`;
const POLICY_ANSWER = new RegExp(
  String.raw`^(?:(?:actually|sorry|no|nope|oops|ok|okay|oh|wait)[,.!\s]+)*(?:(?:(?:it|this|that)(?:['’]s|\s+is|\s+should\s+be|\s+falls?\s+under|\s+goes\s+under)|should\s+be|use|make\s+it|change\s+it\s+to|switch\s+(?:it\s+)?to|go\s+with|put\s+it\s+under|under)\s+)?(?:the\s+)?(${POLICY_NAME})(?:\s+polic(?:y|ies))?(?:\s+instead)?\s*[.!]?$`,
  "i",
);
const ANSWER_CUE = /\b(?:actually|should|use|make|change|switch|go with|instead|under|it['’]?s|it is|this is|that['’]?s)\b/i;

/**
 * Whether this turn asks to change which manual policy the open form cites,
 * and how. Null for anything else — the turn is answered as it would have been.
 * `policyAsked`: Ask Bubbles' last turn asked which policy applies, so a bare
 * policy name is the answer.
 */
export function readPolicyChange(question: string, options: { readonly policyAsked?: boolean } = {}): PolicyChangeMode | null {
  const text = (question ?? "").trim();
  if (text === "" || ASKS_ABOUT.test(text)) return null;
  if (!NAMES_A_POLICY.test(text)) {
    return POLICY_ANSWER.test(text) && (options.policyAsked || ANSWER_CUE.test(text)) ? "replace" : null;
  }
  if (REMOVE.test(text)) return "remove";
  if (REPLACE_STRONG.test(text)) return "replace";
  if (ADD.test(text)) return "add";
  if (REPLACE_WEAK.test(text)) return "replace";
  // "The policy is standards of conduct", "it's attendance": a policy named as the answer.
  if (readCaPolicy(text).stated !== null) return "replace";
  return null;
}

/**
 * Words that are never a section on their own, however a manual prints them.
 * "Policy" alone would otherwise match every request.
 */
const NOT_A_SECTION = new Set([
  "policy",
  "policies",
  "the company",
  "company",
  "manual",
  "section",
  "reference list",
  "core values",
  "text",
  "document body",
  // The retirement "Warning" sheet is not a policy. "Verbal warning" names a
  // level on the form, and citing that sheet turned it into Warning Policy p.36.
  "warning",
]);

/** A short heading must be a whole phrase of the request, never part of a word. */
const SHORTEST_HEADING = 4;

/**
 * The manual's headings this text names, longest first, with a heading that
 * is only part of a longer one dropped ("Opening" inside "Late Opening").
 */
/*
 * POLICY_EVERYDAY_HEADING_ENABLED: a one-word heading that is also an everyday word
 * names its section only beside "policy", "section" or "rule". "it's for
 * october promotions" (sales offers) cited the HR Promotions section p.34 on
 * every turn of a coaching form (QA item 6, conv_mvoe0zgh20z4krm), and an
 * onboarding "orientation" cited Orientation p.33.
 */
const EVERYDAY_ONE_WORD = new Set(["promotions", "promotion", "orientation", "discounting", "solicitation", "overtime", "tanning", "minors", "robberies"]);

function namedAsPolicy(said: string, key: string): boolean {
  return new RegExp(String.raw` ${key} (?:polic(?:y|ies)|section|rules?) |(?:polic(?:y|ies)|section|rules?) (?:on |for |about )?${key} `).test(said);
}

export function headingsNamedIn(text: string, headings: readonly string[]): string[] {
  const said = ` ${headingKey(text)} `;
  const matched = headings.filter((heading) => {
    const key = headingKey(heading);
    if (key.length < SHORTEST_HEADING || NOT_A_SECTION.has(key)) return false;
    if (policyEverydayHeadingEnabled() && EVERYDAY_ONE_WORD.has(key) && !namedAsPolicy(said, key)) return false;
    return said.includes(` ${key} `);
  });
  const keys = matched.map(headingKey);
  return matched.filter(
    (heading, index) => !keys.some((other, at) => at !== index && other.length > keys[index]!.length && ` ${other} `.includes(` ${keys[index]} `)),
  );
}

/** Words before "policy" that name nothing: "add the policy", "this direct policy". */
const FILLER = new Set([
  "a", "an", "the", "this", "that", "these", "those", "her", "his", "their", "our", "my", "your",
  "add", "use", "include", "put", "change", "replace", "swap", "switch", "cite", "quote", "remove",
  "to", "of", "in", "on", "for", "from", "with", "and", "or", "please", "can", "you", "could", "would",
  "direct", "official", "company", "jba", "manual", "same", "new", "right", "correct", "it", "its",
]);

/**
 * "the X policy", "policy on X", "policy for X" — the phrase the manager
 * called the policy by, for headings only the contents page names. Tried
 * longest first against the manual, so "late opening" is looked for before
 * "opening".
 */
export function policyPhrasesIn(text: string): string[] {
  const lower = (text ?? "").toLowerCase().replace(/[‘’]/g, "'");
  const phrases: string[] = [];
  for (const match of lower.matchAll(/((?:[a-z&/'-]+\s+){1,5})polic(?:y|ies)\b/g)) {
    const words = match[1]!.trim().split(/\s+/);
    while (words.length > 0 && FILLER.has(words[0]!)) words.shift();
    for (let start = 0; start < words.length; start += 1) {
      const phrase = words.slice(start).join(" ");
      if (phrase !== "" && !FILLER.has(phrase)) phrases.push(phrase);
    }
  }
  for (const match of lower.matchAll(/\bpolic(?:y|ies)\s+(?:on|for|about|called|named|regarding)\s+((?:[a-z&/'-]+\s*){1,5})/g)) {
    const words = match[1]!.trim().split(/\s+/);
    for (let end = words.length; end > 0; end -= 1) {
      const phrase = words.slice(0, end).join(" ");
      if (!FILLER.has(phrase)) phrases.push(phrase);
    }
  }
  // "switch the policy to standards of conduct", "change her policy to dress code" (QA, 22 Oct 2026, round 3).
  for (const match of lower.matchAll(
    /\b(?:switch|change|swap|set|update|move)\s+(?:the\s+|her\s+|his\s+|their\s+|this\s+)?polic(?:y|ies)\s+(?:over\s+)?to\s+(?:the\s+)?((?:[a-z&/'-]+\s*){1,5})/g,
  )) {
    const words = match[1]!.trim().split(/\s+/);
    for (let end = words.length; end > 0; end -= 1) {
      const phrase = words.slice(0, end).join(" ");
      if (!FILLER.has(phrase)) phrases.push(phrase);
    }
  }
  return [...new Set(phrases)];
}

/**
 * The manual's sections this text names, in the order it names them.
 *
 * THREE READINGS, NARROWEST FIRST, and the first that answers is used:
 *
 *   1. a heading the manual prints on a sheet, named whole ("late opening")
 *   2. a policy the Corrective Action Form already knows by its offense box
 *      ("attendance", "dress code", "standards of conduct"), through the
 *      same mapping the first draft uses
 *   3. the phrase the manager called it by ("the absenteeism policy"),
 *      looked up the way `findManualSection` looks — including the contents
 *      page — and only ever as an exact heading
 */
export function sectionsNamedIn(input: {
  readonly text: string;
  readonly chunks: readonly ManualChunk[];
  readonly jobTitle?: string | null;
}): ManualSection[] {
  const found: ManualSection[] = [];
  const keep = (section: ManualSection | null) => {
    if (section && !found.some((seen) => headingKey(seen.heading) === headingKey(section.heading))) found.push(section);
  };

  const headings = manualSectionHeadings(input.chunks);
  const said = ` ${headingKey(input.text)} `;
  const named = headingsNamedIn(input.text, headings).sort(
    (a, b) => said.indexOf(` ${headingKey(a)} `) - said.indexOf(` ${headingKey(b)} `),
  );
  for (const heading of named) keep(findManualSection(input.chunks, [heading]));
  if (found.length > 0) return found;

  const reading = readCaPolicy(input.text);
  const offenseKeys = statedOffenseKeys(reading, input.text) ?? [];
  for (const wanted of sectionHeadingsFor({ offenseKeys, jobTitle: input.jobTitle })) {
    keep(findManualSection(input.chunks, wanted));
  }
  if (found.length > 0) return found;

  for (const phrase of policyPhrasesIn(input.text)) {
    keep(findManualSection(input.chunks, [phrase]));
    if (found.length > 0) break;
  }
  return found;
}

/**
 * The words the manager used for a policy the manual did not answer, for the
 * reply — "I couldn't find a section called 'late open' in the manual".
 */
export function unresolvedPolicyName(text: string): string | null {
  return policyPhrasesIn(text)[0] ?? null;
}

/**
 * Up to three headings that share a word with what the manager asked for —
 * offered as the manual's own names, never chosen for them.
 */
export function similarHeadings(asked: string, chunks: readonly ManualChunk[]): string[] {
  const words = headingKey(asked)
    .split(" ")
    .filter((word) => word.length >= 4 && !NOT_A_SECTION.has(word));
  if (words.length === 0) return [];
  return manualSectionHeadings(chunks)
    .filter((heading) => {
      const key = ` ${headingKey(heading)} `;
      return words.some((word) => key.includes(` ${word} `));
    })
    .slice(0, 3);
}

/**
 * The sections the form will cite after the change.
 *
 * ADD keeps what is there and appends what is new; REPLACE cites only what was
 * named; REMOVE drops what was named. Order is kept, and a section is never
 * cited twice.
 */
export function nextPolicySections(input: {
  readonly mode: PolicyChangeMode;
  readonly current: readonly ManualSection[];
  readonly named: readonly ManualSection[];
}): ManualSection[] {
  const same = (a: ManualSection, b: ManualSection) => headingKey(a.heading) === headingKey(b.heading);
  switch (input.mode) {
    case "remove":
      return input.current.filter((section) => !input.named.some((gone) => same(gone, section)));
    case "replace":
      return [...input.named];
    case "add":
      return [...input.current, ...input.named.filter((section) => !input.current.some((kept) => same(kept, section)))];
  }
}

/**
 * The sections a Direct policy line cites under a box that is not the box's
 * own — "Visitors in the Workplace" under Violation of Company Policies,
 * "Late Opening" under Tardiness — read off the line's own provenance. What
 * Policy Violated prints beside each box (`boxSectionNames`), so the two lines
 * name the same section after either one changes. Empty when the line cites
 * none, or was not quoted from the manual.
 */
export function citedBoxSections(provenance: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!provenance || provenance.verified !== true || provenance.source !== "official_policy_manual") return {};
  const listed = Array.isArray(provenance.sections) ? provenance.sections : [];
  return boxSectionNames(
    listed
      .map((entry) => (entry as { locator?: unknown } | null)?.locator)
      .filter((heading): heading is string => typeof heading === "string"),
  );
}
