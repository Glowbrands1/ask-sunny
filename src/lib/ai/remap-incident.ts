import { CA_POLICY_LABEL, readCaPolicy, STANDARDS_OF_CONDUCT, type CaPolicyName } from "@/lib/forms/ca-policy";
import {
  findManualSection,
  headingKey,
  manualSectionHeadings,
  type ManualChunk,
  type ManualSection,
} from "@/lib/forms/official-policy-manual";
import { extractJobTitle, titleAfterJobTitleLabel } from "@/lib/forms/proposal";
import type { KnowledgeCategory, SourceCitation } from "@/types";

import { accountManualSections } from "./account-manual-sections";
import { formatManualCitation } from "./policy-citation-fields";

/**
 * REMAP_INCIDENT_FIX_ENABLED: the remap path's What happened, prior actions
 * and policy (24 Oct 2026, prod with FORM_FULL_REMAP on).
 *
 * "create a corrective action form for Test Employee" is the request, not the
 * incident and not the action plan. "previous coaching: jba policy manual
 * 1-1-26, verbal ca 9-1-26" is the prior-action list, not the incident. A
 * policy is "as you said" only when the manager named it. The manual section
 * the account resolves is cited with its printed page, as the intent path
 * does. This app says salon, not store.
 */

export interface RemapManual {
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentCategory?: string | null;
  readonly chunks: readonly ManualChunk[];
}

const FORM_WORDS = String.raw`(?:corrective\s+actions?|ca|c\/a|write-?ups?|dpoa|coaching\s+form|policy\s+review|follow-?up\s+coaching)(?:\s+forms?)?`;
const LEVEL_WORDS = String.raw`(?:(?:a|an|the)\s+)?(?:new\s+)?(?:(?:verbal|written|final)\s+(?:warning\s+)?)?`;

