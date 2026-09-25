/**
 * ============================================================================
 * WHAT A PERFORMANCE PLAN NEEDS, AND WHAT THE MANAGER HAS ALREADY SAID
 * ============================================================================
 *
 * The same shape as `corrective-action-intake.ts`, and deliberately so: a
 * manager who has been asked seven questions to open a Corrective Action Form
 * should recognise this list as the same kind of thing. It is PURE and
 * browser-safe, it decides nothing, and it reports which details are already
 * present in the manager's own words so the caller can ask for only the rest.
 *
 * ============================================================================
 * THE RULE THAT MAKES IT USABLE: ASK ONCE, FOR WHAT IS MISSING
 * ============================================================================
 *
 * "Jessica is an SDIT at Lincoln South. She's great with clients but she's
 * been late several times this month." has already answered the employee, the
 * job title, where she is succeeding and what needs work. Asking all ten
 * questions after that is the friction this whole workflow exists to remove,
 * and it is what the previous generation of this product did.
 *
 * ============================================================================
 * NOTHING HERE HOLDS UP A FORM THAT CAN BE DRAFTED
 * ============================================================================
 *
 * The productivity figures and the expectation marks are OPTIONAL, and that is
 * a decision about the document rather than a convenience. A manager who says
 * "I don't have them" or "I'll add those later" must still get their EPP: the
 * fields are on the form, blank, where they can be filled in the review
 * conversation. An EPP nobody can generate because a number was missing is a
 * worse outcome than an EPP with a blank line on it.
 *
 * ============================================================================
 * ONE READER, TWO PLANS, AND THE DIFFERENCE IS A LIST
 * ============================================================================
 *
 * The SDIT plan and the TSD Management Performance Plan ask for different
 * things: the SDIT's productivity table has three metrics and the TSD's has
 * five, the TSD's job title is not a question because the document is the
 * Training Salon Director's own, and the TSD's expectation marks are not
 * chased at all. So the ITEMS are per-plan (`EppIntakePlan`) and the DETECTORS
 * are shared — a manager writes "she's great with clients" the same way
 * whichever plan they are asking for, and two copies of these regexes would
 * be two copies that drift.
 *
 * ============================================================================
 * WHY THE TESTS ARE DELIBERATELY GENEROUS
 * ============================================================================
 *
 * Nothing here writes to a form. Reading an answer as present when it was not
 * costs a question that should have been asked, and the manager sees the empty
 * field in front of them. Reading a present answer as missing costs the
 * friction this module exists to remove, on every turn, until they phrase it
 * the way a regex wanted. So the detectors fire on the shapes people type.
 */

export type EppIntakeItemKey =
  | "employee_name"
  | "salon"
  | "form_date"
  | "job_title"
  | "succeeding"
  | "needs_improvement"
  | "employee_productivity"
  | "salon_productivity"
  | "expectations_success"
  | "expectations_improvement"
  | "follow_up";

export interface EppIntakeItem {
  readonly key: EppIntakeItemKey;
  /** The line as Ask Sunny asks for it, without its number. */
  readonly prompt: string;
  /** An optional item is reported as missing but never blocks the form. */
  readonly optional: boolean;
}

/**
 * THE INTAKE, IN THE ORDER AND THE WORDING MANAGERS ALREADY KNOW.
 *
 * Taken from the intake the business has been using, so a numbered reply lines
 * up with the numbered question. The only edit is that the job title asks for
 * the role rather than assuming it — which is what lets "Employee Performance
 * Plan" resolve to the SDIT plan rather than to a guess.
 */
