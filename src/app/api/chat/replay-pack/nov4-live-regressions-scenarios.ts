import { STAFF, type DirectoryRow } from "./cases";

/**
 * ============================================================================
 * REGRESSION SET #1 — THE SCENARIOS, AS PLAIN DATA (4 Nov 2026)
 * ============================================================================
 *
 * Ported from Ask Bubbles (c20e858, bb29452): the mechanism, in this app's
 * setting (salons, salon titles, invented people). Step B
 * (FORM_PATCH_REDUCER_ENABLED / FORM_REPLY_FROM_DIFF_ENABLED, the same flags
 * in both apps) was flipped live in the sibling app on 3 Nov and rolled back;
 * QA's testers ran the same chats here with the flags off. These are those
 * chats in the testers' words (people invented), plus QA's 20 name wordings.
 * Two readers share them:
 *
 *   `nov4-live-regressions-cases.ts`  the replay pack: the real chat route,
 *                                      production's flags, scripted models,
 *                                      asserted invariants (CI).
 *   `evals/live-regressions.eval.ts`  the same turns with the real models
 *                                      (LIVE=1 only, never in CI).
 *
 * Not a `*-cases.ts` file, so the pack's registry does not read it as cases.
 */

/** One step of a chat: a message, or the card's Create. */
export type LiveStep = { readonly say: string } | { readonly create: true };

export interface LiveScenario {
  readonly id: string;
  readonly roster: readonly DirectoryRow[];
  readonly steps: readonly LiveStep[];
  /** The form field the scenario is about, recorded by the live script. */
  readonly field: string | null;
}

/** The Kearney salon (KEARNEY's primary area in `cases.ts`). */
export const KEARNEY_SALON = "loc-0309";

/** A directory row at the Kearney salon. */
export const at = (id: string, firstName: string, lastName: string, positionName = "Tanning Consultant"): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [KEARNEY_SALON],
  positionName,
});

/* ---------------------------------------------------------------- people -- */

/*
 * The testers' people, invented: "Jane Doe" (the Corrective Action chat) and
 * "Dana Lane" (the coaching chat). This app makes no card for a name the
 * Woven roster does not have, and the testers' chats did make a card, so the
 * opening names are on the directory; the corrected names (Doe-Smith, Laine)
 * are NOT, and the header name stays as it was, as the testers saw.
 *
 * Jane's directory position is "Full-Time Tanning Consultant", so T5's
 * "change her position to Tanning Consultant" asks for a real change.
 */
export const JANE_DOE = at("r1-jane-doe", "Jane", "Doe", "Full-Time Tanning Consultant");
export const DANA_LANE = at("r1-dana-lane", "Dana", "Lane");
export const LIVE_ROSTER: readonly DirectoryRow[] = [...STAFF, JANE_DOE, DANA_LANE];
/** QA's invented name for the 20 wordings: on the directory only in the ON-roster runs. */
export const CORIN_BELLWEATHER = at("r1-corin-bellweather", "Corin", "Bellweather");

/* --------------------------------------------------- live Step B failures -- */

/**
 * The tester's Corrective Action chat, exact turns, one each in order; Create
 * after T1. T1–T3 are the Sunny tester's words; T4–T6 are the sibling app's
 * further turns, with values valid here.
 */
export const CA_CHAIN = [
  "Create a Corrective Action for Jane Doe, she was late to open on 10-20-26",
  "fix her last name, it is Doe-Smith",
  "redraft it and say she was also late on Tuesday",
  "set the daily stats to 3 of 4 shifts on time",
  "change her position to Tanning Consultant",
  "Add that she Must Practice the sanitizing checklist every shift.",
] as const;

/** The tester's coaching chat (Dana Lane), exact follow-up turns. */
export const COACHING_OPENING = "Create a coaching form for Dana Lane, she was late to open today";
export const COACHING_CHAIN = ["fix her last name, it is Laine", "make it sound more professional", "can you make it more professional"] as const;

/*
 * THE SCRIPTED MODEL OUTPUTS that reproduce the testers' BASELINE texts here
 * (flags off): the replay pack's `t.draftWrites` / `t.revisionWrites`, and
 * the stand-in models of the live script's LIVE_DRY=1 mode.
 */
/** The CA chat: [0] is the drafting model's Observation at Create; [k] the revision's after turn k+1 (null: it writes nothing). */
export const EXPECTATION = "\nExpectation:\nJane is expected to arrive on time and have the salon ready to open.";
const T3 = "Jane Doe-Smith was late to open on October 20, 2026. Jane was also late on Tuesday.";
export const OBSERVATION_AFTER: readonly (string | null)[] = [
  `Observed:\nJane Doe was late to open on October 20, 2026.${EXPECTATION}`,
  `Observed:\nJane Doe-Smith was late to open on October 20, 2026.${EXPECTATION}`,
  `Observed:\n${T3}${EXPECTATION}`,
  `Observed:\n${T3} Daily stats show 3 of 4 shifts on time.${EXPECTATION}`,
  // T5: the revision writes nothing.
  null,
  `Observed:\n${T3} Daily stats show 3 of 4 shifts on time. Jane must also practice the sanitizing checklist every shift.${EXPECTATION}`,
];

/** The coaching chat: the drafting model's Details at Create, then the revision's after each turn. */
export const DETAILS_LANE = "Observed:\nDana Lane was late to open the location today.\nExpectation:\nDana is expected to arrive on time and be ready to open.";
export const DETAILS_AFTER = [
  DETAILS_LANE.replace("Dana Lane", "Dana Laine"),
  "Observed:\nDana Laine did not arrive in time to open the location today.\nExpectation:\nDana will arrive on time and be prepared to open.",
  "Observed:\nDana Laine arrived after the scheduled opening time today.\nExpectation:\nDana is expected to arrive on time, prepared to open the salon.",
];

/** What the stand-in models write in LIVE_DRY=1: the draft at Create, and the revision before each edit turn (in order). */
export interface DryScript {
  readonly draft: Record<string, string>;
  readonly revisions: readonly Record<string, string>[];
  /** The checkboxes the stand-in draft ticks at Create (the replay pack's `t.draftWrites(values, checked)`). */
  readonly checked?: Record<string, string[]>;
}

