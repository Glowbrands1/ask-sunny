import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { listIncidentDates } from "@/lib/forms/form-date-answer";
import { formDateIncidentOnlyEnabled } from "@/lib/config/chat-quality-flags";
import { incidentDates } from "@/lib/forms/incident-dates";
import { correctiveActionDocument } from "@/lib/forms/library";
import { statedPriorActions } from "@/lib/forms/prior-actions";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA, 25 OCT 2026 — "PREVIOUS COACHING. VERBAL (06/25/2026) AND WRITTEN
 * (07/28/2026)" ARE PRIOR ACTIONS, NEVER A DATE FOR THE FORM
 * ============================================================================
 *
 * Ask Sunny production (intent path, PRIOR_ACTIONS_PARSE_ENABLED on), the
 * manager's turn word for word ("Test Employee" is QA's placeholder; the salon
 * is an invented one):
 *
 *   "create a verbal corrective action for Test Employee, tanning consultant
 *    at Test Salon for missing the 10-15-26 woven deadline. previous coaching.
 *    verbal (06/25/2026) and written (07/28/2026). no payroll deducation"
 *
 * Live, the form date was right (10/15) but neither prior was on the card, and
 * the chat asked "You mentioned more than one date (6/25, 7/28, 10/15). Which
 * date goes on the form?". In another chat, "previous coaching. verbal
 * (06/25/2026) and written (07/28/2026)" as its own turn was asked the same
 * question, and the form was then dated 6/25 — the prior verbal's date.
 *
 * The history label ends its sentence ("previous coaching.") and each item is
 * a level with its date in brackets, so no earlier-step reader saw a step.
 * With PRIOR_ACTIONS_PARSE_ENABLED a label closed by a full stop heads the
 * items after it that name a step, and a bracketed date is read as the item's
 * date. Flag off: the readers are unchanged (pinned below).
 *
 * Through `answerQuestion` with this app's production profile (intent
 * extraction on, CODE_SLOTS and FORM_FULL_REMAP unset), the way
 * `prior-actions-yearless-oct25.test.ts` runs.
 */

const TODAY = "2026-10-25";

const FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "POLICY_CITATION_ENABLED",
  "SECOND_FORM_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
] as const;

const UNSET = [
  "CODE_SLOTS_ENABLED",
  "FORM_STATE_ENABLED",
  "FORM_FULL_REMAP_ENABLED",
  "FORM_EDIT_DATE_RULES_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "CHAT_MEMORY_ENABLED",
  "SELF_CHECK_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
  "CHAT_DATA_TOOLS_ENABLED",
] as const;

const stateBag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

/** What the intent model copies from the manager's words. Nothing is guessed. */
const intentModel = vi.hoisted(() => ({
  reading: null as null | ((manager: string) => Record<string, unknown>),
}));

const PEOPLE: DirectoryFact[] = [
  {
    id: "wren",
    firstName: "Wren",
    lastName: "Halvorsen",
    preferredFirstName: null,
    salonIds: ["loc-test"],
    title: "Tanning Consultant",
    primarySalonId: "loc-test",
    primaryLocationName: "Test Salon",
  },
  {
    id: "test-employee",
    firstName: "Test",
    lastName: "Employee",
    preferredFirstName: null,
    salonIds: ["loc-test"],
    title: "Tanning Consultant",
    primarySalonId: "loc-test",
    primaryLocationName: "Test Salon",
  },
];

function template(overrides: Record<string, unknown>) {
  return {
    id: "tpl",
    key: "coaching",
    name: "Coaching Form",
    shortName: "Coaching",
    description: "A coaching conversation.",
    category: "hr_performance",
    layoutFamily: "coaching",
    requiredPermission: "create_coaching_form",
    active: true,
    displayOrder: 1,
    currentVersion: { id: "v1", status: "published", variants: [] },
    draftVersion: null,
    versionCount: 1,
    activeAsset: null,
    assetCount: 0,
    ...overrides,
  };
}

const LIBRARY = [
  template({}),
  template({
    id: "tpl-dpoa",
    key: "dpoa",
    name: "Corrective Action Form",
    shortName: "CA",
    description: "A corrective action.",
    layoutFamily: "corrective",
    requiredPermission: "create_corrective_action",
    displayOrder: 2,
    currentVersion: { id: "v-dpoa", status: "published", document: correctiveActionDocument(), variants: [] },
  }),
];

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("@/lib/forms/employee-roster", () => ({
  readDirectoryFacts: async () => PEOPLE,
  loadScopedRoster: async () => PEOPLE,
  withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
}));

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => LIBRARY,
}));

vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

vi.mock("./form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) =>
    stateBag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    stateBag.forms.set(`${userId}:${conversationId}`, state);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    readonly name = "late-open";
    async match() {
      return [];
    }
    async search() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true as const,
        documentId: JBA_MANUAL_DOCUMENT.id,
        documentTitle: JBA_MANUAL_DOCUMENT.title,
        documentCategory: "policies_compliance" as const,
        matchedBy: "fallback" as const,
        chunks: JBA_MANUAL_CHUNKS,
      };
    }
  },
}));

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));

vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));

vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
    const text = JSON.stringify(input.messages ?? []);
    const manager = (text.split("Manager:").pop() ?? text).replace(/\\n/g, "\n");
    return intentModel.reading ? intentModel.reading(manager) : null;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query = {
        select: () => query,
        eq: () => query,
        neq: () => query,
        is: () => query,
        in: () => query,
        gte: () => query,
        ilike: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve(resolve({ data: [], error: null })),
      };
      return query;
    },
  }),
}));

const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

let answerQuestion: typeof import("./server-ask").answerQuestion;

// The app's whole chat path is imported once; under load that takes longer than the default hook timeout.
beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
}, 60_000);

beforeEach(() => {
  stateBag.forms.clear();
  intentModel.reading = null;
  for (const name of FLAGS) vi.stubEnv(name, "1");
  for (const name of UNSET) vi.stubEnv(name, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type Answer = Awaited<ReturnType<typeof answerQuestion>>;

/** Each manager turn in order, with the replies the app gave as history. */
async function chat(turns: readonly string[], conversationId: string): Promise<Answer[]> {
  const history: ChatMessage[] = [];
  const answers: Answer[] = [];
  for (const [index, question] of turns.entries()) {
    const response = await answerQuestion(
      {
        question,
        mode: "standard",
        history: [...history],
        scopeId: "stc-core",
        questionMessageId: `msg-${conversationId}-${index}`,
        conversationId,
        continueProposalTemplateKey: continuationFor(history)?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "district_manager", scope: SCOPE, subject: "manager-late-open", verified: true },
      { memoryOwnerId: "manager-late-open" },
    );
    answers.push(response);
    history.push({ id: `u-${index}`, role: "user", content: question, createdAt: `${TODAY}T19:41:5${index}Z` });
    history.push({
      id: `a-${index}`,
      role: "assistant",
      content: response.content,
      createdAt: `${TODAY}T19:41:5${index}Z`,
      ...(response.formProposal ? { formProposal: response.formProposal } : {}),
    } as ChatMessage);
  }
  return answers;
}

/** A faithful copy of the manager's words: the first date exactly as typed, no policy guessed. */
function copiesTheManager(manager: string): Record<string, unknown> {
  const date = /\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/.exec(manager)?.[0] ?? null;
  return {
    employee: /test employee/i.test(manager) ? "Test Employee" : null,
    salon: /test salon/i.test(manager) ? "Test Salon" : null,
    title: /tanning consultant/i.test(manager) ? "tanning consultant" : null,
    incidentType: /late to open/i.test(manager) ? "late to open" : /woven/i.test(manager) ? "missing the woven deadline" : null,
    incidentDate: date,
    payrollAmount: null,
    warningLevel: /\bverbal\b/i.test(manager) ? "verbal" : null,
    formType: /\b(?:ca|corrective action)\b/i.test(manager) ? "corrective action" : null,
    formTurn: /\b(?:ca|corrective action)\b/i.test(manager),
    policyHeading: null,
  };
}

const reading = (incidentDate: string | null) => (manager: string) => ({ ...copiesTheManager(manager), incidentDate });

/** QA's turn, word for word ("deducation" as typed). */
const SAID =
  "create a verbal corrective action for Test Employee, tanning consultant at Test Salon for missing the 10-15-26 woven deadline. previous coaching. verbal (06/25/2026) and written (07/28/2026). no payroll deducation";
/** The other chat: the priors as their own turn. */
const PRIORS = "previous coaching. verbal (06/25/2026) and written (07/28/2026)";
const OPENING = "create a verbal corrective action for Test Employee, tanning consultant at Test Salon for missing the 10-15-26 woven deadline";
const OPENING_UNDATED = "create a verbal corrective action for Test Employee, tanning consultant at Test Salon for missing the woven deadline";

const PRIOR_LINES = ["Verbal warning — 06/25/2026", "Written warning — 07/28/2026"];
const ASKS_WHICH_DATE = /Which date (?:goes|should go) on the form\?|more than one date/i;

/** The "Prior actions" lines the chat reads back, without its confirmation. */
function priorLines(content: string): string[] {
  const line = /\*\*Prior actions:\*\*\s*([^\n]+)/.exec(content)?.[1];
  return line ? line.replace(/, as you said\b.*$/, "").split("; ") : [];
}

describe("QA's turn, word for word (flag on)", () => {
  it.each([
    ["the model copied 10-15-26", reading("10-15-26")],
    ["the model copied 06/25/2026", reading("06/25/2026")],
    ["the model read no date", reading(null)],
    ["no model reading at all", null],
  ] as const)("dated 10/15, both priors on the card, no date question (%s)", async (label, model) => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    intentModel.reading = model;
    const [first] = await chat([SAID], `conv-priors-${label.length}`);
    const card = first!.formProposal!;
    expect(card, first!.content).toBeTruthy();
    expect(card.formDate).toBe("2026-10-15");
    expect(priorLines(first!.content)).toEqual(PRIOR_LINES);
    expect(first!.content).not.toMatch(ASKS_WHICH_DATE);
    expect(card.warningLevel).toBe("verbal");
  });

  it("with the flag off it is read as before: no priors, and the date question", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "");
    intentModel.reading = reading("10-15-26");
    const [first] = await chat([SAID], "conv-priors-off");
    expect(priorLines(first!.content)).toEqual([]);
    /*
     * FORM_DATE_INCIDENT_ONLY_ENABLED (D3, changed on purpose; QA ruled D3 wins
     * over "dated 10/15", 26 Oct 2026): "the 10-15-26 Woven deadline" is a
     * deadline, so with that flag on it is not an incident date the form's date
     * is chosen from. Flag off keeps ["2026-10-15"]. With it on, no date is left
     * to choose between, so nothing is asked.
     */
    if (formDateIncidentOnlyEnabled()) expect(first!.content).not.toMatch(ASKS_WHICH_DATE);
    else expect(first!.content).toMatch(ASKS_WHICH_DATE);
  });
});