export const SDIT_EPP_INTAKE: readonly EppIntakeItem[] = [
  { key: "employee_name", prompt: "The employee's full name", optional: false },
  { key: "salon", prompt: "The salon location", optional: false },
  {
    /*
     * THE DATE LINE NAMES THE DATE. "Say today and I'll use today's date" is a
     * tautology; the actual date is the thing a manager can check, and the
     * form's date is what the plan is written against. Substituted by
     * `eppIntakeRequest`; this string is the fallback.
     */
    key: "form_date",
    prompt: "The date for the form (if you say “today,” I'll use today's date)",
    optional: false,
  },
  {
    key: "succeeding",
    prompt: "Where the employee is currently succeeding (your observations)",
    optional: false,
  },
  {
    key: "needs_improvement",
    prompt: "The biggest areas needing improvement",
    optional: false,
  },
  {
    key: "employee_productivity",
    prompt:
      "The employee's productivity numbers (e.g. PPTA, UPTA, LPSVA) — or say you'll add them later",
    optional: true,
  },
  {
    key: "salon_productivity",
    prompt: "The salon's current productivity numbers — or say you'll add them later",
    optional: true,
  },
  {
    key: "expectations_success",
    prompt: "Which of the form's expectations the employee is succeeding at (there are seven)",
    optional: true,
  },
  {
    key: "expectations_improvement",
    prompt: "Which of those expectations need improvement",
    optional: true,
  },
  {
    key: "follow_up",
    prompt: "When the follow-up review should happen (e.g. “the week of October 5”)",
    optional: false,
  },
  {
    key: "job_title",
    prompt: "The employee's job title (SDIT)",
    optional: true,
  },
];

/**
 * ============================================================================
 * THE TSD MANAGEMENT PERFORMANCE PLAN'S OWN INTAKE — EIGHT LINES
 * ============================================================================
 *
 * SHORTER THAN THE SDIT'S ELEVEN, ON PURPOSE. Three of that list are not
 * questions on this document:
 *
 *   THE JOB TITLE. The SDIT plan asks because the same plan is written for an
 *   ASD on the SDIT track as often as for an SDIT. This document is the
 *   Training Salon Director's own — a District Manager asking for it has
 *   already said whose plan it is by asking for THIS plan — so a question
 *   about it is a question with one answer, and the line on the form stays
 *   whatever the manager's own words gave it.
 *
 *   THE TWO EXPECTATION LINES. There are NINE management expectations here and
 *   they are marked in the review conversation, against the form, with the
 *   Training Salon Director in the room. Reading a chat sentence into nine
 *   tri-state marks is the auto-marking this plan's rules forbid, so nothing
 *   asks for them up front: the rows are on the document, blank.
 *
 * WHAT IT ASKS FOR IS WHAT THE BUSINESS ASKS FOR, in the business's order, and
 * the two productivity lines name the five metrics this plan actually has.
 * PPTA, LPSVA, UPTA, Club Close and Average Club Dollar — not the SDIT three.
 */
export const TSD_EPP_INTAKE: readonly EppIntakeItem[] = [
  { key: "employee_name", prompt: "The employee's full name", optional: false },
  { key: "salon", prompt: "The salon location", optional: false },
  {
    key: "form_date",
    prompt: "The date for the form (if you say \u201ctoday,\u201d I'll use today's date)",
    optional: false,
  },
  {
    key: "succeeding",
    prompt: "Where the manager is currently succeeding (your observations)",
    optional: false,
  },
  {
    key: "needs_improvement",
    prompt: "The biggest areas needing improvement",
    optional: false,
  },
  {
    key: "employee_productivity",
    prompt:
      "The manager's productivity numbers, if you have them (PPTA, LPSVA, UPTA, Club Close, Average Club Dollar)",
    optional: true,
  },
  {
    key: "salon_productivity",
    prompt: "The salon's current productivity numbers, if you have them (the same five)",
    optional: true,
  },
  {
    key: "follow_up",
    prompt:
      "When the follow-up review should happen (e.g. \u201cthe week of October 5\u201d)",
    optional: false,
  },
];

/* ------------------------------------------------------------ the plans --- */

/**
 * WHICH PLAN IS BEING ASKED FOR, AND WHAT THAT CHANGES.
 *
 * Everything that differs between the performance plans, in one place, keyed
 * on the LIBRARY KEY. A caller passes the key it already resolved against the
 * published library; it never reads a name or a title, because those are the
 * business's to change.
 */