export const DRY_SCRIPTS: Readonly<Record<string, DryScript>> = {
  "ca-chain": {
    draft: { observation: OBSERVATION_AFTER[0]! },
    revisions: OBSERVATION_AFTER.slice(1).map((observation): Record<string, string> => (observation ? { observation } : {})),
  },
  /** The live script's create repeat: T1 → Create, the same draft as the CA chat. */
  "create-repeat": { draft: { observation: OBSERVATION_AFTER[0]! }, revisions: [] },
  "coaching-chain": {
    draft: { coaching_details: DETAILS_LANE },
    revisions: DETAILS_AFTER.map((coaching_details) => ({ coaching_details })),
  },
  // The gate scenarios: Jane's draft as created; the stand-in revision writes nothing.
  ...Object.fromEntries(
    ["gate-edit-1", "gate-edit-2", "gate-edit-3", "gate-edit-4", "gate-edit-5", "gate-question-1", "gate-question-2", "gate-question-3"].map((id) => [
      id,
      { draft: { observation: OBSERVATION_AFTER[0]! }, revisions: [{}] },
    ]),
  ),
  // The ca-sales set's Creates: the replay pack's drafts, with an Under Performance tick the flag turns into the Standards of Conduct.
  "ca-sales-msb": {
    draft: { observation: "Observed:\nAurel Tregarthen did not perform the Must See Behaviors with guests during his shifts this week." },
    checked: { offense_type: ["under_performance"] },
    revisions: [],
  },
  "ca-sales-low-sales": {
    draft: { observation: "Observed:\nBriallen Coxworthy's sales were below her goals for October." },
    checked: { offense_type: ["under_performance"] },
    revisions: [],
  },
  "ca-sales-negative-attendance": {
    draft: { observation: "Observed:\nDagny Ravensholt arrived late to three shifts this week." },
    checked: { offense_type: ["tardiness"] },
    revisions: [],
  },
  // The cleaning negatives: the stand-in ticks Other, never the Standards of Conduct.
  "ca-sales-negative-cleaning": { draft: { observation: "Observed:\nThe tanning beds were left dirty at close." }, checked: { offense_type: ["other"] }, revisions: [] },
  "ca-sales-negative-cleaning-duties": {
    draft: { observation: "Observed:\nAnsgar Whitlowe did not complete his daily cleaning duties." },
    checked: { offense_type: ["other"] },
    revisions: [],
  },
  "ca-sales-wrong-items": {
    draft: { observation: "Observed:\nCorwen Fenwhistle rang up the wrong items on a guest's order." },
    checked: { offense_type: ["under_performance"] },
    revisions: [],
  },
};

/* ------------------------------------------ the edit tool's question gate -- */

/*
 * QA and Pau, 4 Nov 2026 (Step 3, FORM_EDIT_TOOL_IN_STREAM_ENABLED): with a
 * draft open, a real edit asked as a question must reach `edit_form`; a
 * question must not. Their exact wordings (ported from Ask Bubbles c5534279);
 * each is one scenario on Jane Doe's open Corrective Action at the Kearney
 * salon (T1, then Create, then the wording).
 */
export const GATE_EDIT_WORDINGS = [
  "can you change her last name to Laine?",
  "could you add that she was also late on Tuesday?",
  "would you make it sound more professional?",
  "is it possible to change the date to 10/20?",
  "can you set the daily stats to 3 of 4 shifts on time?",
] as const;
export const GATE_QUESTION_WORDINGS = ["what policy does that fall under?", "what is the policy on being late?", "can you tell me what the expectation is?"] as const;

export const GATE_SCENARIOS: readonly LiveScenario[] = [
  ...GATE_EDIT_WORDINGS.map((say, index) => ({ id: `gate-edit-${index + 1}`, say })),
  ...GATE_QUESTION_WORDINGS.map((say, index) => ({ id: `gate-question-${index + 1}`, say })),
].map(({ id, say }) => ({ id, roster: LIVE_ROSTER, field: "observation", steps: [{ say: CA_CHAIN[0] }, { create: true }, { say }] }));

export const LIVE_FAILURE_SCENARIOS: readonly LiveScenario[] = [
  { id: "ca-chain", roster: LIVE_ROSTER, field: "observation", steps: [{ say: CA_CHAIN[0] }, { create: true }, ...CA_CHAIN.slice(1).map((say) => ({ say }))] },
  { id: "coaching-chain", roster: LIVE_ROSTER, field: "coaching_details", steps: [{ say: COACHING_OPENING }, { create: true }, ...COACHING_CHAIN.map((say) => ({ say }))] },
  { id: "street-address", roster: LIVE_ROSTER, field: null, steps: [{ say: "Corrective action for 123 Main Street" }] },
  { id: "jane-doe", roster: LIVE_ROSTER, field: null, steps: [{ say: "I need a coaching form" }, { say: "On 10-20-26 Jane Doe was late" }] },
];

/* ------------------------------------------------- QA's 20 name wordings -- */

/*
 * QA'S EXACT MATRIX (4 Nov 2026): six templates × three casings, plus two of
 * Pau's sentences word for word. The casing applies to the whole sentence:
 * lower = toLowerCase(); sentence = as written, the name "Corin Bellweather";
 * caps = toUpperCase().
 *
 * TODO(QA): QA may send a further exact matrix. Add its wordings to
 * `NAME_TEMPLATES` (a template, cased three ways) or `NAME_EXACT` (a sentence
 * kept word for word), with the name as `{N}`, and give each a status in
 * `NAME_OPEN` in `nov4-live-regressions-cases.ts`.
 */
export const NAME = "Corin Bellweather";

export const NAME_TEMPLATES: readonly { readonly id: string; readonly text: string }[] = [
  { id: "first-nodate", text: "Corrective action: {N} was rude to a guest at the front desk on Monday" },
  { id: "first-date", text: "Corrective action: {N} was rude to a guest at the front desk on Monday 10/05/2026" },
  { id: "middle-nodate", text: "Corrective action: at the front desk {N} was rude to a guest on Monday" },
  { id: "middle-date", text: "Corrective action: on Monday 10/05/2026 at the front desk {N} was rude to a guest" },
  { id: "last-nodate", text: "Corrective action: a guest was treated rudely at the front desk on Monday by {N}" },
  { id: "last-date", text: "Corrective action: a guest was treated rudely at the front desk on Monday 10/05/2026 by {N}" },
];

/** Kept word for word: the manager's own sentences (the name in lower case as typed). */
export const NAME_EXACT: readonly { readonly id: string; readonly text: string; readonly typed: string }[] = [
  { id: "pau-1", text: "Corrective action: corin bellweather was rude to a guest at the front desk on Monday", typed: "corin bellweather" },
  {
    id: "pau-2",
    text: "Corrective action for the primary salon manager: on Monday 10/05/2026 corin bellweather was working a shift at the front desk and was rude to a guest",
    typed: "corin bellweather",
  },
];

const CASINGS = {
  lower: (text: string) => text.toLowerCase(),
  sentence: (text: string) => text,
  caps: (text: string) => text.toUpperCase(),
} as const;

export interface NameWording {
  /** e.g. "last-date-caps", "pau-2". */
  readonly id: string;
  readonly text: string;
  /** The name as it appears in the sentence. */
  readonly typed: string;
}

/** The 20 wordings, in QA's order: each template lower / sentence / caps, then Pau's two. */
export const NAME_WORDINGS: readonly NameWording[] = [
  ...NAME_TEMPLATES.flatMap((template) =>
    (Object.keys(CASINGS) as (keyof typeof CASINGS)[]).map((casing) => ({
      id: `${template.id}-${casing}`,
      text: CASINGS[casing](template.text.replace("{N}", NAME)),
      typed: CASINGS[casing](NAME),
    })),
  ),
  ...NAME_EXACT,
];