describe("the priors as their own turn (the other chat)", () => {
  it("after a dated opening: still 10/15, both priors, no date question", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    intentModel.reading = copiesTheManager;
    const answers = await chat([OPENING, PRIORS], "conv-priors-turn");
    const last = answers[1]!;
    expect(last.content).not.toMatch(ASKS_WHICH_DATE);
    expect(last.formProposal?.formDate).toBe("2026-10-15");
    expect(priorLines(last.content)).toEqual(PRIOR_LINES);
  });

  it("after an undated opening: no date question, and never a prior's date on the form", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    intentModel.reading = copiesTheManager;
    const answers = await chat([OPENING_UNDATED, PRIORS], "conv-priors-undated");
    const last = answers[1]!;
    expect(last.content).not.toMatch(ASKS_WHICH_DATE);
    expect(["2026-06-25", "2026-07-28"]).not.toContain(last.formProposal?.formDate);
    expect(priorLines(last.content)).toEqual(PRIOR_LINES);
  });
});

describe("one incident date and one prior date", () => {
  it.each([
    "create a verbal CA for Test Employee at Test Salon for being late to open on 10-20-26. previous coaching. verbal (06/25/2026)",
    "create a written CA for Test Employee at Test Salon, late to open 10/20/2026. prior coaching. written (07/28/2026). no payroll",
  ])("asks no date question: %s", async (turn) => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    intentModel.reading = copiesTheManager;
    const [first] = await chat([turn], `conv-one-prior-${turn.length}`);
    expect(first!.content).not.toMatch(ASKS_WHICH_DATE);
    expect(first!.formProposal?.formDate).toBe("2026-10-20");
    expect(priorLines(first!.content)).toHaveLength(1);
  });
});

/*
 * The same turn the way managers type it (Pau, 26 Oct 2026): all lowercase,
 * and sentence case with the name and levels typed lowercase or capitalized.
 * The card must read the same in each.
 */
