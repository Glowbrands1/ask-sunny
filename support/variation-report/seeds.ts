/**
 * The seeds: real manager chats from production (QA, 27 Oct 2026), word for
 * word, every name invented. Each says what the finished form should hold;
 * `checks` names only what the seed is about.
 */
export interface Expect {
  /** "Quinn Marlowe": the saved Employee. */
  readonly employee?: string;
  /** ISO date the form's Date should hold. */
  readonly date?: string;
  /** Each a substring a Prior actions row must contain (MM/DD/YYYY), in any order; `priorExact` also forbids others. */
  readonly prior?: readonly string[];
  readonly priorExact?: boolean;
  readonly payroll?: "yes" | "no";
  /** "$3.25": in the plan. */
  readonly amountInPlan?: string;
  readonly warning?: "verbal" | "written";
  /** A substring of Policy Violated or Direct policy. */
  readonly policy?: RegExp;
  /** The plan must not match. */
  readonly planNot?: RegExp;
  /** Observation must not match. */
  readonly observedNot?: RegExp;
  readonly jobTitle?: RegExp;
  readonly location?: RegExp;
  /** Exit form. */
  readonly noticeGiven?: string;
  readonly noticeFulfilled?: string;
  readonly lastDay?: string;
  readonly rehire?: "yes" | "no";
  /** Chat only: the reply asks for the name in one plain question, never a numbered list, never the same list twice. */
  readonly oneQuestion?: boolean;
  /** No reply after the first asks the payroll question while it is open. */
  readonly payrollAskedOnce?: boolean;
}

export interface Seed {
  readonly id: string;
  readonly turns: readonly string[];
  readonly expect: Expect;
  /** The person as the seed writes them, for the name variants. */
  readonly name?: { readonly first: string; readonly last: string };
  /** Each date as the seed writes it, and the ISO date it means, for the date variants. */
  readonly dates?: readonly { readonly text: string; readonly iso: string }[];
  /** Flags this seed needs on beyond production (named so the report says so). */
  readonly flags?: readonly string[];
  /** No form is created: the seed is about the chat's questions. */
  readonly chatOnly?: boolean;
}

