import { at, type CheckedScenario, type LiveOutcome, type LiveStep } from "./nov4-live-regressions-scenarios";
import { STAFF, type DirectoryRow } from "./cases";

/**
 * ============================================================================
 * STEP B'S TARGET: EVERY REAL "I HAVEN'T CHANGED THE <FORM>" (7 Nov 2026)
 * ============================================================================
 *
 * QA (coding 5's brief, 7 Nov 2026): each case is a production turn where the
 * app replied "I haven't changed the <form> — everything on it is as it was."
 * The manager's words are exact; the people are invented (none is in either
 * app's employee directory); a store or a company term is this app's where
 * the sibling's was (Bubbles ↔ Sunny, store ↔ salon). Earlier turns are kept
 * where they make the context, trimmed where they only repeat it.
 *
 *   bub-*  the sibling app' 7 (project dyurgwieyltnhphihwwj, 25 Oct – 3 Nov), the
 *          mechanism in this app's setting.
 *   sun-*  Ask Sunny's 9 (project rbkylaavthsjepsczccv, 27 Oct – 6 Nov).
 *   trace-* coding 2's real-AI trace (6 Nov) of the same chats with Step B on.
 *
 * Two readers share them:
 *   `nov7-step-b-refusals-cases.ts`  the replay pack: real route, scripted
 *                                     models (`patch` below), invariants (CI).
 *   `evals/live-regressions.eval.ts` the same steps with the real models,
 *                                     LIVE_SCENARIOS=step-b-refusals (QA only).
 *
 * `expect` is the outcome after the edit: what the form must say (or, where
 * the manager gave nothing to write, that nothing was invented and the reply
 * does not say it changed). Not a `*-cases.ts` file: the registry skips it.
 */

/* ---------------------------------------------------------------- people -- */

export const WRENNA = at("s7-wrenna", "Wrenna", "Thistlecombe");
export const OSWIN = at("s7-oswin", "Oswin", "Marchbank");
export const LIESEL = at("s7-liesel", "Liesel", "Quarrington");
export const CORVINA = at("s7-corvina", "Corvina", "Vellacott");
export const ISOLDE = at("s7-isolde", "Isolde", "Pembrook");
export const BRIONY = { ...at("s7-briony", "Briony", "Tallisker"), positionName: null } satisfies DirectoryRow;
export const PERRIN = at("s7-perrin", "Perrin", "Fennimore");
export const MAELIS = at("s7-maelis", "Maelis", "Harrowgate");
export const ANSEL = at("s7-ansel", "Ansel", "Larkspur");
export const GALEN = { ...at("s7-galen", "Galen", "Winterbourne"), positionName: null } satisfies DirectoryRow;
export const SABELINE = at("s7-sabeline", "Sabeline", "Delacourt");
export const THADDEUS = at("s7-thaddeus", "Thaddeus", "Lowestoft");
export const LEOPOLD = at("s7-leopold", "Leopold", "Ashdown");
export const OTTOLINE = at("s7-ottoline", "Ottoline", "Fenwright");

export const REFUSAL_ROSTER: readonly DirectoryRow[] = [
  ...STAFF,
  WRENNA,
  OSWIN,
  LIESEL,
  CORVINA,
  ISOLDE,
  BRIONY,
  PERRIN,
  MAELIS,
  ANSEL,
  GALEN,
  SABELINE,
  THADDEUS,
  LEOPOLD,
  OTTOLINE,
];

/* ------------------------------------------------------ scripted readings -- */

type PatchSet = { field: string; value?: string; options?: string[]; how: "add" | "replace" | "reword"; evidence: string };
/** One form-patch model output, as the model returns it. */
export function patch(turn: "this_form" | "question" | "other", set: readonly PatchSet[] = []) {
  return { turn, set: [...set], clear: [] };
}

/** What the replay pack scripts for a scenario: the draft at Create, the answering model's text per message, the patch reading per message. */
export interface RefusalScript {
  readonly draft?: Readonly<Record<string, string>>;
  readonly checked?: Readonly<Record<string, string[]>>;
  /** By the manager's message (exact): the answering model's text that turn. */
  readonly says?: Readonly<Record<string, string>>;
  /** By the manager's message (exact): the form-patch model's raw output. A message not listed falls back. */
  readonly patch?: Readonly<Record<string, unknown>>;
}

