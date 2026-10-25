import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * Ask Bubbles, 24 Oct 2026 (FORM_FULL_REMAP on in its prod): What happened was
 * built from what was left of the request, "previous coaching" was lost, and
 * no policy was cited. The same acceptance cases in Sunny's words, through
 * `answerQuestion`:
 *
 *   - the live path (INTENT_EXTRACTION_ENABLED on, FORM_FULL_REMAP off), and
 *   - the remap path Sunny also has (FORM_FULL_REMAP_ENABLED with
 *     REMAP_INCIDENT_FIX_ENABLED).
 *
 * The models are stand-ins that copy the manager's words. The manual is the
 * production JBA Policy Manual rows. The people are synthetic.
 */

const TODAY = "2026-10-24";
const SCOPE: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/** The replay's flags-on set for the intent path (priority-replay.test.ts). */
const INTENT_FLAGS = [
  "INTENT_EXTRACTION_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "POLICY_GATE_NONBLOCKING_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "CODE_SLOTS_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "INTENT_PAYROLL_MANAGER_ONLY_ENABLED",
] as const;
const REMAP_FLAGS = ["FORM_FULL_REMAP_ENABLED", "REMAP_INCIDENT_FIX_ENABLED"] as const;
const ALL_FLAGS = [...INTENT_FLAGS, ...REMAP_FLAGS] as const;

const model = vi.hoisted(() => ({
  intent: {} as Record<string, unknown>,
  remap: {} as Record<string, unknown>,
  prompts: [] as string[],
}));

const stateBag = vi.hoisted(() => ({ forms: new Map<string, unknown>() }));

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
  template({
    id: "tpl-policy-review",
    key: "policy-review",
    name: "Policy Review",
    shortName: "Policy Review",
    description: "A documented review of a policy with an employee, quoting the approved manual.",
    layoutFamily: "corrective",
    requiredPermission: "create_policy_review",
    displayOrder: 3,
  }),
];

vi.mock("@/lib/config/server-env", () => ({
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  MissingConfigurationError: class MissingConfigurationError extends Error {
    missing: string[] = [];
  },
}));

vi.mock("@/lib/forms/employee-roster", () => ({
  readDirectoryFacts: async () => [],
  loadScopedRoster: async () => [],
  withRosterLimit: (_ids: readonly string[] | null, run: () => unknown) => run(),
}));

vi.mock("@/lib/forms/repository", () => ({ listTemplateSummaries: async () => LIBRARY }));

