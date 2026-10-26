/**
 * ============================================================================
 * THE DATE-FORMAT MATRIX — ONE SET OF CASES FOR BOTH APPS
 * ============================================================================
 *
 * Pau (26 Oct 2026): "Please prioritize how apps read dates and map them in
 * the form even if they have different formats." Every way a manager writes
 * a date, in every role a form gives it, in lowercase, Sentence case and ALL
 * CAPS — read the same way by both apps.
 *
 * THIS FILE IS BYTE-IDENTICAL IN ASK SUNNY AND ASK BUBBLES. Keep it so: edit
 * it in one app and copy it to the other in the same session. It is company
 * neutral — no location-type or brand words, and invented names only. Where a
 * live sentence named a place, the case holds `{place}`; each app's runner
 * fills it with a place of its own, or drops " at {place}" (see `fillPlace` in
 * `run.ts`). Each app's own wording (what it calls the Observation, what it
 * calls a location) is mapped in that app's runner, never here.
 *
 * SHAPE. A `DateMatrixBase` is one sentence (or conversation) with what the
 * form must say. `DATE_MATRIX_CASES` expands every base into its casings:
 * `lower`, `sentence` (first letter of each sentence, and "I"), `upper`, and
 * — for live sentences — `typed`, the manager's own capitalisation. A case id
 * is `<base id>/<casing>`. `run.ts` turns each case into one test per CELL
 * (a role or rule it pins), and documents how another PR runs them.
 *
 * DATES. `today` is the business day the conversation happens on. A date
 * typed without a year is the most recent such day that is not in the future
 * relative to `today` ("12-20" on 26 Oct 2026 is 20 Dec 2025) — except a
 * follow-up, which is ahead by nature. A date with its year typed is read as
 * typed. Every expected date is ISO `YYYY-MM-DD`.
 *
 * ROLES COVERED, per the templates both apps publish:
 *   Corrective Action — the form's Date (the incident's; with several
 *     incidents, the FIRST, or one question asking which), the incident dates
 *     in the Observation, the Prior actions rows, the Follow-up.
 *   Coaching Form — the Date (the day the coaching was held), the incident
 *     dates in the account.
 *   Resignation/Exit — Last Day Worked, Date that notice was given, Date that
 *     notice was fulfilled, Resignation Date.
 * `effectiveDate` is in the type for other callers, but no published template
 * has an effective-date field (the employment-change forms write it only in
 * the drafting model's prose), so no case here asserts one.
 *
 * RULES every case pins where it applies (see `cellsFor` in `run.ts`):
 *   - a prior's date is never the form date, and never the Follow-up;
 *   - no date the manager did not give for that event is stated;
 *   - no incident date is dropped from the Observation;
 *   - an ambiguous date is asked about once, and never left as a blank row;
 *   - the same result across formats, casings and both apps.
 */

export type DateMatrixForm = "ca" | "coaching" | "exit";

export type DateMatrixCasing = "lower" | "sentence" | "upper" | "typed";

export type PriorKind = "verbal" | "written" | "coaching";

export interface PriorExpectation {
  kind: PriorKind;
  /** ISO date. Rows are matched on month and day; the year is checked by `noInventedDates`. */
  date: string;
}

export interface DateMatrixExpect {
  /** The form's Date. `null`: none was stated, so the form keeps its default (today). */
  formDate?: string | null;
  /** With `formDate`: ONE "which date?" question is an acceptable answer instead. Never a blank Date. */
  formDateOrAsk?: boolean;
  /**
   * With followUpDate, lastDayWorked, noticeDate, noticeFulfilledDate or
   * resignationDate: ONE "which date?" question is acceptable instead.
   */
  dateOrAsk?: boolean;
  /** Every one of these is in the Observation / account. */
  incidentDates?: string[];
  /** Exactly these earlier steps are listed as Prior actions rows (`[]`: none is). */
  priorActions?: PriorExpectation[];
  /** `null`: no Follow-up date is shown. */
  followUpDate?: string | null;
  lastDayWorked?: string | null;
  noticeDate?: string | null;
  noticeFulfilledDate?: string | null;
  resignationDate?: string | null;
  /** No published template has this field today; kept for callers that add one. */
  effectiveDate?: string | null;
  /** Case-insensitive substrings the Observation / account must hold. */
  observationMustContain?: string[];
  /** Case-insensitive substrings it must not hold ("coached her on october 5" when the manager said 10-16). */
  observationMustNotContain?: string[];
  /** true: exactly one date question is asked; false: none is. */
  asksWhichDate?: boolean;
  /**
   * INFORMATIONAL, not a cell: the employee the card should name. Runners
   * record what they read, so a date cell that fails only because the name
   * was not read (no card) can be told apart.
   */
  employee?: string | null;
}