export interface RefusalScenario extends CheckedScenario {
  /** Where it was reported, and the refused message. */
  readonly report: string;
  /** The message production answered "I haven't changed the …". */
  readonly refused: string;
  readonly script: RefusalScript;
  /**
   * What Step B cannot do and which path owns it (a name correction is the
   * correction path's; a question is the answer's). Null: Step B's reader
   * owns the turn.
   */
  readonly owner: string | null;
}

/* ------------------------------------------------------------- checks ---- */

function all(...checks: (string | false | null | undefined)[]): string | null {
  return checks.find((check): check is string => typeof check === "string") ?? null;
}
const noError = (run: LiveOutcome) => (run.error ? `error: ${run.error}` : null);
const has = (run: LiveOutcome, field: string, pattern: RegExp, what: string) =>
  pattern.test(run.saved[field] ?? "") ? null : `${field} ${what}: "${(run.saved[field] ?? "").slice(0, 160)}"`;
const hasNot = (run: LiveOutcome, field: string, pattern: RegExp, what: string) =>
  pattern.test(run.saved[field] ?? "") ? `${field} ${what}: "${(run.saved[field] ?? "").slice(0, 160)}"` : null;
/** The refusal itself, on the last reply. */
export const REFUSAL = /^I haven't changed the\b/;
const notRefused = (run: LiveOutcome) => (REFUSAL.test(run.reply) ? `still refused: "${run.reply.slice(0, 120)}"` : null);
/** No reply claims a change about the form (for turns that have nothing to write). */
const CLAIM = /\b(?:updated|changed|added|now reads|now says|is on the card)\b/i;
const noClaim = (run: LiveOutcome) => (CLAIM.test(run.reply) && !/\bhaven't changed|\bdidn't change|\bnot changed\b/i.test(run.reply) ? `the reply claims a change: "${run.reply.slice(0, 120)}"` : null);
const created = (run: LiveOutcome) => (Object.keys(run.saved).length === 0 ? "no form was created" : null);

const say = (text: string): LiveStep => ({ say: text });
const CREATE: LiveStep = { create: true };

/* ------------------------------------------------------------ Bubbles 7 -- */

const BUB_PHONE = "add that she was also on her phone";
const BUB_SHIPPED = "oswin marked a lotion order as picked up but the client hadn't come in yet";
const BUB_DIDNT_EDIT = "it didnt edit in the card";
const BUB_DATE_Q = "What's the date on the form for these details?";
const BUB_REDO = "redo corvina ashdown vellacott";
const BUB_FENWICK = "fix her last name, it is Pembrooke";
const BUB_POSITION = "change her position to Assistant Salon Director";

