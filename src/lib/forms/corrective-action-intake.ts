/**
 * ============================================================================
 * WHAT A CORRECTIVE ACTION FORM NEEDS, AND WHAT THE MANAGER HAS ALREADY SAID
 * ============================================================================
 *
 * Asking for a Corrective Action Form used to produce a paragraph about the
 * performance-management ladder and a request to choose a form — to a manager
 * who had just chosen one. What they wanted was the thing the previous
 * generation of this product did well and nothing else about it did: ask for
 * the seven details, then build the form.
 *
 * This module is the seven details. It is PURE and browser-safe on purpose —
 * the same reading has to be available to the preview provider — and it decides
 * nothing: it reports which details are present in the manager's own words and
 * leaves every consequence to the caller.
 *
 * ============================================================================
 * THE RULE THAT MAKES IT USABLE: ASK ONCE, FOR WHAT IS MISSING
 * ============================================================================
 *
 * A manager who answers
 *
 *     1. Sarah Test
 *     2. Kearny
 *     3. today
 *     4. she was wearing a mini skirt
 *     5. verbal warning
 *     6. first time
 *
 * has answered six of seven, and being asked all seven again is the single
 * most irritating thing a form assistant can do. So every item carries its own
 * test, run over the manager's turns, and only what genuinely did not arrive is
 * asked for a second time. The seventh — the job title — is OPTIONAL and never
 * holds the form up; the template has no field for it, and stopping for it
 * would be inventing a requirement the document does not have.
 *
 * ============================================================================
 * WHY THE TESTS ARE DELIBERATELY GENEROUS
 * ============================================================================
 *
 * The asymmetry runs the opposite way from most of the guards in this codebase.
 * Nothing here writes to a form: reading an answer as present when it was not
 * costs a question that should have been asked, and the manager sees the empty
 * field on the draft in front of them and fills it. Reading a present answer as
 * missing costs the exact friction this module exists to remove, and it happens
 * on every turn until they phrase it the way a regex wanted.
 *
 * So a detector fires on the shapes people actually type — "first time",
 * "verbal", "she was late" — rather than on a canonical form. What it must
 * never do is put a value ON the form; that stays with the drafting route,
 * which reads the manager's words through the model under the policy and
 * narrative guards.
 */

export type IntakeItemKey =
  | "employee_name"
  | "salon"
  | "form_date"
  | "what_happened"
  | "warning_level"
  | "previous_action"
  | "job_title";

export interface IntakeItem {
  readonly key: IntakeItemKey;
  /** The line as Ask Sunny asks for it, without its number. */
  readonly prompt: string;
  /** An optional item is reported as missing but never blocks the form. */
  readonly optional: boolean;
}

/**
 * THE SEVEN, IN THE ORDER THE BUSINESS ASKS THEM.
 *
 * The order is not arbitrary and is not this file's to change: it is the intake
 * managers already know, kept so that a numbered reply lines up with the
 * numbered question. Only the wording moved — "previously disciplined" is now
 * "previous corrective action", which is the same question asked in the
 * business's current terminology.
 */
export const CORRECTIVE_ACTION_INTAKE: readonly IntakeItem[] = [
  { key: "employee_name", prompt: "Employee's full name", optional: false },
  { key: "salon", prompt: "Salon location", optional: false },
  {
    key: "form_date",
    prompt: "Date for the form — say “today” and I'll use today's date",
    optional: false,
  },
  {
    key: "what_happened",
    prompt: "What happened — a clear, factual description of the incident or behaviour",
    optional: false,
  },
  {
    key: "warning_level",
    prompt: "Whether this is a verbal or written warning",
    optional: false,
  },
  {
    key: "previous_action",
    prompt:
      "Whether there has been previous corrective action for this same or related issue, and if so, when",
    optional: false,
  },
  {
    key: "job_title",
    prompt: "Employee's job title, if you have it",
    optional: true,
  },
];

