import { JOIN } from "./bounded-context";
import {
  findManualSection,
  manualSectionHeadings,
  manualSectionsFor,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";

/**
 * ============================================================================
 * WHICH POLICY A CORRECTIVE ACTION RESTS ON, READ FROM THE MANAGER'S WORDS
 * ============================================================================
 *
 * HR feedback, 30 Sep 2026: "I had to tell Sunny the applicable policy (which
 * was the Standards of Conduct) for the CA for missing the Woven deadline."
 *
 * The policy on a Corrective Action Form follows its Type of Offense box, and
 * the box was the model's choice alone. For a missed deadline it ticked Under
 * Performance — which deliberately cites no section, because underperformance
 * enters at coaching — and the policy came back blank until the manager named
 * it. The model was not wrong to be unsure; it was wrong to be the only one
 * deciding.
 *
 * SO THE FAMILIAR CASES ARE READ HERE, DETERMINISTICALLY, the way `exit-facts.ts`
 * reads the dates:
 *
 *   an assigned task or required work that was not completed,
 *   a required deadline that was missed,
 *   required Woven items or training that were not completed,
 *   a manager's direction that was not followed.
 *
 * Each points at the Standards of Conduct. That is a SUGGESTION, not a label:
 *
 *   AT THE PROPOSAL it is named, with what it rests on, for the manager to
 *   change. Where the same account also reads as attendance or as a
 *   performance target, nothing is suggested — the manager is asked which.
 *
 *   AT THE DRAFT it is applied only when the pinned official manual's own
 *   Standards of Conduct section, as it reads TODAY, lists the infraction —
 *   "Failing to follow the policies and procedures of The Company", or
 *   "Insubordination - the refusal to follow the directions of the manager".
 *   A re-issued manual that drops the line, a deployment with no manual, or a
 *   section that cannot be found leaves the box to the model and the policy
 *   blank, exactly as before. Nothing here writes a policy; it ticks the box
 *   whose section the manual itself is then quoted from.
 *
 * A POLICY THE MANAGER NAMED WINS. "The policy violated is the standards of
 * conduct" settles it; "it's attendance" or "under performance" stops the
 * suggestion. The later turn wins, so a correction is honoured.
 *
 * Pure and browser-safe; nothing here knows who is asking.
 */

/** The offense box the Standards of Conduct is ticked with. */
export const STANDARDS_OF_CONDUCT = "standards_of_conduct";

/** The policies a manager may name, and the ones this may ask between. */
export type CaPolicyName =
  | "standards_of_conduct"
  | "attendance"
  | "under_performance"
  | "dress_code"
  | "company_policies";

/** How each is written back to the manager — the form's and the manual's words. */
export const CA_POLICY_LABEL: Record<CaPolicyName, string> = {
  standards_of_conduct: "Standards of Conduct",
  attendance: "Attendance",
  under_performance: "Under Performance",
  dress_code: "Dress Code",
  company_policies: "Violation of Company Policies",
};

/** What an incident was, in the terms the suggestion is explained in. */
export type ConductTopic = "task" | "deadline" | "direction";

export interface CaPolicyReading {
  /** The policy the manager named, latest turn first. */
  stated: CaPolicyName | null;
  /** The conduct incidents the account describes. */
  topics: ConductTopic[];
  /** Other readings of the same account, which make a suggestion a question. */
  alternatives: Exclude<CaPolicyName, "standards_of_conduct">[];
  /** Standards of Conduct, when the manager named it or the account clearly points at it. */
  suggestion: typeof STANDARDS_OF_CONDUCT | null;
  /** Where the suggestion came from. */
  source: "stated" | "incident" | null;
  /** Policies to ask between, when the account reads more than one way and none was named. */
  ambiguous: CaPolicyName[] | null;
  /** A scheduled meeting, seminar or training session the account says was not attended: "the monthly meeting". */
  missedEvent: string | null;
}

/* ------------------------------------------------------------ the words -- */

function normalize(text: string): string {
  return (text ?? "").replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').toLowerCase();
}

/** Sentences, with every question dropped whole — a question names no policy. */
function statements(turn: string): string[] {
  const out: string[] = [];
  for (const match of turn.matchAll(/[^.!?\n]+[.!?]*/g)) {
    const sentence = match[0].trim();
    if (sentence === "" || /\?\s*$/.test(sentence)) continue;
    out.push(sentence);
  }
  return out;
}

const FAILED = String.raw`(?:did ?n[o']?t|didn't|never|failed to|has ?n[o']?t|hasn't|have ?n[o']?t|haven't|had ?n[o']?t|hadn't|was ?n[o']?t able to|wasn't able to|neglected to|is ?n[o']?t|isn't)`;

/** What an assigned piece of work is called. */
const TASK_NOUN = String.raw`(?:tasks?|assignments?|assigned work|duties|duty|checklists?|training|trainings|modules?|courses?|items?|paperwork|cleaning|disinfect\w*|projects?|reports?|requirements?|woven)`;

const CONDUCT_TOPICS: { topic: ConductTopic; pattern: RegExp }[] = [
  {
    topic: "deadline",
    pattern: new RegExp(
      String.raw`\b(?:miss(?:ed|ing|es)?|not meeting|not meet|did ?n[o']?t meet|didn't meet|failed to meet|blew|blown)\s+(?:\S+\s+){0,3}?(?:deadlines?|due dates?)\b|\bdeadlines?\s+(?:\S+\s+){0,3}?(?:was|were)\s+(?:missed|not met|passed)\b|\b(?:overdue|past due)\b`,
    ),
  },
  {
    topic: "task",
    pattern: new RegExp(
      String.raw`\b${FAILED}\s+(?:\S+\s+){0,2}?(?:complete|completed|finish|finished|do|done|turn in|turned in|submit|submitted)\b[^.;!?\n]{0,40}?\b${TASK_NOUN}|\b(?:incomplete|unfinished|uncompleted|left undone|left unfinished)\s+(?:\S+\s+){0,2}?${TASK_NOUN}|\b${TASK_NOUN}\s+(?:\S+\s+){0,3}?(?:incomplete|unfinished|not (?:completed|finished|done))\b`,
    ),
  },
  {
    topic: "direction",
    pattern: new RegExp(
      String.raw`\b(?:${FAILED}|refused to|would ?n[o']?t|wouldn't|won't)\s+(?:\S+\s+){0,2}?follow\s+(?:\S+\s+){0,3}?(?:directions?|instructions?|directives?|requests?)\b|\binsubordinat\w*|\bignored\s+(?:\S+\s+){0,3}?(?:directions?|instructions?|requests?)\b|\b(?:was|were)\s+(?:told|directed|instructed|asked)\s+to\b[^.;!?\n]{0,80}?\b(?:did ?n[o']?t|didn't|never|refused|failed)\b`,
    ),
  },
];

/**
 * THE OTHER READINGS OF THE SAME ACCOUNT. A task left undone because she was
 * late is arguably attendance; a "deadline" for a sales number is a target.
 * Either alongside a conduct incident makes the policy a question.
 */
const ATTENDANCE =
  /\b(?:arrived|came in|showed up|clocked in|was|were|is|been|running)\s+(?:\S+\s+){0,2}?late\b|\b(?:tardy|tardiness|lateness|left early|leaving early|clocked out early|absent|absence|absences|absenteeism|no[- ]call|no[- ]show|called (?:out|off)|call[- ]?off|missed (?:her|his|their|a|the) shift)\b/;
const TARGET =
  /\b(?:sales|quota|ppta|upgrades?|conversions?|close rate|closing rate|kpis?|metrics|scorecard|revenue|(?:her|his|their|the) numbers|(?:sales|membership|monthly|weekly) goals?|below (?:goal|target)|(?:hit|hitting|meet|meeting|missed|missing) (?:her|his|their|the) (?:goal|goals|target|targets))\b/;

/**
 * ============================================================================
 * A MEETING, SEMINAR OR TRAINING SESSION NOT ATTENDED
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026: "create a written CA for <employee>
 * for not attending the monthly meeting on 10-20-26 …" was drafted under the
 * Standards of Conduct. The manual's own Attendance section says otherwise:
 * "Seminars/Meetings/ Training sessions are considered scheduled shifts", and
 * its Seminar/Webinar Attendance section calls a missed one a no call no show.
 *
 * So an account of a scheduled event not attended is read here, as an
 * attendance account, and the MANUAL decides what that means
 * (`groundMissedEvent`): where its attendance sections name the event, it is
 * Absenteeism and the section is quoted, said as a reading the manager can
 * change. Where the manual does not — or cannot be read — the manager is
 * asked which policy applies, and their answer fills the form.
 *
 * Not a task left undone: "did not complete the woven training" is the
 * Standards of Conduct reading above, and "missed the training deadline" a
 * deadline. Only attending one is read here.
 */
const EVENT_NOUN = String.raw`(?:meetings?|seminars?|webinars?|huddles?|trainings?(?:\s+(?:sessions?|classes?|meetings?))?|(?:training\s+)?(?:sessions?|classes?))`;
const NOT_THE_EVENT = String.raw`(?!\s+(?:deadlines?|due|modules?|items?|videos?|courses?|assignments?|requirements?|quiz\w*|workbooks?|notes?|minutes|agenda))`;
const MISSED_EVENT = new RegExp(
  String.raw`\b(?:(?:${FAILED}|not|never|without)\s+(?:\S+\s+)?(?:attend(?:ing|ed)?|show(?:ing|ed)? up (?:to|for|at)|c[oa]me to|coming to|go to|went to|going to|ma(?:k|d)e it to|join(?:ing|ed)?)|missed|missing|skipped|skipping|no[- ]show(?:ed)? (?:to|for|at)|absent from)\s+((?:\S+\s+){0,3}?${EVENT_NOUN})\b${NOT_THE_EVENT}`,
);

function missedEventIn(sentences: readonly string[]): string | null {
  for (const sentence of sentences) {
    const match = MISSED_EVENT.exec(sentence);
    if (match) return match[1]!.replace(/^(?:the|a|an|her|his|their|our)\s+/, "").trim();
  }
  return null;
}

/**
 * A POLICY NAMED. The Standards of Conduct is a policy's name wherever it
 * appears; the others are also everyday words ("her attendance", "out of dress
 * code"), so they count only as an answer — a short reply, or a sentence that
 * frames them as the policy.
 */
const NAMED: { name: CaPolicyName; pattern: RegExp; alwaysAPolicy: boolean }[] = [
  { name: "standards_of_conduct", pattern: /\b(?:standards? of conduct|code of conduct)\b/, alwaysAPolicy: true },
  { name: "under_performance", pattern: /\b(?:under[- ]?performance|underperforming)\b/, alwaysAPolicy: false },
  { name: "attendance", pattern: /\b(?:attendance|tardiness|absenteeism)\b/, alwaysAPolicy: false },
  { name: "dress_code", pattern: /\bdress code\b/, alwaysAPolicy: false },
  { name: "company_policies", pattern: /\bviolation of company polic(?:y|ies)\b/, alwaysAPolicy: true },
];
const POLICY_FRAME =
  /\b(?:polic(?:y|ies)|violat\w*|falls? under|under|use|it'?s|it is|should be|applies|apply|is the|was the)\b/;
const NEGATED_BEFORE = /\b(?:not|never|isn't|is not|wasn't|was not|no)\s+(?:\S+\s+){0,2}$/;

function statedIn(turn: string): CaPolicyName | null {
  let found: { name: CaPolicyName; at: number } | null = null;
  const short = turn.split(/\s+/).filter(Boolean).length <= 8;
  for (const sentence of statements(turn)) {
    for (const { name, pattern, alwaysAPolicy } of NAMED) {
      const match = pattern.exec(sentence);
      if (!match) continue;
      if (NEGATED_BEFORE.test(sentence.slice(0, match.index))) continue;
      if (!alwaysAPolicy && !short && !POLICY_FRAME.test(sentence)) continue;
      // The last policy named in the turn is its answer: "not attendance — standards of conduct".
      const at = turn.indexOf(sentence) + match.index;
      if (!found || at >= found.at) found = { name, at };
    }
  }
  return found?.name ?? null;
}

/* ------------------------------------------------------------- reading -- */

/**
 * Everything the manager's turns say about which policy applies.
 *
 * The turns arrive joined by `JOIN`, oldest first, exactly as the proposal and
 * the drafting notes carry them.
 */
export function readCaPolicy(rawText: string): CaPolicyReading {
  const text = normalize(rawText);
  const turns = text.split(JOIN).map((turn) => turn.trim()).filter(Boolean);

  let stated: CaPolicyName | null = null;
  for (const turn of turns) stated = statedIn(turn) ?? stated;

  const sentences = statements(text);
  const topics = CONDUCT_TOPICS.filter(({ pattern }) => sentences.some((s) => pattern.test(s))).map(
    ({ topic }) => topic,
  );

  const missedEvent = missedEventIn(sentences);

  const alternatives: CaPolicyReading["alternatives"] = [];
  if (topics.length > 0) {
    if (missedEvent || sentences.some((s) => ATTENDANCE.test(s))) alternatives.push("attendance");
    if (sentences.some((s) => TARGET.test(s))) alternatives.push("under_performance");
  }

  if (stated) {
    return {
      stated,
      topics,
      alternatives,
      suggestion: stated === STANDARDS_OF_CONDUCT ? STANDARDS_OF_CONDUCT : null,
      source: stated === STANDARDS_OF_CONDUCT ? "stated" : null,
      ambiguous: null,
      missedEvent,
    };
  }
  /*
   * A MISSED MEETING, AND NOTHING ELSE: Attendance or the Standards of
   * Conduct. A question here; the manual settles it where it can (see
   * `groundMissedEvent`), and the manager's answer settles it otherwise.
   */
  if (topics.length === 0 && missedEvent) {
    return {
      stated,
      topics,
      alternatives: ["attendance"],
      suggestion: null,
      source: null,
      ambiguous: ["attendance", STANDARDS_OF_CONDUCT],
      missedEvent,
    };
  }
  if (topics.length === 0) {
    return { stated, topics, alternatives, suggestion: null, source: null, ambiguous: null, missedEvent };
  }
  if (alternatives.length > 0) {
    return {
      stated,
      topics,
      alternatives,
      suggestion: null,
      source: null,
      ambiguous: [STANDARDS_OF_CONDUCT, ...alternatives],
      missedEvent,
    };
  }
  return {
    stated,
    topics,
    alternatives,
    suggestion: STANDARDS_OF_CONDUCT,
    source: "incident",
    ambiguous: null,
    missedEvent,
  };
}

/** Whether a reply names a policy — the answer to "which policy applies?". */
export function namesCaPolicy(reply: string): boolean {
  return statedIn(normalize(reply)) !== null;
}

/*
 * ============================================================================
 * A POLICY THE MANAGER NAMED IS THE BOX THAT IS TICKED
 * ============================================================================
 *
 * Not left to the model. "Actually use attendance" after an account that also
 * mentions unfinished tasks must come back Attendance, whatever the model
 * would have classified. Attendance is one section with two boxes: the box
 * follows what the account describes — absence, lateness, or both — and is
 * Tardiness when it describes neither. The policy fields are then derived and
 * quoted by the existing code, and fail closed as before where the manual
 * states no section (Under Performance, Violation of Company Policies).
 */
const ABSENCE = /\b(?:absent|absence|absences|absenteeism|no[- ]call|no[- ]show|called (?:out|off)|call[- ]?off|missed (?:her|his|their|a|the) shift)\b/;
const LATENESS = /\b(?:late|lateness|tardy|tardiness|left early|leaving early|clocked out early)\b/;

export function statedOffenseKeys(reading: CaPolicyReading, rawText: string): string[] | null {
  switch (reading.stated) {
    case null:
      return null;
    case "attendance": {
      const text = normalize(rawText);
      // A meeting not attended is an absence from a scheduled shift, not a late arrival.
      const absent = ABSENCE.test(text) || reading.missedEvent !== null;
      const late = LATENESS.test(text);
      if (absent && late) return ["tardiness", "absenteeism"];
      return absent ? ["absenteeism"] : ["tardiness"];
    }
    default:
      return [reading.stated];
  }
}

/**
 * The Type of Offense as the manager named it. Only keys this version offers
 * are ticked; the model's other ticks and its "Other" write-in give way.
 */
export function withStatedOffense(input: {
  checked: Record<string, string[]>;
  values: Record<string, string>;
  keys: readonly string[];
  offered: readonly string[];
}): { checked: Record<string, string[]>; values: Record<string, string>; ticked: string[]; replaced: string[] } {
  const ticked = input.keys.filter((key) => input.offered.includes(key));
  const before = input.checked.offense_type ?? [];
  const replaced: string[] = before.filter((key) => !ticked.includes(key));
  const values = { ...input.values };
  if (typeof values.other_offense === "string" && values.other_offense.trim() !== "") {
    delete values.other_offense;
    replaced.push("other_offense");
  }
  return { checked: { ...input.checked, offense_type: ticked }, values, ticked, replaced };
}

/* ----------------------------------------------------- the proposal line -- */

const TOPIC_WORDS: Record<ConductTopic, string> = {
  task: "assigned work that wasn't completed",
  deadline: "a required deadline that was missed",
  direction: "a manager's direction that wasn't followed",
};

const ALTERNATIVE_WORDS: Record<CaPolicyReading["alternatives"][number], string> = {
  attendance: "**Attendance**, if it comes down to being late or absent",
  under_performance:
    "**Under Performance**, if it is about results against a target (the manual gives that no policy section; it is usually coached first)",
  dress_code: "**Dress Code**",
  company_policies: "**Violation of Company Policies**",
};

/**
 * A policy the manager named by a name this file does not know — "violating
 * visitors at work policy" — and what the pinned manual said about it:
 * `found` (its heading and printed page), `missing` (no heading, or more than
 * one, answers it), or `unknown` (the manual was not read). `described` is a
 * section the account describes where no policy was named at all ("talking
 * on her cell phone"). See `named-policy-section.ts`.
 */
export type NamedPolicyReading =
  | {
      phrase: string;
      lookup: "found" | "described";
      heading: string;
      page: number;
      offenseKey: string;
      /** The manual's own sentence the reading rests on, where one was needed: "Seminars/Meetings/ Training sessions are considered scheduled shifts." */
      anchor?: string;
    }
  | { phrase: string; lookup: "missing" | "unknown" };

/** The offense box a named section is cited under, as the form labels it. */
const OFFENSE_BOX_LABEL: Record<string, string> = {
  tardiness: "Tardiness/Leaving Early",
  absenteeism: "Absenteeism",
  standards_of_conduct: "Standards of Conduct",
  dress_code: "Dress Code Violation",
  company_policies: "Violation of Company Policies",
};

function namedPolicyLine(named: NamedPolicyReading): string {
  /*
   * NOT NAMED, DESCRIBED: "on her cell phone" is the manual's Cell Phone/Smart
   * Watch Policy. Said as a reading the manager can change, not as theirs.
   */
  if (named.lookup === "described") {
    const box = OFFENSE_BOX_LABEL[named.offenseKey];
    // The manual's sentence closes this one: `… which says "… scheduled shifts." I'll quote it`.
    const says = named.anchor ? `, which says "${named.anchor}"${/[.!?]$/.test(named.anchor) ? "" : "."}` : ".";
    return `**Policy:** "${named.phrase}" reads as the policy manual's **${named.heading}** (page ${named.page})${says} I'll quote it on the draft${box ? ` under **${box}**` : ""} — tell me if a different policy applies.`;
  }
  if (named.lookup === "found") {
    const box = OFFENSE_BOX_LABEL[named.offenseKey];
    return `**Policy:** ${named.heading}, as you said — the policy manual's section on page ${named.page}. I'll quote it on the draft${box ? ` under **${box}**` : ""}.`;
  }
  if (named.lookup === "missing") {
    return `**Policy:** Woven does not see a section of the current policy manual for "${named.phrase}" in the knowledge base, so I won't cite one. Tell me the policy as the manual names it, or tick Type of Offense and complete Direct policy on the form.`;
  }
  return `**Policy:** "${named.phrase}", as you said. I'll look for that section in the current policy manual and quote it on the draft; if the manual has no section by that name, Direct policy is left for you to complete.`;
}

/** How a missed event is read back: "missed the monthly meeting". */
export function missedEventPhrase(event: string): string {
  return `missed ${withArticle(event)}`;
}

/** "monthly meeting" → "the monthly meeting"; "meetings" stays as said. */
function withArticle(event: string): string {
  return /s$/.test(event) && !/(?:ss|class)$/.test(event) ? event : `the ${event}`;
}

/** The marker the continuation reads to know a policy question is open. */
export const CA_POLICY_QUESTION = "Which policy applies?";

/**
 * What the proposal says about the policy, or null when there is nothing to
 * say beyond the usual "I'll check the applicable company policy".
 */
export function caPolicyProposalLine(reading: CaPolicyReading, named: NamedPolicyReading | null = null): string | null {
  /*
   * A POLICY THE MANAGER NAMED, which the manual answers, is the policy — the
   * draft ticks its box and quotes its section (District Manager feedback,
   * 21 Oct 2026: "violating visitors at work policy" named no policy at all).
   * One the manual does not answer is said so, unless the account still reads
   * as a policy below.
   */
  if (!reading.stated && named && (named.lookup !== "missing" || (!reading.ambiguous && !reading.suggestion))) {
    return namedPolicyLine(named);
  }
  if (reading.ambiguous && reading.topics.length === 0 && reading.missedEvent) {
    return `**${CA_POLICY_QUESTION}** Missing ${withArticle(reading.missedEvent)} could fall under **Attendance** (as an absence from a scheduled shift) or **Standards of Conduct**. Tell me which, or tick Type of Offense on the form — I won't pick one for you.`;
  }
  if (reading.ambiguous) {
    const others = reading.alternatives.map((name) => ALTERNATIVE_WORDS[name]);
    const topic = TOPIC_WORDS[reading.topics[0]!];
    return `**${CA_POLICY_QUESTION}** This could fall under **Standards of Conduct** (${topic}) or ${others.join(", or ")}. Tell me which, or tick Type of Offense on the form — I won't pick one for you.`;
  }
  if (reading.suggestion && reading.source === "stated") {
    return "**Policy:** Standards of Conduct, as you said. I'll quote that section from the current policy manual on the draft.";
  }
  if (reading.stated === "attendance" || reading.stated === "dress_code") {
    return `**Policy:** ${CA_POLICY_LABEL[reading.stated]}, as you said. I'll quote that section from the current policy manual on the draft.`;
  }
  if (reading.stated === "under_performance" || reading.stated === "company_policies") {
    return `**Policy:** ${CA_POLICY_LABEL[reading.stated]}, as you said. The policy manual has no single section to quote for it, so Direct policy is left for you to complete.`;
  }
  if (reading.suggestion && reading.source === "incident") {
    const what = reading.topics.map((topic) => TOPIC_WORDS[topic]).join(" and ");
    return `**Policy:** this reads as **Standards of Conduct** — ${what}. I'll check it against the current policy manual and quote that section on the draft; if the manual doesn't support it, I'll leave the policy for you. Tell me if a different policy applies.`;
  }
  return null;
}

/* ------------------------------------------------- grounding in the manual -- */

/**
 * THE MANUAL'S OWN LINES the suggestion may rest on, per kind of incident. A
 * direction not followed is insubordination; every one of them is "failing to
 * follow the policies and procedures of The Company".
 */
const ANCHORS: Record<ConductTopic, RegExp[]> = {
  task: [/failing to follow the policies and procedures/i],
  deadline: [/failing to follow the policies and procedures/i],
  direction: [/insubordination/i, /refusal to follow the directions/i, /failing to follow the policies and procedures/i],
};

/** How many chunks a section may run across before another heading must have begun. */
const SECTION_SPAN = 6;

/**
 * The section's own text: from its heading, through the chunks that continue
 * it, stopping at the first chunk that opens a different section.
 */
export function sectionText(chunks: readonly ManualChunk[], section: ManualSection): string {
  const ordered = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const start = ordered.findIndex((chunk) => chunk.chunkIndex === section.chunkIndex);
  if (start < 0) return "";
  const heading = section.heading.trim().toLowerCase();
  const parts: string[] = [];
  for (const chunk of ordered.slice(start, start + SECTION_SPAN)) {
    const other = [
      ...(chunk.sections ?? []).map((entry) => entry.heading),
      ...(chunk.section ? [chunk.section] : []),
    ].some((name) => name.trim().toLowerCase() !== heading);
    if (parts.length > 0 && other) break;
    parts.push(chunk.content);
  }
  const text = parts.join("\n");
  const at = text.toLowerCase().indexOf(heading);
  return at >= 0 ? text.slice(at) : text;
}

export type ConductGrounding =
  | {
      ok: true;
      section: ManualSection;
      /** The manual's own line the suggestion rests on, verbatim; null when the manager named the policy. */
      anchor: string | null;
    }
  | { ok: false; reason: "no_suggestion" | "no_manual" | "no_section" | "not_supported" };

/**
 * Whether the pinned manual, as it reads now, supports ticking Standards of
 * Conduct for this account.
 *
 * A policy the manager NAMED needs only its section to exist — they have
 * decided, and the manual is quoted for them. One SUGGESTED from the incident
 * needs the section to list the infraction too.
 */
export function groundConductPolicy(input: {
  reading: CaPolicyReading;
  chunks: readonly ManualChunk[] | null;
  jobTitle?: string | null;
}): ConductGrounding {
  if (input.reading.suggestion !== STANDARDS_OF_CONDUCT) return { ok: false, reason: "no_suggestion" };
  if (!input.chunks || input.chunks.length === 0) return { ok: false, reason: "no_manual" };
  const section = manualSectionsFor({
    chunks: input.chunks,
    offenseKeys: [STANDARDS_OF_CONDUCT],
    jobTitle: input.jobTitle,
  })[0];
  if (!section) return { ok: false, reason: "no_section" };
  if (input.reading.source === "stated") return { ok: true, section, anchor: null };

  const text = sectionText(input.chunks, section);
  const lines = text.split("\n");
  for (const topic of input.reading.topics) {
    for (const anchor of ANCHORS[topic]) {
      const line = lines.find((candidate) => anchor.test(candidate));
      if (line) return { ok: true, section, anchor: line.trim() };
    }
  }
  return { ok: false, reason: "not_supported" };
}

/**
 * ============================================================================
 * WHERE THE MANUAL PUTS A MEETING NOT ATTENDED
 * ============================================================================
 *
 * Read from the pinned manual as it is today, never from a list kept here:
 *
 *   A SECTION OF ITS OWN — a heading that names the event and attendance,
 *   such as "Seminar/Webinar Attendance" for a missed seminar — is cited
 *   first, where exactly one answers.
 *
 *   OTHERWISE THE ATTENDANCE SECTION, where one of its own sentences names
 *   the event: "Seminars/Meetings/ Training sessions are considered
 *   scheduled shifts."
 *
 * Either is cited under Absenteeism, with the sentence it rests on. A manual
 * that says neither — a huddle it never mentions, a re-issued manual, none at
 * all — grounds nothing, and the manager is asked which policy applies.
 */
export type MissedEventGrounding =
  | { ok: true; section: ManualSection; anchor: string }
  | { ok: false; reason: "no_event" | "no_manual" | "not_supported" };

/** The box a meeting not attended is cited under. */
export const MISSED_EVENT_OFFENSE = "absenteeism";

function eventStem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("sses")) return w.slice(0, -2);
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** "monthly meeting" → "meeting"; "training session" → "session". */
function eventHead(event: string): string {
  const words = event.split(/\s+/).filter(Boolean);
  return eventStem(words[words.length - 1] ?? "");
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^(?:o|•|-|\*)\s+/, "").trim())
    .filter(Boolean);
}