export const BUBBLES_REFUSALS: readonly RefusalScenario[] = [
  {
    id: "bub-phone",
    report: 'the sibling app, 25 Oct 2026: "create a written CA for <name> at <store> for missing the 10-15-26 woven deadline" → card → "add that she was also on her phone"',
    refused: BUB_PHONE,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "observation",
    steps: [say("create a written CA for Wrenna Thistlecombe at Kearney for missing the 10-15-26 woven deadline"), CREATE, say(BUB_PHONE)],
    script: {
      draft: { observation: "Observed:\nWrenna Thistlecombe missed the October 15, 2026 Woven deadline." },
      patch: { [BUB_PHONE]: patch("this_form", [{ field: "observation", value: "She was also on her phone.", how: "add", evidence: "she was also on her phone" }]) },
    },
    expect: {
      says: "the Observation keeps the Woven deadline and adds that she was also on her phone",
      check: (run) => all(noError(run), created(run), has(run, "observation", /on her phone/i, "does not say she was on her phone"), has(run, "observation", /woven deadline/i, "lost the Woven deadline"), notRefused(run)),
    },
  },
  {
    id: "bub-didnt-edit",
    report:
      'the sibling app, 30 Oct 2026: coaching form → "can you upate the draft with these details of coaching?" → "<name> marked an order as … before the customer … yet" (here: a lotion order) (an offer, nothing written) → "yes, do that" ("Updating the draft now", nothing written) → "it didnt edit in the card"',
    refused: BUB_DIDNT_EDIT,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [
      say("Create a coaching form."),
      say("Oswin"),
      say("yes"),
      CREATE,
      say("lotion orders, when to press ready for pick up and when to press mark as picked up"),
      say("can you upate the draft with these details of coaching?"),
      say(BUB_SHIPPED),
      say("yes, do that"),
      say(BUB_DIDNT_EDIT),
    ],
    script: {
      says: {
        [BUB_SHIPPED]:
          'Marking an order as "Picked up" is meant to happen only once the client is in the salon. Want me to add this to Oswin Marchbank\'s coaching form details? If so, tell me exactly what to write — for example "marked a lotion order as Picked up before the client came in".',
      },
      patch: {
        "can you upate the draft with these details of coaching?": patch("this_form"),
        [BUB_SHIPPED]: patch("this_form", [{ field: "coaching_details", value: "Oswin marked a lotion order as picked up but the client hadn't come in yet.", how: "add", evidence: BUB_SHIPPED }]),
        "yes, do that": patch("this_form"),
        [BUB_DIDNT_EDIT]: patch("this_form"),
      },
    },
    expect: {
      says: "Details of Coaching holds that he marked a lotion order as picked up before the client came in",
      check: (run) => all(noError(run), created(run), has(run, "coaching_details", /marked a lotion order as picked up/i, "does not hold the lotion order")),
    },
  },
  {
    id: "bub-date-question",
    report: 'the sibling app, 31 Oct 2026: coaching form → "how do i handle a <order>?" (here: a lotion order) → "can you upate the draft with these details of coaching?" → "What\'s the date on the form for these details?"',
    refused: BUB_DATE_Q,
    owner: "a question about the form: answered, not an edit (QUESTION_NOT_FORM / the answer)",
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [say("create a coaching form for Liesel Quarrington"), CREATE, say("how do i handle a lotion order?"), say("can you upate the draft with these details of coaching?"), say(BUB_DATE_Q)],
    script: {
      patch: {
        "how do i handle a lotion order?": patch("question"),
        "can you upate the draft with these details of coaching?": patch("this_form"),
        [BUB_DATE_Q]: patch("question"),
      },
    },
    expect: {
      says: "the date question is answered (no edit, no refusal); nothing about the form is claimed changed",
      check: (run) => all(noError(run), created(run), notRefused(run), noClaim(run)),
    },
  },
  {
    id: "bub-name-redo",
    report:
      'the sibling app, 2 Nov 2026: CA for a misspelled name → "fix her last name …" → "make that update" → "under the employee line the name is supposed to be …" → "redo <first> <middle> <last>"',
    refused: BUB_REDO,
    owner: "a name correction: the correction path (NAME_CORRECTION_WORDS), not Step B's reader",
    roster: REFUSAL_ROSTER,
    field: "employee_name",
    steps: [
      say("i have an employee, Corvina Ashdown Vellacot that needs a corrective action form with a customer complaint"),
      say("verbal warning, no payroll deduct, part-time tanning consultant,"),
      CREATE,
      say("fix her last name vellacott"),
      say("make that update"),
      say("under the employee line the name is supposed to be corvina ashdwon vellacott"),
      say(BUB_REDO),
    ],
    script: { draft: { observation: "Observed:\nA guest complained about the experience with Corvina." } },
    expect: {
      says:
        "Employee Name reads Corvina Ashdown Vellacott (the spelling of the latest message); or, where this app does not change a Corrective Action's name from the chat, the reply says how (the card's Employee Name line) or asks which spelling is right — never the bare refusal",
      check: (run) =>
        all(
          noError(run),
          created(run),
          notRefused(run),
          /corvina ashdown vellacott/i.test(run.saved.employee_name ?? "") || /\?/.test(run.reply) || /\bon the card\b/i.test(run.reply)
            ? null
            : `Employee Name is "${run.saved.employee_name ?? ""}" and the reply neither asks nor says how to change it`,
        ),
    },
  },
  {
    id: "bub-last-name",
    report: 'the sibling app, 3 Nov 2026 (QA\'s live test, twice): "Create a coaching form for <name>, she was late to open today" → "fix her last name, it is <surname>"',
    refused: BUB_FENWICK,
    owner: "a name correction: the correction path (NAME_CORRECTION_WORDS); Step B's reader adds nothing",
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [say("Create a coaching form for Isolde Pembrook, she was late to open today"), CREATE, say(BUB_FENWICK)],
    script: {
      draft: { coaching_details: "Observed:\nIsolde Pembrook was late to open the salon today.\nExpectation:\nIsolde is expected to arrive on time and be ready to open." },
      /*
       * The reading FORM_PATCH_READER_FIXES_ENABLED's added prompt line asks for: the field whose text holds
       * the old surname, replaced with the word corrected and nothing else (the trace read set:[] without it).
       */
      patch: {
        [BUB_FENWICK]: patch("this_form", [
          {
            field: "coaching_details",
            value: "Observed:\nIsolde Pembrooke was late to open the salon today.\nExpectation:\nIsolde is expected to arrive on time and be ready to open.",
            how: "replace",
            evidence: "fix her last name, it is Pembrooke",
          },
        ]),
      },
    },
    expect: {
      says: "Details of Coaching names her Isolde Pembrooke (first name kept)",
      check: (run) => all(noError(run), created(run), has(run, "coaching_details", /\bIsolde Pembrooke\b/, "does not name Isolde Pembrooke"), notRefused(run)),
    },
  },
  {
    id: "bub-position",
    report: 'the sibling app, 3 Nov 2026 (QA\'s live test): "Create a Corrective Action for <name>, she was late to open on 10-20-26" → … → "change her position to <title>" (here: a title this app has)',
    refused: BUB_POSITION,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "job_title",
    steps: [say("Create a Corrective Action for Briony Tallisker, she was late to open on 10-20-26"), CREATE, say(BUB_POSITION)],
    script: {
      draft: { observation: "Observed:\nBriony Tallisker was late to open on October 20, 2026." },
      patch: { [BUB_POSITION]: patch("this_form", [{ field: "job_title", value: "Assistant Salon Director", how: "replace", evidence: BUB_POSITION }]) },
    },
    expect: {
      says: "Job Title reads Assistant Salon Director",
      check: (run) => all(noError(run), created(run), /^Assistant Salon Director$/i.test((run.saved.job_title ?? "").trim()) ? null : `Job Title is "${run.saved.job_title ?? ""}"`, notRefused(run)),
    },
  },
];

