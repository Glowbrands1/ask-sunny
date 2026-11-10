import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { DirectoryFact } from "@/lib/forms/employee-roster";
import { correctiveActionDocument } from "@/lib/forms/library";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } from "@/lib/ai/__fixtures__/jba-policy-manual";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * SUNNY TESTER, 26 OCT 2026 — A PRIOR IN A SHORT SECOND SENTENCE
 * ============================================================================
 *
 * The tester's turn, word for word but for the employee, who is invented here
 * ("Rowan Pell"), in all three casings:
 *
 *   "Write up Rowan Pell, Tanning Consultant, KS Manhattan, no call no show
 *    today. I coached her on 10-16 and gave a verbal on 10-21."
 *
 * The form was dated today (right), but there was no Prior actions line, and
 * the Observation stopped after "… no call no show today.": the second
 * sentence was dropped everywhere. With PRIOR_ACTIONS_NO_COMMA_ENABLED (and
 * PRIOR_ACTIONS_PARSE_ENABLED, on in production) both steps are listed, the
 * Observation keeps the sentence, and the form stays dated today, whatever
 * date the slot model copied. Through `answerQuestion` with this app's
 * production profile, as `prior-actions-yearless-oct25.test.ts` runs.
 */

const TODAY = "2026-10-26";

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
    id: "rowan",
    firstName: "Rowan",
    lastName: "Pell",
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


const SAID =
  "Write up Rowan Pell, Tanning Consultant, KS Manhattan, no call no show today. I coached her on 10-16 and gave a verbal on 10-21.";
const SECOND = "I coached her on 10-16 and gave a verbal on 10-21.";
const PRIORS = "**Prior actions:** Coaching — 10/16/2026; Verbal warning — 10/21/2026";

const CASINGS = [
  ["all lowercase", SAID.toLowerCase()],
  ["sentence case", SAID],
  ["sentence case, name lowercase", SAID.replace("Rowan Pell", "rowan pell")],
  ["ALL CAPS", SAID.toUpperCase()],
] as const;

/** What the slot model copies from the manager's words; the date as it came back. */
function model(date: string | null) {
  return (manager: string) => ({
    employee: /rowan pell/i.test(manager) ? "Rowan Pell" : null,
    salon: /manhattan/i.test(manager) ? "KS Manhattan" : null,
    title: /tanning consultant/i.test(manager) ? "tanning consultant" : null,
    incidentType: /no call no show/i.test(manager) ? "no call no show" : null,
    incidentDate: date,
    payrollAmount: null,
    warningLevel: null,
    formType: "corrective action",
    formTurn: true,
    policyHeading: null,
  });
}

function observation(content: string): string {
  return /\*\*Observation of Offense:\*\*\s*([^\n]+)/.exec(content)?.[1] ?? "";
}

describe("the tester's turn, flag on", () => {
  for (const [casing, said] of CASINGS) {
    for (const date of ["10-21", null] as const) {
      it(`both priors listed, the sentence kept, dated today (${casing}; model date ${date ?? "none"})`, async () => {
        vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
        vi.stubEnv("PRIOR_ACTIONS_NO_COMMA_ENABLED", "1");
        intentModel.reading = model(date);
        const [first] = await chat([said], `conv-second-${casing.length}-${date ?? "none"}`);
        const card = first!.formProposal!;
        expect(card, first!.content).toBeTruthy();
        expect(first!.content).toContain(PRIORS);
        expect(observation(first!.content).toLowerCase()).toContain(SECOND.toLowerCase());
        expect(card.formDate).toBe(TODAY);
      });
    }
  }
});

describe("flag off: today's output, pinned", () => {
  it("no Prior actions line, and the Observation stops after the first sentence (the tester's defect)", async () => {
    vi.stubEnv("PRIOR_ACTIONS_PARSE_ENABLED", "1");
    vi.stubEnv("PRIOR_ACTIONS_NO_COMMA_ENABLED", "");
    intentModel.reading = model(null);
    const [first] = await chat([SAID], "conv-second-off");
    expect(first!.content).not.toContain("**Prior actions:**");
    expect(observation(first!.content)).not.toContain("coached");
    expect(first!.formProposal?.formDate).toBe(TODAY);
  });
});