function mentions(sentence: string, head: string): boolean {
  return sentence
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => word !== "" && eventStem(word) === head);
}

export function groundMissedEvent(input: {
  reading: CaPolicyReading;
  chunks: readonly ManualChunk[] | null;
  jobTitle?: string | null;
}): MissedEventGrounding {
  const event = input.reading.missedEvent;
  if (!event || input.reading.stated !== null || input.reading.topics.length > 0) return { ok: false, reason: "no_event" };
  if (!input.chunks || input.chunks.length === 0) return { ok: false, reason: "no_manual" };
  const head = eventHead(event);

  const own = manualSectionHeadings(input.chunks).filter(
    (heading) => /\battend/i.test(heading) && mentions(heading.replace(/\battendance\b/gi, ""), head),
  );
  if (own.length === 1) {
    const section = findManualSection(input.chunks, own);
    const anchor = section
      ? sentencesOf(sectionText(input.chunks, section).slice(section.heading.length)).find((s) => mentions(s, head))
      : undefined;
    if (section && anchor) return { ok: true, section, anchor };
  }

  const attendance = manualSectionsFor({
    chunks: input.chunks,
    offenseKeys: [MISSED_EVENT_OFFENSE],
    jobTitle: input.jobTitle,
  })[0];
  if (attendance) {
    const anchor = sentencesOf(sectionText(input.chunks, attendance)).find((s) => mentions(s, head));
    if (anchor) return { ok: true, section: attendance, anchor };
  }
  return { ok: false, reason: "not_supported" };
}