/* ------------------------------------------------------------- Sunny 9 -- */

const SUN_MEETING = "can you make it for missing out monthly meeting";
const SUN_TOWEL = "add details about the towel";
const SUN_QUITTING = "update the draft: he told the whole team he was quitting";
const SUN_POSITION = "change her position to Tanning Consultant";
const SUN_OUTLINE = "No this should be the same out line but with sabelines info i told you in the first chat";
const SUN_MSB = "I need the CA for the Must see behaviors and not the standard of conduct. Make it in the format that I explained above in the first chat for Sabeline.";
const SUN_LATE = "I need you to make it about showing up late and please list the policy make the date for 10/14/26.";
const SUN_MAKE_UPDATE = "make that update";
const SUN_YES = "yes, do that";

const OUTLINE_FIRST =
  "create a ca for must see behaviors for performace  this should be for sabeline delacourt  - verbal\n146 tans \nBelow in PPTA, LPSVA, Average Club, CC%, Spa%";
const OUTLINE_PASTE =
  "Observation of Offense:  During the month of September 2026, Rosamund completed 237 tanning transactions. Throughout these transactions, Rosamund failed to follow their Must See Behaviors resulting in a performance below Sun Tan City averages in the following areas UPTA, Average Club, CC%, and Spa %.  \n\nAt Sun Tan City, we strive to provide the ultimate tanning experience for every client. In order to ensure the best results for our clients, every employee is expected to follow their Client Service Must See Behaviors and Engagement Must See Behaviors with every client interaction.\t\n\nAction Plan:  The Leadership Team will coach Rosamund on Must See Behaviors to make sure these are not only understood but also put into practice. Rosamund is expected to follow these Must See Behaviors with every client interaction. Failure to consistenly meet expectations may result in additional corrective action ";