describe("QA's turn in every register (flag on)", () => {
  it.each([
    ["all lowercase", SAID.toLowerCase()],
    [
      "sentence case, name lowercase",
      "Create a verbal corrective action for test employee, tanning consultant at test salon for missing the 10-15-26 woven deadline. Previous coaching. Verbal (06/25/2026) and written (07/28/2026). No payroll deducation",
    ],
    [
      "sentence case, name and levels capitalized",
      "Create a Verbal corrective action for Test Employee, Tanning Consultant at Test Salon for missing the 10-15-26 Woven deadline. Previous Coaching. Verbal (06/25/2026) and Written (07/28/2026). No payroll deducation",
    ],
  ] as const)("dated 10/15, both priors, no date question (%s)", async (register, said) => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    intentModel.reading = copiesTheManager;
    const [first] = await chat([said], `conv-priors-register-${register.length}`);
    expect(first!.formProposal, first!.content).toBeTruthy();
    expect(first!.formProposal!.formDate).toBe("2026-10-15");
    expect(priorLines(first!.content)).toEqual(PRIOR_LINES);
    expect(first!.content).not.toMatch(ASKS_WHICH_DATE);
    expect(statedPriorActions(said, TODAY)).toEqual(PRIOR_LINES);
    // D3 (see "the readers" below): with FORM_DATE_INCIDENT_ONLY on the deadline is no incident date.
    expect(incidentDates(said, TODAY)).toEqual(formDateIncidentOnlyEnabled() ? [] : ["2026-10-15"]);
  });
});

/*
 * QA Sunny tester batch 13 (26 Oct 2026). S16, chatty: the priors were listed,
 * and the same two dates were also printed as "Follow-up: 6/25/2026" and
 * "Follow-up: 7/28/2026". S19 had the same with three coaching dates. With
 * FOLLOW_UP_NOT_PRIOR_ENABLED, a prior's date is never a Follow-up line. The
 * terse form types the priors without a year ("verbal 6/25 written 7/28").
 */
const S16 =
  "create a ca for Test Employee, tanning consultant at Test Salon, late to open on 10-20-26. She already had a verbal on 06/25/2026 and a written on 07/28/2026. This should be a written warning, no payroll deduct.";
const S19 =
  "Test Employee, tanning consultant at Test Salon, was late to open again on 10-20-26. She was coached on 09/08/2026, 09/15/2026 and 09/25/2026 for being late. Can you do a written CA, no payroll.";
const followUpLines = (content: string) => content.split("\n").filter((line) => line.startsWith("**Follow-up:**"));

describe("a prior's date is not a follow-up (S16, S19)", () => {
  it.each([
    ["S16 as typed", S16],
    ["S16 all lowercase", S16.toLowerCase()],
    ["S16 sentence case, name lowercase", S16.replace("Test Employee", "test employee").replace("Test Salon", "test salon")],
    ["S19 as typed", S19],
    ["S19 all lowercase", S19.toLowerCase()],
  ] as const)("flag on: no Follow-up line carries a prior's date (%s)", async (register, said) => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    vi.stubEnv("FOLLOW_UP_NOT_PRIOR_ENABLED", "1");
    intentModel.reading = copiesTheManager;
    const [first] = await chat([said], `conv-follow-up-${register.length}`);
    expect(first!.formProposal, first!.content).toBeTruthy();
    expect(followUpLines(first!.content)).toEqual([]);
    expect(first!.formProposal!.formDate).toBe("2026-10-20");
  });

  it("flag off: the Follow-up lines are as before (the S16 defect, pinned)", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    vi.stubEnv("FOLLOW_UP_NOT_PRIOR_ENABLED", "");
    intentModel.reading = copiesTheManager;
    const [first] = await chat([S16], "conv-follow-up-off");
    expect(followUpLines(first!.content).length).toBeGreaterThan(0);
  });

  it("a follow-up the manager asked for still shows", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    vi.stubEnv("FOLLOW_UP_NOT_PRIOR_ENABLED", "1");
    intentModel.reading = copiesTheManager;
    const said = `${S16} Follow up with her on 11/03/2026.`;
    const [first] = await chat([said], "conv-follow-up-asked");
    expect(followUpLines(first!.content)).toEqual(["**Follow-up:** 11/3/2026"]);
  });

  it.each([
    ["sentence case", "Prior coaching verbal 6/25 written 7/28 no deduct"],
    ["all lowercase", "prior coaching verbal 6/25 written 7/28 no deduct"],
  ] as const)("year-less priors are read as priors (%s)", (_register, said) => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    const priors = statedPriorActions(said, TODAY);
    // Both are earlier steps with this year's dates, and neither can date the form.
    expect(priors).toHaveLength(2);
    expect(priors[0]).toBe("Verbal warning — 06/25/2026");
    expect(priors[1]).toMatch(/^Written warning — .*07\/28\/2026$/);
    expect(incidentDates(said, TODAY)).toEqual([]);
    // Known, and the same on main: with no comma between the items the second
    // line keeps the first item's words ("Written warning — verbal 6/25 —
    // 07/28/2026"). Reported to QA as its own item; not this PR's change.
  });
});