/** How the date is written, for grouping the report. */
export type DateFormatLabel = string;

export type DateRoleLabel =
  | "incident"
  | "incident list"
  | "prior"
  | "follow-up"
  | "last day worked"
  | "notice given"
  | "resignation"
  | "date edit"
  | "live";

export interface DateMatrixBase {
  id: string;
  form: DateMatrixForm;
  /** The manager's turns, in order. May hold `{place}`. */
  turns: string[];
  today: string;
  /** Every date format the turns use. */
  formats: DateFormatLabel[];
  /** The role this base was written to exercise, for grouping. */
  role: DateRoleLabel;
  /** The manager's own capitalisation, kept as the `typed` casing. */
  typed?: string[];
  /** Where the wording comes from: a live QA report, or written for the matrix. */
  source?: string;
  expect: DateMatrixExpect;
}

export interface DateMatrixCase extends DateMatrixBase {
  baseId: string;
  casing: DateMatrixCasing;
}

export const DATE_MATRIX_TODAY = "2026-10-26";
const TODAY = DATE_MATRIX_TODAY;

/* ---------------------------------------------------------------- formats -- */

interface FormatSpec {
  label: DateFormatLabel;
  /** As it follows "late": "on 10-16", "yesterday". */
  when: string;
  iso: string;
  /**
   * A shape main's readers do not read (QA-6): ONE question asking which date
   * is an acceptable answer instead of the date. Silence never is. A format
   * that is read today must stay read: no question.
   */
  askOk?: true;
}

const on = (label: string, text: string, iso: string): FormatSpec => ({ label, when: `on ${text}`, iso });
const bare = (label: string, text: string, iso: string): FormatSpec => ({ label, when: text, iso });
const unread = (format: FormatSpec): FormatSpec => ({ ...format, askOk: true });

/** The formats in the request, 16 October (and 5 October for the coordinator's additions). */
export const SPEC_FORMATS: readonly FormatSpec[] = [
  on("10-16", "10-16", "2026-10-16"),
  on("10/16", "10/16", "2026-10-16"),
  on("10-16-26", "10-16-26", "2026-10-16"),
  on("10/16/26", "10/16/26", "2026-10-16"),
  on("10-16-2026", "10-16-2026", "2026-10-16"),
  on("10/16/2026", "10/16/2026", "2026-10-16"),
  on("2026-10-16", "2026-10-16", "2026-10-16"),
  on("October 16", "October 16", "2026-10-16"),
  on("Oct 16th", "Oct 16th", "2026-10-16"),
  unread(on("16 Oct", "16 Oct", "2026-10-16")),
  unread(on("the 16th", "the 16th", "2026-10-16")),
  bare("today", "today", TODAY),
  unread(bare("yesterday", "yesterday", "2026-10-25")),
  unread(bare("last Friday", "last Friday", "2026-10-23")),
  on("yearless, not in the future (12-20)", "12-20", "2025-12-20"),
  unread(on("10.5", "10.5", "2026-10-05")),
  on("10/05/26", "10/05/26", "2026-10-05"),
  unread(on("5th of october", "5th of october", "2026-10-05")),
  on("oct 5th", "oct 5th", "2026-10-05"),
];