const OUTLINE_OBSERVATION_PASTED =
  "During the month of September 2026, Rosamund completed 237 tanning transactions. Throughout these transactions, Rosamund failed to follow their Must See Behaviors resulting in a performance below Sun Tan City averages in the following areas UPTA, Average Club, CC%, and Spa %.\nAt Sun Tan City, we strive to provide the ultimate tanning experience for every client. In order to ensure the best results for our clients, every employee is expected to follow their Client Service Must See Behaviors and Engagement Must See Behaviors with every client interaction.";
const OUTLINE_OBSERVATION_SABELINE =
  "During the month of September 2026, Sabeline Delacourt completed 146 tanning transactions. Throughout these transactions, Sabeline failed to follow their Must See Behaviors resulting in a performance below Sun Tan City averages in the following areas PPTA, LPSVA, Average Club, CC%, and Spa %.\nAt Sun Tan City, we strive to provide the ultimate tanning experience for every client. In order to ensure the best results for our clients, every employee is expected to follow their Client Service Must See Behaviors and Engagement Must See Behaviors with every client interaction.";

const ROOM_PROCESS =
  "this is what i am wanting to coach on: getting rooms ready between guests, here are the details of the process: wipe down the bed with the approved cleaner, use a fresh towel, empty the trash, reset the timer and check the room before the next guest is taken back.";
const ROOM_STEPS = "wipe down the bed with the approved cleaner, use a fresh towel, empty the trash, reset the timer and check the room before the next guest is taken back.";
const CASH = "add to the details: reminded her to call a manager for any cash drawer shortage";