/** The name-matrix directory: Corin Bellweather on it (ON roster) or not (OFF roster). */
export function nameRoster(onRoster: boolean): readonly DirectoryRow[] {
  return onRoster ? [...STAFF, CORIN_BELLWEATHER] : [...STAFF];
}

export const NAME_SCENARIOS: readonly LiveScenario[] = NAME_WORDINGS.flatMap((wording) =>
  [true, false].map((onRoster) => ({
    id: `name-${wording.id}-${onRoster ? "on" : "off"}`,
    roster: nameRoster(onRoster),
    field: null,
    steps: [{ say: wording.text }],
  })),
);

/* ------------------------------------- the flag sets: glossary, ca-sales -- */

/*
 * Ported from Ask Bubbles (the mechanism; the people invented anew, the
 * wordings this app's own replay cases'). PAU'S FLAG PROCEDURE (4 Nov 2026): before each Production flip, QA runs the
 * live script in QA's own session with the flag on (LIVE_FLAGS), at most 30
 * Haiku calls (LIVE_CAP=30). Each set below is one LIVE_SCENARIOS value and
 * stays within 30 calls (counted under LIVE_DRY=1). Every scenario carries an
 * `expect`: a small predicate over the recorded run, written as PASS or FAIL
 * into the results. A FAIL is recorded, never a failed vitest run.
 *
 * Every person is invented (the repository is public) and is on these
 * scenarios' own roster only; none is on another fixture.
 */

/** What an `expect` reads: the recorded run of one scenario. */
export interface LiveOutcome {
  /** The last card the chat proposed (null: none). */
  readonly card: { readonly templateKey: string | null; readonly employeeName: string | null } | null;
  /** The last turn's reply. */
  readonly reply: string;
  /** Every chat reply, in order (Create's own turn excluded). */
  readonly replies: readonly string[];
  /** Every saved text value after Create (empty: no Create, or nothing saved). */
  readonly saved: Readonly<Record<string, string>>;
  /** Every saved checkbox value after Create, e.g. offense_type. */
  readonly checked: Readonly<Record<string, readonly string[]>>;
  readonly error: string | null;
  /** The live script only: the card each chat turn proposed (null: none that turn), Create's turn excluded. */
  readonly turnCards?: readonly ({ readonly templateKey: string | null; readonly employeeName: string | null } | null)[];
  /** The live script only: LIVE_FLAGS, the flags on top of production's in this run. */
  readonly flagsOn?: readonly string[];
}

/** A scenario's expected outcome: `check` returns null (PASS) or why it failed (FAIL). */
export interface LiveExpect {
  readonly says: string;
  readonly check: (run: LiveOutcome) => string | null;
}

export interface CheckedScenario extends LiveScenario {
  readonly expect: LiveExpect;
}

/** The first failing reason, or null when every check holds. */
function all(...checks: (string | false | null | undefined)[]): string | null {
  return checks.find((check): check is string => typeof check === "string") ?? null;
}

/** The card's "**Policy:**" line (empty: none). */
export function policyLine(reply: string): string {
  return reply.split("\n").find((line) => /\*\*Policy:?\*\*/i.test(line)) ?? "";
}