/** QA-6 (26 Oct 2026): formats main's readers drop in every role. */
export const QA6_UNREAD_FORMATS: readonly FormatSpec[] = [
  unread(on("2 october", "2 october", "2026-10-02")),
  unread(on("2nd of october", "2nd of october", "2026-10-02")),
  unread(on("october second", "october second", "2026-10-02")),
  unread(on("2-Oct", "2-Oct", "2026-10-02")),
  unread(on("10-2", "10-2", "2026-10-02")),
  unread(on("10.2", "10.2", "2026-10-02")),
  unread(on("1002", "1002", "2026-10-02")),
  unread(on("the 2nd", "the 2nd", "2026-10-02")),
];

/** QA-6: formats main's readers read. They must keep reading them. */
export const QA6_READ_FORMATS: readonly FormatSpec[] = [
  on("10/2", "10/2", "2026-10-02"),
  on("10/2/26", "10/2/26", "2026-10-02"),
  on("10.2.26", "10.2.26", "2026-10-02"),
  on("10/02/2026", "10/02/2026", "2026-10-02"),
  on("2026-10-02", "2026-10-02", "2026-10-02"),
  on("October 2", "October 2", "2026-10-02"),
  on("Oct 2nd", "Oct 2nd", "2026-10-02"),
  on("oct. 2", "oct. 2", "2026-10-02"),
  on("Oct 2nd 2026", "Oct 2nd 2026", "2026-10-02"),
  on("fri 10/2", "fri 10/2", "2026-10-02"),
];

const RELATIVE_FORMATS: readonly FormatSpec[] = [
  bare("today", "today", TODAY),
  bare("yesterday", "yesterday", "2026-10-25"),
  bare("last Friday", "last Friday", "2026-10-23"),
];

/**
 * A follow-up is ahead: Monday 2 November 2026. Each is labelled with the
 * shape it shares with the October formats above, so the report groups them.
 */
export const FOLLOW_UP_FORMATS: readonly FormatSpec[] = [
  on("10/2", "11/2", "2026-11-02"),
  on("10/2/26", "11/2/26", "2026-11-02"),
  on("10.2.26", "11.2.26", "2026-11-02"),
  on("10/02/2026", "11/02/2026", "2026-11-02"),
  on("2026-10-02", "2026-11-02", "2026-11-02"),
  on("October 2", "November 2", "2026-11-02"),
  on("Oct 2nd", "Nov 2nd", "2026-11-02"),
  on("oct. 2", "nov. 2", "2026-11-02"),
  on("Oct 2nd 2026", "Nov 2nd 2026", "2026-11-02"),
  on("fri 10/2", "mon 11/2", "2026-11-02"),
  unread(on("2 october", "2 november", "2026-11-02")),
  unread(on("2nd of october", "2nd of november", "2026-11-02")),
  unread(on("october second", "november second", "2026-11-02")),
  unread(on("2-Oct", "2-Nov", "2026-11-02")),
  unread(on("10-2", "11-2", "2026-11-02")),
  unread(on("10.2", "11.2", "2026-11-02")),
  unread(on("1002", "1102", "2026-11-02")),
];

const QA6_FORMATS = [...QA6_UNREAD_FORMATS, ...QA6_READ_FORMATS];

/** An id part that keeps the separator: "10/16", "10-16" and "10.16" are different formats. */
const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/\//g, "slash")
    .replace(/\./g, "dot")
    .replace(/,/g, "")
    .replace(/[()]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "");

/* ------------------------------------------------------------ role bases -- */

const NAME = "Rowan Pell";

function byFormat(
  role: DateRoleLabel,
  prefix: string,
  form: DateMatrixForm,
  formats: readonly FormatSpec[],
  build: (format: FormatSpec) => { turns: string[]; expect: DateMatrixExpect },
): DateMatrixBase[] {
  return formats.map((format) => ({
    id: `${prefix}-${slug(format.label)}`,
    form,
    today: TODAY,
    formats: [format.label],
    role,
    ...build(format),
  }));
}

const INCIDENT = byFormat("incident", "incident", "ca", [...SPEC_FORMATS, ...QA6_FORMATS], (f) => ({
  turns: [`ca for ${NAME}, she was late ${f.when}`],
  expect: { formDate: f.iso, formDateOrAsk: f.askOk, incidentDates: [f.iso], priorActions: [], employee: NAME },
}));