export const SUNNY_REFUSALS: readonly RefusalScenario[] = [
  {
    id: "sun-monthly-meeting",
    report: 'Ask Sunny, 27 Oct 2026: "can you create a coaching form for attendance policy" → "<name>" → card → "can you make it for missing out monthly meeting"',
    refused: SUN_MEETING,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [say("can you create a coaching form for attendance policy"), say("Perrin Fennimore"), CREATE, say(SUN_MEETING)],
    script: {
      patch: { [SUN_MEETING]: patch("this_form", [{ field: "coaching_details", value: "Perrin missed the monthly meeting.", how: "replace", evidence: "missing out monthly meeting" }]) },
    },
    expect: {
      says: "Details of Coaching is about missing the monthly meeting",
      check: (run) => all(noError(run), created(run), has(run, "coaching_details", /monthly meeting/i, "is not about the monthly meeting"), notRefused(run)),
    },
  },
  {
    id: "sun-towel-nothing-said",
    report: 'Ask Sunny, 31 Oct 2026 (twice): "create a coaching form for <name>" → card → "add details about the towel" (no towel details were ever given)',
    refused: SUN_TOWEL,
    owner: "nothing to write: the manager gave no towel details; the honest reply asks for them",
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [say("create a coaching form for Maelis Harrowgate"), CREATE, say(SUN_TOWEL)],
    script: { patch: { [SUN_TOWEL]: patch("this_form") } },
    expect: {
      says: "nothing about a towel is invented; the reply does not claim a change",
      check: (run) => all(noError(run), created(run), hasNot(run, "coaching_details", /towel/i, "holds towel details nobody gave"), noClaim(run)),
    },
  },
  {
    id: "sun-quitting",
    report: 'Ask Sunny, 31 Oct 2026: coaching form → "for whole staff" (one person per form) → "update the draft: he told the whole team he was quitting"',
    refused: SUN_QUITTING,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [say("create a coaching form for Ansel Larkspur"), CREATE, say("for whole staff"), say(SUN_QUITTING)],
    script: {
      patch: {
        "for whole staff": patch("other"),
        [SUN_QUITTING]: patch("this_form", [{ field: "coaching_details", value: "He told the whole team he was quitting.", how: "add", evidence: "he told the whole team he was quitting" }]),
      },
    },
    expect: {
      says: "Details of Coaching says he told the whole team he was quitting",
      check: (run) => all(noError(run), created(run), has(run, "coaching_details", /told the whole team he was quitting/i, "does not hold it"), notRefused(run)),
    },
  },
  {
    id: "sun-position",
    report: 'Ask Sunny, 3 Nov 2026 (QA\'s live test, twice): coaching form → … → "change her position to Tanning Consultant"',
    refused: SUN_POSITION,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "job_title",
    steps: [say("Create a coaching form for Galen Winterbourne, she was late to open today"), CREATE, say(SUN_POSITION)],
    script: {
      draft: { coaching_details: "Observed:\nGalen Winterbourne was late to open the salon today." },
      patch: { [SUN_POSITION]: patch("this_form", [{ field: "job_title", value: "Tanning Consultant", how: "replace", evidence: SUN_POSITION }]) },
    },
    expect: {
      says: "Job Title reads Tanning Consultant",
      check: (run) => all(noError(run), created(run), /^Tanning Consultant$/i.test((run.saved.job_title ?? "").trim()) ? null : `Job Title is "${run.saved.job_title ?? ""}"`, notRefused(run)),
    },
  },
  {
    id: "sun-same-outline",
    report:
      'Ask Sunny, 4 Nov 2026: MSB CA with the metrics → the manager pastes another employee\'s CA as the outline (it was saved with that employee\'s name and numbers) → "No this should be the same out line but with <name>s info i told you in the first chat"',
    refused: SUN_OUTLINE,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "observation",
    steps: [say(OUTLINE_FIRST), CREATE, say(OUTLINE_PASTE), say(SUN_OUTLINE)],
    script: {
      draft: { observation: "Observed:\nSabeline Delacourt did not follow the Must See Behaviors; 146 tans, below in PPTA, LPSVA, Average Club, CC% and Spa%." },
      checked: { offense_type: ["standards_of_conduct"] },
      patch: {
        [OUTLINE_PASTE]: patch("this_form", [{ field: "observation", value: OUTLINE_OBSERVATION_PASTED, how: "replace", evidence: OUTLINE_OBSERVATION_PASTED.split("\n")[0]!.slice(0, 120) }]),
        [SUN_OUTLINE]: patch("this_form", [{ field: "observation", value: OUTLINE_OBSERVATION_SABELINE, how: "reword", evidence: "the same out line but with sabelines info" }]),
      },
    },
    expect: {
      says: "the Observation keeps the pasted outline with Sabeline's own facts: Sabeline, 146 tans, PPTA/LPSVA/Average Club/CC%/Spa%; no Rosamund, no 237",
      check: (run) =>
        all(
          noError(run),
          created(run),
          has(run, "observation", /Sabeline/, "does not name Sabeline"),
          has(run, "observation", /\b146\b/, "does not hold 146"),
          hasNot(run, "observation", /Rosamund|\b237\b/, "still holds the other employee's name or number"),
          has(run, "observation", /Must See Behaviors/i, "lost the outline"),
          notRefused(run),
        ),
    },
  },
  {
    id: "sun-msb-format",
    report:
      'Ask Sunny, 4 Nov 2026, the same chat, next turn: "I need the CA for the Must see behaviors and not the standard of conduct. Make it in the format that I explained above in the first chat for <name>."',
    refused: SUN_MSB,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "observation",
    steps: [say(OUTLINE_FIRST), CREATE, say(OUTLINE_PASTE), say(SUN_MSB)],
    script: {
      draft: { observation: "Observed:\nSabeline Delacourt did not follow the Must See Behaviors; 146 tans, below in PPTA, LPSVA, Average Club, CC% and Spa%." },
      checked: { offense_type: ["standards_of_conduct"] },
      patch: {
        [OUTLINE_PASTE]: patch("this_form", [{ field: "observation", value: OUTLINE_OBSERVATION_PASTED, how: "replace", evidence: OUTLINE_OBSERVATION_PASTED.split("\n")[0]!.slice(0, 120) }]),
        [SUN_MSB]: patch("this_form", [{ field: "observation", value: OUTLINE_OBSERVATION_SABELINE, how: "reword", evidence: "Make it in the format that I explained above in the first chat for Sabeline" }]),
      },
    },
    expect: {
      says: "the Observation is the outline with Sabeline's facts (no Rosamund, no 237); the policy stays as the client's rule makes it (MSB cites the Standards of Conduct)",
      check: (run) =>
        all(
          noError(run),
          created(run),
          has(run, "observation", /Sabeline/, "does not name Sabeline"),
          has(run, "observation", /\b146\b/, "does not hold 146"),
          hasNot(run, "observation", /Rosamund|\b237\b/, "still holds the other employee's name or number"),
          notRefused(run),
        ),
    },
  },
  {
    id: "sun-late-date",
    report:
      'Ask Sunny, 6 Nov 2026: "I need you to draw me up a a coachong document for <name>. … this is the coaching document dreated on 10/14/26" → card → "I need you to make it about showing up late and please list the policy make the date for 10/14/26."',
    refused: SUN_LATE,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [
      say("I need you to draw me up a a coachong document for Thaddeus Lowestoft. She already has one but the policy was not listed so that needs added in this is the coaching document dreated on 10/14/26"),
      CREATE,
      say(SUN_LATE),
    ],
    script: {
      patch: { [SUN_LATE]: patch("this_form", [{ field: "coaching_details", value: "Thaddeus showed up late.", how: "replace", evidence: "make it about showing up late" }]) },
    },
    expect: {
      says: "Details of Coaching is about showing up late; the form's Date stays 2026-10-14",
      check: (run) =>
        all(
          noError(run),
          created(run),
          has(run, "coaching_details", /\blate\b/i, "is not about showing up late"),
          run.saved.form_date && run.saved.form_date !== "2026-10-14" ? `the Date is ${run.saved.form_date}` : null,
          notRefused(run),
        ),
    },
  },
  {
    id: "sun-make-that-update",
    report:
      'Ask Sunny, 31 Oct 2026: coaching form → the process given → "add details about the towel" → "i don\'t see the details updated in the draft card. …" → "make that update"',
    refused: SUN_MAKE_UPDATE,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [
      say("create a coaching form for Leopold Ashdown"),
      CREATE,
      say(ROOM_PROCESS),
      say(SUN_TOWEL),
      say("i don't see the details updated in the draft card. Do i need to copy and paste it? or should it be automatically updating?"),
      say(SUN_MAKE_UPDATE),
    ],
    script: {
      says: {
        "i don't see the details updated in the draft card. Do i need to copy and paste it? or should it be automatically updating?":
          "No copying needed — the card updates automatically when I make a change here.",
      },
      patch: {
        [ROOM_PROCESS]: patch("this_form", [{ field: "coaching_details", value: ROOM_STEPS, how: "add", evidence: ROOM_STEPS }]),
        [SUN_TOWEL]: patch("this_form", [{ field: "coaching_details", value: "Use a fresh towel.", how: "add", evidence: "use a fresh towel" }]),
        "i don't see the details updated in the draft card. Do i need to copy and paste it? or should it be automatically updating?": patch("question"),
        [SUN_MAKE_UPDATE]: patch("this_form"),
      },
    },
    expect: {
      says: "Details of Coaching holds the process given, the fresh towel included; the reply does not claim a change it did not make",
      check: (run) => all(noError(run), created(run), has(run, "coaching_details", /fresh towel/i, "does not hold the towel step"), has(run, "coaching_details", /reset the timer/i, "does not hold the process")),
    },
  },
  {
    id: "sun-yes-do-that",
    report: 'Ask Sunny, 3 Nov 2026 (twice): coaching form → "add to the details: reminded her to call a manager for any cash drawer shortage" ("Updated") → "yes, do that"',
    refused: SUN_YES,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [say("create a coaching form for Ottoline Fenwright"), CREATE, say(CASH), say(SUN_YES)],
    script: {
      patch: {
        [CASH]: patch("this_form", [{ field: "coaching_details", value: "Reminded her to call a manager for any cash drawer shortage.", how: "add", evidence: "reminded her to call a manager for any cash drawer shortage" }]),
        [SUN_YES]: patch("this_form"),
      },
    },
    expect: {
      says: "Details of Coaching holds the cash drawer reminder exactly once; nothing is claimed for the yes",
      check: (run) => {
        const times = (run.saved.coaching_details ?? "").match(/cash drawer shortage/gi)?.length ?? 0;
        return all(noError(run), created(run), times === 1 ? null : `the cash drawer reminder is on the form ${times} times`, noClaim(run));
      },
    },
  },
];