vi.mock("@/lib/forms/prior-forms", () => ({
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

vi.mock("./form-state-store", () => ({
  loadFormState: async (userId: string, conversationId: string) => stateBag.forms.get(`${userId}:${conversationId}`) ?? null,
  saveFormState: async (userId: string, conversationId: string, state: unknown) => {
    stateBag.forms.set(`${userId}:${conversationId}`, state);
  },
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { manualChunkFromRow } = await import("@/lib/ai/full-manual-load");
  const rows = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
  return {
    SupabaseKnowledgeProvider: class {
      readonly name = "replay";
      async match() {
        return [];
      }
      async fetchRoleGrounding() {
        return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
      }
      async fetchOfficialPolicyManual() {
        return {
          ok: true as const,
          documentId: "doc-jba",
          documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
          documentCategory: "policies_compliance" as const,
          matchedBy: "fallback" as const,
          chunks: (rows.chunks as Parameters<typeof manualChunkFromRow>[0][]).map(manualChunkFromRow),
        };
      }
    },
  };
});

vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));

vi.mock("./call-claude", () => ({
  callClaude: async () => "An answer.",
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    const tool = input.tool?.name ?? "";
    if (tool === "record_intent_slots") return model.intent;
    if (tool === "extract_form_fields") {
      model.prompts.push(JSON.stringify(input.messages ?? []));
      return model.remap;
    }
    return null;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({
    from() {
      const query = {
        select: () => query,
        insert: async () => ({ error: null }),
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

let answerQuestion: typeof import("./server-ask").answerQuestion;
let groundFormSlots: typeof import("./form-full-remap").groundFormSlots;

beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
  ({ groundFormSlots } = await import("./form-full-remap"));
  // The first import loads the whole answer path; a busy machine takes longer than the 10 s default.
}, 120_000);

beforeEach(() => {
  stateBag.forms.clear();
  model.prompts.length = 0;
});

afterEach(() => {
  for (const flag of ALL_FLAGS) delete process.env[flag];
});

function useFlags(flags: readonly string[]) {
  for (const flag of ALL_FLAGS) delete process.env[flag];
  for (const flag of flags) process.env[flag] = "true";
}

interface Turn {
  readonly say: string;
  /** What the intent model copies from the manager. */
  readonly intent?: Record<string, unknown>;
  /** What the remap model copies from the manager. */
  readonly remap?: Record<string, unknown>;
}

function intentRaw(over: Record<string, unknown> = {}) {
  return {
    employee: null,
    salon: null,
    title: null,
    incidentType: null,
    incidentDate: null,
    payrollAmount: null,
    warningLevel: null,
    formType: "corrective action",
    formTurn: true,
    policyHeading: null,
    ...over,
  };
}

function remapRaw(over: Record<string, unknown> = {}) {
  return { templateKey: "dpoa", employeeName: null, observation: null, actionPlan: null, ...over };
}

let chatCount = 0;

async function chat(turns: readonly Turn[]) {
  chatCount += 1;
  const conversationId = `conv-remap-incident-${chatCount}`;
  const history: ChatMessage[] = [];
  let last: Awaited<ReturnType<typeof answerQuestion>> | null = null;
  for (const [index, turn] of turns.entries()) {
    model.intent = intentRaw(turn.intent);
    model.remap = remapRaw(turn.remap);
    last = await answerQuestion(
      {
        question: turn.say,
        mode: "standard",
        history,
        scopeId: "stc-core",
        questionMessageId: `msg-${conversationId}-${index}`,
        conversationId,
        continueProposalTemplateKey: last?.formProposal?.templateKey,
        context: { userName: "Pat Manager", locationName: "All salons", todayIso: TODAY },
      },
      { role: "admin", scope: SCOPE, subject: "manager-remap-incident", verified: true },
      { memoryOwnerId: "manager-remap-incident" },
    );
    history.push(
      { id: `u-${index}`, role: "user", content: turn.say, createdAt: TODAY } as ChatMessage,
      // The client sends the card back with its message, as priority-replay does.
      {
        id: `a-${index}`,
        role: "assistant",
        content: last.content,
        createdAt: TODAY,
        ...(last.formProposal ? { formProposal: last.formProposal } : {}),
      } as ChatMessage,
    );
  }
  return last!;
}

type Reply = Awaited<ReturnType<typeof chat>>;

/** The section and its printed page, on the reply or its sources. */
function cites(response: Reply, heading: string, page: number) {
  const blob = `${response.content}\n${response.citations
    .map((item) => `${item.documentTitle} ${item.locator} ${item.excerpt}`)
    .join("\n")}`;
  expect(blob, response.content).toContain(heading);
  expect(blob, response.content).toMatch(new RegExp(String.raw`(?:\bp\.?\s*|page\s+)${page}\b`, "i"));
}

/** The request, the prior-action list and the intent read's own sentences are not what happened. */
const LEFTOVER =
  /\b(?:create|write|do)\s+(?:a\s+)?(?:verbal\s+|written\s+)?(?:ca|corrective action)\b|\bprevious coaching\b|It happened at|Policy reference|payroll deduct/i;

function expectIncident(response: Reply, pattern: RegExp) {
  expect(happened(response), response.content).toMatch(pattern);
  expect(happened(response), response.content).not.toMatch(LEFTOVER);
}

/** What happened as the card carries it (remap path) or the reply's Observation of Offense (intent path). */
function happened(response: Reply): string {
  const issue = response.formProposal?.issue;
  if (issue) return issue;
  return /\*\*(?:What happened|Observation of Offense):\*\*\s*([^\n]+)/.exec(response.content)?.[1]?.trim() ?? "";
}

const NAME = { employee: "Test Employee" };
const REMAP_NAME = { employeeName: "Test Employee" };

/** Each acceptance case once, for both paths. */
const CASES = {
  bare: [{ say: "create a corrective action form for Test Employee", intent: NAME, remap: REMAP_NAME }],
  bareYes: [
    { say: "create a corrective action form for Test Employee", intent: NAME, remap: REMAP_NAME },
    { say: "Yes", intent: NAME, remap: { ...REMAP_NAME, actionPlan: "create a corrective action form for" } },
  ],
  meeting: [
    {
      say: "create a written CA for Test Employee for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26",
      intent: { ...NAME, incidentType: "not attending the monthly meeting", incidentDate: "10-20-26", warningLevel: "written" },
      remap: REMAP_NAME,
    },
  ],
  woven: [
    {
      say: "create a verbal CA for Test Employee for missing the 10-15-26 woven deadline",
      intent: { ...NAME, incidentType: "missing the 10-15-26 woven deadline", incidentDate: "10-15-26", warningLevel: "verbal" },
      remap: REMAP_NAME,
    },
  ],
  lateShift: [
    {
      say: "write a verbal CA for Tanning Consultant, Test Employee at Kearney, NE. On 10-20-26 Test was late for shift and did not call supervisor as outlined in attendance policy. payroll deduct is not applicable. previous coaching is JBA Manual 1-1-25",
      intent: {
        ...NAME,
        salon: "Kearney",
        title: "Tanning Consultant",
        incidentType: "late for shift and did not call supervisor",
        incidentDate: "10-20-26",
        warningLevel: "verbal",
      },
      remap: REMAP_NAME,
    },
  ],
  cleaning: [
    {
      say: "create a CA for Test Employee for cleaning duties not being completed on 10-20-26",
      intent: {
        ...NAME,
        incidentType: "cleaning duties not being completed",
        incidentDate: "10-20-26",
        policyHeading: "Care and Cleaning of Equipment and Facilities",
      },
      remap: { ...REMAP_NAME, policySection: "Care and Cleaning of Equipment and Facilities" },
    },
  ],
  lateOpen: [
    {
      say: "create verbal ca for Test Employee for opening the salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted",
      intent: {
        ...NAME,
        incidentType: "opening the salon late",
        incidentDate: "10-1-26",
        warningLevel: "verbal",
        payrollAmount: "$25",
      },
      remap: REMAP_NAME,
    },
  ],
  empire: [
    { say: "cite animals in the workplace policy", intent: { formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "salon location is empire, sd. create corrective action", intent: {}, remap: {} },
  ],
  dressCode: [
    { say: "CA for Test Employee at Kearney, out of dress code 10/11", intent: { ...NAME, salon: "Kearney", incidentType: "out of dress code", incidentDate: "10/11" }, remap: REMAP_NAME },
    { say: "verbal, prior = manual ack 9/01, no payroll", intent: { ...NAME, warningLevel: "verbal" }, remap: REMAP_NAME },
    { say: "Use Kearney as the location", intent: { ...NAME, salon: "Kearney" }, remap: REMAP_NAME },
  ],
  acknowledgement: [
    {
      say: "create corrective action for Test Employee for violating standards of conduct policy on 10-20-26. Test failed to acknowledge policies in woven by the 10-15-26 deadline.",
      intent: { ...NAME, incidentType: "failed to acknowledge policies in Woven by the deadline", incidentDate: "10-20-26" },
      remap: REMAP_NAME,
    },
  ],
} satisfies Record<string, readonly Turn[]>;

for (const path of ["intent", "remap"] as const) {
  describe(`${path} path: the Ask Bubbles remap incident, in Sunny's words`, () => {
    beforeEach(() => useFlags(path === "intent" ? [...INTENT_FLAGS, "REMAP_INCIDENT_FIX_ENABLED"] : REMAP_FLAGS));

    it("a bare request leaves What happened empty and asks for it; Yes does not become the plan", async () => {
      const first = await chat(CASES.bare);
      expect(first.formProposal?.templateKey).toBe("dpoa");
      expect(happened(first)).not.toMatch(/create|corrective action form/i);
      expect(first.content).toMatch(/what happened/i);
      const yes = await chat(CASES.bareYes);
      expect(happened(yes)).not.toMatch(/create|corrective action form/i);
      expect(yes.content).not.toMatch(/Action plan:\*\*\s*create a corrective action form for/i);
    });

    it("previous coaching is the prior actions, and Attendance is not 'as you said' for a missed meeting", async () => {
      const response = await chat(CASES.meeting);
      expectIncident(response, /not attending the monthly meeting/i);
      expect(happened(response)).not.toBe("9-1-26");
      const prior = `${response.formProposal?.priorActions ?? ""}\n${response.content}`;
      expect(prior).toMatch(/JBA Policy Manual/i);
      expect(prior).toMatch(/1-1-26|0?1\/0?1\/2026|2026-01-01/);
      expect(prior).toMatch(/verbal (?:CA|corrective action)[^\n]*(?:9-1-26|0?9\/0?1\/2026|2026-09-01)/i);
      expect(response.content).not.toMatch(/Attendance[^\n]*as you said/i);
    });

    it("the woven deadline keeps its whole date and cites Standards of Conduct p.12", async () => {
      const response = await chat(CASES.woven);
      expectIncident(response, /missing the 10-15-26 woven deadline/i);
      expect(happened(response)).not.toMatch(/create a|\b5-26\b/i);
      cites(response, "Standards of Conduct", 12);
    });

    it("the policy acknowledgement cites Standards of Conduct p.12", async () => {
      const response = await chat(CASES.acknowledgement);
      expectIncident(response, /acknowledge policies/i);
      cites(response, "Standards of Conduct", 12);
    });

    it("late for shift is the incident, not the request; Attendance p.14 and the previous coaching", async () => {
      const response = await chat(CASES.lateShift);
      expectIncident(response, /late for shift/i);
      expect(happened(response)).not.toMatch(/write a|Tanning Consultant/i);
      const prior = `${response.formProposal?.priorActions ?? ""}\n${response.content}`;
      expect(prior).toMatch(/JBA (?:Policy )?Manual[^\n]*(?:1-1-25|0?1\/0?1\/2025|2025-01-01)/i);
      cites(response, "Attendance", 14);
    });

    it("cleaning duties keep their words and cite Care and Cleaning p.21", async () => {
      const response = await chat(CASES.cleaning);
      expectIncident(response, /cleaning duties not being completed/i);
      expect(happened(response)).not.toMatch(/\b0-26\b|^for /i);
      cites(response, "Care and Cleaning of Equipment and Facilities", 21);
    });

    it("opening the salon late is what happened, with Late Opening p.15 and the manual acknowledgement", async () => {
      const response = await chat(CASES.lateOpen);
      expectIncident(response, /opening the salon late/i);
      expect(response.content).not.toMatch(/^What happened\?$/m);
      const prior = `${response.formProposal?.priorActions ?? ""}\n${response.content}`;
      expect(prior).toMatch(/JBA Policy Manual[^\n]*(?:1-1-26|0?1\/0?1\/2026|2026-01-01)/i);
      cites(response, "Late Opening", 15);
    });

    it("the salon line is not what happened, Empire is not invented, and the earlier policy is cited", async () => {
      const response = await chat(CASES.empire);
      expect(happened(response)).not.toMatch(/sd\.|create corrective action|empire/i);
      expect(response.formProposal?.locationName ?? "").not.toMatch(/empire/i);
      expect(response.formProposal?.employeeRole ?? "").not.toMatch(/salon director/i);
      cites(response, "Animals in the Workplace", 30);
    });

    it("'out of dress code' keeps 'out of', and the prior action is in the reply once on each later turn", async () => {
      // "Manual — signed 09/01/2026" (intent path) or "manual acknowledgement 9/01" (remap path).
      const priorLine = /manual[^\n]*?(?:\b9\/0?1\b|09\/01\/2026)/gi;
      const second = await chat(CASES.dressCode.slice(0, 2));
      expectIncident(second, /^out of dress code/i);
      expect(second.content.match(priorLine)?.length, second.content).toBe(1);
      // The prior step's date is not the form's date.
      expect(second.formProposal?.formDate).not.toBe("2026-09-01");
      const third = await chat(CASES.dressCode);
      expectIncident(third, /^out of dress code/i);
      expect(third.content.match(priorLine)?.length, third.content).toBe(1);
      expect(third.formProposal?.formDate).not.toBe("2026-09-01");
    });
  });
}

describe("date bug fix in the remap path (REMAP_INCIDENT_FIX_ENABLED off)", () => {
  it("never reads '10-1' out of '10-15-26' or '10-2' out of '10-20-26'", () => {
    useFlags(["FORM_FULL_REMAP_ENABLED"]);
    const read = (question: string) =>
      groundFormSlots({ raw: remapRaw(REMAP_NAME), history: [], question, today: TODAY, people: [] }).slots.observation ?? "";
    expect(read("create a verbal CA for Test Employee for missing the 10-15-26 woven deadline")).not.toMatch(/5-26/);
    expect(read("create a CA for Test Employee for cleaning duties not being completed on 10-20-26")).not.toMatch(/0-26/);
    expect(
      read(
        "create a written CA for Test Employee for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26",
      ),
    ).not.toBe("9-1-26");
  });
});


/**
 * QA's live step-3 run and C-list (Ask Bubbles, 24–25 Oct 2026), in Sunny's
 * words, on both paths. Edits and commands never become What happened, a new
 * request with a new incident is a new form, a bare "Yes" after a list of
 * questions answers none, no plan is copied from the model or from "previous
 * coaching", and "as you said" only for a manager's own words.
 */
const EDIT_WORDS = /change the date|name is|cite |show draft|this is a violation|^it happened\b|^location$|sunny|this conversation|generate/i;
const KEARNEY = "loc-0309";

const STEP3 = {
  dateEdit: [
    // Sunny's readers take a month and day with a slash; Ask Bubbles' manager typed "10-19" / "10-22".
    { say: "CA for Test Employee at Kearney, late to open 10/19, verbal, no payroll", intent: { ...NAME, salon: "Kearney", incidentType: "late to open", incidentDate: "10/19", warningLevel: "verbal" }, remap: REMAP_NAME },
    { say: "change the date to 10/22", intent: { ...NAME, incidentDate: "10/22" }, remap: REMAP_NAME },
  ],
  measuring: [
    {
      say: "create a verbal CA for tanning consultant Testy Testerson at Kearney, NE. location. On 10-16-26 Testy was not properly measuring and recording lotion inventory. payroll deduct is not applicable",
      intent: { employee: "Testy Testerson", salon: "Kearney", title: "tanning consultant", incidentType: "not properly measuring and recording lotion inventory", incidentDate: "10-16-26", warningLevel: "verbal" },
      remap: { employeeName: "Testy Testerson" },
    },
    { say: "employee name is Testy Testerson", intent: { employee: "Testy Testerson" }, remap: { employeeName: "Testy Testerson" } },
    { say: "cite standards of conduct as policy violated", intent: { employee: "Testy Testerson" }, remap: { employeeName: "Testy Testerson" } },
    { say: "show draft", intent: { employee: "Testy Testerson" }, remap: { employeeName: "Testy Testerson" } },
    { say: "violation is that on 10-16-26 Testy was not measuring and recording lotion inventory", intent: { employee: "Testy Testerson" }, remap: { employeeName: "Testy Testerson" } },
    { say: "show draft with edits", intent: { employee: "Testy Testerson" }, remap: { employeeName: "Testy Testerson" } },
  ],
  nameAndPolicy: [
    {
      say: "create a written corrective action for Tanning Consultant, Test Employee. Test was assigned to complete policy acknowledgements in woven by 10-15-26 and failed to meet the deadline. Previous coaching was a Verbal CA 10-1-26. Payroll deduct is not applicable.",
      intent: { ...NAME, title: "Tanning Consultant", incidentType: "failed to complete policy acknowledgements by the deadline", warningLevel: "written" },
      remap: REMAP_NAME,
    },
    { say: "name is Test Employee", intent: NAME, remap: { ...REMAP_NAME, actionPlan: "Complete policy acknowledgements in woven" } },
    { say: "this is a violation under Standards of Conduct", intent: NAME, remap: { ...REMAP_NAME, actionPlan: "Complete policy acknowledgements in woven" } },
  ],
  newRequest: [
    {
      say: "create verbal CA for Test Testy for violating visitors at work policy on 10-10-26. Test Employee spent 40 minutes talking with friend and ignoring guests. previous coaching was jba policy manual 1-1-26",
      intent: { employee: "Test Testy", incidentType: "talking with friend", incidentDate: "10-10-26", warningLevel: "verbal" },
      remap: { employeeName: "Test Testy", observation: "Spent 40 minutes talking with friend and ignoring guests" },
    },
    { say: "no payroll deduct", intent: { employee: "Test Testy" }, remap: { employeeName: "Test Testy" } },
    {
      say: "create a verbal corrective action form for Test Employee. on 10-20-26 Test was talking on her cell phone for over 30 minutes",
      intent: { ...NAME, incidentType: "talking on her cell phone", incidentDate: "10-20-26", warningLevel: "verbal" },
      remap: { ...REMAP_NAME, observation: "Spent 40 minutes talking with friend and ignoring guests" },
    },
  ],
  coachingChat: [
    { say: "I need to coach an employee", intent: { formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "Her name is Test Employee", intent: { ...NAME, formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "She works at Kearney", intent: { ...NAME, salon: "Kearney", formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "It happened on 10-21", intent: { ...NAME, incidentDate: "10-21", formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "She was on her cell phone for 30+ minutes at the front desk", intent: { ...NAME, formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "Create a Coaching Form", intent: { ...NAME, formType: "coaching" }, remap: { templateKey: "coaching", employeeName: "Test Employee" } },
  ],
  fromConversation: [
    {
      say: "I have an employee Test Employee at our Kearney location who has been out of dress code three shifts. I verbally coached her on the second offense and she still is out of dress code",
      intent: { ...NAME, formType: null, formTurn: false },
      remap: { templateKey: null },
    },
    { say: "Create a Coaching Form from this conversation.", intent: { ...NAME, formType: "coaching" }, remap: { templateKey: "coaching", employeeName: "Test Employee" } },
  ],
  twoShifts: [
    {
      say: "My employee Test Employee has was 10 minutes late on her last two shifts. On the first shift I verbally coached her on our policy and expectations. Then she was late again. Please create a CA form so I can document. She was late on 10/5 and 10/15",
      intent: NAME,
      remap: REMAP_NAME,
    },
    { say: "I already told you the employee name. She is at Kearney", intent: { ...NAME, salon: "Kearney" }, remap: REMAP_NAME },
    { say: "I gave sunny all of the information it should need, but it still would not generate the coaching form.", intent: { ...NAME, formType: "coaching" }, remap: { templateKey: "coaching", employeeName: "Test Employee" } },
  ],
  shortage: [
    { say: "create ca form for Test Employee for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching", intent: { ...NAME, incidentType: "attendance", incidentDate: "10-20-26", warningLevel: "verbal" }, remap: REMAP_NAME },
    { say: "verbal", intent: { ...NAME, warningLevel: "verbal" }, remap: REMAP_NAME },
    {
      say: "create ca form for Test Employee for a register shortage on 10-20-26. payroll deduct applies and $3.25 will be deducted from check. previous coaching - jba policy manual 1-20-26.",
      intent: { ...NAME, incidentType: "register shortage", incidentDate: "10-20-26", payrollAmount: "$3.25" },
      remap: { ...REMAP_NAME, actionPlan: "Previous coaching" },
    },
  ],
  puppy: [
    {
      say: "do verbal for tanning consultant Test Employee at empire, sd. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the salon to show her team her new puppy. Test was in the salon 45 min",
      intent: { ...NAME, formType: null, formTurn: false },
      remap: { templateKey: null },
    },
    { say: "jba manual 11-1-25", intent: { ...NAME, formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "cite animals in the workplace policy", intent: { formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "salon location is empire, sd. create corrective action", intent: { ...NAME }, remap: REMAP_NAME },
  ],
  phoneThenReview: [
    { say: "Test Employee at Kearney used her cell phone on the salon floor on 10-17", intent: { ...NAME, salon: "Kearney", formType: null, formTurn: false }, remap: { templateKey: null } },
    { say: "Create a Policy Review", intent: { ...NAME, formType: "policy review" }, remap: { templateKey: "policy-review", employeeName: "Test Employee" } },
  ],
} satisfies Record<string, readonly Turn[]>;

for (const path of ["intent", "remap"] as const) {
  describe(`${path} path: step 3 and C-list in Sunny's words`, () => {
    beforeEach(() => useFlags(path === "intent" ? [...INTENT_FLAGS, "REMAP_INCIDENT_FIX_ENABLED"] : REMAP_FLAGS));

    it("A3: 'change the date to 10-22' changes the date only", async () => {
      const response = await chat(STEP3.dateEdit);
      expect(response.formProposal?.formDate).toBe("2026-10-22");
      expectIncident(response, /late to open/i);
      expect(happened(response)).not.toMatch(EDIT_WORDS);
    });

    it("name, cite and show-draft turns keep the incident; 10-16-26 stays whole", async () => {
      for (const count of [2, 3, 4, 5, 6]) {
        const response = await chat(STEP3.measuring.slice(0, count));
        expectIncident(response, /measuring and recording lotion inventory/i);
        expect(happened(response), `turn ${count}`).not.toMatch(EDIT_WORDS);
        expect(happened(response), `turn ${count}`).not.toMatch(/(?<!\d-)\b6-26\b/);
      }
    });

    it("'name is' and the policy line keep the incident, and no plan is copied from the model", async () => {
      for (const count of [2, 3]) {
        const response = await chat(STEP3.nameAndPolicy.slice(0, count));
        expectIncident(response, /policy acknowledgements in woven/i);
        expect(happened(response), `turn ${count}`).not.toMatch(/^create a for|^name is|this is a violation/i);
        expect(response.content, `turn ${count}`).not.toMatch(/Complete policy acknowledgements in woven/);
        const prior = `${response.formProposal?.priorActions ?? ""}\n${response.content}`;
        expect(prior, `turn ${count}`).toMatch(/Verbal (?:CA|corrective action)[^\n]*(?:10-1-26|10\/0?1\/2026)/i);
      }
    });

    it("a new request with a new incident resets What happened and the policy", async () => {
      const response = await chat(STEP3.newRequest);
      expectIncident(response, /cell phone/i);
      expect(happened(response)).not.toMatch(/talking with friend/i);
      expect(response.content).not.toMatch(/Visitors[^\n]*as you said/i);
    });

    it("'It happened on 10-21' is the date; the cell phone sentence is What happened", async () => {
      const response = await chat(STEP3.coachingChat);
      expect(response.formProposal?.templateKey).toBe("coaching");
      expectIncident(response, /cell phone for 30\+/i);
      expect(happened(response)).not.toMatch(/^it happened/i);
    });

    it("'Create a Coaching Form from this conversation.' is never What happened", async () => {
      const response = await chat(STEP3.fromConversation);
      expect(happened(response)).not.toMatch(/Create a Coaching Form|this conversation/i);
      expectIncident(response, /out of dress code/i);
    });

    it("the account keeps both dates and the verbal coaching; the complaint is never What happened", async () => {
      for (const count of [1, 3]) {
        const response = await chat(STEP3.twoShifts.slice(0, count));
        const issue = happened(response);
        expect(issue, `turn ${count}: ${response.content}`).toMatch(/10 minutes late/);
        expect(issue, `turn ${count}`).toMatch(/10\/5/);
        expect(issue, `turn ${count}`).toMatch(/10\/15/);
        expect(issue, `turn ${count}`).toMatch(/verbally coached/);
        expect(issue, `turn ${count}`).not.toMatch(EDIT_WORDS);
      }
    });

    it("a new request drops the old policy; previous coaching is a prior action, never the plan", async () => {
      const response = await chat(STEP3.shortage);
      expectIncident(response, /register shortage/i);
      expect(response.content).not.toMatch(/Attendance[^\n]*as you said/i);
      expect(response.content).not.toMatch(/Action plan:\*\*\s*Previous coaching/i);
      const prior = `${response.formProposal?.priorActions ?? ""}\n${response.content}`;
      expect(prior).toMatch(/JBA Policy Manual[^\n]*(?:1-20-26|0?1\/20\/2026)/i);
    });

    it("every 'as you said' value is in the manager's words (conv_mvmzmy4g2wp7dhf)", async () => {
      const turns = CASES.meeting.map((turn) => turn.say);
      const response = await chat(CASES.meeting);
      const said = turns.join("\n");
      for (const match of response.content.matchAll(/\*\*([^*]+):\*\*\s*([^\n]+?),? as you said/g)) {
        const [, label, value] = match;
        const evidence = /payroll/i.test(label!) ? ["payroll"] : value!.replace(/\*/g, "").split(/[^A-Za-z]+/).filter((word) => word.length >= 3);
        expect(evidence.some((word) => new RegExp(`\\b${word}\\b`, "i").test(said)), `${label}: ${value}`).toBe(true);
      }
    });

    it("the form date is 10-22-26, never the 'jba manual 11-1-25' date", async () => {
      const response = await chat(STEP3.puppy);
      expect(response.formProposal?.formDate).toBe("2026-10-22");
      expect(happened(response)).not.toMatch(/create corrective action|sd\./i);
      cites(response, "Animals in the Workplace", 30);
    });

    it("the Policy Review keeps the salon named before the account", async () => {
      const response = await chat(STEP3.phoneThenReview);
      expect(response.formProposal?.templateKey).toBe("policy-review");
      expect(response.formProposal?.locationId).toBe(KEARNEY);
    });
  });
}

describe("remap path: a bare yes after several questions (Sunny wording)", () => {
  it("is not a payroll answer, and the questions are asked again", async () => {
    useFlags(REMAP_FLAGS);
    const response = await chat(CASES.bareYes);
    expect(response.formProposal?.payrollDeduct ?? null).toBeNull();
    expect(response.content).toContain("Is payroll deduct applicable?");
  });
});

/**
 * Ask Bubbles QA B5, prod 25 Oct 2026 (conv_mvnmf1ik2lqkfld, its remap path
 * with REMAP_INCIDENT_FIX_ENABLED off): "What happened: create a for for
 * missing the 5-26 woven deadline" and "Action plan: Meet the woven
 * deadline", a plan the manager never typed. The same turn in Sunny's words,
 * through Sunny's live intent path and its remap path, with the fix flag on.
 * The remap stand-in returns the plan the extraction returned in prod.
 */
const B5_SAID = "create a written CA for Test Employee at Kearney for missing the 10-15-26 woven deadline";
const B5: readonly Turn[] = [
  {
    say: B5_SAID,
    intent: { ...NAME, salon: "Kearney", incidentType: "missing the 10-15-26 woven deadline", incidentDate: "10-15-26", warningLevel: "written" },
    remap: { ...REMAP_NAME, actionPlan: "Meet the woven deadline" },
  },
];
const B5_MANGLED = /create a for|(?<![\d-])5-26|Meet the woven deadline/i;

for (const path of ["intent", "remap"] as const) {
  describe(`${path} path: Ask Bubbles QA B5, the woven deadline request in Sunny's words`, () => {
    beforeEach(() => useFlags(path === "intent" ? [...INTENT_FLAGS, "REMAP_INCIDENT_FIX_ENABLED"] : REMAP_FLAGS));

    it("What happened is the incident with its whole date, and no plan is taken from the model", async () => {
      const response = await chat(B5);
      expectIncident(response, /^missing the 10-15-26 woven deadline$/i);
      expect(response.content).not.toMatch(B5_MANGLED);
      expect(response.content).toMatch(/Written Warning, as you said/);
      if (path === "remap") {
        expect(response.formProposal?.formDate).toBe("2026-10-15");
        expect(response.content).not.toMatch(/Action plan/i);
      }
    });
  });
}

describe("remap path: Ask Bubbles QA B5 stored slots (Sunny wording)", () => {
  /** The prod trace row's shape for that turn, with this app's salon. */
  const STORED = {
    templateKey: "dpoa",
    employeeName: "Test Employee",
    store: "NE Kearney",
    locationId: KEARNEY,
    incidentDateIso: "2026-10-15",
    warningLevel: "written",
    observation: "create a for for missing the 5-26 woven deadline",
    actionPlan: "Meet the woven deadline",
  };

  it("the stored fragment and the stored plan do not ride on to the next turn", () => {
    useFlags(REMAP_FLAGS);
    // The next answer, with the turn that held the account not in hand.
    const { slots, response } = groundFormSlots({
      raw: remapRaw({ ...REMAP_NAME, actionPlan: "Meet the woven deadline" }),
      history: [],
      question: "Tanning Consultant",
      today: "2026-10-25",
      people: [],
      saved: STORED as never,
    });
    expect(slots.observation).toBeNull();
    expect(slots.actionPlan).toBeNull();
    expect(response.content).not.toMatch(B5_MANGLED);
    expect(response.content).toContain("What happened?");

    const next = groundFormSlots({
      raw: remapRaw({ ...REMAP_NAME, actionPlan: "Meet the woven deadline" }),
      history: [{ role: "user", content: B5_SAID }],
      question: "Tanning Consultant",
      today: "2026-10-25",
      people: [],
      saved: STORED as never,
    });
    expect(next.slots.observation).toBe("missing the 10-15-26 woven deadline");
    expect(next.slots.actionPlan).toBeNull();
  });

  it("a model summary with the date cut short is not What happened", () => {
    useFlags(REMAP_FLAGS);
    // "date is …" reads as a date edit, so the summary is the fallback here.
    const { slots } = groundFormSlots({
      raw: remapRaw({ ...REMAP_NAME, observation: "missed the 5-26 woven deadline" }),
      history: [{ role: "user", content: "create a written CA for Test Employee" }],
      question: "date is 10-15-26, missed the woven deadline",
      today: "2026-10-25",
      people: [],
    });
    expect(slots.observation ?? "").not.toMatch(/(?<![\d-])5-26/);
    expect(slots.incidentDateIso).toBe("2026-10-15");
  });
});

/*
 * INTEGRATION, REMAP_INCIDENT_FIX_ENABLED + LATE_OPEN_DATE_ENABLED. The remap
 * fix reads the policy only from a policy the manager names, so with both on
 * a described late opening ("late to open 10-19", conv_mvmt1v0u2u32xsf) lost
 * the Late Opening policy LATE_OPEN_DATE gives it. The fix path now falls back
 * to Late Opening when no policy is named and the manual gives no section.
 */
describe("remap path: a late opening with LATE_OPEN_DATE_ENABLED on too", () => {
  const LATE: readonly Turn[] = [
    {
      say: "CA for Test Employee at NE Kearney, late to open 10-19, verbal, no payroll",
      intent: { ...NAME, salon: "NE Kearney", incidentType: "late to open", incidentDate: "10-19", warningLevel: "verbal" },
      remap: REMAP_NAME,
    },
  ];

  afterEach(() => {
    delete process.env.LATE_OPEN_DATE_ENABLED;
  });

  it("both on: the card keeps the Late Opening policy", async () => {
    useFlags(REMAP_FLAGS);
    process.env.LATE_OPEN_DATE_ENABLED = "true";
    const response = await chat(LATE);
    expect(response.content).toMatch(/\*\*Policy:\*\* Late Opening/);
    expect(response.content).not.toMatch(/Late Opening, as you said/);
    // LATE_OPEN_DATE's rule: a late opening cites Late Opening, not Attendance too.
    expect(response.content).toMatch(/Late Opening Policy, JBA Policy Manual p\.15/);
    expect(response.content).not.toMatch(/Attendance/);
    expect(response.formProposal?.formDate).toBe("2026-10-19");
  });

  it("both on, with no manual section to cite: the policy is still Late Opening", async () => {
    useFlags(REMAP_FLAGS);
    process.env.LATE_OPEN_DATE_ENABLED = "true";
    const { remapFormTurn } = await import("./form-full-remap");
    const response = await remapFormTurn({ question: LATE[0]!.say, history: [], today: TODAY, people: [] }, async () => ({
      raw: null,
      model: "test",
      inputTokens: null,
      outputTokens: null,
    }));
    expect(response?.content).toMatch(/\*\*Policy:\*\* Late Opening(?!, as you said)/);
  });

  it("LATE_OPEN_DATE alone: Late Opening, as before", async () => {
    useFlags(["FORM_FULL_REMAP_ENABLED"]);
    process.env.LATE_OPEN_DATE_ENABLED = "true";
    const response = await chat(LATE);
    expect(response.content).toMatch(/\*\*Policy:\*\* Late Opening, as you said/);
  });

  it("REMAP_INCIDENT_FIX alone: no policy read from a description, as before", async () => {
    useFlags(REMAP_FLAGS);
    const response = await chat(LATE);
    expect(response.content).not.toMatch(/\*\*Policy:\*\* Late Opening/);
  });
});