const SOC = /standards of conduct/i;
const PAGE = /\bp(?:age|\.)\s*\d+/i;
/** The existing question for a card with no employee ("Who is this form for? …"). */
const WHO = /who is this\b[^?\n]*\bfor\?|which (?:employee|team member)|who(?:'s| is) (?:it|this) for/i;

const cardFor = (run: LiveOutcome, templateKey: string, name: string) =>
  run.card?.templateKey === templateKey && run.card.employeeName === name ? null : `no ${templateKey} card for ${name} (card: ${run.card ? `${run.card.templateKey ?? "?"} / ${run.card.employeeName ?? "—"}` : "none"})`;
const noError = (run: LiveOutcome) => (run.error ? `error: ${run.error}` : null);
/** Create saved the draft: Policy Violated and Direct Policy both name the Standards of Conduct, with a page. */
const savedCitesSoc = (run: LiveOutcome) =>
  all(
    !SOC.test(run.saved.policy_violated ?? "") && `Policy Violated is not Standards of Conduct: "${run.saved.policy_violated ?? ""}"`,
    !SOC.test(run.saved.policy_language ?? "") && `Direct policy does not name the Standards of Conduct: "${(run.saved.policy_language ?? "").slice(0, 120)}"`,
    !PAGE.test(run.saved.policy_language ?? "") && "Direct policy has no page",
  );

const GLOSSARY_CA = at("lf-ferelith-marchbank", "Ferelith", "Marchbank");
const GLOSSARY_COACHING = at("lf-osric-wychbold", "Osric", "Wychbold");
const SALES_MSB = at("lf-aurel-tregarthen", "Aurel", "Tregarthen");
const SALES_LOW = at("lf-briallen-coxworthy", "Briallen", "Coxworthy");
const SALES_WRONG_ITEMS = at("lf-corwen-fenwhistle", "Corwen", "Fenwhistle");
const SALES_ATTENDANCE = at("lf-dagny-ravensholt", "Dagny", "Ravensholt");
const SALES_CLEANING = at("lf-elowen-gorselandt", "Elowen", "Gorselandt");
const SALES_NO_REASON = at("lf-ingram-brackenridge", "Ingram", "Brackenridge");
const SALES_CLEANING_DUTIES = at("lf-ansgar-whitlowe", "Ansgar", "Whitlowe");

/** The invented people of the flag sets (a function: not read as cases). */
export function flagSetPeople(): readonly DirectoryRow[] {
  return [GLOSSARY_CA, GLOSSARY_COACHING, SALES_MSB, SALES_LOW, SALES_WRONG_ITEMS, SALES_ATTENDANCE, SALES_CLEANING, SALES_NO_REASON, SALES_CLEANING_DUTIES];
}

const FLAG_SET_ROSTER: readonly DirectoryRow[] = [...STAFF, ...flagSetPeople()];

/** LIVE_SCENARIOS=glossary, for CHAT_GLOSSARY_ENABLED. */
export const GLOSSARY_SCENARIOS: readonly CheckedScenario[] = [
  {
    // QA's overnight scan, sf-s12, word for word.
    id: "glossary-sf-s12-msb",
    roster: FLAG_SET_ROSTER,
    field: null,
    steps: [{ say: "I need to make a corrective action for msb" }],
    expect: {
      says: "asks which employee; MSB is never the employee name",
      check: (run) =>
        all(
          noError(run),
          /\bmsb\b/i.test(run.card?.employeeName ?? "") && `the card names "${run.card?.employeeName}"`,
          /\bmsb\b/i.test(run.saved.employee_name ?? "") && `"${run.saved.employee_name}" is saved as the employee`,
          /\bfor \**msb\b|\bmsb\** (?:is not|isn'?t|was not|wasn'?t) (?:on|in)|find[^.\n]*\bmsb\b/i.test(run.reply) && "the reply treats MSB as a person",
          !WHO.test(run.reply) && "the reply does not ask which employee",
        ),
    },
  },
  {
    // Negative control: a normal Corrective Action for a person on the roster.
    id: "glossary-control-ca-name",
    roster: FLAG_SET_ROSTER,
    field: null,
    steps: [{ say: "Create a Corrective Action for Ferelith Marchbank, she was late to open on 10-20-26" }],
    expect: { says: "a CA card for Ferelith Marchbank (the name kept)", check: (run) => all(noError(run), cardFor(run, "dpoa", "Ferelith Marchbank")) },
  },
  {
    // Negative control: a name-only coaching request.
    id: "glossary-control-coaching-name",
    roster: FLAG_SET_ROSTER,
    field: null,
    steps: [{ say: "create a coaching document for Osric Wychbold" }],
    expect: { says: "a coaching card for Osric Wychbold", check: (run) => all(noError(run), cardFor(run, "coaching", "Osric Wychbold")) },
  },
];

/** The offense boxes Create ticked. */
const offenses = (run: LiveOutcome): readonly string[] => run.checked.offense_type ?? [];

/** A cleaning Corrective Action is not a Standards of Conduct one: Other is ticked, the Standards of Conduct is not, on the card or the draft. */
const cleaningNegative = (name: string): LiveExpect => ({
  says: "offense_type includes other and not standards_of_conduct; neither the card nor Policy Violated names the Standards of Conduct",
  check: (run) =>
    all(
      noError(run),
      cardFor(run, "dpoa", name),
      SOC.test(policyLine(run.replies[0] ?? "")) && "the card cites the Standards of Conduct for cleaning",
      !offenses(run).includes("other") && `offense_type does not include other: [${offenses(run).join(", ")}]`,
      offenses(run).includes("standards_of_conduct") && "offense_type includes standards_of_conduct",
      SOC.test(run.saved.policy_violated ?? "") && "Policy Violated is Standards of Conduct",
    ),
});

/** LIVE_SCENARIOS=ca-sales, for CA_SALES_POLICY_ENABLED: `nov4-ca-sales-policy-cases.ts`'s cases (this app's wordings), live. */
export const CA_SALES_SCENARIOS: readonly CheckedScenario[] = [
  {
    id: "ca-sales-msb",
    roster: FLAG_SET_ROSTER,
    field: "policy_language",
    steps: [{ say: "I need a corrective action for Aurel Tregarthen for MSB" }, { create: true }],
    expect: {
      says: "a CA card for Aurel Tregarthen citing the Standards of Conduct; the draft cites it with a page",
      check: (run) =>
        all(
          noError(run),
          cardFor(run, "dpoa", "Aurel Tregarthen"),
          !SOC.test(policyLine(run.replies[0] ?? "")) && "the card does not cite the Standards of Conduct",
          savedCitesSoc(run),
        ),
    },
  },
  {
    id: "ca-sales-low-sales",
    roster: FLAG_SET_ROSTER,
    field: "policy_language",
    steps: [{ say: "write a corrective action for Briallen Coxworthy, her sales are low and she is not hitting her goals" }, { create: true }],
    expect: {
      says: "a CA card for Briallen Coxworthy (a stated shortfall goes to the form) citing the Standards of Conduct; the draft cites it with a page",
      check: (run) =>
        all(
          noError(run),
          cardFor(run, "dpoa", "Briallen Coxworthy"),
          !SOC.test(policyLine(run.replies[0] ?? "")) && "the card does not cite the Standards of Conduct",
          savedCitesSoc(run),
        ),
    },
  },
  {
    id: "ca-sales-wrong-items",
    roster: FLAG_SET_ROSTER,
    field: "policy_language",
    // QA's wording for the live script ("a guest's order"; the replay case says "sale").
    steps: [{ say: "create a corrective action for Corwen Fenwhistle for ringing up the wrong items on a guest's order" }, { create: true }],
    expect: {
      says: "after Create, offense_type includes standards_of_conduct and Policy Violated names the Standards of Conduct",
      check: (run) =>
        all(
          noError(run),
          cardFor(run, "dpoa", "Corwen Fenwhistle"),
          !offenses(run).includes("standards_of_conduct") && `offense_type is not standards_of_conduct: [${offenses(run).join(", ")}]`,
          !SOC.test(run.saved.policy_violated ?? "") && `Policy Violated is not Standards of Conduct: "${run.saved.policy_violated ?? ""}"`,
        ),
    },
  },
  {
    id: "ca-sales-negative-attendance",
    roster: FLAG_SET_ROSTER,
    field: "policy_language",
    steps: [{ say: "I need a corrective action for Dagny Ravensholt, she was late to her shift three times this week" }, { create: true }],
    expect: {
      says: "the draft cites the Attendance Policy, never the Standards of Conduct (card or draft)",
      check: (run) =>
        all(
          noError(run),
          cardFor(run, "dpoa", "Dagny Ravensholt"),
          SOC.test(policyLine(run.replies[0] ?? "")) && "the card cites the Standards of Conduct for attendance",
          SOC.test(run.saved.policy_violated ?? "") && "Policy Violated is Standards of Conduct",
          !/attendance/i.test(run.saved.policy_language ?? "") && `Direct policy does not cite Attendance: "${(run.saved.policy_language ?? "").slice(0, 120)}"`,
        ),
    },
  },
  {
    id: "ca-sales-negative-cleaning",
    roster: FLAG_SET_ROSTER,
    field: "policy_violated",
    steps: [{ say: "make a corrective action for Elowen Gorselandt, the tanning beds were left dirty at close" }, { create: true }],
    expect: cleaningNegative("Elowen Gorselandt"),
  },
  {
    id: "ca-sales-negative-cleaning-duties",
    roster: FLAG_SET_ROSTER,
    field: "policy_violated",
    steps: [{ say: "make a corrective action for Ansgar Whitlowe, he did not complete daily cleaning duties" }, { create: true }],
    expect: cleaningNegative("Ansgar Whitlowe"),
  },
  {
    id: "ca-sales-negative-no-reason",
    roster: FLAG_SET_ROSTER,
    field: null,
    steps: [{ say: "make a CA for Ingram Brackenridge" }],
    expect: {
      says: "asks for the reason; cites no Standards of Conduct",
      check: (run) => all(noError(run), SOC.test(policyLine(run.reply)) && "the card cites a policy with no reason given", !/\?/.test(run.reply) && "no question for what happened"),
    },
  },
];

/* ------------------------------------- the managers' five MSB / sales messages -- */

/*
 * PAU, VIA QA (4 Nov 2026, 11:30 UTC): five EXACT real manager messages, the
 * name swapped for an invented one on the scenario roster (not on the
 * directory). Quoted manager text is kept word for word, metric names and all.
 * Each runs flag OFF and flag ON; in the live script that is two runs of
 * LIVE_SCENARIOS=managers, without and with
 * LIVE_FLAGS=CHAT_GLOSSARY_ENABLED,CA_SALES_POLICY_ENABLED (each within 30
 * calls). The replay pack runs the same five with production's flags and with
 * their fixFlags (`nov4-manager-msb-cases.ts`).
 *
 * Four criteria, one result column each:
 *   card       a card is made for the person (#2: it asks ONCE which employee);
 *   no-ask     it never asks what happened when the metrics or reason are given;
 *   msb-name   MSB is never saved or shown as a name;
 *   cites-soc  the card or the draft cites the Standards of Conduct with the
 *              manual heading and page (each card message has a Create step).
 */

export const MANAGER_CA_VERBAL = at("lf-eustace-merriweld", "Eustace", "Merriweld");
export const MANAGER_CA_METRICS = at("lf-tobiah-ellerslie", "Tobiah", "Ellerslie");
export const MANAGER_MSB_OCTOBER = at("lf-galen-thackeray", "Galen", "Thackeray");
export const MANAGER_MSB_SOC = at("lf-quintessa-harrowmere", "Quintessa", "Harrowmere");

/** The managers' five people (a function: not read as cases). */
export function managerMessagePeople(): readonly DirectoryRow[] {
  return [MANAGER_CA_VERBAL, MANAGER_CA_METRICS, MANAGER_MSB_OCTOBER, MANAGER_MSB_SOC];
}

export const MANAGER_ROSTER: readonly DirectoryRow[] = [...STAFF, ...managerMessagePeople()];

/** A question for what happened (the reason was given, so never asked). Test code: a text check. */
const ASKS_WHAT_HAPPENED = /what happened|what (?:did|has) [a-z]+ (?:do|done)\b|describe (?:what|the (?:incident|issue|behaviou?r))|what (?:was|is) the (?:issue|reason|incident|behaviou?r)|tell me (?:more )?(?:about )?what/i;
/** MSB (or Must See Behaviors) read as a person. */
const MSB_AS_NAME = /msb|must see/i;
const MSB_AS_PERSON = /\bfor \**msb\b|\bmsb\** (?:is not|isn'?t|was not|wasn'?t) (?:on|in)|find[^.\n]*\bmsb\b|\*\*msb\*\*/i;

export interface LiveCriterion {
  /** The result column: card, no-ask, msb-name, cites-soc; #5's live turns add their own (see MSB5_LIVE_CRITERIA). */
  readonly name: string;
  /** null: PASS; a string: FAIL, why; "n/a" is never returned (a criterion that does not apply is left out). */
  readonly check: (run: LiveOutcome) => string | null;
  /** The live script only: whether the criterion applies to this run's flags (absent: always). */
  readonly applies?: (flagsOn: readonly string[]) => boolean;
}

export interface ManagerMessage {
  readonly id: string;
  /** The manager's words, exact, with the invented name in place of theirs. */
  readonly text: string;
  /** null: #2, no name given (it asks which employee). */
  readonly person: DirectoryRow | null;
}

const fullName = (row: DirectoryRow) => `${row.firstName} ${row.lastName}`;

export const MANAGER_MESSAGES: readonly ManagerMessage[] = [
  {
    id: "mgr-1-verbal-metrics",
    text: `I need a corrective action verbal for ${fullName(MANAGER_CA_VERBAL)}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.`,
    person: MANAGER_CA_VERBAL,
  },
  { id: "mgr-2-msb-no-name", text: "I need to make a corrective action for msb", person: null },
  { id: "mgr-3-salon-metrics", text: `CA for ${fullName(MANAGER_CA_METRICS)} due to under performance in salon metrics`, person: MANAGER_CA_METRICS },
  { id: "mgr-4-msb-october", text: `MSB CA for ${fullName(MANAGER_MSB_OCTOBER)} for underperformance in the month of October`, person: MANAGER_MSB_OCTOBER },
  { id: "mgr-5-msb-soc", text: `${fullName(MANAGER_MSB_SOC)} did not follow must see behaviors which violates standards of conduct policy`, person: MANAGER_MSB_SOC },
];

/** The four criteria for one message (cites-soc left out for #2, which has no person to make a form for). */
export function managerCriteria(message: ManagerMessage): readonly LiveCriterion[] {
  const person = message.person;
  const criteria: LiveCriterion[] = [
    {
      name: "card",
      check: (run) => {
        if (run.error && !/NO CARD/.test(run.error)) return `error: ${run.error}`;
        if (!person) {
          const asked = (run.replies[0] ?? "").split(/(?<=[?.!])\s+/).filter((sentence) => WHO.test(sentence)).length;
          return asked === 1 ? null : `asks which employee ${asked} times (once expected)`;
        }
        return run.card?.employeeName === fullName(person) ? null : `no card for ${fullName(person)} (card: ${run.card ? `${run.card.templateKey ?? "?"} / ${run.card.employeeName ?? "—"}` : "none"})`;
      },
    },
    {
      name: "no-ask",
      check: (run) => {
        const asked = run.replies.find((reply) => ASKS_WHAT_HAPPENED.test(reply));
        return asked ? `asks what happened: "${(ASKS_WHAT_HAPPENED.exec(asked)?.[0] ?? "").slice(0, 60)}"` : null;
      },
    },
    {
      name: "msb-name",
      check: (run) =>
        all(
          MSB_AS_NAME.test(run.card?.employeeName ?? "") && `the card names "${run.card?.employeeName}"`,
          MSB_AS_NAME.test(run.saved.employee_name ?? "") && `"${run.saved.employee_name}" is saved as the employee`,
          run.replies.some((reply) => MSB_AS_PERSON.test(reply)) && "a reply shows MSB as a person",
        ),
    },
  ];
  if (person) {
    criteria.push({
      name: "cites-soc",
      check: (run) => {
        const line = policyLine(run.replies[0] ?? "");
        const onCard = SOC.test(line) && PAGE.test(line);
        const onDraft = SOC.test(run.saved.policy_language ?? "") && PAGE.test(run.saved.policy_language ?? "");
        return onCard || onDraft ? null : `no Standards of Conduct with a page (card: "${line.slice(0, 80)}", draft: "${(run.saved.policy_language ?? "").slice(0, 80)}")`;
      },
    });
  }
  return criteria;
}

export interface CriteriaScenario extends CheckedScenario {
  readonly criteria: readonly LiveCriterion[];
}

/** LIVE_SCENARIOS=managers: the five messages; a card message, then Create (the citation may only be on the draft). */
/*
 * #5 IN THE LIVE SCRIPT (the session that owns the Corrective Action work, 4
 * Nov 2026, behind CA_SALES_POLICY_ENABLED). The replay case for #5
 * (`nov4-manager-msb-cases.ts`) keeps `managerCriteria`; only the live run
 * has two turns, the message and then "yes", and then Create:
 *
 *   flag ON   t1-no-card     turn 1 makes no card;
 *             t1-offer-once  turn 1 has exactly ONE offer that opens "Do you
 *                            want a Corrective Action for <Name>?" and, in
 *                            the same paragraph, mentions "yes" and the
 *                            Standards of Conduct (matched by parts);
 *             t2-card        after "yes", a Corrective Action card for <Name>;
 *             t2-cites-soc   that card or its draft cites the Standards of
 *                            Conduct with heading and page;
 *   flag OFF  off-answer     turn 1 is a policy answer: no card, a reply;
 *             off-no-offer   turn 1 makes no offer;
 *   both      msb-name       MSB is never a name.
 */
export const MSB5_FLAG = "CA_SALES_POLICY_ENABLED";
const msb5On = (flags: readonly string[]) => flags.includes(MSB5_FLAG);
const msb5Off = (flags: readonly string[]) => !msb5On(flags);

/** The offers in a reply: each paragraph holding "Do you want a Corrective Action for <Name>?" (full or first name, bold or not). */
export function correctiveActionOffers(reply: string, person: DirectoryRow): string[] {
  const name = `(?:${person.firstName} ${person.lastName}|${person.firstName})`;
  const opener = new RegExp(`do you want a corrective action for \\**${name}\\**\\s*\\?`, "gi");
  return reply.split(/\n\s*\n/).flatMap((paragraph) => (paragraph.match(opener) ?? []).map(() => paragraph));
}

export function msb5LiveCriteria(person: DirectoryRow): readonly LiveCriterion[] {
  const name = fullName(person);
  const turn = (run: LiveOutcome, index: number) => run.turnCards?.[index] ?? null;
  return [
    { name: "t1-no-card", applies: msb5On, check: (run) => (turn(run, 0) ? `turn 1 made a card (${turn(run, 0)!.templateKey ?? "?"} / ${turn(run, 0)!.employeeName ?? "—"})` : null) },
    {
      name: "t1-offer-once",
      applies: msb5On,
      check: (run) => {
        const offers = correctiveActionOffers(run.replies[0] ?? "", person);
        if (offers.length !== 1) return `${offers.length} offers "Do you want a Corrective Action for ${person.firstName}…?" (one expected)`;
        return all(!/\byes\b/i.test(offers[0]!) && "the offer does not mention \"yes\"", !SOC.test(offers[0]!) && "the offer does not mention the Standards of Conduct");
      },
    },
    {
      name: "t2-card",
      applies: msb5On,
      check: (run) => {
        const card = turn(run, 1);
        return card?.templateKey === "dpoa" && card.employeeName === name ? null : `"yes" made no Corrective Action card for ${name} (card: ${card ? `${card.templateKey ?? "?"} / ${card.employeeName ?? "—"}` : "none"})`;
      },
    },
    {
      name: "t2-cites-soc",
      applies: msb5On,
      check: (run) => {
        const line = policyLine(run.replies[1] ?? "");
        const onCard = SOC.test(line) && PAGE.test(line);
        const onDraft = SOC.test(run.saved.policy_language ?? "") && PAGE.test(run.saved.policy_language ?? "");
        return onCard || onDraft ? null : `no Standards of Conduct with a page (card: "${line.slice(0, 80)}", draft: "${(run.saved.policy_language ?? "").slice(0, 80)}")`;
      },
    },
    {
      name: "off-answer",
      applies: msb5Off,
      check: (run) => all(turn(run, 0) !== null && "turn 1 made a card", !(run.replies[0] ?? "").trim() && `no answer${run.error ? ` (${run.error})` : ""}`),
    },
    { name: "off-no-offer", applies: msb5Off, check: (run) => (correctiveActionOffers(run.replies[0] ?? "", person).length ? "turn 1 offers a Corrective Action with the flag off" : null) },
    {
      name: "msb-name",
      check: (run) =>
        all(
          (run.turnCards ?? [run.card]).some((card) => MSB_AS_NAME.test(card?.employeeName ?? "")) && "a card names MSB",
          MSB_AS_NAME.test(run.saved.employee_name ?? "") && `"${run.saved.employee_name}" is saved as the employee`,
          run.replies.some((reply) => MSB_AS_PERSON.test(reply)) && "a reply shows MSB as a person",
        ),
    },
  ];
}

/** The criteria that apply to a run with these flags on top of production's. */
export function applicableCriteria(criteria: readonly LiveCriterion[], flagsOn: readonly string[]): readonly LiveCriterion[] {
  return criteria.filter((criterion) => !criterion.applies || criterion.applies(flagsOn));
}

/* ------------------------------- metrics and an off-roster name, as people -- */

/*
 * PAU'S MESSAGE 1, LIVE (4 Nov 2026): "I need a corrective action verbal for
 * <name>. This is for Under Performance on PPTA, LPSVA, Club Average, Club
 * Close %, and Spa %." The metric words must never be read as people, and a
 * typed name that is NOT on the roster must not be swapped for a roster
 * person who shares its first name.
 *
 *   no-metric-person  no metric phrase (Club Close, Under, Club Average, PPTA,
 *                     LPSVA, Spa), bold or not, appears as a name: not in a
 *                     "couldn't find" note, not in a "Which of them" question,
 *                     not as the card's employee, not in an "Is this for …?";
 *                     on mgr-1 and on the off-roster case;
 *   no-wrong-person   the card is never for the roster person who shares the
 *                     typed first name, and there is no "Is this for <them>?";
 *   slot-card         a card for the typed name (acceptable here: this app
 *                     has no "unchecked with a close name" branch); FAIL
 *                     records what came instead, either way only recorded.
 *
 * The live script only: the replay case for mgr-1 (`nov4-manager-msb-cases.ts`)
 * keeps `managerCriteria`. Every person is invented; the typed name is on no
 * directory, the trap is on this case's roster only.
 */

/** The typed name: on no roster. */
export const OFF_ROSTER_TYPED = "Leofric Arkwell";
/** The trap: on the case's roster, the typed first name with another surname. */
export const OFF_ROSTER_TRAP = at("lf-leofric-dunmarrow", "Leofric", "Dunmarrow");
const OFF_ROSTER_ROSTER: readonly DirectoryRow[] = [...MANAGER_ROSTER, OFF_ROSTER_TRAP];

/** The metric phrases of Pau's message 1, as a name would show them. */
const METRIC_AS_NAME = /\b(?:club close|club average|under|ppta|lpsva|spa)\b/i;

const nameList = (list: string) =>
  list
    .split(/,\s*|\s+or\s+|\s+and\s+/i)
    .map((name) => name.replace(/\*/g, "").trim())
    .filter(Boolean);

/** The names a reply's "I couldn't find … in the Woven roster" note gives as not found. */
export function notFoundNames(reply: string): string[] {
  return [...reply.matchAll(/(?:couldn'?t|could not|can'?t|cannot) find ([^.?!\n]*?)(?= (?:in|on) the (?:woven )?(?:roster|directory)|[.?!\n]|$)/gi)].flatMap((match) => nameList(match[1] ?? ""));
}

/** The names a reply asks about as people: "Which of them is this … for — A or B?", "Is this for A?", "a close match for A". */
export function askedNames(reply: string): string[] {
  return [
    ...[...reply.matchAll(/which of (?:them|these)[^?\n]*?—([^?\n]*)\?/gi)].flatMap((match) => nameList(match[1] ?? "")),
    ...[...reply.matchAll(/is this for ([^?\n]*)\?/gi)].flatMap((match) => nameList(match[1] ?? "")),
    ...[...reply.matchAll(/close match for ([^.?!\n,]*)/gi)].flatMap((match) => nameList(match[1] ?? "")),
  ];
}

const everyCard = (run: LiveOutcome) => [...(run.turnCards ?? []), run.card];
const sameName = (a: string | null | undefined, b: string) => (a ?? "").replace(/\*/g, "").trim().toLowerCase() === b.toLowerCase();

export const NO_METRIC_PERSON: LiveCriterion = {
  name: "no-metric-person",
  check: (run) => {
    const shown = [...new Set(run.replies.flatMap((reply) => [...notFoundNames(reply), ...askedNames(reply)]).filter((name) => METRIC_AS_NAME.test(name)))];
    const card = everyCard(run).find((entry) => METRIC_AS_NAME.test(entry?.employeeName ?? ""));
    return all(
      card && `a card names "${card.employeeName}"`,
      METRIC_AS_NAME.test(run.saved.employee_name ?? "") && `"${run.saved.employee_name}" is saved as the employee`,
      shown.length > 0 && `a reply shows ${shown.map((name) => `"${name}"`).join(", ")} as a person`,
    );
  },
};

export function offRosterCriteria(typed: string, trap: DirectoryRow): readonly LiveCriterion[] {
  const trapName = fullName(trap);
  return [
    NO_METRIC_PERSON,
    {
      name: "no-wrong-person",
      check: (run) =>
        all(
          everyCard(run).some((card) => sameName(card?.employeeName, trapName)) && `a card is for ${trapName}`,
          sameName(run.saved.employee_name, trapName) && `"${trapName}" is saved as the employee`,
          run.replies.some((reply) => [...reply.matchAll(/is this for ([^?\n]*)\?/gi)].some((match) => sameName(match[1], trapName))) && `asks "Is this for ${trapName}?"`,
        ),
    },
    {
      name: "slot-card",
      check: (run) => {
        if (sameName(run.card?.employeeName, typed)) return null;
        const missing = [...new Set(run.replies.flatMap(notFoundNames))];
        return `no card for ${typed} (card: ${run.card ? `${run.card.templateKey ?? "?"} / ${run.card.employeeName ?? "—"}` : "none"}; not found: ${missing.length ? missing.map((name) => `"${name}"`).join(", ") : "none"})`;
      },
    },
  ];
}

const offRosterCriteriaFor = offRosterCriteria(OFF_ROSTER_TYPED, OFF_ROSTER_TRAP);

/** LIVE_SCENARIOS=managers, after the five: Pau's message 1 with a typed name on no roster. */
export const OFF_ROSTER_SCENARIO: CriteriaScenario = {
  id: "mgr-1-off-roster-name",
  roster: OFF_ROSTER_ROSTER,
  field: null,
  steps: [{ say: `I need a corrective action verbal for ${OFF_ROSTER_TYPED}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.` }],
  criteria: offRosterCriteriaFor,
  expect: {
    says: `no metric shown as a person; never ${fullName(OFF_ROSTER_TRAP)}; a card for ${OFF_ROSTER_TYPED}`,
    check: (run) => all(...offRosterCriteriaFor.map((criterion) => criterion.check(run))),
  },
};

/* ------------------------- a roster person typed short, beside the metrics -- */

/*
 * QA, 4 NOV 2026, 19:21 UTC (CA_SALES_POLICY_ENABLED rolled back in this app):
 * live, a REAL roster employee, Pau's message 1, CA_SALES on and FORM_NAME
 * off, made a card whose Employee was "Club Close" (conv_mw2i2avm22egfhe). In
 * the replay harness the same happens when a roster person is typed by first
 * name only or by first name and last initial; a full name gets the person's
 * card. So the live script runs Pau's message 1 with mgr-1's roster person
 * typed both short ways.
 *
 *   no-metric-person  as above;
 *   roster-person     the card's employee is the roster person, or the reply
 *                     asks "Is this for <them>?" — never a metric, never the
 *                     short name alone (FAIL records the card and any
 *                     close-match note).
 *
 * The person is mgr-1's invented roster person; nobody else on MANAGER_ROSTER
 * shares the first name.
 */

/**
 * `metrics`: the message gives a metric shortfall, which with
 * CA_SALES_POLICY_ENABLED off gets the metric-only answer (no card, no
 * question) — so the criterion applies only with that flag on.
 */
export function rosterPersonCriterion(person: DirectoryRow, metrics = true): LiveCriterion {
  const name = fullName(person);
  return {
    name: "roster-person",
    ...(metrics ? { applies: (flagsOn: readonly string[]) => flagsOn.includes("CA_SALES_POLICY_ENABLED") } : {}),
    check: (run) => {
      if (sameName(run.card?.employeeName, name)) return null;
      if (run.replies.some((reply) => [...reply.matchAll(/is this for ([^?\n]*)\?/gi)].some((match) => sameName(match[1], name)))) return null;
      const note = (run.card as { wovenCloseMatch?: string } | null)?.wovenCloseMatch;
      return `no card for ${name} and no "Is this for ${name}?" (card: ${run.card ? `${run.card.templateKey ?? "?"} / ${run.card.employeeName ?? "—"}${note ? `, note "${note}"` : ""}` : "none"})`;
    },
  };
}

/** How the roster person is typed: first name only, first name and last initial. */
export const ROSTER_SHORT_SHAPES: readonly { readonly id: string; readonly typed: (person: DirectoryRow) => string }[] = [
  { id: "first-name", typed: (person) => person.firstName },
  { id: "first-initial", typed: (person) => `${person.firstName} ${person.lastName.charAt(0)}` },
];

/** LIVE_SCENARIOS=managers, after the off-roster case: mgr-1's roster person typed short. */
export const ROSTER_SHORT_SCENARIOS: readonly CriteriaScenario[] = ROSTER_SHORT_SHAPES.map(({ id, typed }) => {
  const person = MANAGER_CA_VERBAL;
  const criteria = [NO_METRIC_PERSON, rosterPersonCriterion(person)];
  return {
    id: `mgr-1-roster-${id}`,
    roster: MANAGER_ROSTER,
    field: null,
    steps: [{ say: `I need a corrective action verbal for ${typed(person)}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.` }],
    criteria,
    expect: {
      says: `typed "${typed(person)}": no metric shown as a person; a card for ${fullName(person)} or "Is this for ${fullName(person)}?" (CA_SALES_POLICY_ENABLED on)`,
      check: (run) => all(...applicableCriteria(criteria, run.flagsOn ?? []).map((criterion) => criterion.check(run))),
    },
  };
});

/*
 * QA, 4 NOV 2026, 19:26–19:41 UTC (CA_SALES_POLICY_ENABLED OFF in production):
 * the tester was thought to have typed Employee R's FULL roster name (8
 * letters, 4 letters, copied from the staff picker), and production gave
 *   (A) "Create a Corrective Action for <full name>" → a card with an EMPTY
 *       employee and "Who is this form for?" (conv_mw2id8ky2do6is8);
 *   (B) "I need a corrective action for <full name>. This is for Under
 *       Performance on Club Close % and Spa %." → a card for "Club Close"
 *       (conv_mw2idhu42wdjlet);
 *   (P1) Pau's message 1 → a card for "Club Close" (conv_mw2ibcm02l42nya).
 * The stored messages show the pasted "name" was "Coaching Form" (see the
 * form-name scenarios below). These stay as controls: an invented Tanning
 * Consultant of that shape, typed in full, at mgr-1's salon; criteria
 * no-metric-person and roster-person.
 */
export const EMPLOYEE_R_SHAPED = at("lf-marigold-vess", "Marigold", "Vess");
const EMPLOYEE_R_ROSTER: readonly DirectoryRow[] = [...MANAGER_ROSTER, EMPLOYEE_R_SHAPED];

export const QA_FULL_NAME_SCENARIOS: readonly CriteriaScenario[] = (
  [
    ["qa-full-a-alone", `Create a Corrective Action for ${fullName(EMPLOYEE_R_SHAPED)}`],
    ["qa-full-b-metrics", `I need a corrective action for ${fullName(EMPLOYEE_R_SHAPED)}. This is for Under Performance on Club Close % and Spa %.`],
    ["qa-full-p1", `I need a corrective action verbal for ${fullName(EMPLOYEE_R_SHAPED)}. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %.`],
  ] as const
).map(([id, say]) => {
  const criteria = [NO_METRIC_PERSON, rosterPersonCriterion(EMPLOYEE_R_SHAPED, id !== "qa-full-a-alone")];
  return {
    id,
    roster: EMPLOYEE_R_ROSTER,
    field: null,
    steps: [{ say }],
    criteria,
    expect: {
      says: `no metric shown as a person; a card for ${fullName(EMPLOYEE_R_SHAPED)} or "Is this for ${fullName(EMPLOYEE_R_SHAPED)}?"`,
      check: (run: LiveOutcome) => all(...applicableCriteria(criteria, run.flagsOn ?? []).map((criterion) => criterion.check(run))),
    },
  };
});

/*
 * The same three production messages as stored: "Coaching Form" where the
 * person goes. The named form wins (a Coaching Form card) and "Club Close"
 * became its employee, with CA_SALES off.
 *
 *   no-metric-person  as above;
 *   asks-who          a card with no employee asks "Who is this form for?",
 *                     and no reply says "I have the employee";
 *   ca-wins           Pau, 4 Nov 2026: any card is a Corrective Action, never
 *                     the form named where the person goes.
 */
const ASKS_WHO_CRITERION: LiveCriterion = {
  name: "asks-who",
  check: (run) =>
    all(
      run.replies.some((reply) => /I have the employee/i.test(reply)) && "a reply says it has the employee",
      run.card && !run.card.employeeName && !run.replies.some((reply) => /Who is this (?:\*\*[^*]+\*\* |form )?for\?/.test(reply)) && "a card with no employee does not ask who",
    ),
};

/** Pau, 4 Nov 2026: a corrective action asked for, with another form's name after "for", is a Corrective Action. */
const CA_WINS_CRITERION: LiveCriterion = {
  name: "ca-wins",
  check: (run) => (everyCard(run).some((card) => card && card.templateKey !== "dpoa") ? `a ${everyCard(run).find((card) => card && card.templateKey !== "dpoa")?.templateKey} card, not a Corrective Action` : null),
};

export const QA_FORM_NAME_SCENARIOS: readonly CriteriaScenario[] = (
  [
    ["qa-form-name-a-alone", "Create a Corrective Action for Coaching Form"],
    ["qa-form-name-b-metrics", "I need a corrective action for Coaching Form. This is for Under Performance on Club Close % and Spa %."],
    ["qa-form-name-p1", "I need a corrective action verbal for Coaching Form. This is for Under Performance on PPTA, LPSVA, Club Average, Club Close %, and Spa %."],
  ] as const
).map(([id, say]) => {
  const criteria = [NO_METRIC_PERSON, ASKS_WHO_CRITERION, CA_WINS_CRITERION];
  return {
    id,
    roster: MANAGER_ROSTER,
    field: null,
    steps: [{ say }],
    criteria,
    expect: {
      says: "no metric shown as a person or on the card; a card with no employee asks who; any card is a Corrective Action",
      check: (run: LiveOutcome) => all(...criteria.map((criterion) => criterion.check(run))),
    },
  };
});

const MANAGER_MESSAGE_SCENARIOS: readonly CriteriaScenario[] = MANAGER_MESSAGES.map((message): CriteriaScenario => {
  if (message.id === "mgr-5-msb-soc" && message.person) {
    const criteria = msb5LiveCriteria(message.person);
    return {
      id: message.id,
      roster: MANAGER_ROSTER,
      field: "policy_language",
      steps: [{ say: message.text }, { say: "yes" }, { create: true }],
      criteria,
      expect: {
        says: `${MSB5_FLAG} on: no card, one offer "Do you want a Corrective Action for ${message.person.firstName}…?" (yes, Standards of Conduct); "yes" → a CA card citing the Standards of Conduct with a page. Off: a policy answer, no offer. MSB never a name`,
        check: (run) => all(...applicableCriteria(criteria, run.flagsOn ?? []).map((criterion) => criterion.check(run))),
      },
    };
  }
  // mgr-1 also: its metric words are never a name (the live script only; the replay case keeps managerCriteria).
  const criteria = message.id === "mgr-1-verbal-metrics" ? [...managerCriteria(message), NO_METRIC_PERSON] : managerCriteria(message);
  return {
    id: message.id,
    roster: MANAGER_ROSTER,
    field: message.person ? "policy_language" : null,
    steps: message.person ? [{ say: message.text }, { create: true }] : [{ say: message.text }],
    criteria,
    expect: {
      says: message.person ? `a card for ${fullName(message.person)}; no "what happened"; MSB never a name; cites the Standards of Conduct with a page` : "asks once which employee; no \"what happened\"; MSB never a name",
      check: (run) => all(...criteria.map((criterion) => criterion.check(run))),
    },
  };
});

export const MANAGER_SCENARIOS: readonly CriteriaScenario[] = [...MANAGER_MESSAGE_SCENARIOS, OFF_ROSTER_SCENARIO, ...ROSTER_SHORT_SCENARIOS, ...QA_FULL_NAME_SCENARIOS, ...QA_FORM_NAME_SCENARIOS];

/** The stand-in draft for a manager message's Create (LIVE_DRY=1), with the Under Performance tick the flag turns into the Standards of Conduct. */
export function managerDryScripts(): Record<string, DryScript> {
  return Object.fromEntries(
    MANAGER_MESSAGES.filter((message) => message.person).map((message) => [
      message.id,
      { draft: { observation: `Observed:\n${fullName(message.person!)} did not meet the expected performance standards.` }, checked: { offense_type: ["under_performance"] }, revisions: [] },
    ]),
  );
}