/* --------------------------------------------- coding 2's real-AI trace -- */

const TRACE_PRACTICE = "Add that she Must Practice the sanitizing checklist every shift.";
const TRACE_PRO_1 = "make it sound more professional";
const TRACE_PRO_2 = "can you make it more professional";
const TRACE_DETAILS = "Observed:\nTessaly Laine was late to open the salon today.\nExpectation:\nTessaly is expected to arrive on time and be ready to open.";

export const TRACE_REFUSALS: readonly RefusalScenario[] = [
  {
    id: "trace-name-prefix",
    report:
      "coding 2's real-AI trace, 6 Nov 2026 (Step B on): \"Add that she Must Practice the sanitizing checklist every shift.\" read as add \"<Name> must practice …\" and REFUSED not_in_manager_words (the name prefix and the lower case)",
    refused: TRACE_PRACTICE,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "observation",
    steps: [say("Create a Corrective Action for Wrenna Thistlecombe, she was late to open on 10-20-26"), CREATE, say(TRACE_PRACTICE)],
    script: {
      draft: { observation: "Observed:\nWrenna Thistlecombe was late to open on October 20, 2026." },
      patch: {
        [TRACE_PRACTICE]: patch("this_form", [
          { field: "observation", value: "Wrenna Thistlecombe must practice the sanitizing checklist every shift.", how: "add", evidence: "Wrenna Thistlecombe must practice the sanitizing checklist every shift" },
        ]),
      },
    },
    expect: {
      says: "the Observation adds that she must practice the sanitizing checklist every shift",
      check: (run) => all(noError(run), created(run), has(run, "observation", /practice the sanitizing checklist every shift/i, "does not hold the checklist"), has(run, "observation", /late to open/i, "lost the late opening")),
    },
  },
  {
    id: "trace-professional",
    report:
      "coding 2's real-AI trace, 6 Nov 2026 (Step B on): \"make it sound more professional\" and \"can you make it more professional\" read as a whole rewrite (how: replace) and REFUSED not_in_manager_words ×2 (Pau, 7 Nov: \"yes rewrite\")",
    refused: TRACE_PRO_2,
    owner: null,
    roster: REFUSAL_ROSTER,
    field: "coaching_details",
    steps: [say("Create a coaching form for Isolde Pembrook, she was late to open today"), CREATE, say(TRACE_PRO_1), say(TRACE_PRO_2)],
    script: {
      draft: { coaching_details: TRACE_DETAILS.replace(/Tessaly Laine/g, "Isolde Pembrook").replace(/Tessaly/g, "Isolde") },
      patch: {
        [TRACE_PRO_1]: patch("this_form", [
          {
            field: "coaching_details",
            value: "Observed:\nIsolde Pembrook did not arrive in time to open the salon today.\nExpectation:\nIsolde will arrive on time and be prepared to open.",
            how: "reword",
            evidence: TRACE_PRO_1,
          },
        ]),
        [TRACE_PRO_2]: patch("this_form", [
          {
            field: "coaching_details",
            value: "Observed:\nIsolde Pembrook arrived after the scheduled opening time today.\nExpectation:\nIsolde is expected to arrive punctually, prepared to open the salon.",
            how: "reword",
            evidence: TRACE_PRO_2,
          },
        ]),
      },
    },
    expect: {
      says: "Details of Coaching is reworded (not the created text), still names Isolde Pembrook and the late opening, and adds no new fact",
      check: (run) =>
        all(
          noError(run),
          created(run),
          has(run, "coaching_details", /\bIsolde Pembrook\b/, "lost her name"),
          has(run, "coaching_details", /open/i, "lost the late opening"),
          /was late to open the salon today/.test(run.saved.coaching_details ?? "") ? "Details still the created text: nothing was reworded" : null,
          notRefused(run),
        ),
    },
  },
];

/** Every refusal, Bubbles' first. LIVE_SCENARIOS=step-b-refusals. */
export const STEP_B_REFUSAL_SCENARIOS: readonly RefusalScenario[] = [...BUBBLES_REFUSALS, ...SUNNY_REFUSALS, ...TRACE_REFUSALS];

/** The Step B flags the scenarios are for, and coding 5's (7 Nov 2026). */
export const STEP_B_READER_FLAGS = [
  "FORM_PATCH_REDUCER_ENABLED",
  "FORM_REPLY_FROM_DIFF_ENABLED",
  "FORM_EDIT_SINGLE_WRITER_ENABLED",
  "FORM_EDIT_SAID_REPLACEMENT_ENABLED",
  "FORM_PATCH_READER_FIXES_ENABLED",
] as const;
