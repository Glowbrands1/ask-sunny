import { withoutAppLines } from "@/lib/ai/app-sentences";
import { CHAT_GLOSSARY, foldsToGlossaryTerm, isSalesCountTerm } from "@/lib/ai/chat-glossary";
import {
  asYouSaidAppReadEnabled,
  asYouSaidManagerWordsEnabled,
  caPerformanceReasonEnabled,
  msbPhraseSocEnabled,
  caSalesPolicyEnabled,
  cleaningOtherEveryWordingEnabled,
  formEditDateRulesEnabled,
  removePolicyNotNamedEnabled,
  policyCleaningIncidentEnabled,
  salesObservationAccountEnabled,
  salesShortfallObjectEnabled,
  wovenTrainingConductEnabled,
  conductIncidentCitesPageEnabled,
} from "@/lib/config/chat-quality-flags";

import { JOIN } from "./bounded-context";
import { namesPerformance } from "./epp-policy";
import { LATE_TO_OPEN, lateOpenOn } from "./late-open";
import {
  findManualSection,
  isApprovedPolicyManualTitle,
  manualSectionHeadings,
  manualSectionsFor,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";
import { statesMetricShortfall } from "./metric-shortfall";
import { CURRENT_CA_OFFENSE_KEYS, offeredOffenseKey, offeredOffenseKeys } from "./offense-keys";
import { detectTemplateIntent } from "./template-intent";

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
  | "late_opening"
  | "under_performance"
  | "dress_code"
  | "company_policies";

/** How each is written back to the manager — the form's and the manual's words. */
export const CA_POLICY_LABEL: Record<CaPolicyName, string> = {
  standards_of_conduct: "Standards of Conduct",
  attendance: "Attendance",
  late_opening: "Late Opening",
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
  /**
   * Where the suggestion came from. `sales_performance` and `msb` only with
   * CA_SALES_POLICY_ENABLED on: the account reads as the Under Performance
   * offense type, or uses a glossary term (MSB). See `withSalesPolicy`.
   */
  source: "stated" | "incident" | "sales_performance" | "msb" | "woven" | null;
  /** WOVEN_TRAINING_CONDUCT_ENABLED: the manager's words that say the Woven work was not done ("not signing the woven policies"). */
  woven?: string;
  /** Policies to ask between, when the account reads more than one way and none was named. */
  ambiguous: CaPolicyName[] | null;
  /** A scheduled meeting, seminar or training session the account says was not attended: "the monthly meeting". */
  missedEvent: string | null;
  /**
   * CA_SALES_POLICY_ENABLED: cleaning left undone is the form's Other box, not
   * the Standards of Conduct (Pau's ruling; `withCleaningOther`). Absent off.
   */
  other?: "cleaning";
  /**
   * AS_YOU_SAID_APP_READ_ENABLED: the policy the app's own lines on the turn named, when the manager's words name
   * none (AS_YOU_SAID_MANAGER_WORDS_ENABLED reads only the manager's). Said as a reading, never "as you said".
   */
  readFromApp?: CaPolicyName;
}

/* ------------------------------------------------------------ the words -- */

function normalize(text: string): string {
  return (text ?? "").replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').toLowerCase();
}

/**
 * Sentences, with every question dropped whole — a question names no policy.
 *
 * A REQUEST ASKED AS A QUESTION STILL SAYS WHAT HAPPENED. QA, 22 Oct 2026,
 * round 3: "Can we put <employee> on a written for skipping the 10/20/26
 * meeting?" — the account is in the request, and dropping it left the missed
 * meeting uncited. Only a request ("can we / could you / will you … for …"),
 * never a question about what the policy is.
 */
const REQUEST_QUESTION =
  /^(?:hey,?\s+)?(?:can|could|would|will)\s+(?:we|you|i)\s+(?:please\s+)?(?:put|write|do|start|issue|give|create|make|draft|file|document|doc|log|get)\b/;

function statements(turn: string): string[] {
  const out: string[] = [];
  for (const match of turn.matchAll(/[^.!?\n]+[.!?]*/g)) {
    const sentence = match[0].trim();
    if (sentence === "" || (/\?\s*$/.test(sentence) && !REQUEST_QUESTION.test(sentence))) continue;
    out.push(sentence);
  }
  return out;
}

const FAILED = String.raw`(?:did ?n[o']?t|didn't|never|failed to|has ?n[o']?t|hasn't|have ?n[o']?t|haven't|had ?n[o']?t|hadn't|was ?n[o']?t able to|wasn't able to|neglected to|is ?n[o']?t|isn't)`;

/** What an assigned piece of work is called. */
const TASK_NOUN = String.raw`(?:tasks?|assignments?|assigned work|duties|duty|checklists?|training|trainings|modules?|courses?|items?|paperwork|cleaning|disinfect\w*|projects?|reports?|requirements?|woven)`;

/*
 * CONDUCT_INCIDENT_CITES_PAGE_ENABLED (QA's live tester, 8 Nov 2026, the managers' Woven wordings): "This would be a
 * verbal due to not completing her woven courses by the deadline" read as no conduct topic at all: FAILED does not
 * take a bare "not" ("not completing"). With the flag on, "not completing / not finishing <a task noun>" is unfinished
 * assigned work too. Off, as before.
 */
const NOT_COMPLETING_TASK = new RegExp(String.raw`\b(?:not|never)\s+(?:complet|finish)\w*\s+(?:\S+\s+){0,3}?${TASK_NOUN}\b`);

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
      String.raw`\b${FAILED}\s+(?:\S+\s+){0,2}?(?:complete|completed|finish|finished|do|done|turn in|turned in|submit|submitted)\b[^.;!?\n]{0,40}?\b${TASK_NOUN}|\b(?:incomplete|unfinished|uncompleted|left undone|left unfinished)\s+(?:\S+\s+){0,2}?${TASK_NOUN}|\b(?:(?:blew|blown|blow(?:s|ing)?)\s+off|skip(?:ped|ping|s)?|ignor(?:ed|es|ing))\s+(?:\S+\s+){0,2}?${TASK_NOUN}\b(?!\s+(?:sessions?|class(?:es)?|meetings?))|\b${TASK_NOUN}\s+(?:\S+\s+){0,3}?(?:incomplete|unfinished|not (?:completed|finished|done))\b|\bpolicy acknowledgements?\b`,
    ),
  },
  {
    topic: "direction",
    pattern: new RegExp(
      String.raw`\b(?:${FAILED}|refused to|would ?n[o']?t|wouldn't|won't)\s+(?:\S+\s+){0,2}?follow\s+(?:\S+\s+){0,3}?(?:directions?|instructions?|directives?|requests?)\b|\binsubordinat\w*|\bignored\s+(?:\S+\s+){0,3}?(?:directions?|instructions?|requests?)\b|\b(?:was|were)\s+(?:told|directed|instructed|asked)\s+to\b[^.;!?\n]{0,80}?\b(?:did ?n[o']?t|didn't|never|refused|failed)\b`,
    ),
  },
];

/*
 * POLICY_CLEANING_INCIDENT_ENABLED: DUTIES LEFT UNDONE, IN THE WORDS MANAGERS
 * USE (QA T5, 25 Oct 2026): "cleaning duties not being completed", "weren't
 * done", "didn't get done". Duties are the Standards of Conduct; cleaning is
 * the manual's Care and Cleaning of Equipment and Facilities section
 * (`cleaningIncident`, `named-policy-section.ts`), chosen here and not by the
 * model, so the same chat cites the same section every run (QA item 9).
 */
const UNDONE_DUTIES = new RegExp(
  String.raw`\b${TASK_NOUN}\s+(?:\S+\s+){0,4}?(?:(?:were|was|are|is|been)\s+not\s+(?:being\s+)?|(?:were ?n[o']?t|weren't|was ?n[o']?t|wasn't|are ?n[o']?t|aren't|is ?n[o']?t|isn't)\s+(?:being\s+)?|not\s+being\s+|(?:did ?n[o']?t|didn't|never)\s+(?:get|got)\s+|never\s+(?:got|get)\s+)(?:completed|done|finished)\b`,
);

/** Cleaning, sanitizing or the equipment — the words that make it Care and Cleaning. */
const CLEANING_WORD =
  String.raw`(?:clean(?:ing|ed|s)?|san[ai]?t[ai]?[zs]\w*|disinfect\w*|wip(?:e|ed|ing)\s+down|mop(?:ped|ping)?|sweep(?:ing)?|swept|vacuum\w*|dust(?:ing|ed)?)`;