const INCIDENT_LIST = byFormat("incident list", "list", "ca", QA6_FORMATS, (f) => ({
  turns: [`ca for ${NAME}, she was late ${f.when} and 10/9 and 10/16`],
  expect: {
    formDate: f.iso,
    formDateOrAsk: true,
    incidentDates: [f.iso, "2026-10-09", "2026-10-16"],
    priorActions: [],
    employee: NAME,
  },
}));

const PRIOR = byFormat("prior", "prior", "ca", QA6_FORMATS, (f) => ({
  turns: [`written ca for ${NAME}, she was late on 10/20/26. she got a verbal warning ${f.when}`],
  expect: {
    formDate: "2026-10-20",
    incidentDates: ["2026-10-20"],
    priorActions: [{ kind: "verbal", date: f.iso }],
    followUpDate: null,
    employee: NAME,
  },
}));

const FOLLOW_UP = byFormat("follow-up", "follow-up", "ca", FOLLOW_UP_FORMATS, (f) => ({
  turns: [`ca for ${NAME}, she was late on 10/20/26, follow up ${f.when}`],
  expect: { formDate: "2026-10-20", followUpDate: f.iso, dateOrAsk: f.askOk, employee: NAME },
}));

/** The card is dated 10/16 first, so an edit that does nothing is seen. */
const EDIT_FROM = `ca for ${NAME}, she was late on 10/16/26`;

const DATE_EDIT = byFormat("date edit", "edit", "ca", [on("10-20", "10-20", "2026-10-20"), ...QA6_FORMATS], (f) => ({
  turns: [EDIT_FROM, `change the date to ${f.when.replace(/^on /, "")}`],
  expect: { formDate: f.iso, formDateOrAsk: f.askOk, employee: NAME },
}));

/** QA-6's date-edit probes (26 Oct 2026): the turn after a card. */
const DATE_EDIT_PROBES: DateMatrixBase[] = [
  {
    id: "edit-probe-with-prior",
    form: "ca",
    role: "date edit",
    source: "QA-6 date-edit probe, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16", "10/16"],
    turns: [EDIT_FROM, "change the date to 10-20, verbal was 9/15"],
    expect: { formDate: "2026-10-20", priorActions: [{ kind: "verbal", date: "2026-09-15" }], employee: NAME },
  },
  {
    id: "edit-probe-unread-with-prior",
    form: "ca",
    role: "date edit",
    source: "QA-6 date-edit probe, 26 Oct 2026",
    today: TODAY,
    formats: ["2 october", "10/16"],
    turns: [EDIT_FROM, "change the date to 2 october, verbal was 9/15"],
    expect: {
      formDate: "2026-10-02",
      formDateOrAsk: true,
      priorActions: [{ kind: "verbal", date: "2026-09-15" }],
      employee: NAME,
    },
  },
  {
    id: "edit-probe-two-dates",
    form: "ca",
    role: "date edit",
    source: "QA-6 date-edit probe, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16", "incident range (10-20 and 10-21)"],
    turns: [EDIT_FROM, "change the date to 10-20 and 10-21"],
    expect: { asksWhichDate: true, employee: NAME },
  },
];

const LAST_DAY = byFormat("last day worked", "last-day", "exit", [...QA6_FORMATS, ...RELATIVE_FORMATS], (f) => ({
  turns: [`create an exit form for ${NAME}, she resigned and her last day was ${f.when.replace(/^on /, "")}`],
  expect: { lastDayWorked: f.iso, dateOrAsk: f.askOk, employee: NAME },
}));

const NOTICE = byFormat("notice given", "notice", "exit", [...QA6_FORMATS, ...RELATIVE_FORMATS], (f) => ({
  turns: [`create an exit form for ${NAME}, she gave her two weeks notice ${f.when}`],
  expect: { noticeDate: f.iso, dateOrAsk: f.askOk, employee: NAME },
}));

const RESIGNED = byFormat("resignation", "quit", "exit", [...QA6_FORMATS, ...RELATIVE_FORMATS], (f) => ({
  turns: [`create an exit form for ${NAME}, she quit ${f.when}`],
  expect: { resignationDate: f.iso, dateOrAsk: f.askOk, employee: NAME },
}));

