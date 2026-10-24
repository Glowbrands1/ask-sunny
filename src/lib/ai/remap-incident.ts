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
  let item = raw.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "");
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
  for (const turn of withoutPriorList(input.text).split("\n")) {
    for (const sentence of turn.split(/[.!?;]+(?=\s|$)/)) {
      for (const clause of sentence.split(",")) {
        const text = clause.trim();
        if (!text || input.slotClause(text) || STORE_CLAUSE.test(text) || PAYROLL_STATEMENT.test(text) || POLICY_ASK.test(text)) continue;
        const offense = clauseOffense(text, input.employeeName);
        if (offense) found = offense;
      }
    }
  }
  return found;
}

function clauseOffense(clause: string, employeeName: string | null): string | null {
  let text = clause.replace(REQUEST_LEAD, " ");
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
  text = text.replace(/^(?:was|is|has been)\s+/i, "");
  text = text.replace(/^[,\s]+|[,\s.]+$/g, "").replace(/\s+(?:on|at)$/i, "");
  if (!text || text.length > 120) return null;
  if (/^(?:for|a|an|the|form)$/i.test(text)) return null;
  if (/\b(?:she|he|they|i|we)\b/i.test(text)) return null;
  const title = titleAfterJobTitleLabel(text) ?? extractJobTitle(text);
  if (title && title.toLowerCase() === text.toLowerCase()) return null;
  if (/^team members?$/i.test(text)) return null;
  const onDuration = /^on\s+(.+?)\s+(\d+\+?\s*(?:min|mins|minutes|hrs|hours))\b/i.exec(text);
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
  for (const turn of turns) {
    const text = withoutPriorList(turn.replace(/\bThe account continues\.\s*/g, ""));
    for (const sentence of text.split(/\n+|[.!?;]+(?=\s|$)/)) {
      if (STATE_SENTENCE.test(sentence.trim())) continue;
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
  let text = part.replace(REQUEST_LEAD, " ");
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