/**
 * The Type of Offense once Standards of Conduct is grounded: the box is ticked,
 * and the readings it replaces are removed — Under Performance, and the
 * "Other" write-in (with its tick, on a version that has one), which is the
 * model's own name for the same incident. Every other box the model ticked
 * stays.
 */
export function withConductOffense(input: {
  checked: Record<string, string[]>;
  values: Record<string, string>;
}): { checked: Record<string, string[]>; values: Record<string, string>; replaced: string[] } {
  const ticked = input.checked.offense_type ?? [];
  const replaced: string[] = ticked.filter((key) => key === "under_performance" || key === "other");
  const kept = ticked.filter((key) => !replaced.includes(key) && key !== STANDARDS_OF_CONDUCT);
  const values = { ...input.values };
  if (typeof values.other_offense === "string" && values.other_offense.trim() !== "") {
    delete values.other_offense;
    replaced.push("other_offense");
  }
  return {
    checked: { ...input.checked, offense_type: [STANDARDS_OF_CONDUCT, ...kept] },
    values,
    replaced,
  };
}

/** Said beside a draft whose policy the manager was asked about and did not settle. */
export function caPolicyAmbiguousNotice(reading: CaPolicyReading): string | null {
  if (!reading.ambiguous) return null;
  const names = reading.ambiguous.map((name) => CA_POLICY_LABEL[name]);
  const list = `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  return `This could fall under ${list}, and you didn't say which — check Type of Offense, Policy Violated and Direct policy before you finalize.`;
}