/* ------------------------------------------------------- live sentences -- */

/** "coached her on October 5" when the manager said 10-16: the event got another event's date. */
const NOT_COACHED_ON = (...dates: string[]) =>
  dates.flatMap((date) => [`coached her on ${date}`, `coached on ${date}`, `was coached on ${date}`]);

const LIVE: DateMatrixBase[] = [
  {
    id: "qa-late-coached",
    form: "ca",
    role: "live",
    source: "QA, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16", "incident range (10-5 and 10-15)"],
    turns: ["create a ca for Rory Vance, she was late on 10-5 and 10-15. i coached her on 10-16 about being late"],
    typed: ["create a ca for Rory Vance, she was late on 10-5 and 10-15. i coached her on 10-16 about being late"],
    expect: {
      formDate: "2026-10-05",
      formDateOrAsk: true,
      incidentDates: ["2026-10-05", "2026-10-15"],
      priorActions: [{ kind: "coaching", date: "2026-10-16" }],
      followUpDate: null,
      observationMustNotContain: NOT_COACHED_ON("10-5", "10/5", "october 5", "10-15", "october 15"),
      employee: "Rory Vance",
    },
  },
  {
    id: "qa-late-open-coached",
    form: "ca",
    role: "live",
    source: "QA, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16", "incident range (10-5 and 10-15)"],
    turns: ["create a ca for Rory Vance, she was late to open on 10-5 and 10-15. i coached her on 10-16 about being late"],
    typed: ["create a ca for Rory Vance, she was late to open on 10-5 and 10-15. i coached her on 10-16 about being late"],
    expect: {
      formDate: "2026-10-05",
      formDateOrAsk: true,
      incidentDates: ["2026-10-05", "2026-10-15"],
      priorActions: [{ kind: "coaching", date: "2026-10-16" }],
      followUpDate: null,
      observationMustNotContain: NOT_COACHED_ON("10-5", "10/5", "october 5", "10-15", "october 15"),
      employee: "Rory Vance",
    },
  },
  {
    id: "qa-coached-then-written",
    form: "ca",
    role: "live",
    source: "QA, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16"],
    turns: ["ca for Rory Vance, coached her 10-16, written warning on 10-20"],
    typed: ["ca for Rory Vance, coached her 10-16, written warning on 10-20"],
    expect: {
      formDate: null,
      priorActions: [
        { kind: "coaching", date: "2026-10-16" },
        { kind: "written", date: "2026-10-20" },
      ],
      followUpDate: null,
      employee: "Rory Vance",
    },
  },
  {
    id: "qa-coached-late-today",
    form: "ca",
    role: "live",
    source: "QA, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16", "today"],
    turns: ["create a ca for Rory Vance. i coached her on 10-16 about being late. she was late again today"],
    typed: ["create a ca for Rory Vance. i coached her on 10-16 about being late. she was late again today"],
    expect: {
      formDate: TODAY,
      incidentDates: [TODAY],
      priorActions: [{ kind: "coaching", date: "2026-10-16" }],
      followUpDate: null,
      observationMustContain: ["late again today"],
      employee: "Rory Vance",
    },
  },
  {
    id: "qa-came-late-coached",
    form: "ca",
    role: "live",
    source: "QA, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16"],
    turns: ["ca for Rory Vance, she came in late on 10-5, i coached her on 10-16"],
    typed: ["ca for Rory Vance, she came in late on 10-5, i coached her on 10-16"],
    expect: {
      formDate: "2026-10-05",
      incidentDates: ["2026-10-05"],
      priorActions: [{ kind: "coaching", date: "2026-10-16" }],
      followUpDate: null,
      observationMustNotContain: NOT_COACHED_ON("10-5", "10/5", "october 5"),
      employee: "Rory Vance",
    },
  },
  {
    id: "qa-coaching-form-held",
    form: "coaching",
    role: "live",
    source: "QA, 26 Oct 2026",
    today: TODAY,
    formats: ["10-16", "incident range (10-5 and 10-15)"],
    turns: ["coaching form for Rory Vance, she was late on 10-5 and 10-15, I coached her on 10-16 about being late"],
    typed: ["coaching form for Rory Vance, she was late on 10-5 and 10-15, I coached her on 10-16 about being late"],
    expect: {
      formDate: "2026-10-16",
      incidentDates: ["2026-10-05", "2026-10-15"],
      employee: "Rory Vance",
    },
  },
  {
    id: "b12-puppy-two-dates",
    form: "ca",
    role: "live",
    source: "Ask Bubbles live B12, two incident dates (coordinator, 26 Oct 2026)",
    today: TODAY,
    formats: ["10-16-26", "incident range (10-21-26 and 10-22-26)"],
    turns: [
      "do verbal for team member rowan pell. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-21-26 and 10-22-26 rowan was not scheduled to work and came in to show the team a new puppy. rowan was there 45 min",
    ],
    typed: [
      "do verbal for team member Rowan Pell. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-21-26 and 10-22-26 Rowan was not scheduled to work and came in to show the team a new puppy. Rowan was there 45 min",
    ],
    expect: {
      formDate: "2026-10-21",
      formDateOrAsk: true,
      incidentDates: ["2026-10-21", "2026-10-22"],
      // The year is typed, so the "not in the future" rule (yearless dates only) leaves 11-1-26 as typed.
      priorActions: [{ kind: "coaching", date: "2026-11-01" }],
      followUpDate: null,
      employee: NAME,
    },
  },
  ...(
    [
      [
        "b12-live-ncns-team-member",
        "Create a written CA for Odalys Merriweather, Team Member at {place}, Attendance, she was a no call no show on 10-21-26 and 10-22-26. Payroll deduct not applicable",
      ],
      [
        "b12-live-ncns-no-title",
        "Create a written CA for Odalys Merriweather at {place}, Attendance, she was a no call no show on 10-21-26 and 10-22-26. Payroll deduct not applicable",
      ],
      [
        "b12-live-ncns-no-comma",
        "Create a written CA for Odalys Merriweather Team Member at {place}, Attendance, she was a no call no show on 10-21-26 and 10-22-26. Payroll deduct not applicable",
      ],
      [
        "b12-live-ncns-short",
        "written ca for odalys merriweather, team member at {place}, attendance, she was a no call no show on 10-21-26 and 10-22-26. payroll deduct not applicable",
      ],
    ] as const
  ).map(
    ([id, said]): DateMatrixBase => ({
      id,
      form: "ca",
      role: "live",
      source: "Ask Bubbles live tester B12, exact wording (26 Oct 2026)",
      today: TODAY,
      formats: ["10-16-26", "incident range (10-21-26 and 10-22-26)"],
      turns: [said.toLowerCase()],
      ...(said === said.toLowerCase() ? {} : { typed: [said] }),
      expect: {
        formDate: "2026-10-21",
        formDateOrAsk: true,
        incidentDates: ["2026-10-21", "2026-10-22"],
        priorActions: [],
        employee: "Odalys Merriweather",
      },
    }),
  ),
  ...(
    [
      [
        "b10-live-comma",
        "Create a verbal CA for Odalys Merriweather, Team Member at {place}, Standards of Conduct, she was rude to a customer on 10-7-26. Payroll deduct not applicable",
      ],
      [
        "b10-live-no-comma",
        "Create a verbal CA for Odalys Merriweather Team Member at {place}, Standards of Conduct, she was rude to a customer on 10-7-26. Payroll deduct not applicable",
      ],
    ] as const
  ).map(
    ([id, said]): DateMatrixBase => ({
      id,
      form: "ca",
      role: "live",
      source: "Ask Bubbles live tester B10, exact wording (26 Oct 2026)",
      today: TODAY,
      formats: ["10-16-26"],
      turns: [said.toLowerCase()],
      typed: [said],
      expect: { formDate: "2026-10-07", incidentDates: ["2026-10-07"], priorActions: [], employee: "Odalys Merriweather" },
    }),
  ),
  {
    id: "b11-live-late-opening",
    form: "ca",
    role: "live",
    source: "Ask Bubbles live tester B11, exact wording (26 Oct 2026)",
    today: TODAY,
    formats: ["10-16-26"],
    turns: ["verbal ca for rory vance at {place}, late opening on 10-19-26, payroll deduction of $3.25 in the action plan"],
    expect: { formDate: "2026-10-19", incidentDates: ["2026-10-19"], priorActions: [], employee: "Rory Vance" },
  },
  {
    id: "priors-without-commas",
    form: "ca",
    role: "prior",
    source: "written for the matrix (priors run together, no commas)",
    today: TODAY,
    formats: ["10/16/26"],
    turns: [`written ca for ${NAME} late on 10/20/26 verbal warning 9/15/26 coaching 8/1/26`],
    expect: {
      formDate: "2026-10-20",
      incidentDates: ["2026-10-20"],
      priorActions: [
        { kind: "verbal", date: "2026-09-15" },
        { kind: "coaching", date: "2026-08-01" },
      ],
      followUpDate: null,
      employee: NAME,
    },
  },
  {
    id: "incident-range-from-to",
    form: "ca",
    role: "incident list",
    source: "written for the matrix",
    today: TODAY,
    formats: ["incident range (from 10-5 to 10-9)"],
    turns: [`ca for ${NAME}, she was late every day from 10-5 to 10-9`],
    expect: {
      formDate: "2026-10-05",
      formDateOrAsk: true,
      incidentDates: ["2026-10-05", "2026-10-09"],
      priorActions: [],
      employee: NAME,
    },
  },
  {
    id: "exit-last-day-weekday",
    form: "exit",
    role: "last day worked",
    source: "written for the matrix (a bare weekday is asked about)",
    today: TODAY,
    formats: ["bare weekday (friday)"],
    turns: [`create an exit form for ${NAME}, she resigned, her last day was friday`],
    expect: { lastDayWorked: null, asksWhichDate: true, employee: NAME },
  },
  {
    id: "exit-notice-and-fulfilled",
    form: "exit",
    role: "notice given",
    source: "written for the matrix",
    today: TODAY,
    formats: ["10/16/26", "10-16"],
    turns: [`create an exit form for ${NAME}, she gave notice 9/25/26 - fulfilled 10/9/26, her last day was 10-9`],
    expect: {
      noticeDate: "2026-09-25",
      noticeFulfilledDate: "2026-10-09",
      lastDayWorked: "2026-10-09",
      employee: NAME,
    },
  },
];

