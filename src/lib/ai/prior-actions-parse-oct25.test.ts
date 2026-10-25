import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PRIOR ACTIONS AS MANAGERS WRITE THEM — QA, 25 OCT 2026
 * ============================================================================
 *
 * PRIOR_ACTIONS_PARSE_ENABLED. The managers' turns are copied exactly, with
 * the people renamed (Test Employee is how the manager typed it):
 *
 *   1. conv_mvmvlnel251xs4k: "… verbal warning received Open Ended Questions
 *      Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching
 *      9/25/2026 …" kept 9/8 only, and offered 9/15 and 9/25 as the form's
 *      date. The question is the one production sent (chat_traces).
 *   2. "prior verbal 9-1-26", "previous verbal …", "prior written …" gave no
 *      prior action, and their date was offered as the form's.
 *   3. "previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26": both.
 *   4. "previous coaching - jba policy manual 1-20-26": one line.
 *   5. "Previous coaching was a Verbal CA 10-1-26" (the Ask Bubbles turn in
 *      conv_mvmzn0sn2pfk6uk) read "Verbal corrective action — a — signed …".
 *   6. "Her prior coaching is her policy manual ackwnelegement on 9/01" (the
 *      Ask Bubbles turn in conv_mvmzlt9o219eiga, typo kept) gave nothing.
 *   7. "previous coaching jba manual 11-1-26 … on 10-22-26 …" then "jba
 *      manual 11-1-25" (the Ask Bubbles turns in conv_mvmznap42vcw0dl) dated
 *      the form 2025-11-01. A prior-coaching date never dates the form.
 *
 * Ask Bubbles' turns name a store; here the salon is one of this app's, and
 * nothing else is changed. Driven through the real intent read
 * (`decideIntentTurn`) and the real proposal flow (`proposeFormForTurn`),
 * which writes the "Prior actions" line the chat reads back.
 */

const FLAG = "PRIOR_ACTIONS_PARSE_ENABLED";

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};
const state = vi.hoisted(() => ({ directory: [] as unknown[] }));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { decideIntentTurn } = await import("@/lib/ai/intent-slots");
const { PRODUCTION_SALONS } = await import("@/data/salons");
type ConversationFormState = import("@/lib/ai/form-state").ConversationFormState;
type GroundedPerson = import("@/lib/ai/grounded-entities").GroundedPerson;

