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
  "ca-sales-negative-cleaning": { draft: { observation: "Observed:\nThe tanning beds were left dirty at close." }, revisions: [] },
  "ca-sales-wrong-items": {
    draft: { observation: "Observed:\nCorwen Fenwhistle rang up the wrong items on a guest's sale." },
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

/** The invented people of the flag sets (a function: not read as cases). */
export function flagSetPeople(): readonly DirectoryRow[] {
  return [GLOSSARY_CA, GLOSSARY_COACHING, SALES_MSB, SALES_LOW, SALES_WRONG_ITEMS, SALES_ATTENDANCE, SALES_CLEANING, SALES_NO_REASON];
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
    steps: [{ say: "create a corrective action for Corwen Fenwhistle for ringing up the wrong items on a guest's sale" }, { create: true }],
    expect: {
      says: "after Create, the draft cites the Standards of Conduct with a page (the card's own citation is still open)",
      check: (run) => all(noError(run), cardFor(run, "dpoa", "Corwen Fenwhistle"), savedCitesSoc(run)),
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
    expect: {
      says: "neither the card nor the draft cites the Standards of Conduct",
      check: (run) =>
        all(
          noError(run),
          cardFor(run, "dpoa", "Elowen Gorselandt"),
          SOC.test(policyLine(run.replies[0] ?? "")) && "the card cites the Standards of Conduct for cleaning",
          SOC.test(run.saved.policy_violated ?? "") && "Policy Violated is Standards of Conduct",
        ),
    },
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