export const DATE_MATRIX_BASES: readonly DateMatrixBase[] = [
  ...LIVE,
  ...INCIDENT,
  ...INCIDENT_LIST,
  ...PRIOR,
  ...FOLLOW_UP,
  ...DATE_EDIT,
  ...DATE_EDIT_PROBES,
  ...LAST_DAY,
  ...NOTICE,
  ...RESIGNED,
];

/* ---------------------------------------------------------------- casings -- */

/** First letter of the text and of each sentence, and the pronoun "I". Names stay as they are. */
export function sentenceCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[.!?]\s+)([a-z])/g, (_all, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`)
    .replace(/\bi\b/g, "I");
}

export function inCasing(text: string, casing: Exclude<DateMatrixCasing, "typed">): string {
  if (casing === "lower") return text.toLowerCase();
  if (casing === "upper") return text.toUpperCase();
  return sentenceCase(text);
}

function expand(base: DateMatrixBase): DateMatrixCase[] {
  const cases: DateMatrixCase[] = (["lower", "sentence", "upper"] as const).map((casing) => ({
    ...base,
    id: `${base.id}/${casing}`,
    baseId: base.id,
    casing,
    turns: base.turns.map((turn) => inCasing(turn, casing)),
  }));
  if (base.typed && !cases.some((entry) => entry.turns.join("\n") === base.typed!.join("\n"))) {
    cases.push({ ...base, id: `${base.id}/typed`, baseId: base.id, casing: "typed", turns: [...base.typed] });
  }
  return cases;
}

export const DATE_MATRIX_CASES: readonly DateMatrixCase[] = DATE_MATRIX_BASES.flatMap(expand);