const TODAY = "2026-10-24";
const SALON = "loc-0468";
const ACTOR = { role: "salon_director" as never, scope: { level: "salon", primaryAreaId: SALON, alsoCoversAreaIds: [] } as AccessScope };
const person = (id: string, firstName: string, lastName: string) => ({
  id,
  firstName,
  lastName,
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: [SALON],
});

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.directory = [person("e-1", "Test", "Employee"), person("e-2", "Avery", "Holt"), person("e-3", "Remy", "Calder")];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T18:00:00Z`));
  vi.stubEnv("INTENT_EXTRACTION_ENABLED", "1");
  vi.stubEnv(FLAG, "1");
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

let sequence = 0;

type Turn = { text: string; raw: Record<string, unknown> };

const SALONS = PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));
const HEADINGS = ["Attendance", "Dress Code", "Disciplinary Action", "Standards of Conduct"];

/**
 * The manager's turns through the live path: the intent read (with the
 * model's reading as it would return it), its question, then the proposal.
 */
async function conversation(turns: Turn[]) {
  const history: ChatMessage[] = [];
  let saved: ConversationFormState | null = null;
  let last: NonNullable<Awaited<ReturnType<typeof proposeFormForTurn>>> | null = null;
  let open: string | undefined;
  for (const turn of turns) {
    sequence += 1;
    const decision = decideIntentTurn({
      question: turn.text,
      history: history.map((message) => ({ role: message.role, content: message.content })),
      today: TODAY,
      saved,
      raw: turn.raw,
      people: (state.directory as GroundedPerson[]).map((row) => ({ ...row, title: null, primaryLocationName: null })),
      salons: SALONS,
      headings: HEADINGS,
      headingPages: { Attendance: 14, "Dress Code": 20, "Disciplinary Action": 14, "Standards of Conduct": 13 },
      templates: [{ key: "dpoa", name: "Corrective Action Form" }],
      formInProgress: Boolean(saved?.templateKey || open),
    });
    saved = decision.state;
    const response = await proposeFormForTurn({
      history,
      question: decision.question,
      questionMessageId: `u${sequence}`,
      actor: ACTOR,
      summaries: await listTemplateSummaries(),
      today: TODAY,
      policyManual: async () => null,
      ...(open ? { continueTemplateKey: open } : {}),
    } as never);
    expect(response, `turn left the form intake: ${JSON.stringify(turn.text)}`).not.toBeNull();
    last = response!;
    if (response!.formProposal) open = response!.formProposal.templateKey;
    history.push(
      { id: `u${sequence}`, role: "user", content: turn.text, createdAt: `${TODAY}T18:00:00Z` } as ChatMessage,
      {
        id: `a${sequence}`,
        role: "assistant",
        content: response!.content,
        createdAt: `${TODAY}T18:00:01Z`,
        ...(response!.formProposal ? { formProposal: response!.formProposal } : {}),
      } as ChatMessage,
    );
  }
  return { last: last!, state: saved! };
}

/** The "Prior actions" line the chat reads back, one entry per step. */
function priorLine(content: string): string {
  const line = /\*\*Prior actions:\*\*\s*([^\n]+)/.exec(content)?.[1] ?? "";
  return line.replace(/, as you said\b.*$/, "");
}

const DATE_QUESTION = /more than one date|Which date goes on the form\?/i;

/*
 * QA decision, 25 Oct 2026: a prior-action line holds no word the manager did
 * not say. The expectations below read "— signed MM/DD/YYYY" before; none of
 * these managers wrote "signed", so the line ends with the date alone, and a
 * manual they named reads as its title, "JBA Policy Manual" (case 7's "jba
 * manual" was "JBA Manual").
 */

/** The model's reading of a CA request: the form and the person, nothing it was not told. */
const CA = (employee: string, more: Record<string, unknown> = {}) => ({ employee, formType: "CA", formTurn: true, ...more });

describe("1. a prior list keeps every step the manager named (conv_mvmvlnel251xs4k)", () => {
  const SAID =
    "Avery Holt today under performance for September 270 tans below in PPTA, UPTA, LPSVA, CC% and Spa% verbal warning received Open Ended Questions Coaching 9/8/2026, Focus Item Coaching 9/15/2026, New Product Coaching 9/25/2026 not payroll deductible Tanning Consultant";

  it("lists 9/8, 9/15 and 9/25, dates the form today, and asks about no date", async () => {
    const { last, state } = await conversation([
      { text: "Can you create me a performance CA?", raw: { formType: "CA", formTurn: true } },
      // The model's reading production stored for this turn (chat_traces.slots), name swapped.
      { text: SAID, raw: CA("Avery Holt", { title: "Tanning Consultant", warningLevel: "verbal", incidentDate: "today" }) },
    ]);
    const line = priorLine(last.content);
    expect(line).toContain("09/08/2026");
    expect(line).toContain("09/15/2026");
    expect(line).toContain("09/25/2026");
    expect(state.formDate).toBe(TODAY);
    expect(last.content).not.toMatch(DATE_QUESTION);
  });
});

describe("2. \"prior verbal 9-1-26\" is a prior action", () => {
  it.each([
    ["prior verbal 9-1-26", "Verbal warning — 09/01/2026"],
    ["previous verbal 9-1-26", "Verbal warning — 09/01/2026"],
    ["prior written 9-1-26", "Written warning — 09/01/2026"],
    ["had a verbal on 9-1-26", "Verbal warning — 09/01/2026"],
    ["prior verbal ca 9-1-26", "Verbal corrective action — 09/01/2026"],
  ])("%s", async (phrase, expected) => {
    const { last, state } = await conversation([
      { text: `create written ca for avery holt. she was late on 10/20/26. ${phrase}. no payroll deduct`, raw: CA("avery holt", { warningLevel: "written" }) },
    ]);
    expect(priorLine(last.content)).toBe(expected);
    expect(state.formDate).toBe("2026-10-20");
    expect(last.formProposal?.formDate).toBe("2026-10-20");
    expect(last.content).not.toMatch(DATE_QUESTION);
  });
});

describe("3 and 4. a labelled history, with a colon or a dash", () => {
  it("\"previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26\" is both lines", async () => {
    const { last } = await conversation([
      {
        text: "create written ca for avery holt. she was late on 10/20/26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. no payroll deduct",
        raw: CA("avery holt", { warningLevel: "written" }),
      },
    ]);
    expect(priorLine(last.content)).toBe(
      "Coaching — JBA Policy Manual — 01/01/2026; Verbal corrective action — 09/01/2026",
    );
    expect(last.formProposal?.formDate).toBe("2026-10-20");
  });

  it("\"previous coaching - jba policy manual 1-20-26\" is one line, never the action plan", async () => {
    const { last } = await conversation([
      {
        text: "create ca form for remy calder for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check. previous coaching - jba policy manual 1-20-26.",
        raw: CA("remy calder", { payrollAmount: "3.25" }),
      },
    ]);
    expect(priorLine(last.content)).toBe("Coaching — JBA Policy Manual — 01/20/2026");
    expect(last.content).not.toMatch(/Action plan:\*?\*?\s*Previous coaching/i);
    expect(last.formProposal?.formDate).toBe("2026-10-20");
  });
});

describe("5. \"Previous coaching was a Verbal CA 10-1-26\" (conv_mvmzn0sn2pfk6uk)", () => {
  it("reads one verbal corrective action, with no stray article", async () => {
    const { last } = await conversation([
      {
        text: "create a written corrective action for Tanning Consultant, Test Employee. Test was assigned to complete policy acknowledgements in woven by 10-15-26 and failed to meet the deadline. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.",
        raw: CA("Test Employee", { title: "Tanning Consultant", warningLevel: "written" }),
      },
    ]);
    expect(priorLine(last.content)).toBe("Verbal corrective action — 10/01/2026");
    expect(last.formProposal?.formDate ?? null).not.toBe("2026-10-01");
  });
});

describe("6. \"Her prior coaching is her policy manual ackwnelegement on 9/01\" (conv_mvmzlt9o219eiga)", () => {
  it("is a prior action, and 9/01 is not the form's date", async () => {
    const { last, state } = await conversation([
      {
        text: "I need a CA form for Test Employee at KS Lawrence for being out of dress code on October 11",
        raw: CA("Test Employee", { salon: "KS Lawrence", incidentDate: "October 11" }),
      },
      {
        text: "This is a verbal warning. Her prior coaching is her policy manual ackwnelegement on 9/01. payroll deduction is not applicable.",
        raw: CA("Test Employee", { salon: "KS Lawrence", incidentDate: "October 11", warningLevel: "verbal" }),
      },
    ]);
    expect(priorLine(last.content)).toContain("— 09/01/2026");
    expect(state.formDate).toBe("2026-10-11");
    expect(last.formProposal?.formDate).toBe("2026-10-11");
    expect(last.content).not.toMatch(DATE_QUESTION);
  });
});

describe("7. a prior-coaching date never dates the form (conv_mvmznap42vcw0dl)", () => {
  const FIRST =
    "do verbal for tanning consultant Test Employee at KS Lawrence. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the salon to show her team her new puppy. Test was in the salon 45 min";

  it("the form is dated 10-22-26 even when the model reads the manual's date, and the coaching moves to 11-1-25", async () => {
    const reading = CA("Test Employee", { title: "tanning consultant", salon: "KS Lawrence", warningLevel: "verbal" });
    const { last, state } = await conversation([
      { text: FIRST, raw: { ...reading, incidentDate: "10-22-26" } },
      // The correction turn: the reading takes the date it was just given.
      { text: "jba manual 11-1-25", raw: { ...reading, incidentDate: "2025-11-01" } },
      { text: "salon location is KS Lawrence. create corrective action", raw: { ...reading, incidentDate: "2025-11-01" } },
    ]);
    expect(state.formDate).toBe("2026-10-22");
    expect(last.formProposal?.formDate).toBe("2026-10-22");
    expect(priorLine(last.content)).toBe("Coaching — JBA Policy Manual — 11/01/2025");
  });
});

/*
 * QA decisions, 25 Oct 2026, on this app's live path (the intent read, then
 * the proposal): the manager's two turns exactly, "jba manual 1-1-26 for
 * previous coaching", then a turn of just "verbal" (the warning level). The
 * bare "verbal" is never a prior action, and the line holds only their words.
 */
describe("a bare \"verbal\" turn is never a prior action (live path)", () => {
  const TURNS = ["jba manual 1-1-26 for previous coaching", "verbal"];

  it.each([
    ["both flags on", { fix: "1", parse: "1" }, "Coaching — JBA Policy Manual — 01/01/2026"],
    ["PRIOR_ACTIONS_PARSE_ENABLED alone", { fix: "", parse: "1" }, "Coaching — JBA Policy Manual — 01/01/2026"],
    ["REMAP_INCIDENT_FIX_ENABLED alone", { fix: "1", parse: "" }, null],
  ])("%s", async (_name, flags, expected) => {
    vi.stubEnv("REMAP_INCIDENT_FIX_ENABLED", flags.fix);
    vi.stubEnv(FLAG, flags.parse);
    const reading = CA("Test Employee");
    const { last } = await conversation(TURNS.map((text) => ({ text, raw: reading })));
    const line = priorLine(last.content);
    if (expected) expect(line).toBe(expected);
    expect(line).not.toMatch(/(?:^|;\s*)verbal\s*(?:;|$)/i);
    expect(last.formProposal?.priorActions ?? "").not.toMatch(/^verbal$/im);
  });
});