describe("the readers", () => {
  it("flag on: the priors are earlier steps, and only 10/15 can date the form", () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    expect(statedPriorActions(SAID, TODAY)).toEqual(PRIOR_LINES);
    expect(statedPriorActions(PRIORS, TODAY)).toEqual(PRIOR_LINES);
    expect(listIncidentDates(SAID, TODAY).map((found) => found.iso)).toEqual(["2026-10-15"]);
    expect(listIncidentDates(PRIORS, TODAY)).toEqual([]);
    /*
     * FORM_DATE_INCIDENT_ONLY_ENABLED (D3, changed on purpose; QA ruled D3 wins
     * over "dated 10/15", 26 Oct 2026): "the 10-15-26 Woven deadline" is a
     * deadline, so with that flag on it is not an incident date the form's date
     * is chosen from. Flag off keeps ["2026-10-15"].
     */
    expect(incidentDates(SAID, TODAY)).toEqual(formDateIncidentOnlyEnabled() ? [] : ["2026-10-15"]);
  });

  it("flag on: a full stop after the label opens nothing that names no step", () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    const account = "previous coaching. she was late (10/20/2026) and left early (10/22/2026)";
    expect(statedPriorActions(account, TODAY)).toEqual([]);
    expect(listIncidentDates(account, TODAY).map((found) => found.iso)).toEqual(["2026-10-20", "2026-10-22"]);
  });

  it("flag off: unchanged — no step, every date a candidate", () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "");
    expect(statedPriorActions(SAID, TODAY)).toEqual([]);
    expect(listIncidentDates(SAID, TODAY).map((found) => found.iso)).toEqual(["2026-10-15", "2026-06-25", "2026-07-28"]);
    expect(listIncidentDates(PRIORS, TODAY).map((found) => found.iso)).toEqual(["2026-06-25", "2026-07-28"]);
  });
});

/*
 * LOCK: what already passes stays passing with the priors read. The manager's
 * typed "action plan: …" is the Action Plan word for word, and a late opening
 * still cites the manual's Late Opening section, p.15.
 */
function sources(answer: Answer): string {
  const lines = answer.content.split("\n").filter((line) => /JBA Policy Manual p\.\d+/.test(line));
  const cited = (answer.citations ?? []).map((item) => `${item.excerpt.split(".")[0]} ${item.locator}`);
  return [...lines, ...cited].join("\n");
}

describe("lock: the passing behaviours stay (flag on)", () => {
  const PLAN = "complete the Woven policy module by 10-30-26 and review it with her manager";

  it('"action plan: …" is kept word for word beside the priors', async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    vi.stubEnv("ACTION_PLAN_SENTENCES_ENABLED", "1");
    vi.stubEnv("ACTION_PLAN_MANAGER_ONLY_ENABLED", "1");
    intentModel.reading = reading("10-15-26");
    const [first] = await chat([`${SAID}. action plan: ${PLAN}`], "conv-lock-plan");
    const plans = first!.content.split("\n").filter((line) => /\*\*Action plan:?\*\*/i.test(line));
    expect(plans).toEqual([`**Action Plan:** ${PLAN}`]);
    expect(first!.formProposal?.formDate).toBe("2026-10-15");
    expect(priorLines(first!.content)).toEqual(PRIOR_LINES);
    expect(first!.content).not.toMatch(ASKS_WHICH_DATE);
  });

  it("a late opening still cites Late Opening p.15, with the prior listed", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    vi.stubEnv("LATE_OPEN_DATE_ENABLED", "1");
    intentModel.reading = copiesTheManager;
    const [first] = await chat(
      ["create a verbal CA for Test Employee at Test Salon for being late to open on 10-20-26. previous coaching. verbal (06/25/2026)"],
      "conv-lock-late-open",
    );
    expect(first!.content).toMatch(/Late Opening/);
    expect(sources(first!)).toMatch(/Late Opening.*(?:p\.|Page )15/);
    expect(first!.formProposal?.formDate).toBe("2026-10-20");
    expect(priorLines(first!.content)).toEqual(["Verbal warning — 06/25/2026"]);
  });
});