/* ------------------------------------------------------------- matching --- */

/**
 * Lower-cased, with horizontal runs collapsed and NEWLINES KEPT.
 *
 * The line breaks are load-bearing. A manager answering the intake types one
 * item per line, and the bare-adjective test below — "5. verbal" as a whole
 * answer — is anchored to a line for exactly the reason that test exists:
 * "verbal" mid-sentence is an account of a conversation, and "verbal" alone on
 * its own line is the Type of Warning. Collapsing `\s+` erased the anchor and
 * the pattern could never fire.
 */
function normalize(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^\S\n]+/g, " ");
}

function any(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * A date, in the shapes a manager types one.
 *
 * "Today" counts, and it is the commonest answer by a distance — the intake
 * says so in its own prompt. A weekday or a month-and-day counts too; the
 * drafting route is what turns any of them into the form's date, under the
 * rule that it may never invent one the manager did not give.
 */
const DATE_GIVEN: readonly RegExp[] = [
  /\b(?:today|yesterday|tonight|this morning|this afternoon|this evening)\b/,
  /\blast (?:night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  /\b(?:on |this )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+of\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/,
];

/**
 * The warning level, which is the Type of Warning box on the form.
 *
 * The bare adjectives are accepted only as a WHOLE ANSWER — "5. verbal" — and
 * never mid-sentence, because "he gave her a verbal heads-up" is an account of
 * what happened rather than a decision about the document's warning level.
 */
const WARNING_LEVEL_GIVEN: readonly RegExp[] = [
  /\b(?:verbal|written|final)(?:\s+written)?\s+warning\b/,
  /\bwarning\s*(?:level|type)?\s*[:\-=]\s*(?:verbal|written|final)\b/,
  /\b(?:termination|terminate|demotion|demote|suspension|suspend)\b/,
  /(?:^|\n)\s*\d*[.)]?\s*(?:verbal|written)\s*[.?!]?\s*(?:$|\n)/,
];

/** "First time", "no prior write-ups" — a stated ABSENCE is a stated answer. */
const PREVIOUS_NONE: readonly RegExp[] = [
  /\b(?:first|1st)\s+(?:time|occurrence|occasion|offence|offense|incident|instance)\b/,
  /\bthis is (?:her|his|their|the) first\b/,
  /\bno (?:prior|previous|past|earlier)\b/,
  /\bnot(?:hing)? (?:been )?(?:coached|warned|written up|disciplined)\b/,
  /\bnever been (?:coached|warned|written up|disciplined)\b/,
  /\bno (?:coaching|warnings?|write[- ]?ups?|corrective action|discipline)\b/,
  /\bfirst offen[cs]e\b/,
];

/**
 * A stated history, named as one.
 *
 * These say a prior conversation or step HAPPENED, which is both an answer to
 * the intake's sixth question and a conduct signal in its own right.
 */
const PREVIOUS_SOME: readonly RegExp[] = [
  /\b(?:previous(?:ly)?|prior|already|earlier|before)\b[^.\n]{0,40}\b(?:coach|coached|coaching|warn|warned|warning|written up|write[- ]?up|disciplin|corrective action|coaching form|spoke|talked)\b/,
  /\b(?:coached|warned|written up|disciplined|corrected)\b[^.\n]{0,40}\b(?:before|previously|already|last|in|on)\b/,
  /\b(?:second|third|fourth|2nd|3rd|4th|repeat|repeated|recurring|ongoing)\s+(?:time|occurrence|occasion|offence|offense|incident|warning)\b/,
  /\b(?:she|he|they) (?:has|have|had) been (?:coached|warned|written up|disciplined)\b/,
  /\bthis (?:has )?happened (?:again|before)\b/,
];

/**
 * "AGAIN", ON ITS OWN, AND WHY IT IS KEPT APART FROM THE LIST ABOVE.
 *
 * "She was late again" answers the sixth question — the manager has told us
 * there is a history — so it belongs to the intake's reading. It is far too
 * weak to be a CONDUCT SIGNAL, though: "her upgrade rate is down again this
 * month" is a sentence about a number, and counting it as behaviour would
 * defeat the §7 guard on exactly the phrasing managers reach for when they are
 * frustrated about a metric.
 *
 * So it answers the question and it does not settle the basis.
 */
const PREVIOUS_WEAK: readonly RegExp[] = [/\b(?:again|once again)\b/];

/**
 * An account of what happened.
 *
 * TWO WAYS IN, either sufficient: a topic the form has an offense box for, or
 * an observational clause. Neither is a claim that the account is GOOD ENOUGH
 * to draft from — the drafting route enforces its own minimum and its own
 * guards. It is only the difference between a manager who has described
 * something and one who has typed nothing but the form's name.
 */
const INCIDENT_TOPIC: readonly RegExp[] = [
  /\b(?:late|lateness|tardy|tardiness|overslept)\b/,
  /\b(?:left early|leaving early|clocked out early)\b/,
  /\b(?:absent|absence|absenteeism|no[- ]call|no[- ]show|called out|call[- ]?off|missed (?:her|his|their|the) shift)\b/,
  /\b(?:dress code|uniform|attire|skirt|shorts|leggings|jeans|sandals|flip[- ]?flops|name tag|nametag|piercing|hoodie)\b/,
  /\b(?:phone|cell phone|on her phone|on his phone|social media)\b/,
  /\b(?:rude|unprofessional|argued|arguing|shouted|yelled|swore|swearing|disrespect\w*)\b/,
  /\b(?:refus\w+|insubordinat\w+|would not follow|didn't follow|did not follow|ignored (?:my|the) (?:direction|instruction))\b/,
  /\b(?:cash|drawer|register|till|deposit|void|refund|discount)\b/,
  /\b(?:safety|injur\w+|hazard|spill|chemical|sanitiz\w+|sanitis\w+|cleaning|closing duties|opening duties)\b/,
  /\b(?:harass\w+|theft|stole|stealing|dishonest\w*|falsif\w+)\b/,
  /\b(?:standards of conduct|policy violation|violated (?:the|our) polic)\b/,
];

const OBSERVATIONAL_CLAUSE: readonly RegExp[] = [
  /\b(?:she|he|they|the employee|[a-z]+)\s+(?:was|were|has been|have been|had been)\s+\w+/,
  /\b(?:she|he|they)\s+(?:arrived|showed up|came in|left|wore|refused|failed|forgot|ignored|walked out|clocked)\b/,
  /\b(?:didn't|did not|hasn't|has not|wouldn't|would not)\s+\w+/,
  /\bi (?:saw|observed|watched|found|noticed|had to)\b/,
];

/**
 * A job title, in the vocabulary this business uses.
 *
 * The acronyms are matched as whole words — "TC" inside a sentence is a role,
 * "tc" inside a word is not — which is the same rule every short matcher in
 * `template-intent.ts` goes through and for the same reason.
 */
const JOB_TITLE_GIVEN: readonly RegExp[] = [
  /\b(?:tc|asd|sd|sdit|tsd|dmit|fttc|dm)\b/,
  /\b(?:tanning consultant|salon director|assistant salon director|district manager|regional manager|key ?holder|shift lead|manager in training)\b/,
  /\bjob title\s*[:\-=]/,
];

/* -------------------------------------------------------------- reading --- */

export interface IntakeReading {
  /** Items the manager's own words already answer. */
  readonly supplied: IntakeItemKey[];
  /** Everything not yet answered, optional items included, in intake order. */
  readonly missing: IntakeItem[];
  /** The subset that actually holds the form up. */
  readonly missingRequired: IntakeItem[];
  /** True when every REQUIRED item is answered. The job title never counts. */
  readonly complete: boolean;
  /**
   * True when the manager has told us nothing beyond naming the form.
   *
   * NOT THE SAME AS "nothing is known", and the difference decides which ask
   * they get. The salon comes from the AUTHENTICATED ACCOUNT, so on a
   * salon-assigned login it is settled before the manager has typed a word —
   * and counting that as an answer would mean the opening intake was never
   * shown to the people who actually use this product.
   *
   * So the test is on what the manager has SAID: the employee, which
   * `resolveEmployee` reads out of their own turns, and the five details this
   * module reads out of their text.
   */
  readonly nothingSupplied: boolean;
}

/**
 * Which of the seven the manager has already given.
 *
 * `employeeKnown` and `salonSettled` are passed in rather than read out of the
 * text, because both are established elsewhere and by better means: the
 * employee by `resolveEmployee`, which reads the manager's turns under rules
 * this module has no business restating, and the salon by the AUTHENTICATED
 * SCOPE. A salon typed into chat is not a salon Ask Sunny can file against —
 * there is no roster to resolve it — so an account that already settles it is
 * the only thing that can mark that item answered.
 */
export function readCorrectiveActionIntake(input: {
  readonly text: string;
  readonly employeeKnown: boolean;
  readonly salonSettled: boolean;
}): IntakeReading {
  const text = normalize(input.text);

  const answered: Record<IntakeItemKey, boolean> = {
    employee_name: input.employeeKnown,
    salon: input.salonSettled,
    form_date: any(text, DATE_GIVEN),
    what_happened: any(text, INCIDENT_TOPIC) || any(text, OBSERVATIONAL_CLAUSE),
    warning_level: any(text, WARNING_LEVEL_GIVEN),
    previous_action:
      any(text, PREVIOUS_NONE) || any(text, PREVIOUS_SOME) || any(text, PREVIOUS_WEAK),
    job_title: any(text, JOB_TITLE_GIVEN),
  };

  const supplied = CORRECTIVE_ACTION_INTAKE.filter((item) => answered[item.key]).map(
    (item) => item.key,
  );
  const missing = CORRECTIVE_ACTION_INTAKE.filter((item) => !answered[item.key]);
  const missingRequired = missing.filter((item) => !item.optional);

  return {
    supplied,
    missing,
    missingRequired,
    complete: missingRequired.length === 0,
    nothingSupplied: supplied.every((key) => key === "salon"),
  };
}

/**
 * Whether the manager said this is a first occurrence.
 *
 * Read separately from the intake because it answers a FIELD rather than a
 * question: §10 of the request asks that "this is the first time" reach the
 * form as "None — first occurrence" rather than as a blank line a reader can
 * mistake for a history nobody checked.
 */
export function statesFirstOccurrence(text: string): boolean {
  return any(normalize(text), PREVIOUS_NONE);
}

/* ---------------------------------------------------------------- basis --- */

/**
 * ============================================================================
 * A LOW NUMBER IS NOT A CORRECTIVE ACTION
 * ============================================================================
 *
 * §7 of the approved Performance Management Framework's own ladder is that
 * underperformance enters at coaching — Observation, Coaching, Role Play,
 * Follow-Up Coaching, EPP — and reaches formal accountability through history,
 * not through a metric being bad. "Their Club Close is low, create a corrective
 * action" is therefore a request the ladder answers rather than one the form
 * answers, and the difference is not a matter of degree: a formal warning
 * issued off a scorecard is the failure this whole area of the product exists
 * to prevent.
 *
 * SO THE BASIS IS READ, AND ONLY THE METRIC-ONLY CASE IS DIVERTED. A conduct or
 * policy signal ANYWHERE in the manager's words settles it as the form's
 * business — that is the ordinary case and it must not be slowed down. An
 * unstated basis is also the form's business, because "corrective action form"
 * typed on its own is a manager reaching for a document, and the intake is what
 * finds out what happened.
 *
 * WHICH MAKES THE DIVERSION NARROW BY CONSTRUCTION: it fires only when a metric
 * is named, a judgement about that metric is made, and nothing about anybody's
 * behaviour is said at all.
 */
export type CorrectiveActionBasis = "metric_only" | "conduct" | "unstated";

const METRIC_NAMED: readonly RegExp[] = [
  /\bclub close\b/,
  /\b(?:close|closing) rate\b/,
  /\bconversion(?:s| rate)?\b/,
  /\bupgrade(?:s| rate|%| percentage)?\b/,
  /\befts?\b/,
  /\bmembership (?:%|percentage|rate|sales)\b/,
  /\bsales per hour\b/,
  /\b(?:sph|atv|kpis?)\b/,
  /\baverage ticket\b/,
  /\bred (?:%|percentage)\b/,
  /\b(?:her|his|their|the) (?:numbers|stats|metrics|scorecard|percentages)\b/,
  /\bdaily stats\b/,
  /\b(?:sales|revenue|units|packages) (?:are|is|have been|has been)\b/,
];

const METRIC_JUDGED: readonly RegExp[] = [
  /\b(?:low|lowest|down|below|behind|weak|weakest|poor|under|dropping|declining|slipping|worst|bottom|last)\b/,
  /\b(?:not hitting|missing|misses|failing to hit|under target|off target|below target|not meeting)\b/,
  /\bneeds? (?:to )?improve\b/,
];

/**
 * Anything that is about a PERSON'S CONDUCT rather than about a number.
 *
 * The incident topics are reused verbatim — a dress code question is a conduct
 * question wherever it is read — and the additions are the words that name the
 * ladder's own history and the offense boxes on the form.
 */
const CONDUCT_SIGNAL: readonly RegExp[] = [
  ...INCIDENT_TOPIC,
  ...PREVIOUS_SOME,
  ...PREVIOUS_NONE,
  /\b(?:polic(?:y|ies)|handbook|manual|standards of conduct|code of conduct)\b/,
  /\b(?:attendance|punctuality|schedule adherence)\b/,
  /\b(?:behaviou?r|conduct|attitude problem|misconduct)\b/,
  /\b(?:written|verbal|final)(?:\s+written)?\s+warning\b/,
];

export function correctiveActionBasis(text: string): CorrectiveActionBasis {
  const normalized = normalize(text);
  if (any(normalized, CONDUCT_SIGNAL)) return "conduct";
  if (any(normalized, METRIC_NAMED) && any(normalized, METRIC_JUDGED)) {
    return "metric_only";
  }
  return "unstated";
}

/* -------------------------------------------------------------- wording --- */

/**
 * The opening ask, in full.
 *
 * `formName` comes from the template row rather than from a literal here, so
 * the sentence follows the library the day the business renames the form again
 * — which is exactly what happened to produce this module.
 */
export function correctiveActionIntakeRequest(input: {
  readonly formName: string;
  readonly items: readonly IntakeItem[];
  /** True on the first ask, false when only the gaps are being chased. */
  readonly opening: boolean;
}): string {
  const numbered = input.items
    .map((item, index) => `${index + 1}. ${item.prompt}`)
    .join("\n");

  if (input.opening) {
    return [
      `Absolutely — I can help you create a **${input.formName}**. To get started, please give me:`,
      "",
      numbered,
      "",
      /*
       * THE PROMISE AT THE END IS THE ONE THIS PRODUCT CAN ACTUALLY KEEP, and
       * it is stated up front because it changes what the manager should expect
       * to see. The policy fields are filled from the approved manual or they
       * are left blank — see `policy-grounding.ts` — so saying so here is the
       * difference between a blank line that looks like an omission and one
       * that looks like the safeguard it is.
       */
      `Once I have that I'll prepare the ${input.formName} and check the applicable company policy before anything policy-related goes on it.`,
    ].join("\n");
  }

  const lead =
    input.items.length === 1
      ? "One more thing and I can build it:"
      : "I have most of it. Still missing:";

  return [lead, "", numbered].join("\n");
}