/** "create a verbal CA for", "write a CA for", "CA for" — only at the start of a clause. */
const REQUEST_LEAD = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:(?:can|could)\s+you\s+)?(?:(?:i\s+)?(?:need|want)\s+(?:to\s+)?)?(?:(?:create|make|start|open|do|file|write|draft|fill\s+out|put\s+together)\s+(?:me\s+)?)?${LEVEL_WORDS}${FORM_WORDS}\b\s*(?:for\s+)?`,
  "i",
);

/** A whole date: 10-15-26, 10/11, 1/1/2026. Never part of one ("10-1" of "10-15-26"). */
const DATE = String.raw`(?<![\d/-])\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?(?![\d/-])`;

const STORE_CLAUSE = /^\s*(?:the\s+)?(?:salon|location)(?:\s+(?:location|name|number))?\s*(?:is|=|:)\s+/i;

/** "cite animals in the workplace policy" asks about a policy. It is not what happened. */
const POLICY_ASK =
  /^\s*(?:please\s+)?(?:cite|quote|show(?:\s+me)?|look\s+up|pull\s+up|what(?:'s|\s+is|\s+does)|tell\s+me|give\s+me)\b.*\bpolic(?:y|ies)\b/i;

const PAYROLL_STATEMENT =
  /^\s*(?:(?:yes|no)\b[\s,]*)?payroll(?:\s+|-)deduct(?:ion|ed)?\s+(?:does|do|did|is|isn'?t|will|won'?t|applies|apply|not|doesn'?t|should|shall)\b/i;

/** The prior-action list a manager labels "previous coaching: …". */
const PRIOR_LIST =
  /\b(?:previous|prior|past)\s+(?:coaching|corrective\s+actions?|cas?|c\/as?|actions?|steps?|warnings?|discipline)(?:\s+(?:is|was|were|are|includes?|included))?\s*[:=-]?\s*([^\n]+?)(?=\.(?:\s|$)|\n|$)/gi;

export function withoutPriorList(text: string): string {
  return text.replace(PRIOR_LIST, " ").replace(/\bprior\s*=\s*[^\n.]+/gi, " ");
}

/**
 * "previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26" is two prior
 * actions. The manual shorthand is the JBA Policy Manual acknowledgement.
 */
export function priorListActions(text: string): string[] {
  const items: string[] = [];
  for (const match of text.matchAll(PRIOR_LIST)) {
    for (const part of match[1]!.split(/\s*(?:,|;|&|\band\b)\s*/i)) {
      const item = priorItem(part);
      if (item) items.push(item);
    }
  }
  return items;
}

function priorItem(raw: string): string | null {
  let item = raw.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").replace(/^(?:a|an|the)\s+/i, "");
  if (!item || /^(?:none|no|n\/?a)$/i.test(item)) return null;
  if (/\bmanual\b/i.test(item)) {
    item = item.replace(
      /\b(?:the\s+)?(?:jba\s+)?(?:policy\s+)?manual(?:\s+(?:ack(?:nowledge?ments?)?|acknowledged|signed|signature|sign[- ]off))?\b/i,
      "JBA Policy Manual acknowledgement",
    );
  }
  return item.replace(/\bc\/a\b/gi, "C/A").replace(/\bca\b/gi, "CA");
}

/** Prior actions in the order stated, each once. */
export function mergePriorActions(first: string | null, more: readonly string[]): string | null {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const line of [...(first ? first.split("\n") : []), ...more]) {
    const clean = line.replace(/\s+/g, " ").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    lines.push(clean);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * What happened, from the manager's turns. The request, the employee, the
 * store, the slot answers and the prior-action list are not the incident.
 * A date inside the phrase stays ("missing the 10-15-26 woven deadline"); the
 * incident's own date at the start or end goes ("… on 10-20-26").
 */
export function requestIncident(input: {
  readonly text: string;
  readonly employeeName: string | null;
  readonly slotClause: (clause: string) => boolean;
}): string | null {
  let found: string | null = null;
  // One turn at a time. An edit or a command ("change the date to 10-22",
  // "name is …", "show draft", "cite standards of conduct …") changes its own
  // field and never What happened; the newest turn that describes an
  // incident is the incident.
  for (const turn of input.text.split("\n")) {
    const offense = turnIncident(turn, input.employeeName, input.slotClause);
    if (offense) found = offense;
  }
  return found;
}

function turnIncident(
  turn: string,
  employeeName: string | null,
  slotClause: (clause: string) => boolean,
): string | null {
  if (isEditTurn(turn)) return null;
  let found: string | null = null;
  const story: string[] = [];
  for (const raw of withoutPriorList(turn).split(/[.!?;]+(?=\s|$)/)) {
    const sentence = raw.trim();
    if (!sentence || isEditTurn(sentence) || TALKS_TO_THE_APP.test(sentence) || ASKS_FOR_HELP.test(sentence)) continue;
    const requested = REQUEST_LEAD.test(sentence) || LEVEL_REQUEST.test(sentence);
    let kept = false;
    for (const clause of sentence.split(",")) {
      const text = clause.trim();
      if (!text || slotClause(text) || STORE_CLAUSE.test(text) || PAYROLL_STATEMENT.test(text) || POLICY_ASK.test(text)) continue;
      kept = true;
      const offense = clauseOffense(text, employeeName);
      if (offense) found = offense;
    }
    if (kept && !requested && sentence.split(/\s+/).length >= 3) story.push(sentence);
  }
  // An account of two or more sentences is kept in the manager's words, so
  // both dates and the coaching they already gave stay on the form
  // (conv_mvmzlpox2z7u4c3). One sentence is read down to the offense.
  if (story.length >= 2) return story.join(". ");
  return found;
}

/** "do verbal for team member …": a level and "for" is a request too. */
const LEVEL_REQUEST =
  /^\s*(?:please\s+)?(?:create|make|start|open|do|file|write|draft)\s+(?:a\s+|an\s+)?(?:verbal|written|final)(?:\s+warning)?\s+for\b/i;

/** "I need to coach an employee": the manager asking for help, not the account. */
const ASKS_FOR_HELP = /^(?:i\s+)?(?:need|want|have|would\s+like)\s+to\s+(?:coach|write\s+up|discipline|document|create|make|do)\b/i;

/** A sentence to the app, not about the employee: "it still would not generate the coaching form". */
const TALKS_TO_THE_APP =
  /\b(?:you|your|sunny|generate|generated|this\s+conversation|the\s+information|information\s+given)\b/i;

/** An edit or a command: it sets a field, shows the draft, or names the policy. It is not an account. */
const EDIT_TURN = [
  /^(?:please\s+)?(?:change|update|edit|fix|correct|set|switch|replace)\b/i,
  /^(?:(?:her|his|their|the)\s+)?(?:employee(?:'s)?\s+)?(?:full\s+)?name\s+(?:is|should\s+be|=|:)/i,
  /^(?:the\s+)?(?:job\s+title|title|position|role|salon|location|date|warning(?:\s+level)?|level)\s+(?:is|should\s+be|=|:)/i,
  /^(?:please\s+)?(?:show|view|see|open|display|preview|send|give\s+me)\b.*\b(?:draft|form|card|edits?)\b/i,
  /^(?:please\s+)?cite\b/i,
  /^(?:this|it|that)\s+(?:is|was)\s+(?:a\s+)?(?:violation|under|against)\b/i,
  /^(?:she|he|they)\s+works?\s+(?:at|in)\b/i,
  /^(?:she|he|they)\s+(?:is|are)\s+(?:at|in|a|an|the)\b/i,
  /^it\s+happened\s+(?:on|at)\s+[^,.;]+[.!]?$/i,
];

export function isEditTurn(turn: string): boolean {
  const text = turn.trim();
  return text !== "" && EDIT_TURN.some((pattern) => pattern.test(text));
}

/**
 * The turn that starts the form now being written. A later create request
 * with its own incident is a new form: What happened, the policy and the
 * action plan are read from that turn on. 0 when there is no such later
 * request.
 */
export function currentRequestStart(input: {
  readonly turns: readonly string[];
  readonly employeeName: string | null;
  readonly slotClause: (clause: string) => boolean;
}): number {
  let requests = 0;
  let start = 0;
  for (const [index, raw] of input.turns.entries()) {
    const turn = raw.replace(STATE_LEAD, "");
    if (!REQUEST_TURN.test(turn.trim())) continue;
    requests += 1;
    if (requests > 1 && turnIncident(turn, input.employeeName, input.slotClause)) start = index;
  }
  return start;
}

/** The state sentences the intent read puts in front of a question ("The employee is …."). */
const STATE_LEAD =
  /^\s*(?:(?:The form is the|The employee is|Job title:|It happened at|It happened on|Warning level:|Payroll amount:|Policy reference:|Incident:|The account continues)[^\n]*?\.(?=\s|$)\s*|(?:Payroll deduct applies|No payroll deduction)\.\s*)+/i;

const REQUEST_TURN = new RegExp(
  String.raw`^\s*(?:please\s+)?(?:(?:create|make|start|open|do|file|write|draft)\s+(?:me\s+)?)?${LEVEL_WORDS}${FORM_WORDS}\b`,
  "i",
);

/** The action plan the manager gave in their own words ("action plan: …"), or null. */
export function statedActionPlan(text: string): string | null {
  let found: string | null = null;
  for (const match of text.matchAll(/\b(?:action\s+plan|the\s+plan)\s*(?:is|will\s+be|:|=|-)\s*([^\n]+?)(?=\.(?:\s|$)|\n|$)/gi)) {
    const plan = match[1]!.trim();
    if (plan) found = plan;
  }
  return found;
}

/**
 * A bare "yes" or "no" answers a yes/no question only when the reply before
 * it asked exactly one question. After a list of questions it answers none.
 */
export function withoutAmbiguousAnswers<T extends { readonly role: string; readonly content: string }>(turns: readonly T[]): T[] {
  return turns.filter((turn, index) => !isAmbiguousAnswer(turns, index));
}

export function isAmbiguousAnswer(turns: readonly { readonly role: string; readonly content: string }[], index: number): boolean {
  const turn = turns[index];
  if (!turn || turn.role !== "user" || !/^(?:yes|no|yeah|yep|yup|nope|y|n)[.!]?$/i.test(turn.content.trim())) return false;
  const asked = [...turns.slice(0, index)].reverse().find((item) => item.role === "assistant");
  if (!asked) return true;
  return openQuestions(asked.content) !== 1;
}

function openQuestions(content: string): number {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\?(?:\*\*)?\s*$/.test(line) || /\?\*\*/.test(line)).length;
}

/** "as you said" only when a word of the value is in a manager turn. */
export function saidInWords(value: string, said: string): boolean {
  const words = value
    .split(/[^A-Za-z']+/)
    .filter((word) => word.length >= 3 && !STATE_CODES.test(word) && !/^(?:the|and|store|salon|location)$/i.test(word));
  if (words.length === 0) return false;
  return words.some((word) => new RegExp(String.raw`\b${escape(word)}\b`, "i").test(said));
}

/** "Test Employee at Grand Island used her cell phone": the capitalized place after "at", read alone. */
export function placeSpans(text: string): string[] {
  return [...text.matchAll(/\bat\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/g)].map((match) => `at ${match[1]}`);
}

function clauseOffense(clause: string, employeeName: string | null): string | null {
  let text = clause.replace(REQUEST_LEAD, " ").replace(LEVEL_REQUEST, " ");
  // "violation is that on 10-16-26 Testy was not measuring and weighing product"
  text = text.replace(/^\s*(?:the\s+)?(?:violation|incident|issue|offen[cs]e|what\s+happened|reason)\s+(?:is|was)(?:\s+that)?\s*[:-]?\s*/i, "");
  // "She was on her cell phone for 30+ minutes at the front desk"
  text = text.replace(/^\s*(?:she|he|they)\s+(?:was|were|has\s+been|have\s+been)\s+/i, "");
  // "Test Employee" anywhere, and "Test" as the subject: "Test was late for shift".
  if (employeeName) {
    text = text.replace(new RegExp(escape(employeeName), "ig"), " ");
    const first = employeeName.trim().split(/\s+/)[0] ?? "";
    if (first.length >= 2) {
      text = text.replace(new RegExp(String.raw`^(\s*(?:on\s+${DATE}\s*,?\s*)?)${escape(first)}\b(?=\s+[a-z])`, "i"), "$1");
    }
  }
  text = text.replace(/\bat\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}/g, " ");
  text = text.replace(/\buse\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}\s+as the (?:location|salon)\b/gi, " ");
  text = text.replace(/\bcoached on\s+\S+/gi, " ");
  text = text.replace(/\bno payroll\b/gi, " ");
  text = text.replace(/\s+/g, " ").trim();
  text = text.replace(new RegExp(String.raw`^(?:on\s+)?${DATE}\s*,?\s*`, "i"), "");
  text = text.replace(new RegExp(String.raw`\s*,?\s*(?:on|at|dated)?\s*${DATE}$`, "i"), "");
  text = text.replace(/^(?:for|about|regarding|re:?)\s+/i, "");
  // Another spelling of the person as the subject: "Test Employee spent 40 minutes …".
  text = text.replace(/^[A-Z][a-z'-]+\s+[A-Z][a-z'-]+\s+(?=[a-z])/, "");
  text = text.replace(/^(?:was|is|has been)\s+/i, "");
  text = text.replace(/^(?:a|an)\s+(?=\S+\s+\S)/i, "");
  text = text.replace(/^[,\s]+|[,\s.]+$/g, "").replace(/\s+(?:on|at)$/i, "");
  if (!text || text.length > 120) return null;
  if (/^(?:for|a|an|the|form|location|store|draft)$/i.test(text)) return null;
  // "jba manual 11-1-25" answers the prior-coaching question.
  if (/^(?:the\s+)?(?:jba\s+)?(?:policy\s+)?manual(?:\s+ack\w*)?$/i.test(text)) return null;
  if (/\b(?:she|he|they|i|we)\b/i.test(text)) return null;
  const title = titleAfterJobTitleLabel(text) ?? extractJobTitle(text);
  if (title && title.toLowerCase() === text.toLowerCase()) return null;
  if (/^team members?$/i.test(text)) return null;
  const onDuration = /\bfor\b/i.test(text) ? null : /^on\s+(.+?)\s+(\d+\+?\s*(?:min|mins|minutes|hrs|hours))\b/i.exec(text);
  if (onDuration) {
    const thing = onDuration[1]!.replace(/\s+/g, " ").trim();
    const spaced = onDuration[2]!.replace(/\s+/g, "").replace(/(\d\+?)(?=[a-z])/i, "$1 ");
    return /\buse\b/i.test(thing) ? `${thing} ${spaced}` : `${thing} use ${spaced}`;
  }
  // "out of dress code" keeps "out of": "dress code" alone says the opposite.
  const counted = /^(out of\s+.+?)\s+(\d+)\s+([a-z]+)$/i.exec(text);
  if (counted) return `${counted[1]}, ${counted[2]} ${counted[3]}`;
  return text;
}

/** A summary that is only the request ("create a corrective action form for"). */
export function isRequestLeftover(summary: string | null | undefined, employeeName: string | null): boolean {
  if (!summary) return false;
  const text = summary.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^(?:please\s+)?(?:create|make|start|open|file|write|draft|do)\b/i.test(text) && new RegExp(FORM_WORDS, "i").test(text)) {
    return true;
  }
  return clauseOffense(text, employeeName) === null && REQUEST_LEAD.test(text);
}

const NAMED_POLICY: Record<CaPolicyName, RegExp> = {
  standards_of_conduct: /\bstandards?\s+of\s+conduct\b/i,
  attendance: /\b(?:attendance|tardiness|absenteeism)\b/i,
  late_opening: /\b(?:late\s+opening|opening\s+late)\s+polic(?:y|ies)\b/i,
  under_performance: /\bunder[\s-]*performance\b/i,
  dress_code: /\bdress\s+code\b/i,
  company_policies: /\bcompany\s+polic(?:y|ies)\b/i,
};

/** The policy the manager named in their own words, or null. A policy the reader inferred is not "as you said". */
export function namedPolicy(text: string): string | null {
  const stated = readCaPolicy(text).stated;
  if (!stated) return null;
  return NAMED_POLICY[stated].test(text) ? CA_POLICY_LABEL[stated] : null;
}

/**
 * The manual sections this account cites. The account's own readers first,
 * then the Standards of Conduct the account points at, then the one heading
 * the extraction chose from the manual's own list — only once there is an
 * incident to cite it for. A heading the manual does not carry is not cited.
 */
export function remapManualSections(input: {
  readonly said: string;
  readonly chunks: readonly ManualChunk[];
  /** What happened as read. It is part of the account ("out of dress code" without its date). */
  readonly incident: string | null;
  readonly modelHeading: string | null;
}): ManualSection[] {
  if (input.chunks.length === 0) return [];
  const notes = withoutPriorList(input.said);
  const kept = (sections: readonly ManualSection[]) =>
    sections.filter((section) => section.heading.trim() && headingKey(section.heading) !== "warning");
  const fromAccount = kept(accountManualSections(notes, input.chunks));
  if (fromAccount.length > 0) return fromAccount;
  const fromIncident = input.incident ? kept(accountManualSections(input.incident, input.chunks)) : [];
  if (fromIncident.length > 0) return fromIncident;
  if (readCaPolicy(notes).suggestion === STANDARDS_OF_CONDUCT) {
    const conduct = findManualSection(input.chunks, [CA_POLICY_LABEL.standards_of_conduct]);
    if (conduct) return kept([conduct]);
  }
  if (!input.incident || !input.modelHeading) return [];
  const listed = manualSectionHeadings(input.chunks).find(
    (heading) => headingKey(heading) === headingKey(input.modelHeading!),
  );
  const section = listed ? findManualSection(input.chunks, [listed]) : null;
  return section ? kept([section]) : [];
}

/** The heading list the extraction chooses a policy from. */
export function remapManualHeadings(chunks: readonly ManualChunk[]): string[] {
  return manualSectionHeadings(chunks).filter((heading) => headingKey(heading) !== "warning");
}

/** The card's Policy row. "as you said" only for the policy the manager named. */
export function remapPolicyLine(named: string | null, sections: readonly ManualSection[]): string | null {
  if (sections.length === 0) return named ? `**Policy:** ${named}, as you said` : null;
  const cited = sections.map((section) => formatManualCitation(section.heading, section.page > 0 ? section.page : null));
  const saidIt = named !== null && sections.some((section) => headingKey(section.heading) === headingKey(named));
  if (named && !saidIt) return `**Policy:** ${named}, as you said — ${cited.join("; ")}`;
  return `**Policy:** ${cited.join("; ")}${saidIt ? ", as you said" : ""}`;
}

const CATEGORIES = new Set<string>([
  "policies_compliance",
  "operations",
  "training",
  "leadership_coaching",
  "sales_client_experience",
  "reports_analytics",
  "bonuses_compensation",
  "safety",
  "equipment_procedures",
  "other",
]);

/** One source per cited section with a printed page, from the manual's own chunk. */
export function remapCitations(manual: RemapManual, sections: readonly ManualSection[]): SourceCitation[] {
  const category = (
    manual.documentCategory && CATEGORIES.has(manual.documentCategory) ? manual.documentCategory : "policies_compliance"
  ) as KnowledgeCategory;
  const citations: SourceCitation[] = [];
  for (const section of sections) {
    if (section.page <= 0) continue;
    const chunk = manual.chunks.find((item) => item.chunkIndex === section.chunkIndex);
    citations.push({
      documentId: manual.documentId,
      documentTitle: manual.documentTitle,
      locator: `Page ${section.page}`,
      category,
      excerpt: `${section.heading}. ${chunk?.content ?? ""}`.slice(0, 500),
      relevance: 1,
    });
  }
  return citations;
}

const STATE_CODES =
  /^(?:A[LKZR]|C[AOT]|DE|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/i;

/** "empire, sd" and "Kearney, NE": a state after a place is not Salon Director (SD). */
export function withoutStateCodes(text: string): string {
  return text.replace(/,\s*([A-Za-z]{2})\b/g, (whole, code: string) => (STATE_CODES.test(code) ? " " : whole));
}

/**
 * The intent path's Observation of Offense, from the manager's sentences. The
 * request words, the employee, the salon, the slot answers, the prior-action
 * list, a policy question and the state sentences the intent read appends
 * ("It happened at …", "Policy reference: …") are not the account. The rest
 * of each sentence stays in the manager's words, dates included.
 */
export function accountSentences(turns: readonly string[], employeeName: string | null): string[] {
  const kept: string[] = [];
  // A later create request with its own incident is a new form; an edit or a
  // command turn ("change the date to 10-22", "show draft") is not an account.
  const start = currentRequestStart({ turns, employeeName, slotClause: accountSlot });
  for (const turn of turns.slice(start)) {
    if (isEditTurn(turn)) continue;
    const text = withoutPriorList(turn.replace(/\bThe account continues\.\s*/g, ""));
    for (const sentence of text.split(/\n+|[.!?;]+(?=\s|$)/)) {
      const trimmed = sentence.trim();
      if (STATE_SENTENCE.test(trimmed) || isEditTurn(trimmed) || TALKS_TO_THE_APP.test(trimmed) || ASKS_FOR_HELP.test(trimmed)) continue;
      if (/^it\s+happened\b/i.test(trimmed)) continue;
      const parts = sentence
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part && !accountSlot(part))
        .map((part) => accountPart(part, employeeName))
        .filter((part): part is string => part !== null);
      const joined = parts.join(", ").trim();
      if (joined.length < 8) continue;
      if (kept.some((seen) => seen.toLowerCase() === joined.toLowerCase())) continue;
      kept.push(joined);
    }
  }
  return kept;
}

const STATE_SENTENCE =
  /^(?:The form is the |The employee is |Job title:|It happened at |It happened on |Warning level:|Payroll |No payroll|Policy reference:|Incident:|Payroll amount:)/;

function accountSlot(part: string): boolean {
  return (
    /^(?:verbal|written|yes|no|yeah|nope|no payroll(?:\s+deduct(?:ion)?)?)[.!]?$/i.test(part) ||
    STATE_CODES.test(part) ||
    STORE_CLAUSE.test(part) ||
    PAYROLL_STATEMENT.test(part) ||
    POLICY_ASK.test(part) ||
    /\buse\s+.+\bas the (?:location|salon)\b/i.test(part) ||
    /^coached on\b/i.test(part)
  );
}

function accountPart(part: string, employeeName: string | null): string | null {
  const requested = REQUEST_LEAD.test(part) || LEVEL_REQUEST.test(part);
  let text = part.replace(REQUEST_LEAD, " ").replace(LEVEL_REQUEST, " ");
  // "Please create a CA form so I can document": the rest of a request is not the account.
  if (requested && /^\s*(?:so|to|with|from|because|now)\b/i.test(text)) return null;
  if (employeeName) text = text.replace(new RegExp(escape(employeeName), "ig"), " ");
  text = text.replace(/\bat\s+[A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3}/g, " ");
  text = text.replace(/\s+/g, " ").trim().replace(/^(?:for|about|regarding|re:?)\s+/i, "").trim();
  if (!text || /^(?:for|a|an|the|form)$/i.test(text)) return null;
  // Only capitalized words left ("Test Employee" when the card holds "Test"): a name or a place.
  if (/^[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2}$/.test(text)) return null;
  const title = titleAfterJobTitleLabel(text) ?? extractJobTitle(text);
  if (title && title.toLowerCase() === text.toLowerCase()) return null;
  return text;
}

/**
 * "prior = manual ack 9/01" is the prior-action shorthand the remap path
 * reads. The proposal's prior-action reader knows "prior action: …", so the
 * shorthand is spelled that way for it, and its date is not the form's date.
 */
export function priorShorthand(text: string): string {
  return text.replace(
    /\bprior\s*=\s*([^,\n.]+)/gi,
    (_whole, step: string) => `prior action: ${step.trim().replace(/\back\b/gi, "acknowledgement")}`,
  );
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The history of the form now being written: from the turn of a later create
 * request with its own incident. Empty when the question itself starts it.
 */
export function requestScopedHistory<T extends { readonly role: string; readonly content: string }>(
  history: readonly T[],
  question: string,
): T[] {
  const userAt = history.flatMap((turn, index) => (turn.role === "user" ? [index] : []));
  const turns = [...userAt.map((index) => history[index]!.content), question];
  const start = currentRequestStart({ turns, employeeName: null, slotClause: accountSlot });
  if (start === 0) return [...history];
  if (start >= userAt.length) return [];
  return history.slice(userAt[start]!);
}

/** Whether the question is a later create request with its own incident: a new form. */
export function startsNewForm(history: readonly { readonly role: string; readonly content: string }[], question: string): boolean {
  const users = history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  return users.length > 0 && currentRequestStart({ turns: [...users, question], employeeName: null, slotClause: accountSlot }) === users.length;
}

/** The manager's own words of a question the intent read rewrote. */
export function withoutStateLead(question: string): string {
  return question.replace(STATE_LEAD, "");
}
