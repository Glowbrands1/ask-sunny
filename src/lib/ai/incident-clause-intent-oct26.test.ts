import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * INCIDENT_CLAUSE_SPLIT_ENABLED on Sunny's live intent path (REMAP_INCIDENT_FIX
 * off, so the Observation of Offense is built by `withObservation`). QA /
 * Code 8, 26 Oct 2026, on production flags: "no deduct" and "date 10/14" were
 * copied into the Observation, and "she works at our kearney, ne salon as a
 * tan consultant" was the account. Through `answerQuestion`; the model is a
 * stand-in that copies the manager's words; the people are invented. Every
 * wording runs all lowercase and in sentence case.
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
const ALL_FLAGS = [...INTENT_FLAGS, ...REMAP_FLAGS, "INCIDENT_CLAUSE_SPLIT_ENABLED", "INCIDENT_COMMAND_WORDS_ENABLED"] as const;

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

beforeAll(async () => {
  ({ answerQuestion } = await import("./server-ask"));
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
  const conversationId = `conv-incident-intent-${chatCount}`;
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



const WORDINGS: readonly (readonly [string, RegExp])[] = [
  ["coaching form for kira dunmore. late opening the salon today. no deduct", /deduct/i],
  ["coaching form for kira dunmore. skipped a tour today. date 10/14", /date/i],
  ["create a ca for kira dunmore, she works at our kearney, ne salon as a tan consultant and was late today", /tan consultant|ne salon/i],
];

function sentenceCase(text: string): string[] {
  const first = text.charAt(0).toUpperCase() + text.slice(1);
  return [text, first, first.replace("kira dunmore", "Kira Dunmore")];
}

describe("intent path, INCIDENT_CLAUSE_SPLIT_ENABLED and INCIDENT_COMMAND_WORDS_ENABLED on", () => {
  it("the Observation of Offense carries no command and no employee fact", async () => {
    // The commands are INCIDENT_COMMAND_WORDS_ENABLED's; the employee facts INCIDENT_CLAUSE_SPLIT_ENABLED's.
    useFlags([...INTENT_FLAGS, "INCIDENT_CLAUSE_SPLIT_ENABLED", "INCIDENT_COMMAND_WORDS_ENABLED"]);
    for (const [wording, leftover] of WORDINGS) {
      for (const say of sentenceCase(wording)) {
        const reply = await chat([{ say, intent: { employee: "kira dunmore" } }]);
        const observation = /\*\*Observation of Offense:\*\*\s*([^\n]+)/.exec(reply.content)?.[1] ?? "";
        expect(observation, say).not.toMatch(leftover);
        expect(observation, say).toMatch(/late opening the salon today|skipped a tour today|late today/i);
      }
    }
  });
});

describe("intent path, INCIDENT_CLAUSE_SPLIT_ENABLED off", () => {
  it("the employee facts and the intent read's own sentences are copied into the Observation (the reported bug)", async () => {
    useFlags(INTENT_FLAGS);
    const reply = await chat([{ say: WORDINGS[2]![0], intent: { employee: "kira dunmore" } }]);
    const observation = /\*\*Observation of Offense:\*\*\s*([^\n]+)/.exec(reply.content)?.[1] ?? "";
    expect(observation).toMatch(/tan consultant/i);
    expect(observation).toMatch(/It happened at NE Kearney/);
  });
});