const CLEANING_UNDONE = [
  new RegExp(
    String.raw`\b${CLEANING_WORD}\b[^.;!?\n]{0,40}?(?:(?:were|was|are|is|been)\s+not\s+(?:being\s+)?|(?:were ?n[o']?t|weren't|was ?n[o']?t|wasn't|are ?n[o']?t|aren't|is ?n[o']?t|isn't)\s+(?:being\s+)?|not\s+being\s+|(?:did ?n[o']?t|didn't|never)\s+(?:get|got)\s+)(?:completed|done|finished)\b`,
  ),
  new RegExp(String.raw`\b(?:${FAILED}|not)\s+(?:\S+\s+){0,3}?(?:complete|completed|finish|finished|do|done)\b[^.;!?\n]{0,30}?\b${CLEANING_WORD}\b`),
  new RegExp(String.raw`\b(?:${FAILED}|not)\s+(?:\S+\s+){0,2}?${CLEANING_WORD}\b`),
  // "skipped the 10 minute sanitize"
  new RegExp(String.raw`\b(?:skipped|skips|skipping)\s+(?:\S+\s+){0,4}?${CLEANING_WORD}\b`),
  /\bleft\s+(?:\S+\s+){0,4}?(?:dirty|unclean|filthy|a\s+mess|messy|uncleaned|unsanitized)\b/,
  /\b(?:dirty|unclean|filthy|uncleaned|unsanitized)\s+(?:\S+\s+){0,1}?(?:beds?|booths?|rooms?|equipment|lobby|restrooms?|bathrooms?|floors?|counters?|stations?|machines?|units?|towels?|break\s?room)\b/,
  // "she left without cleaning the restrooms" (QA-7, 26 Oct 2026)
  new RegExp(
    String.raw`\b(?:left|leaves|leaving|went\s+home|clocked\s+out|closed(?:\s+up)?)\s+(?:\S+\s+){0,3}?without\s+(?:\S+\s+){0,2}?${CLEANING_WORD}\b`,
  ),
];

/*
 * CLEANING_OTHER_EVERY_WORDING_ENABLED (6 Nov 2026): "for not completing his daily cleaning duties" — the
 * same reading as `CLEANING_UNDONE`'s "not complete … cleaning", in the -ing form. Read with that pattern's
 * denial guards (index 1). Off, never read.
 */
const CLEANING_UNDONE_GERUND = new RegExp(
  String.raw`\b(?:${FAILED}|not)\s+(?:\S+\s+){0,3}?(?:completing|finishing|doing)\b[^.;!?\n]{0,30}?\b${CLEANING_WORD}\b`,
);

/**
 * Whether the account says cleaning was left undone: "the cleaning didn't get
 * done", "left the beds dirty". Questions are not accounts. Off, never.
 */
export function cleaningIncident(rawText: string): boolean {
  return cleaningIncidentPhrase(rawText) !== null;
}

/*
 * NOT AN ACCOUNT OF CLEANING LEFT UNDONE (QA-6, 26 Oct 2026): "she never left
 * the beds dirty", "the beds were not left dirty", "no dirty beds", "she did
 * not fail to clean the beds", "it is not about cleaning, she was late", "not
 * cleaning, attendance", "she is not responsible for cleaning". A negation
 * just before the incident words, in the same clause, undoes them; a
 * "failure" that is about the topic or a double negative is not one; a bare
 * "not" counts only before what was not done ("not cleaned").
 */