export interface EppIntakePlan {
  readonly templateKey: string;
  /** The intake for this plan, in the order the business asks it. */
  readonly items: readonly EppIntakeItem[];
  /** The metrics this plan's productivity table actually names. */
  readonly metrics: readonly string[];
  /** How the SUBJECT of this plan is referred to — "employee", "manager". */
  readonly subject: string;
  /** The opening line, given the template's own name off the row. */
  lead(formName: string): string;
  /** The closing line, given the template's own name off the row. */
  tail(formName: string): string;
  /**
   * A line saying the optional answers may be left out, or null for none.
   *
   * NULL FOR THE SDIT PLAN, and deliberately: that intake shipped, was
   * reviewed and is approved as it stands, and a sentence added to it here
   * would be a change to a workflow this work was told to leave alone.
   */
  readonly optionalNote: string | null;
}

export const SDIT_EPP_PLAN: EppIntakePlan = {
  templateKey: "sdit-epp",
  items: SDIT_EPP_INTAKE,
  metrics: ["PPTA", "UPTA", "LPSVA"],
  subject: "employee",
  lead: (formName) => `For the **${formName}**, I'll need a few details to create it for you:`,
  /*
   * THE PROMISE AT THE END IS ONE THIS PRODUCT CAN KEEP. The plan is written
   * against the JB & Associates manual or against nothing at all — see
   * `epp-policy.ts` — so saying so here is the difference between a blank
   * policy line that looks like an omission and one that looks like the
   * safeguard it is.
   */
  tail: (formName) =>
    `Once I have that I'll draft the ${formName} and check the applicable JB & Associates policy before anything policy-related goes on it.`,
  optionalNote: null,
};

export const TSD_EPP_PLAN: EppIntakePlan = {
  templateKey: "tsd-epp",
  items: TSD_EPP_INTAKE,
  metrics: ["PPTA", "LPSVA", "UPTA", "Club Close", "Average Club Dollar"],
  /*
   * "MANAGER", BECAUSE THE SUBJECT OF THIS PLAN MANAGES A SALON. The document
   * asks "in what areas is the manager currently succeeding?" and the person
   * it is reviewed with is their District Manager. Calling the Training Salon
   * Director "the employee" in the chat while the form calls them "the
   * manager" is the role-label drift this plan's rules single out.
   */
  subject: "manager",
  /*
   * THE ROLE SPELLED OUT, ONCE. A District Manager who typed "create a TSD
   * EPP" should see, in the first line, that Ask Sunny understood which
   * document that is — the Training Salon Director's Employee Performance
   * Plan — before being asked for anything.
   */
  lead: () =>
    "To create a Training Salon Director (TSD) Employee Performance Plan (EPP) form for you, I'll need a few details:",
  tail: (formName) =>
    `Please provide these details and I'll prepare the ${formName} draft for you, checking the applicable JB & Associates policy before anything policy-related goes on it.`,
  /*
   * NOTHING OPTIONAL HOLDS THE DRAFT UP, AND THE INTAKE SAYS SO. A manager
   * reading a list of eight assumes eight answers are required; the two
   * productivity lines are not, and a plan that waited for a number nobody
   * has is the friction this workflow exists to remove.
   */
  optionalNote:
    "You can leave the productivity numbers blank if you don't have them — they won't hold the draft up.",
};

/**
 * The plan a template key names.
 *
 * FALLS BACK TO THE SDIT SHAPE rather than throwing: the other four published
 * performance plans cannot reach this today — `inline-draft.ts` decides which
 * workflows exist and only these two are in it — and a key that somehow did
 * should get the longer list of questions, not a crash. Asking one question
 * too many is recoverable; the alternative is not.
 */
export function eppIntakePlan(templateKey: string): EppIntakePlan {
  return templateKey === TSD_EPP_PLAN.templateKey ? TSD_EPP_PLAN : SDIT_EPP_PLAN;
}

/* ------------------------------------------------------------- matching --- */

/**
 * ============================================================================
 * THE PICKER'S OWN SENTENCE IS NOT SOMETHING THE MANAGER TOLD US
 * ============================================================================
 *
 * Clicking a card in the form selector sends `formRequestPhrase(name)` through
 * the composer — "Create a SDIT EPP from this conversation." — as a manager
 * turn, because it IS one: it travels the same path as a typed request and is
 * revalidated the same way.
 *
 * It is also, for this module, a trap that the corrective-action intake never
 * had to face. That form's name contains no job title; this one's name IS a
 * job title. So a manager who clicked the card and said nothing else appeared
 * to have told us the employee's role — "SDIT" — and `nothingSupplied` came
 * back false, which is precisely the state where the opening intake belongs.
 * They would have been asked one straggling question instead of shown the
 * list.
 *
 * SO THE SENTENCE IS REMOVED BEFORE ANYTHING IS READ, rather than the job-title
 * matcher being weakened. "Jessica is an SDIT" must still answer the job title;
 * what must not is the name of the form she is getting.
 */