export const SEEDS: readonly Seed[] = [
  {
    id: "S1",
    turns: [
      "My employee quinn marlowe has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15",
      "I already told you the employee name. She is at Kearney",
      "10/15",
    ],
    name: { first: "quinn", last: "marlowe" },
    dates: [{ text: "10/15", iso: "2026-10-15" }],
    expect: { employee: "Quinn Marlowe", date: "2026-10-15", policy: /Attendance|Tardiness|Absentee/i },
  },
  {
    id: "S2",
    turns: [
      "create a ca for quinn marlowe at kearney, she was late on 10-5 and 10-15. i coached her on 10-16 about being late",
      "verbal",
      "no payroll deduct",
      "10-15",
    ],
    name: { first: "quinn", last: "marlowe" },
    dates: [{ text: "10-15", iso: "2026-10-15" }],
    expect: { employee: "Quinn Marlowe", date: "2026-10-15", prior: ["10/16/2026"], priorExact: true, warning: "verbal", payroll: "no" },
  },
  {
    id: "S3",
    turns: [
      "i need to issue a ca for someone being late",
      "quinn marlowe was late on 10/20 and the salon was opened late",
      "she was issued a verbal ca on 10.1 for this same thing",
      "yes payrol ldeduct",
      "i dont know the amount",
      "kearney",
    ],
    name: { first: "quinn", last: "marlowe" },
    dates: [{ text: "10/20", iso: "2026-10-20" }],
    expect: { employee: "Quinn Marlowe", date: "2026-10-20", prior: ["10/01/2026"], payroll: "yes", policy: /Late Open/i },
  },
  {
    id: "S4",
    turns: [
      "create a written CA for dale ferris for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable",
      "written",
    ],
    name: { first: "dale", last: "ferris" },
    dates: [{ text: "10-20-26", iso: "2026-10-20" }],
    expect: { employee: "Dale Ferris", date: "2026-10-20", prior: ["01/01/2026", "09/01/2026"], warning: "written", payroll: "no", planNot: /arrive on time/i },
  },
  {
    id: "S5",
    turns: [
      "create ca form for dale ferris. dale had a register shortage of $3.25 on 10-20-26. payroll deduct of $3.25 is applicable",
      "verbal",
      "yes payroll deduct",
    ],
    name: { first: "dale", last: "ferris" },
    dates: [{ text: "10-20-26", iso: "2026-10-20" }],
    expect: { employee: "Dale Ferris", date: "2026-10-20", payroll: "yes", amountInPlan: "$3.25", warning: "verbal" },
  },
  {
    id: "S6",
    turns: [
      "create verbal ca for dale ferris for opening salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted",
    ],
    name: { first: "dale", last: "ferris" },
    dates: [{ text: "10-1-26", iso: "2026-10-01" }],
    expect: { employee: "Dale Ferris", date: "2026-10-01", policy: /Late Open/i, amountInPlan: "$25", payroll: "yes" },
  },
  {
    id: "S7",
    turns: [
      "create ca form for dale ferris for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching",
      "verbal",
    ],
    name: { first: "dale", last: "ferris" },
    dates: [{ text: "10-20-26", iso: "2026-10-20" }],
    expect: { employee: "Dale Ferris", date: "2026-10-20", policy: /Attendance|Absentee/i, prior: ["01/01/2026"], payroll: "no", warning: "verbal" },
  },
  {
    id: "S8",
    turns: [
      "Can you create me a performance CA?",
      "Quinn Marlowe today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant",
      "Quinn Marlowe",
    ],
    name: { first: "quinn", last: "marlowe" },
    expect: { employee: "Quinn Marlowe", prior: ["09/08/2026", "09/15/2026", "09/25/2026"], payroll: "no", payrollAskedOnce: true },
  },
  {
    id: "S9",
    turns: [
      "create an exit form. employee name is ivy hollis. ivy was a tanning consultant at manhattan location. on 9-15-26 ivy provided her resignation to management and her last day worked was 9-28-26",
      "ivy gave and worked 2 week notice. ivy messaged management her resignation via woven. all salon items were returned and she is eligible for rehire",
    ],
    name: { first: "ivy", last: "hollis" },
    dates: [{ text: "9-28-26", iso: "2026-09-28" }],
    expect: { employee: "Ivy Hollis", noticeGiven: "2026-09-15", noticeFulfilled: "2026-09-28", lastDay: "2026-09-28", rehire: "yes" },
  },
  {
    id: "S10",
    turns: [
      "do verbal for quinn marlowe at kearney. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 quinn was not scheduled to work and came into the salon to show her team her new puppy. quinn was in the salon 45 min",
      "jba manual 11-1-25",
      "create corrective action",
    ],
    name: { first: "quinn", last: "marlowe" },
    dates: [{ text: "10-22-26", iso: "2026-10-22" }],
    flags: ["ANIMAL_ANYWHERE_ENABLED", "FUTURE_PRIOR_ROW_DROP_ENABLED"],
    expect: { employee: "Quinn Marlowe", prior: ["11/01/2025"], priorExact: true, policy: /Animals in the Workplace/i },
  },
  {
    id: "S11",
    turns: ["create corrective action form for mara quill, Salon Director", "Mara Quill, Salon Director"],
    name: { first: "mara", last: "quill" },
    flags: ["JOB_TITLE_NOT_INCIDENT_ENABLED"],
    expect: { employee: "Mara Quill", jobTitle: /Salon Director/i, observedNot: /^Observed:\s*Salon Director\.?$/i },
  },
  {
    id: "S12",
    turns: [
      "create a CA form for quinn marlowe, tan consultant at manhattan, for opening salon late on 9-28-26",
      "this should be a written and note a verbal ca was given on 9-1-26",
      "Create a form from this conversation.",
    ],
    name: { first: "quinn", last: "marlowe" },
    dates: [{ text: "9-28-26", iso: "2026-09-28" }],
    flags: ["PRIOR_STEP_SENTENCE_ENABLED"],
    expect: { employee: "Quinn Marlowe", prior: ["09/01/2026"], warning: "written", policy: /Late Open/i, jobTitle: /Tan(?:ning)? Consultant/i },
  },
  {
    id: "S13",
    turns: [
      "create coaching form for employee dale ferris who is a tanning consultant at manhattan. on 9-29-26 dale was out of dress code",
      "employee name is dale ferris",
      "create coaching form for dale ferris",
    ],
    name: { first: "dale", last: "ferris" },
    dates: [{ text: "9-29-26", iso: "2026-09-29" }],
    expect: { employee: "Dale Ferris", location: /Manhattan/i },
  },
  { id: "S14a", turns: ["Create a coaching form."], chatOnly: true, flags: ["NAME_QUESTION_ONLY_ENABLED"], expect: { oneQuestion: true } },
  { id: "S14b", turns: ["ca"], chatOnly: true, flags: ["NAME_QUESTION_ONLY_ENABLED"], expect: { oneQuestion: true } },
  { id: "S14c", turns: ["blank corrective action form"], chatOnly: true, flags: ["NAME_QUESTION_ONLY_ENABLED"], expect: { oneQuestion: true } },
  {
    id: "S15",
    turns: [
      "I have an employee ivy at our Grand Island location who has been out of dress code three shifts. I verbally coached her on the second offense and she still is out of dress code",
      "Create a Coaching Form from this conversation.",
      "Yes",
    ],
    chatOnly: true,
    flags: ["NAME_QUESTION_ONLY_ENABLED"],
    expect: { oneQuestion: true },
  },
];