const NEGATED_INCIDENT = /\b(?:never|not|no|no\s+one|nobody|none|did ?n[o']?t|didn't|was ?n[o']?t|wasn't|were ?n[o']?t|weren't)\s+(?:\S+\s+){0,3}$/;
const NOT_A_FAILURE = /\b(?:about|responsible|regarding|related|fail|forget|neglect|skip|miss|only|just)\b/;
/**
 * A negation before a refusal or failure word is a denial, not an incident
 * (QA-3, QA-7, 26 Oct 2026): "never refused to clean", "did not refuse to
 * clean", "never skipped cleaning", "never failed to clean", "never skips the
 * cleaning", "never left without cleaning".
 */
const DOUBLE_NEGATIVE =
  /^(?:never|not|did ?n[o']?t|didn't|has ?n[o']?t|hasn't|have ?n[o']?t|haven't|had ?n[o']?t|hadn't|is ?n[o']?t|isn't)\s+(?:\S+\s+){0,3}?(?:refus\w*|skip\w*|fail\w*|miss\w*|forg[eo]t\w*|neglect\w*|declin\w*|avoid\w*|without)\b/;
const DONE_WORD = /\b(?:cleaned|san[ai]?t[ai]?[zs]ed|disinfected|wiped\s+down|mopped|swept|vacuumed|dusted)\b/;
/** The patterns above that say what happened ("left … dirty", "dirty beds", "skipped …"), not that something failed. */
const AFFIRMATIVE_PATTERNS = new Set([3, 4, 5, 6]);

function clauseBefore(sentence: string, index: number): string {
  return sentence.slice(0, index).split(/[,;:–—]|\s-\s|\bbut\b/).pop() ?? "";
}

function readsAsIncident(sentence: string, match: RegExpExecArray, pattern: number): boolean {
  const before = clauseBefore(sentence, match.index);
  if (AFFIRMATIVE_PATTERNS.has(pattern)) return !NEGATED_INCIDENT.test(before);
  if (pattern === 1 || pattern === 2) {
    if (NOT_A_FAILURE.test(match[0]) || DOUBLE_NEGATIVE.test(match[0])) return false;
    if (NEGATED_INCIDENT.test(before)) return false;
    if (pattern === 2 && /^not\b/.test(match[0]) && !DONE_WORD.test(match[0])) return false;
  }
  return true;
}

/** The manager's words that say the cleaning was left undone, as written, or null. */
export function cleaningIncidentPhrase(rawText: string): string | null {
  if (!policyCleaningIncidentEnabled()) return null;
  return cleaningUndonePhrase(rawText);
}

/**
 * The same reader, whatever POLICY_CLEANING_INCIDENT_ENABLED says: CA_SALES_POLICY_ENABLED's
 * cleaning-is-Other rule (`withCleaningOther`) reads the cleaning with these
 * patterns and no others.
 */
export function cleaningUndonePhrase(rawText: string): string | null {
  for (const sentence of statements(normalize(rawText))) {
    for (const [index, pattern] of CLEANING_UNDONE.entries()) {
      const match = pattern.exec(sentence);
      if (match && readsAsIncident(sentence, match, index)) return match[0].trim();
    }
    if (cleaningOtherEveryWordingEnabled()) {
      const match = CLEANING_UNDONE_GERUND.exec(sentence);
      if (match && readsAsIncident(sentence, match, 1)) return match[0].trim();
    }
  }
  return null;
}

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
 * Standards of Conduct. The manual's own Attendance section says otherwise —
 * it counts meetings, seminars and training sessions as scheduled shifts —
 * and its Seminar/Webinar Attendance section calls a missed one a no call no
 * show.
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
/*
 * THE EVENT, in the words managers use for one: "meeting", "mtg", "all-staff",
 * "1:1", "seminar", "webinar", "huddle", "orientation", a training session or
 * class. "Training" alone is an event only when it is attended or missed —
 * "the training deadline" and "training modules" are work (`NOT_THE_EVENT`).
 */
const EVENT_NOUN = String.raw`(?:meetings?|mtgs?|mtng|all[- ]staff|all[- ]hands|one[- ]on[- ]ones?|1[:-]on[:-]1|1:1s?|seminars?|webinars?|huddles?|orientation|trainings?(?:\s+(?:sessions?|classes?|meetings?|days?))?|(?:training\s+)?(?:sessions?|classes?))`;
const NOT_THE_EVENT = String.raw`(?!\s*(?:deadlines?|due|modules?|items?|videos?|courses?|assignments?|requirements?|quiz\w*|workbooks?|notes?|minutes|agenda|materials?|tasks?|checklists?|binders?|links?|emails?|invites?|requests?)\b)`;
/*
 * WHAT SAYS SHE WAS NOT THERE, before the event: missed, skipped, blew off,
 * bailed on, a no-show, absent from, wasn't at, or a negated attending verb
 * (didn't attend / show up / make it / come / join / log in / dial in …).
 */
const ABSENT_BEFORE = String.raw`(?:miss(?:ed|es|ing)?|skip(?:ped|s|ping)?(?:\s+out\s+on)?|blew\s+off|blown\s+off|bail(?:ed|s)?\s+(?:out\s+)?on|ditch(?:ed|es)?|no[- ]?call[,/ -]*(?:and\s+)?no[- ]?show(?:ed)?(?:\s+(?:to|for|at|on))?|no[- ]?call(?:ed)?\s+(?:to|for|at|on)|no[- ]?show(?:ed)?(?:\s+(?:to|for|at|on))?|absent\s+(?:from|for|at)|(?:was|were|is)\s+(?:not|n't)\s+(?:at|present\s+(?:at|for)|in\s+attendance\s+(?:at|for))|(?:wasn't|weren't|isn't)\s+(?:at|present\s+(?:at|for)|in\s+attendance\s+(?:at|for))|(?:${FAILED}|not|never|without|n't)\s+(?:\S+\s+)?(?:attend(?:ing|ed|s)?|show(?:ing|ed|s)?(?:\s+up)?|c[oa]me|coming|go|went|going|ma(?:k|d)e\s+it|make|join(?:ing|ed|s)?|turn(?:ed|ing)?\s+up|appear(?:ed|ing)?|log(?:ged)?\s+(?:in|on)|dial(?:ed|led)?\s+in|call(?:ed)?\s+in)(?:\s+(?:to|for|at|in|into|on))?)`;
/* What says it after the event: "the monthly meeting, which she missed". */
const ABSENT_AFTER = String.raw`(?:miss(?:ed|es)|skipped|blew\s+off|bailed\s+on|no[- ]?showed|(?:did ?n[o']?t|didn't|never)\s+(?:attend|show(?:\s+up)?|come|go|make\s+it)|(?:was|were)\s*(?:not|n't)\s+(?:at|there|present)|wasn't\s+(?:at|there|present)|was\s+absent)`;
/* Words that put the event as the setting of something else: "rude DURING the meeting". */
const GAP_WORD = String.raw`(?!(?:during|in|while|after|before|throughout|since|until|because|but|and|so|then|where|when|who|which|that)\b)\S+\s+`;
const MISSED_EVENT_BEFORE = new RegExp(
  String.raw`\b${ABSENT_BEFORE}\s+((?:${GAP_WORD}){0,4}?${EVENT_NOUN})\b${NOT_THE_EVENT}`,
);
const MISSED_EVENT_AFTER = new RegExp(
  String.raw`\b((?:${GAP_WORD}){0,3}?${EVENT_NOUN})\b${NOT_THE_EVENT}(?:\s+(?:on|at|from)\s+\S+|\s+[\d/.-]+)?[\s,–—-]+(?:(?:which|that)\s+)?(?:(?:she|he|they|[a-z]+)\s+)?${ABSENT_AFTER}\b`,
);

/** Leading words that place the event rather than name it: "the", "her", "last", "tuesday's". */
const EVENT_LEAD = /^(?:(?:the|a|an|her|his|their|our|this|that|last|next|yesterday['’]?s|today['’]?s|[a-z]+day['’]?s|[a-z]+day|todays|yesterdays)\s+)+/;

function missedEventIn(sentences: readonly string[]): string | null {
  for (const sentence of sentences) {
    for (const clause of sentence.split(/;|:\s|\s+(?:but|however)\s+/)) {
      const match = MISSED_EVENT_BEFORE.exec(clause) ?? MISSED_EVENT_AFTER.exec(clause);
      if (match) return match[1]!.replace(EVENT_LEAD, "").trim();
    }
  }
  return null;
}

/**
 * A POLICY NAMED. The Standards of Conduct is a policy's name wherever it
 * appears; the others are also everyday words ("her attendance", "out of dress
 * code"), so they count only as an answer — a short reply, or a sentence that
 * frames them as the policy.
 */
const NAMED: { name: CaPolicyName; pattern: RegExp; alwaysAPolicy: boolean; enabled?: () => boolean }[] = [
  { name: "standards_of_conduct", pattern: /\b(?:standards? of conduct|code of conduct)\b/, alwaysAPolicy: true },
  { name: "under_performance", pattern: /\b(?:under[- ]?performance|underperforming)\b/, alwaysAPolicy: false },
  /*
   * LATE OPENING IS ITS OWN POLICY. "late opening" and "opened late" are the
   * manual's Late Opening section, not the Attendance section. A late arrival
   * ("she was late") is not this name.
   */
  {
    name: "late_opening",
    pattern: /\blate[- ]open(?:ing|ed|er)?\b|\bopen(?:ed|ing)\s+late\b/,
    alwaysAPolicy: true,
  },
  /* "late to open" is the same section (QA, 24 Oct 2026; LATE_OPEN_DATE_ENABLED). */
  { name: "late_opening", pattern: new RegExp(LATE_TO_OPEN.source), alwaysAPolicy: true, enabled: lateOpenOn },
  { name: "attendance", pattern: /\b(?:attendance|tardiness|absenteeism)\b/, alwaysAPolicy: false },
  { name: "dress_code", pattern: /\bdress code\b/, alwaysAPolicy: false },
  /* "wore leggings" names the dress code when the manager does not say those words. */
  { name: "dress_code", pattern: /\bwore\s+leggings\b/, alwaysAPolicy: true },
  { name: "company_policies", pattern: /\bviolation of company polic(?:y|ies)\b/, alwaysAPolicy: true },
];
const POLICY_FRAME =
  /\b(?:polic(?:y|ies)|violat\w*|falls? under|under|use|it'?s|it is|should be|applies|apply|is the|was the)\b/;
/* "wore jeans against dress code" — the policy broken, straight after "against" (QA, 22 Oct 2026, round 3). */
const AGAINST_BEFORE = /\b(?:against|breaking|broke|breaks)\s+(?:the\s+|our\s+|company\s+)?$/;
const NEGATED_BEFORE = /\b(?:not|never|isn't|is not|wasn't|was not|no)\s+(?:\S+\s+){0,2}$/;
/*
 * FORM_EDIT_DATE_RULES_ENABLED: "reference the late opening policy INSTEAD of
 * the attendance policy" names Late Opening (QA replay, conv_mvnt5u7l2b5u91t,
 * read "Policy: Attendance, as you said"). A policy named after "instead of",
 * "rather than", "in place of" or "replace" is the one set aside.
 */
const SET_ASIDE_BEFORE = /\b(?:instead\s+of|rather\s+than|in\s+place\s+of|replac(?:e|ing)|remov(?:e|ing)|swap\s+out)\s+(?:the\s+|our\s+|that\s+)?$/;

/*
 * REMOVE_POLICY_NOT_NAMED_ENABLED (A1, QA 6 Nov 2026; the flip-3 tester): "take the attendance policy off the
 * form" got "Policy: Attendance, as you said": the verb's "off" comes after the policy, so SET_ASIDE_BEFORE never
 * saw it. With the flag on, a policy between "take / get / pull" and "off / out", or after "drop / delete /
 * strip", is the one set aside too. Off, as before.
 */
const TAKEN_OFF_BEFORE = /\b(?:take|taking|get|getting|pull|pulling)\s+(?:the\s+|our\s+|that\s+)?$/;
const TAKEN_OFF_AFTER = /^\s*(?:polic(?:y|ies)\s+)?(?:off|out)\b/;
const DROPPED_BEFORE = /\b(?:drop|dropping|delete|deleting|strip|stripping)\s+(?:the\s+|our\s+|that\s+)?$/;

function takenOff(sentence: string, start: number, end: number): boolean {
  if (!removePolicyNotNamedEnabled()) return false;
  const before = sentence.slice(0, start);
  return DROPPED_BEFORE.test(before) || (TAKEN_OFF_BEFORE.test(before) && TAKEN_OFF_AFTER.test(sentence.slice(end)));
}

function statedIn(turn: string): CaPolicyName | null {
  let found: { name: CaPolicyName; at: number } | null = null;
  const short = turn.split(/\s+/).filter(Boolean).length <= 8;
  for (const sentence of statements(turn)) {
    for (const { name, pattern, alwaysAPolicy, enabled } of NAMED) {
      if (enabled && !enabled()) continue;
      const match = pattern.exec(sentence);
      if (!match) continue;
      if (NEGATED_BEFORE.test(sentence.slice(0, match.index))) continue;
      if (formEditDateRulesEnabled() && SET_ASIDE_BEFORE.test(sentence.slice(0, match.index))) continue;
      if (takenOff(sentence, match.index, match.index + match[0].length)) continue;
      /*
       * SALES_SHORTFALL_OBJECT_ENABLED (QA, 6 Nov 2026: "sales underperformance"): "under performance" is framed by its own
       * "under" (POLICY_FRAME), so the one-word spelling is read the same way. Off, it needs a frame like any other name.
       */
      const framedByItsSpelling = name === "under_performance" && salesShortfallObjectEnabled() && /^underperform/.test(match[0]);
      if (!alwaysAPolicy && !short && !framedByItsSpelling && !POLICY_FRAME.test(sentence) && !AGAINST_BEFORE.test(sentence.slice(0, match.index))) {
        continue;
      }
      // The last policy named in the turn is its answer: "not attendance — standards of conduct".
      const at = turn.indexOf(sentence) + match.index;
      if (!found || at >= found.at) found = { name, at };
    }
  }
  return found?.name ?? null;
}

/**
 * PROPOSAL_POLICY_SET_ASIDE_ENABLED (`forms/policy-set-aside.ts`): every policy this sentence names by name, where
 * it is in the sentence. Read the same way `statedIn` reads a name, with no frame needed; the caller decides what the
 * sentence does with it.
 */
export function policiesNamedIn(sentence: string): { name: CaPolicyName; start: number; end: number }[] {
  const text = normalize(sentence);
  const found: { name: CaPolicyName; start: number; end: number }[] = [];
  for (const { name, pattern, enabled } of NAMED) {
    if (enabled && !enabled()) continue;
    const match = pattern.exec(text);
    if (match && !found.some((seen) => seen.name === name)) found.push({ name, start: match.index, end: match.index + match[0].length });
  }
  return found;
}

/* ------------------------------------------------------------- reading -- */

/**
 * Everything the manager's turns say about which policy applies.
 *
 * The turns arrive joined by `JOIN`, oldest first, exactly as the proposal and
 * the drafting notes carry them.
 */
export function readCaPolicy(rawText: string): CaPolicyReading {
  const said = managerWords(rawText);
  // Merge of main into #595: WOVEN_TRAINING_CONDUCT's reading (default off) before AS_YOU_SAID_APP_READ's fallback, on the manager's words.
  return withAppReading(withWovenWork(withCleaningOther(withSalesPolicy(readCaPolicyFromWords(said), said), said), said), rawText, said);
}

/**
 * ============================================================================
 * WOVEN WORK NOT DONE IS THE STANDARDS OF CONDUCT
 * (WOVEN_TRAINING_CONDUCT_ENABLED, default off; Pau's ruling, 6 Nov 2026)
 * ============================================================================
 *
 * Three managers, the same thing — assigned Woven policy acknowledgements not
 * completed by the deadline — and three answers: "not signing the woven
 * policies by 10-30-26" said no policy at all; "was assigned to complete policy acknowledgements in Woven
 * by 10-31-26. <first> failed to meet the 10-31-26 deadline" was a tentative
 * suggestion; "did not complete the assigned policy acknowledgements in Woven
 * by the 10-31-26 deadline" was tentative too, and "not signing" said no
 * policy at all. Pau: always the Standards of Conduct, with the
 * manual's section and page.
 *
 * A SENTENCE THAT NAMES WOVEN AND SAYS THE WORK WAS NOT DONE — by the readings
 * above (unfinished work, policy acknowledgements, a missed deadline), or
 * by `NOT_DONE` (a negated sign / complete / acknowledge) — or one that names
 * Woven work as assigned or required beside a deadline missed elsewhere in the
 * account. Woven is where assigned acknowledgements and training live, so the
 * word is enough to know whose work it was; nothing else is listed.
 *
 * WHAT IT LEAVES ALONE: a policy the manager named (other than Under
 * Performance, which the current form records under the Standards of Conduct);
 * a sales or MSB reading. A missed meeting that is Woven training ("missed the
 * woven training") is this, not Attendance. Off, the reading is untouched.
 */
const NOT_DONE = new RegExp(
  String.raw`\b(?:${FAILED}|not|never|without)\s+(?:\S+\s+){0,2}?(?:sign|signs|signed|signing|complete|completes|completed|completing|finish|finished|finishing|acknowledge|acknowledged|acknowledging)\b(?:(?!\s+(?:and|but)\s)[^.;,!?\n])*`,
);
const WOVEN = /\bwoven\b/;
const WOVEN_ASSIGNED = /\b(?:assigned|required|due)\b/;
/*
 * Narrowed (QA's Sunny round-3 gate, 7 Nov 2026): only the acknowledgement CA Pau ruled on — the sentence that
 * names Woven also names the policies or their acknowledgement ("not signing the woven policies", "policy
 * acknowledgements in Woven"). "missed the Woven deadline" or "her Woven training is overdue" alone keep the
 * conduct reading they had (still the Standards of Conduct, as a deadline or a task), and a policy the manager
 * named wins. Before, any Woven sentence with unfinished work or a deadline took this reading, which changed the
 * conduct cases' kind, ticked the box over a named policy, and skipped the manual's fail-closed checks.
 */
const WOVEN_ACKNOWLEDGEMENT = /\b(?:acknowledg\w*|polic(?:y|ies))\b/;
const WOVEN_TOPICS: readonly ConductTopic[] = ["task", "deadline"];

function wovenWork(sentences: readonly string[]): string | null {
  const topicIn = (sentence: string) =>
    CONDUCT_TOPICS.filter(({ topic }) => WOVEN_TOPICS.includes(topic))
      .map(({ pattern }) => pattern.exec(sentence))
      .find((match) => match !== null) ?? null;
  for (const sentence of sentences) {
    if (!WOVEN.test(sentence) || !WOVEN_ACKNOWLEDGEMENT.test(sentence)) continue;
    const said = NOT_DONE.exec(sentence) ?? topicIn(sentence);
    if (said) return said[0].trim();
  }
  if (!sentences.some((sentence) => WOVEN.test(sentence) && WOVEN_ASSIGNED.test(sentence) && WOVEN_ACKNOWLEDGEMENT.test(sentence))) return null;
  const deadline = CONDUCT_TOPICS.find(({ topic }) => topic === "deadline")!.pattern;
  for (const sentence of sentences) {
    const missed = deadline.exec(sentence);
    if (missed) return sentence.slice(Math.max(0, sentence.lastIndexOf(" ", missed.index - 2) + 1)).replace(/[.!]+$/, "").trim();
  }
  return null;
}

function withWovenWork(reading: CaPolicyReading, rawText: string): CaPolicyReading {
  if (!wovenTrainingConductEnabled()) return reading;
  if (isSalesPolicyReading(reading)) return reading;
  // Narrowed (QA's round-3 gate): any policy the manager named wins, and a missed event keeps its own reading.
  if (reading.stated !== null || reading.missedEvent !== null) return reading;
  const woven = wovenWork(statements(normalize(rawText)));
  if (!woven) return reading;
  return {
    ...reading,
    stated: null,
    topics: reading.topics.includes("task") ? reading.topics : [...reading.topics, "task"],
    alternatives: [],
    suggestion: STANDARDS_OF_CONDUCT,
    source: "woven",
    ambiguous: null,
    missedEvent: null,
    woven,
  };
}

/** WOVEN_TRAINING_CONDUCT_ENABLED: Woven work not done, read as the Standards of Conduct. */
export function isWovenWorkReading(reading: CaPolicyReading): boolean {
  return reading.source === "woven";
}

/**
 * AS_YOU_SAID_APP_READ_ENABLED (QA's Sunny gate, 7 Nov 2026; ships with AS_YOU_SAID_MANAGER_WORDS_ENABLED; same flag
 * in both apps; default off). With AS_YOU_SAID on, "make me a CA for <name> for being late to opening this morning"
 * lost its card's Policy line: the only one it had was "Late Opening, as you said", read from the app's own heading
 * line on the turn. On: when the manager's words read as no policy at all and the whole turn (app lines included,
 * as before AS_YOU_SAID) names one, that policy is kept as the app's reading, and the card says it as one
 * (`caPolicyProposalLine`), never "as you said". Off, the reading is returned untouched.
 */
function withAppReading(reading: CaPolicyReading, rawText: string, said: string): CaPolicyReading {
  if (!asYouSaidAppReadEnabled() || said === rawText) return reading;
  if (reading.stated !== null || reading.suggestion !== null || reading.ambiguous || reading.other || reading.missedEvent) return reading;
  const app = readCaPolicyFromWords(rawText).stated;
  return app ? { ...reading, readFromApp: app } : reading;
}

/**
 * ONLY THE MANAGER'S WORDS NAME A POLICY (AS_YOU_SAID_MANAGER_WORDS_ENABLED; live chats, 4 Nov 2026).
 * "Policy reference: Late Opening, JBA Policy Manual p.15." is the app's line — the intent reader's heading,
 * written back onto the turn (`ai/form-state.ts`) — and the card said "Late Opening, as you said" for leaving
 * early. With the flag on, the app's own lines (`ai/app-sentences.ts`) are not read here. Off, as before.
 */
export function managerWords(rawText: string): string {
  return asYouSaidManagerWordsEnabled() ? withoutAppLines(rawText ?? "") : rawText;
}

/**
 * ============================================================================
 * CLEANING LEFT UNDONE IS OTHER, NOT THE STANDARDS OF CONDUCT
 * (CA_SALES_POLICY_ENABLED; Pau's ruling, QA sf-s15, 5 Nov 2026)
 * ============================================================================
 *
 * "Isolde did not complete daily cleaning duties" read as unfinished assigned
 * work, so the card said "this reads as Standards of Conduct" and cited
 * Standards of Conduct p.12, and a draft whose model sent no basis kept that
 * tick. Pau: a cleaning Corrective Action is Other, with no Standards of
 * Conduct. With the flag on, an account read only as that general task
 * incident whose words the cleaning reader matches (`cleaningUndonePhrase`, no
 * new words) keeps its topic but loses the Standards of Conduct suggestion and
 * is marked Other. A policy the manager named, a sales reading, a question
 * between policies, or any other conduct topic leaves it alone. Off, the
 * reading is returned untouched.
 */
function withCleaningOther(reading: CaPolicyReading, rawText: string): CaPolicyReading {
  if (!caSalesPolicyEnabled()) return reading;
  if (reading.stated !== null || reading.ambiguous) return reading;
  /*
   * CLEANING_OTHER_EVERY_WORDING_ENABLED: an account read as nothing else ("for not completing his daily cleaning
   * duties" has no task topic) is Other too, where the cleaning reader reads it. Off, only the task incident.
   */
  const onlyCleaning = cleaningOtherEveryWordingEnabled() && reading.source === null && reading.topics.length === 0 && reading.missedEvent === null;
  if (reading.source !== "incident" && !onlyCleaning) return reading;
  if ((reading.topics.length === 0 && !onlyCleaning) || reading.topics.some((topic) => topic !== "task")) return reading;
  if (cleaningUndonePhrase(rawText) === null) return reading;
  return { ...reading, suggestion: null, source: null, other: "cleaning" };
}

/**
 * ============================================================================
 * SALES AND MSB CORRECTIVE ACTIONS CITE THE STANDARDS OF CONDUCT
 * (CA_SALES_POLICY_ENABLED, default off; client request relayed by Pau,
 * 4 Nov 2026; ported from Ask Bubbles #422)
 * ============================================================================
 *
 * A Corrective Action for sales underperformance or for MSB was created with
 * no policy: the account read as the Under Performance offense type, which
 * cites no section. With the flag on, such an account is read as the Standards
 * of Conduct instead, and the manual's section is cited by heading and page.
 *
 * NO NEW WORDS ARE MATCHED HERE. "Sales performance" is a shortfall the
 * manager stated, read by the reader the progression already uses
 * (`statesMetricShortfall`: a metric named and judged — "the sales floor" is
 * not one), or the manager naming Under Performance; "MSB" is a term of the approved chat
 * glossary (`ai/chat-glossary.ts`, read through `foldsToGlossaryTerm`), not a
 * list kept here.
 *
 * WHAT IT LEAVES ALONE. A policy the manager named other than Under
 * Performance; an account that reads as attendance or a missed meeting. Off,
 * the reading is returned untouched.
 */
/**
 * SALES_SHORTFALL_OBJECT_ENABLED (QA's tester batch 2, 6 Nov 2026: "written CA
 * for <name> on performance", "CA for <name> for performance for october"):
 * "performance" given as the request's reason is the Under Performance topic.
 * It is governed by the reason word ("for", "on", "about", "regarding", "due
 * to"), with only determiners or possessives between, and it ends its phrase:
 * the text ends, or punctuation, a preposition, a month or a date follows. So
 * "performance review" and "a performance improvement plan" are not. Grammar
 * (the closed classes), not a list of offenses.
 */
const REASON_DETERMINER = String.raw`(?:the|a|an|her|his|their|its|my|our|your|this|that|[a-z]+'s)`;
const PHRASE_ENDS = String.raw`(?=\s*$|\s*[.,;:!?)\n]|\s+(?:for|in|on|at|during|since|from|over|of|throughout|through|this|last|past|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*|\d))`;
const PERFORMANCE_AS_REASON = new RegExp(
  String.raw`\b(?:for|on|about|regarding|due to)\s+(?:${REASON_DETERMINER}\s+){0,2}performance\b${PHRASE_ENDS}`,
);

/**
 * SALES_SHORTFALL_OBJECT_ENABLED (Pau, 6 Nov 2026; H18, "<name> 131 tans
 * verbal"): a number directly before a sales count term of the glossary
 * (`isSalesCountTerm`, read from Pau's line) is the metric named and counted.
 */
function countsASalesTerm(rawText: string): boolean {
  return [...normalize(rawText).matchAll(/\b\d[\d,]*\s+([a-z]+)\b/g)].some((match) => isSalesCountTerm(match[1]));
}

function performanceIsTheReason(rawText: string): boolean {
  return statements(normalize(rawText)).some((sentence) => PERFORMANCE_AS_REASON.test(sentence));
}

/**
 * MSB_PHRASE_SOC_ENABLED (Pau, 7 Nov 2026: "create a ca for must see behaviors for <name>" cited no policy; same flag
 * in both apps; default off). The glossary term is matched word by word, so "MSB" was read and the spelled-out
 * "must see behaviors" was not. The spelled-out phrases are the approved table's own: the right side of each
 * "X = <phrase>." line of `CHAT_GLOSSARY`, folded to letters and digits — no list kept here. A singular
 * ("must see behavior") and hyphens ("must-see") fold the same.
 */
const GLOSSARY_PHRASES: readonly string[] = CHAT_GLOSSARY.split("\n")
  .map((line) => /^[A-Za-z0-9][A-Za-z0-9.&-]*\s+=\s+([^.]+)\./.exec(line)?.[1])
  .filter((phrase): phrase is string => Boolean(phrase))
  .map((phrase) => phrase.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/s$/, ""))
  .filter((phrase) => phrase.length >= 6);

function spellsOutGlossaryTerm(sentence: string): boolean {
  const folded = sentence.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return GLOSSARY_PHRASES.some((phrase) => folded.includes(phrase));
}

function withSalesPolicy(reading: CaPolicyReading, rawText: string): CaPolicyReading {
  if (!caSalesPolicyEnabled()) return reading;
  if (reading.stated !== null && reading.stated !== "under_performance") return reading;
  if (reading.missedEvent !== null) return reading;
  const sentences = statements(normalize(rawText));
  const msb =
    sentences.some((sentence) =>
      sentence.split(/[^a-z0-9.]+/).some((word) => foldsToGlossaryTerm(word.replace(/^\.+|\.+$/g, ""))),
    ) ||
    // MSB_PHRASE_SOC_ENABLED: the term spelled out ("must see behaviors") is the term too.
    (msbPhraseSocEnabled() && sentences.some(spellsOutGlossaryTerm));
  // The stated shortfall reader the progression already uses (`corrective-action-intake.ts`): a metric named and judged.
  // Both default-off readings kept (merge of main into #573): CA_PERFORMANCE_REASON's "for performance" request and SALES_SHORTFALL_OBJECT's reason/count.
  const target =
    reading.stated === "under_performance" ||
    statesMetricShortfall(rawText) ||
    performanceIsTheRequest(reading, sentences) ||
    (salesShortfallObjectEnabled() && (performanceIsTheReason(rawText) || countsASalesTerm(rawText)));
  if (!msb && !target) return reading;
  if (reading.stated === null && sentences.some((s) => ATTENDANCE.test(s))) return reading;
  return {
    ...reading,
    stated: null,
    alternatives: reading.alternatives.filter((name) => name !== "under_performance"),
    suggestion: STANDARDS_OF_CONDUCT,
    source: msb ? "msb" : "sales_performance",
    ambiguous: null,
  };
}

/**
 * CA_PERFORMANCE_REASON_ENABLED (QA, coding-3 item 5, 5 Nov 2026; default off;
 * only with CA_SALES_POLICY_ENABLED): "can you write me a Ca for <name> for
 * performance for october" is the sales-performance account. The bare
 * "performance" is not a metric named and judged, and the published template
 * has no Under Performance box to name — so neither reading above saw it, and
 * the card asked what happened.
 *
 * NO NEW WORDS. The sentence must ASK FOR THE CORRECTIVE ACTION (the reading
 * `request-slot.ts` uses, `detectTemplateIntent`, narrowed to this form: "an
 * employee performance plan for …" names performance as its form's own name)
 * and match the EPP reader's existing performance pattern (`namesPerformance`,
 * `epp-policy.ts` — its duties/tasks and evaluation patterns left out, so "for
 * closing duties" stays a task). "Her performance has been great" asks for no
 * form and is left alone. The account must read as nothing else: no conduct
 * topic, no policy named (Under Performance is already `target`), no missed
 * event; attendance is ruled out after, as for every sales reading.
 */
function performanceIsTheRequest(reading: CaPolicyReading, sentences: string[]): boolean {
  if (!caPerformanceReasonEnabled()) return false;
  if (reading.stated !== null || reading.topics.length > 0 || reading.missedEvent !== null) return false;
  return sentences.some((sentence) => namesPerformance.test(sentence) && performanceEndsItsPhrase(sentence) && asksForCorrectiveAction(sentence));
}

/**
 * "performance" ends its phrase wherever it stands (QA's round-4 gate, 8 Nov 2026): "for her performance review" and
 * "for a performance improvement plan" name another thing, so they are no sales-performance account. "for sales
 * performance" and "for performance for october" still are. A sentence without the word (another `namesPerformance`
 * shape, "not meeting her goals") is unchanged.
 */
const PHRASE_END_AFTER = new RegExp(`^${PHRASE_ENDS}`);

function performanceEndsItsPhrase(sentence: string): boolean {
  return [...sentence.matchAll(/\bperformance\b/gi)].every((match) => PHRASE_END_AFTER.test(sentence.slice(match.index + match[0].length)));
}

function asksForCorrectiveAction(sentence: string): boolean {
  const intent = detectTemplateIntent(sentence);
  return intent.kind === "corrective_action" || (intent.kind === "explicit" && intent.templateKey === "dpoa");
}

/**
 * Whether the reading is CA_SALES_POLICY_ENABLED's: a sales or MSB account read as the Standards of Conduct.
 * WOVEN_TRAINING_CONDUCT_ENABLED's reading (Woven work not done) is settled the same way — the box is ticked,
 * nothing is asked — so it counts here too; `isWovenWorkReading` tells it apart.
 */
export function isSalesPolicyReading(reading: CaPolicyReading): boolean {
  return reading.source === "sales_performance" || reading.source === "msb" || reading.source === "woven";
}

function readCaPolicyFromWords(rawText: string): CaPolicyReading {
  const text = normalize(rawText);
  const turns = text.split(JOIN).map((turn) => turn.trim()).filter(Boolean);

  const sentences = statements(text);
  const missedEvent = missedEventIn(sentences);

  let stated: CaPolicyName | null = null;
  for (const turn of turns) stated = statedIn(turn) ?? stated;
  /*
   * A MISSED MEETING IS ATTENDANCE — owner decision, 22 Oct 2026, after the
   * District Manager's 21 Oct report ("not attending the monthly meeting" was
   * written up under Standards of Conduct). An account of missing a meeting,
   * seminar or training reads as Attendance, as if the manager had named it,
   * and ticks Absenteeism; `groundMissedEvent` still finds where the manual
   * says so. A policy the manager does name still wins.
   */
  if (stated === null && missedEvent !== null) stated = "attendance";

  let topics = CONDUCT_TOPICS.filter(({ pattern }) => sentences.some((s) => pattern.test(s))).map(
    ({ topic }) => topic,
  );
  // CONDUCT_INCIDENT_CITES_PAGE_ENABLED: "not completing her woven courses by the deadline" is unfinished assigned work.
  if (conductIncidentCitesPageEnabled() && !topics.includes("task") && sentences.some((s) => NOT_COMPLETING_TASK.test(s))) topics.push("task");
  if (policyCleaningIncidentEnabled()) {
    if (!topics.includes("task") && sentences.some((s) => UNDONE_DUTIES.test(s))) topics.push("task");
    // Cleaning left undone is Care and Cleaning, not the catch-all: the task reading gives way to that section.
    if (cleaningIncident(rawText)) topics = topics.filter((topic) => topic !== "task");
  }

  const alternatives: CaPolicyReading["alternatives"] = [];
  if (topics.length > 0) {
    if (missedEvent || sentences.some((s) => ATTENDANCE.test(s))) alternatives.push("attendance");
    // Revision 8: the current form has no Under Performance box (it is the Standards of Conduct), so a target is no other reading.
    if (sentences.some((s) => TARGET.test(s)) && CURRENT_CA_OFFENSE_KEYS.includes("under_performance")) alternatives.push("under_performance");
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
      // CA_SALES_POLICY_ENABLED: a sales or MSB account ticks the Standards of Conduct. Off, never set.
      return isSalesPolicyReading(reading) ? [STANDARDS_OF_CONDUCT] : null;
    case "attendance": {
      const text = normalize(rawText);
      const absent = ABSENCE.test(text) || missedEventIn(statements(text)) !== null;
      const late = LATENESS.test(text);
      if (absent && late) return ["tardiness", "absenteeism"];
      return absent ? ["absenteeism"] : ["tardiness"];
    }
    case "late_opening":
      /* Late Opening is cited under the Tardiness box. It is not its own checkbox. */
      return ["tardiness"];
    default:
      return [reading.stated];
  }
}

/**
 * Attendance boxes the account itself describes, when the manager did not
 * name Attendance as the policy. Null when the account describes neither
 * lateness nor absence — it does not default every note to tardiness.
 */
export function describedAttendanceKeys(rawText: string): string[] | null {
  const text = normalize(rawText);
  const absent = ABSENCE.test(text);
  const late = LATENESS.test(text);
  if (!absent && !late) return null;
  if (absent && late) return ["tardiness", "absenteeism"];
  return absent ? ["absenteeism"] : ["tardiness"];
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
  // Revision 8: a removed box is ticked as the box that replaced it, where this version offers only that (`offense-keys.ts`).
  const ticked = offeredOffenseKeys(input.keys, input.offered);
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
  late_opening: "**Late Opening**, if it is about opening the salon late",
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
      /** The manual's own sentence the reading rests on, where one was needed, such as the Attendance sentence that counts meetings as scheduled shifts. */
      anchor?: string;
      /** The section `anchor` is from, when it is not `heading`'s. */
      anchorHeading?: string;
      anchorPage?: number;
      /**
       * The manual this section is from, where no owner has confirmed it as
       * Ask Sunny's approved manual (found by its name, not by the
       * `official-policy-manual` tag). Absent when confirmed or not known.
       */
      unconfirmedManual?: string;
    }
  | { phrase: string; lookup: "missing" | "unknown" }
  /** The account describes more than one section the manual titles a Policy: the manager chooses. */
  | { phrase: string; lookup: "choose"; choices: readonly { heading: string; page: number }[] };

/** The offense box a named section is cited under, as the form labels it. */
const OFFENSE_BOX_LABEL: Record<string, string> = {
  attendance_policy: "Attendance Policy",
  tardiness: "Tardiness/Leaving Early",
  absenteeism: "Absenteeism",
  standards_of_conduct: "Standards of Conduct",
  dress_code: "Dress Code Violation",
  company_policies: "Violation of Company Policies",
};

/**
 * The box a section is cited under, as the CURRENT form labels it: a removed
 * box is named as the one that replaced it — except the Standards of
 * Conduct. A specific section (Cell Phone, Visitors, Animals) once cited
 * under Violation of Company Policies is ticked under the Standards of
 * Conduct on revision 8, and Policy Violated says so (Pau, 4 Nov 2026); the
 * chat names the section alone, never "under Standards of Conduct", which
 * reads as citing the catch-all instead of it (District Manager feedback,
 * 21 Oct 2026; eval b6).
 */
/** REPLY_MATCHES_CARD_ENABLED: the Type of Offense labels a box can be cited under that are no longer on the current form. */
export function removedOffenseLabels(): string[] {
  return Object.entries(OFFENSE_BOX_LABEL)
    .filter(([key]) => !CURRENT_CA_OFFENSE_KEYS.includes(key))
    .map(([, label]) => label);
}

function currentBoxLabel(key: string): string | undefined {
  const current = offeredOffenseKey(key, CURRENT_CA_OFFENSE_KEYS) ?? key;
  if (current !== key && current === STANDARDS_OF_CONDUCT) return undefined;
  return OFFENSE_BOX_LABEL[current];
}

function namedPolicyLine(named: NamedPolicyReading): string {
  /*
   * DESCRIBED, BUT AS MORE THAN ONE POLICY — "scrolling social media on her
   * phone" is the Cell Phone/Smart Watch Policy or the Social Media Policy.
   * Asked, never chosen (QA follow-up, 22 Oct 2026).
   */
  if (named.lookup === "choose") {
    const listed = named.choices.map((choice) => `**${choice.heading}** (page ${choice.page})`);
    return `**${CA_POLICY_QUESTION}** What you described reads as more than one section of the policy manual: ${listed.slice(0, -1).join(", ")} or ${listed.at(-1)}. Tell me which — for example "the ${named.choices[0]!.heading.replace(/\s+policy$/i, "").toLowerCase()} policy" — or tick Type of Offense on the form. I won't pick one for you.`;
  }
  /*
   * NOT NAMED, DESCRIBED: "on her cell phone" is the manual's Cell Phone/Smart
   * Watch Policy. Said as a reading the manager can change, not as theirs.
   */
  if (named.lookup === "described") {
    const box = currentBoxLabel(named.offenseKey);
    // The manual's sentence closes this one: `… which says "… scheduled shifts." I'll quote it`.
    const end = named.anchor && /[.!?]$/.test(named.anchor) ? "" : ".";
    const says = !named.anchor
      ? "."
      : named.anchorHeading
        ? `. The manual's ${named.anchorHeading} section (page ${named.anchorPage}) says "${named.anchor}"${end}`
        : `, which says "${named.anchor}"${end}`;
    return `**Policy:** "${named.phrase}" reads as the policy manual's **${named.heading}** (page ${named.page})${says} I'll quote it on the draft${box ? ` under **${box}**` : ""} — tell me if a different policy applies.`;
  }
  if (named.lookup === "found") {
    const box = currentBoxLabel(named.offenseKey);
    return `**Policy:** ${named.heading}, as you said — the policy manual's section on page ${named.page}. I'll quote it on the draft${box ? ` under **${box}**` : ""}.`;
  }
  if (named.lookup === "missing") {
    // WOVEN_TRAINING_CONDUCT_ENABLED: the app says what it did not find; "Woven" is the product, not the one looking.
    // Narrowed (QA's round-3 gate): only for a phrase that is about Woven ("not signing the woven"), where "Woven
    // does not see … for 'not signing the woven'" reads as the product looking. Every other phrase keeps the line.
    if (wovenTrainingConductEnabled() && WOVEN.test(named.phrase.toLowerCase())) {
      return `**Policy:** I don't see a section of the current policy manual for "${named.phrase}" in the knowledge base, so I won't cite one. Tell me the policy as the manual names it, or tick Type of Offense and complete Direct policy on the form.`;
    }
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
/**
 * A manual that is not the JBA Policy Manual, found by name and not tagged.
 *
 * Pau, 23 Oct 2026: the JBA Policy Manual is the approved source. Its section
 * and printed page are the citation. The manager is not asked to confirm it.
 */
export function unconfirmedManualLine(named: NamedPolicyReading | null): string | null {
  if (!named || (named.lookup !== "found" && named.lookup !== "described") || !named.unconfirmedManual) return null;
  if (isApprovedPolicyManualTitle(named.unconfirmedManual)) return null;
  return `**Policy source:** "${named.unconfirmedManual}" — requires owner confirmation as Ask Sunny's approved policy manual. I'll cite it with its section and page; check the wording against your current manual before you finalize.`;
}

export function caPolicyProposalLine(reading: CaPolicyReading, named: NamedPolicyReading | null = null): string | null {
  // CA_SALES_POLICY_ENABLED (`withCleaningOther`): cleaning left undone is the form's Other box. Off, never set.
  if (reading.other === "cleaning") {
    return "**Policy:** Other — cleaning duties left undone are recorded under Other on the Corrective Action Form, not the Standards of Conduct. Tell me if a different policy applies.";
  }
  /*
   * WOVEN_TRAINING_CONDUCT_ENABLED: the manual's section and page, where it was read (`named`, from
   * `describedManualSection`); where the manual could not be read, the policy is still said, not offered.
   */
  if (isWovenWorkReading(reading)) {
    if (named && named.lookup === "described") return namedPolicyLine(named);
    return "**Policy:** Standards of Conduct — required Woven policy acknowledgements or training not completed. I'll cite that section of the current policy manual, with its page, on the draft; tell me if a different policy applies.";
  }
  // CA_SALES_POLICY_ENABLED: a sales or MSB account. Off, the source is never set and this line is never said.
  if (isSalesPolicyReading(reading)) {
    const what = reading.source === "msb" ? "Must See Behaviors (MSB)" : "sales performance against goals";
    return `**Policy:** Standards of Conduct — ${what}. I'll cite that section of the current policy manual, with its page, on the draft; tell me if a different policy applies.`;
  }
  /*
   * A POLICY THE MANAGER NAMED, which the manual answers, is the policy — the
   * draft ticks its box and quotes its section (District Manager feedback,
   * 21 Oct 2026: "violating visitors at work policy" named no policy at all).
   * One the manual does not answer is said so, unless the account still reads
   * as a policy below.
   */
  // A missed meeting reads as Attendance without being named; the manual's section for it is said the same way.
  const readAsAttendance = reading.stated === "attendance" && reading.missedEvent !== null;
  if ((!reading.stated || readAsAttendance) && named && (named.lookup !== "missing" || (!reading.ambiguous && !reading.suggestion))) {
    return namedPolicyLine(named);
  }
  if (readAsAttendance) {
    return `**Policy:** Attendance — missing ${withArticle(reading.missedEvent!)} is an absence from a scheduled shift. I'll quote that section from the current policy manual on the draft; tell me if a different policy applies.`;
  }
  if (reading.ambiguous) {
    const others = reading.alternatives.map((name) => ALTERNATIVE_WORDS[name]);
    const topic = TOPIC_WORDS[reading.topics[0]!];
    return `**${CA_POLICY_QUESTION}** This could fall under **Standards of Conduct** (${topic}) or ${others.join(", or ")}. Tell me which, or tick Type of Offense on the form — I won't pick one for you.`;
  }
  if (reading.suggestion && reading.source === "stated") {
    return "**Policy:** Standards of Conduct, as you said. I'll quote that section from the current policy manual on the draft.";
  }
  if (reading.stated === "attendance" || reading.stated === "dress_code" || reading.stated === "late_opening") {
    return `**Policy:** ${CA_POLICY_LABEL[reading.stated]}, as you said. I'll quote that section from the current policy manual on the draft.`;
  }
  if (
    (reading.stated === "under_performance" || reading.stated === "company_policies") &&
    !CURRENT_CA_OFFENSE_KEYS.includes(reading.stated)
  ) {
    // Revision 8: the form records it under the Standards of Conduct; the box is never offered by its old name.
    return `**Policy:** Standards of Conduct — the Corrective Action Form records ${CA_POLICY_LABEL[reading.stated]} under the Standards of Conduct now. I'll quote that section from the current policy manual on the draft; tell me if a different policy applies.`;
  }
  if (reading.stated === "under_performance" || reading.stated === "company_policies") {
    return `**Policy:** ${CA_POLICY_LABEL[reading.stated]}, as you said. The policy manual has no single section to quote for it, so Direct policy is left for you to complete.`;
  }
  if (reading.suggestion && reading.source === "incident") {
    const what = reading.topics.map((topic) => TOPIC_WORDS[topic]).join(" and ");
    return `**Policy:** this reads as **Standards of Conduct** — ${what}. I'll check it against the current policy manual and quote that section on the draft; if the manual doesn't support it, I'll leave the policy for you. Tell me if a different policy applies.`;
  }
  // AS_YOU_SAID_APP_READ_ENABLED: the policy the app read, said as its reading. Off, never set.
  if (reading.readFromApp) {
    return `**Policy:** ${CA_POLICY_LABEL[reading.readFromApp]} — read from this request. I'll quote that section from the current policy manual on the draft; tell me if a different policy applies.`;
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
  // WOVEN_TRAINING_CONDUCT_ENABLED (Pau, 6 Nov 2026): always the Standards of Conduct; its line is quoted where the manual has one.
  if (input.reading.source === "woven") {
    const line = sectionText(input.chunks, section).split("\n").find((candidate) => ANCHORS.task.some((anchor) => anchor.test(candidate)));
    return { ok: true, section, anchor: line?.trim() ?? null };
  }

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
 *   the event, such as the one that counts meetings as scheduled shifts.
 *
 * Either is cited under Absenteeism, with the sentence it rests on. A manual
 * that says neither — a huddle it never mentions, a re-issued manual, none at
 * all — grounds nothing, and the manager is asked which policy applies.
 */
export type MissedEventGrounding =
  | {
      ok: true;
      section: ManualSection;
      /** The manual's sentence the reading rests on; null where the section is named for the event and says nothing else. */
      anchor: string | null;
      /** Where `anchor` is from, when that is not `section` (the Attendance sentence beside a seminar's own section). */
      anchorSection?: ManualSection;
    }
  | { ok: false; reason: "no_event" | "no_manual" | "not_supported" };

/** The box a meeting not attended is cited under. */
export const MISSED_EVENT_OFFENSE = "absenteeism";

function eventStem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith("sses")) return w.slice(0, -2);
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

/** The words that name a meeting without saying "meeting". */
const MEETING_ALIASES = /^(?:mtgs?|mtng|all[- ]staff|all[- ]hands|one[- ]on[- ]ones?|1[:-]on[:-]1|1:1s?)$/;

/** "monthly meeting" → "meeting"; "training session" → "session"; "all-staff" → "meeting". */
function eventHead(event: string): string {
  if (MEETING_ALIASES.test(event.split(/\s+/).slice(-2).join(" ")) || MEETING_ALIASES.test(event.split(/\s+/).pop() ?? "")) {
    return "meeting";
  }
  const words = event.split(/\s+/).filter(Boolean);
  return eventStem(words[words.length - 1] ?? "");
}

/** The events a manual's attendance sentence may name. */
const EVENT_HEADS = ["meeting", "seminar", "webinar", "training", "session", "huddle", "class"];

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
  // Attendance is what a missed event reads as (owner decision, 22 Oct 2026); any other policy named is the manager's.
  const otherPolicy = input.reading.stated !== null && input.reading.stated !== "attendance";
  if (!event || otherPolicy || input.reading.topics.length > 0) return { ok: false, reason: "no_event" };
  if (!input.chunks || input.chunks.length === 0) return { ok: false, reason: "no_manual" };
  const head = eventHead(event);

  /*
   * THE SENTENCE QUOTED BACK NEVER CLASSIFIES. Calling it a no call no show
   * is the manual's rule for not attending WITHOUT NOTIFYING the
   * Supervisor, and whether she notified anyone is a fact the manager has not
   * given. It is quoted on the form as the manual's text, in full; it is not
   * said back as what this was.
   */
  const plain = (sentence: string) => !/\bno[- ]?call\b|\bno[- ]?show\b|\bncns\b/i.test(sentence);
  const attendance = manualSectionsFor({
    chunks: input.chunks,
    offenseKeys: [MISSED_EVENT_OFFENSE],
    jobTitle: input.jobTitle,
  })[0];
  /*
   * A cross-reference ("(See Seminar/Webinar Attendance section)") is not a
   * rule: the sentence quoted is the one that says the event is a scheduled
   * shift — the event's own word first, else any event the sentence names.
   */
  const ruleSentences = attendance
    ? sentencesOf(sectionText(input.chunks, attendance)).filter((s) => plain(s) && !/^\(/.test(s))
    : [];
  const attendanceAnchor = ruleSentences.find((s) => mentions(s, head)) ?? null;
  const anyEventAnchor = ruleSentences.find((s) => EVENT_HEADS.some((event) => mentions(s, event))) ?? null;

  const own = manualSectionHeadings(input.chunks).filter(
    (heading) => /\battend/i.test(heading) && mentions(heading.replace(/\battendance\b/gi, ""), head),
  );
  if (own.length === 1) {
    const section = findManualSection(input.chunks, own);
    if (section) {
      const anchor = sentencesOf(sectionText(input.chunks, section).slice(section.heading.length)).find(
        (s) => mentions(s, head) && plain(s),
      );
      if (anchor) return { ok: true, section, anchor };
      // Beside the event's own section, the attendance sentence about scheduled events says what it is.
      const beside = attendanceAnchor ?? anyEventAnchor;
      return attendance && beside
        ? { ok: true, section, anchor: beside, anchorSection: attendance }
        : { ok: true, section, anchor: null };
    }
  }
  if (attendance && attendanceAnchor) return { ok: true, section: attendance, anchor: attendanceAnchor };
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
  return `This could fall under ${list}, and you didn't say which, so Type of Offense, Policy Violated and Direct policy are left for you. Tell me which policy applies, or tick it on the form.`;
}

/**
 * Said with a draft whose account describes more than one section the manual
 * titles a Policy, where the manager chose none: the draft's own guess is not
 * kept, and the policy is left for them (QA follow-up, 22 Oct 2026).
 */
export function describedPolicyChoiceNotice(choices: readonly { heading: string; page: number }[]): string {
  const listed = choices.map((choice) => `${choice.heading} (page ${choice.page})`);
  return `What you described reads as more than one policy in the manual — ${listed.slice(0, -1).join(", ")} or ${listed.at(-1)} — so the policy is left for you. Tell me which (for example "add the ${choices[0]!.heading}"), or tick Type of Offense and complete Direct policy on the form.`;
}

/*
 * SALES_OBSERVATION_ACCOUNT_ENABLED (with SALES_SHORTFALL_OBJECT_ENABLED; QA's Sunny flip-4 gate, 7 Nov 2026):
 * once "on performance" counts as the account, the request's own words became the card's Observation —
 * "<name> on performance", "performance for october not pay roll deductable". A sentence for the Observation
 * loses the request's head ("can you write me a ca for"), the employee's name where it leads, the request's
 * reason ("on / for performance (for october)") and a payroll answer ("not pay roll deductable"); what is
 * left is the account, or nothing. Off (either flag), the sentence as it is.
 */
const OBSERVATION_REQUEST_HEAD =
  /^(?:(?:hey|hi|ok|okay)[,\s]+)?(?:(?:can|could|would|will)\s+(?:you|we|i)\s+(?:please\s+)?)?(?:(?:make|write|create|do|draft|start|give|get|put)\s+(?:me\s+)?)?(?:(?:a|an)\s+)?(?:(?:written|verbal|final)\s+)?(?:corrective\s+action(?:\s+form)?|ca|c\/a|write[- ]?up|warning)\s+(?:for|on)\s+/i;
const OBSERVATION_REASON = new RegExp(
  String.raw`(?:^|\s)(?:on|for|about|regarding|due to)\s+(?:${REASON_DETERMINER}\s+){0,2}(?:under[- ]?)?performance\b(?:\s+(?:for|in|during)\s+(?:the\s+month\s+of\s+)?[a-z]+)?`,
  "gi",
);
/** The reason with its "for" already cut off upstream: "performance for october …" at the start of a sentence. */
const OBSERVATION_BARE_REASON = /^\s*(?:under[- ]?)?performance\b(?:\s+(?:for|in|during)\s+(?:the\s+month\s+of\s+)?[a-z]+)?/i;
const OBSERVATION_PAYROLL = /\b(?:(?:not|no)\s+)?pay\s*roll\s+deduct\w*(?:\s+applicable)?\b|\b(?:not|no)\s+(?:a\s+)?pay\s*roll\s+deduction\b/gi;

export function observationAccount(sentence: string, employeeName: string | null): string {
  if (!salesObservationAccountEnabled() || !salesShortfallObjectEnabled()) return sentence;
  const trimmed = sentence.trim();
  let text = trimmed.replace(OBSERVATION_REQUEST_HEAD, "");
  const wasRequest = text !== trimmed;
  const own = new Set((employeeName ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  const words = text.split(/\s+/);
  let lead = 0;
  while (lead < words.length && own.has(words[lead]!.toLowerCase().replace(/[^\p{L}'’-]/gu, ""))) lead += 1;
  // The name goes only where the sentence is the request ("<name> on performance"); "<name> was rude to a guest" keeps it.
  const reasonAtStart = new RegExp(`^${OBSERVATION_REASON.source}`, "i");
  const reasonFollows = reasonAtStart.test(` ${words.slice(lead).join(" ")}`);
  if (lead > 0 && (wasRequest || reasonFollows)) words.splice(0, lead);
  text = words.join(" ");
  /*
   * ONLY THE REQUEST CLAUSE IS CUT (QA's round-4 gate, 8 Nov 2026): the reason and a payroll answer were cut
   * wherever they stood, so "This is for Under Performance on PPTA, …" became "This is on PPTA, …" and "…payroll
   * deduct applies and $3.25 will be deducted" lost "payroll deduct". The reason goes only where it opens the request
   * (after its head or the employee's name). A sentence that is nothing but a reason and a payroll answer
   * ("performance for october not pay roll deductable") is the request's, and nothing is left. Every other word is the
   * manager's and stays.
   */
  const clean = (value: string) => value.replace(/\s{2,}/g, " ").replace(/^[\s,.;:-]+|[\s,;:-]+$/g, "").trim();
  const isAccount = (value: string) => /\p{L}{3,}/u.test(value) && value.split(/\s+/).length >= 2;
  OBSERVATION_PAYROLL.lastIndex = 0;
  const leftover = clean(` ${text}`.replace(reasonAtStart, " ").replace(OBSERVATION_BARE_REASON, " ").replace(OBSERVATION_PAYROLL, " "));
  OBSERVATION_PAYROLL.lastIndex = 0;
  if (!isAccount(leftover)) return "";
  const account = clean(wasRequest || lead > 0 ? ` ${text}`.replace(reasonAtStart, " ") : text);
  return isAccount(account) ? account : "";
}