const FORM_REQUEST_SENTENCE = /\bcreate\b[^.\n]*\bfrom this conversation\b\.?/gi;

/** Lower-cased, horizontal runs collapsed, NEWLINES KEPT — a reply is a list. */
function normalize(text: string): string {
  return (text ?? "")
    .replace(FORM_REQUEST_SENTENCE, " ")
    .toLowerCase()
    .replace(/[^\S\n]+/g, " ");
}

function any(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

const DATE_GIVEN: readonly RegExp[] = [
  /\b(?:today|yesterday|tonight|this morning|this afternoon|this evening)\b/,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/,
  /\b(?:jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/,
];

/**
 * A follow-up, which is a DIFFERENT question from the form's date.
 *
 * "The week of October 5" is the commonest answer by a distance, and a bare
 * month-and-day only counts here when something marks it as the review — "week
 * of", "follow up", "re-evaluate", "check back". Otherwise the date the
 * manager gave for the form would answer both questions and the follow-up line
 * would never be asked.
 */
const FOLLOW_UP_GIVEN: readonly RegExp[] = [
  /\bweek of\b/,
  /\b(?:follow[- ]?up|followup|re[- ]?eval\w*|revisit|check back|check[- ]?in)\b[^.\n]{0,40}\b(?:\d|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/,
  /\bin (?:two|three|four|six|2|3|4|6|30|60|90) (?:weeks?|days?|months?)\b/,
  /\b(?:30|60|90)[- ]day\b/,
];

/**
 * An account of where somebody is DOING WELL.
 *
 * Deliberately generous and deliberately not the same list as the improvement
 * one: a manager writes "she's great with clients", not "areas of success:".
 */
const SUCCEEDING_GIVEN: readonly RegExp[] = [
  /\b(?:succeed\w*|strength|strengths|doing well|does well|great (?:with|at)|good (?:with|at)|excel\w*|strong (?:with|at|in)?|best (?:at|with))\b/,
  /\b(?:positive|friendly|welcoming|reliable|consistent|helpful)\b/,
  /\bgood (?:customer|client) service\b/,
];

const IMPROVEMENT_GIVEN: readonly RegExp[] = [
  /\b(?:improve\w*|improvement|needs? (?:to )?work|struggl\w+|weak\w*|behind|falling short|lack\w*|inconsisten\w+)\b/,
  /\b(?:late|lateness|tardy|tardiness|punctual\w*|absent\w*|no[- ]call|no[- ]show|call[- ]?off)\b/,
  /\b(?:but|however|although)\b[^.\n]{0,80}\b(?:needs?|should|has to|must|isn't|is not|doesn't|does not)\b/,
];

/**
 * Productivity, in the shapes a manager supplies it.
 *
 * A STATED ABSENCE COUNTS AS AN ANSWER. "I don't have them", "leave it blank",
 * "placeholder", "I'll add them later" are all decisions the manager has made,
 * and chasing somebody for a number they have just told you they do not have
 * is the single most irritating thing this flow could do.
 */
const PRODUCTIVITY_DEFERRED: readonly RegExp[] = [
  /*
   * "I DON'T HAVE PRODUCTIVITY YET" IS THE SENTENCE MANAGERS ACTUALLY TYPE,
   * and it was read as no answer at all: the object list was pronouns plus
   * "the numbers", so naming the thing they did not have — productivity, the
   * stats, the figures — did not count as having said so, and the flow chased
   * a manager for a number they had just told you they do not have.
   */
  /\b(?:don'?t|do not|didn'?t) have (?:the |her |his |their |any )?(?:them|those|it|numbers?|productivity|stats?|figures?|metrics)\b/,
  /\b(?:leave|leaving) (?:it|them|that|those)? ?blank\b/,
  /\bplaceholder\b/,
  /\b(?:i'?ll|i will|we'?ll) (?:add|fill|put|get) (?:them|those|it|that)?\s*(?:in)?\s*later\b/,
  /\b(?:add|fill) (?:them|those|it) later\b/,
  /\bnot (?:available|handy|to hand)\b/,
  /\bno (?:productivity|numbers|stats|figures)\b/,
  /\btbd\b/,
];

const EMPLOYEE_PRODUCTIVITY_GIVEN: readonly RegExp[] = [
  /\b(?:employee|personal|her|his|their|individual)'?s? (?:productivity|ppta|upta|lpsva|numbers?|stats?)\b/,
  /\b(?:ppta|upta|lpsva)\b[^.\n]{0,20}\d/,
  /\bproductivity (?:number|numbers)? ?(?:is|are|of|:)?\s*(?:placeholder\s*)?\d/,
];

const SALON_PRODUCTIVITY_GIVEN: readonly RegExp[] = [
  /\bsalon'?s? (?:current )?(?:productivity|ppta|upta|lpsva|numbers?|stats?)\b/,
  /\bstore'?s? (?:current )?(?:productivity|numbers?)\b/,
];

/**
 * A decision about the seven expectations, INCLUDING a decision to defer.
 *
 * "I'll add those later" is an answer: it means leave the boxes blank, and the
 * form supports exactly that. See `deferredExpectations`.
 */
const EXPECTATIONS_DEFERRED: readonly RegExp[] = [
  /\b(?:i'?ll|i will|we'?ll) (?:add|do|mark|complete|fill) (?:those|them|that|these)\b/,
  /\b(?:add|mark|complete|fill) (?:those|them|these) later\b/,
  /\b(?:later|afterwards|after)\b[^.\n]{0,20}\bexpectations?\b/,
  /\bexpectations?\b[^.\n]{0,30}\blater\b/,
  /\bskip (?:the )?expectations?\b/,
];

const EXPECTATIONS_SUCCESS_GIVEN: readonly RegExp[] = [
  /\bexpectations?\b[^.\n]{0,40}\b(?:succeed\w*|success|meeting|meets|strong|doing well)\b/,
  /\b(?:succeed\w*|success|meeting|meets)\b[^.\n]{0,40}\bexpectations?\b/,
];

const EXPECTATIONS_IMPROVEMENT_GIVEN: readonly RegExp[] = [
  /\bexpectations?\b[^.\n]{0,40}\b(?:improve\w*|needs? work|falling short|not meeting)\b/,
  /\b(?:improve\w*|not meeting|falling short)\b[^.\n]{0,40}\bexpectations?\b/,
];

/** A job title, in the vocabulary this business uses. */
const JOB_TITLE_GIVEN: readonly RegExp[] = [
  /\b(?:tc|asd|sd|sdit|tsd|dmit|fttc|dm)\b/,
  /\b(?:tanning consultant|salon director|assistant salon director|district manager|regional manager|key ?holder|shift lead|manager in training)\b/,
  /\bjob title\s*[:\-=]/,
];

/** Whether the manager said the productivity figures are not coming today. */
export function deferredProductivity(text: string): boolean {
  return any(normalize(text), PRODUCTIVITY_DEFERRED);
}

/** Whether the manager said they will mark the expectations later. */
export function deferredExpectations(text: string): boolean {
  return any(normalize(text), EXPECTATIONS_DEFERRED);
}

/* -------------------------------------------------------------- reading --- */

export interface EppIntakeReading {
  /** Items the manager's own words already answer. */
  readonly supplied: EppIntakeItemKey[];
  /** Everything not yet answered, optional items included, in intake order. */
  readonly missing: EppIntakeItem[];
  /** The subset that actually holds the opening ask up. */
  readonly missingRequired: EppIntakeItem[];
  /** True when every REQUIRED item is answered. */
  readonly complete: boolean;
  /**
   * True when the manager has told us nothing beyond naming the form.
   *
   * NOT "nothing is known". The salon comes from the AUTHENTICATED ACCOUNT, so
   * on a salon-assigned login it is settled before a word is typed — counting
   * it would mean the opening intake never appeared for the people who
   * actually use this product. So the test is on what the manager SAID.
   */
  readonly nothingSupplied: boolean;
}

/**
 * Which of the intake the manager has already given.
 *
 * `employeeKnown` and `salonSettled` are passed in rather than read from the
 * text, for the same reason they are in the corrective-action intake: the
 * employee is resolved by `resolveEmployee` from the manager's own turns, and
 * the salon comes from the authenticated scope. A salon typed into chat is not
 * a salon Ask Sunny can file against.
 */
export function readEppIntake(input: {
  readonly text: string;
  readonly employeeKnown: boolean;
  readonly salonSettled: boolean;
  /**
   * WHICH PLAN'S QUESTIONS. Defaults to the SDIT's eleven, which is what every
   * caller asked for before there were two. The DETECTORS below do not vary:
   * only which of their answers are questions on this document.
   */
  readonly plan?: EppIntakePlan;
}): EppIntakeReading {
  const text = normalize(input.text);
  const productivityDeferred = any(text, PRODUCTIVITY_DEFERRED);
  const expectationsDeferred = any(text, EXPECTATIONS_DEFERRED);

  const answered: Record<EppIntakeItemKey, boolean> = {
    employee_name: input.employeeKnown,
    salon: input.salonSettled,
    form_date: any(text, DATE_GIVEN),
    job_title: any(text, JOB_TITLE_GIVEN),
    succeeding: any(text, SUCCEEDING_GIVEN),
    needs_improvement: any(text, IMPROVEMENT_GIVEN),
    /*
     * A DEFERRAL ANSWERS BOTH PRODUCTIVITY LINES AT ONCE. Nobody says "I don't
     * have the employee's and I don't have the salon's" — they say "I don't
     * have them", and they mean the numbers.
     */
    employee_productivity: productivityDeferred || any(text, EMPLOYEE_PRODUCTIVITY_GIVEN),
    salon_productivity: productivityDeferred || any(text, SALON_PRODUCTIVITY_GIVEN),
    expectations_success: expectationsDeferred || any(text, EXPECTATIONS_SUCCESS_GIVEN),
    expectations_improvement:
      expectationsDeferred || any(text, EXPECTATIONS_IMPROVEMENT_GIVEN),
    follow_up: any(text, FOLLOW_UP_GIVEN),
  };

  const items = (input.plan ?? SDIT_EPP_PLAN).items;
  const supplied = items.filter((item) => answered[item.key]).map((item) => item.key);
  const missing = items.filter((item) => !answered[item.key]);
  const missingRequired = missing.filter((item) => !item.optional);

  return {
    supplied,
    missing,
    missingRequired,
    complete: missingRequired.length === 0,
    nothingSupplied: supplied.every((key) => key === "salon"),
  };
}

/* -------------------------------------------------------------- wording --- */

function promptFor(item: EppIntakeItem, today: string | null): string {
  if (item.key === "form_date" && today !== null && today !== "") {
    return `The date for the form (if you say “today,” I'll use ${today})`;
  }
  return item.prompt;
}

/**
 * The opening ask, in full.
 *
 * `formName` comes from the template row rather than from a literal here, so
 * the sentence follows the library the day the business renames the form.
 */
export function eppIntakeRequest(input: {
  readonly formName: string;
  readonly items: readonly EppIntakeItem[];
  /** True on the first ask, false when only the gaps are being chased. */
  readonly opening: boolean;
  /** Today, already formatted for reading — "September 21, 2026". */
  readonly today?: string | null;
  /**
   * WHOSE WORDING. Defaults to the SDIT's, which is the wording every caller
   * got before there were two plans, so an omission changes nothing.
   */
  readonly plan?: EppIntakePlan;
}): string {
  const plan = input.plan ?? SDIT_EPP_PLAN;
  const lines = input.items.map((item) => `- ${promptFor(item, input.today ?? null)}`).join("\n");

  if (input.opening) {
    const optional =
      plan.optionalNote !== null && input.items.some((item) => item.optional)
        ? ["", plan.optionalNote]
        : [];

    return [plan.lead(input.formName), "", lines, ...optional, "", plan.tail(input.formName)].join(
      "\n",
    );
  }

  const lead =
    input.items.length === 1
      ? "One more thing and I can draft it:"
      : "I have most of it. Still missing:";

  return [lead, "", lines].join("\n");
}
