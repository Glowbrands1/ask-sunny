import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * COACHING_ASKS_WHAT_HAPPENED_ENABLED (QA, 26 Oct 2026; the sibling app's
 * tester on path B, reproduced here on the live intent path): "coaching for
 * devon harlan" with no account was answered "Everything I need is here,
 * drawn from your message above." and never asked what happened, where a
 * Corrective Action says "You haven't told me what happened yet". Through
 * `answerQuestion`; the model is a stand-in that copies the manager's words;
 * the name is invented. Lowercase and sentence case.
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
const ALL_FLAGS = [...INTENT_FLAGS, ...REMAP_FLAGS, "COACHING_ASKS_WHAT_HAPPENED_ENABLED"] as const;

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
  const conversationId = `conv-coaching-ask-${chatCount}`;
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



const ON = [...INTENT_FLAGS, "COACHING_ASKS_WHAT_HAPPENED_ENABLED"];
const ASK = "You haven't told me what happened yet";
const BARE = [
  "coaching for devon harlan",
  "Coaching for devon harlan",
  "Coaching for Devon Harlan",
  "create a coaching form for devon harlan",
  "Create a coaching form for Devon Harlan",
];
const coach = (say: string) => ({ say, intent: { employee: "devon harlan", formType: "coaching" } });

describe("COACHING_ASKS_WHAT_HAPPENED_ENABLED on", () => {
  it("a coaching card on a name alone asks what happened, as the Corrective Action does", async () => {
    useFlags(ON);
    for (const say of BARE) {
      const reply = await chat([coach(say)]);
      expect(reply.formProposal?.templateKey, say).toBe("coaching");
      expect(reply.content, say).toContain(ASK);
      expect(reply.content, say).not.toMatch(/Everything I need is here/);
    }
  });

  it("an answer ends the question, and is never asked again", async () => {
    useFlags(ON);
    for (const answer of ["she skipped the 10 minute disinfect today", "She was late", "missed the team huddle this morning"]) {
      const reply = await chat([coach("coaching for devon harlan"), coach(answer)]);
      expect(reply.content, answer).not.toContain(ASK);
    }
  });

  it("an account in the request is never asked for", async () => {
    useFlags(ON);
    for (const say of ["coaching for devon harlan, she was late today", "Coaching for Devon Harlan, skipped the closing checklist on 10-24-26"]) {
      const reply = await chat([coach(say)]);
      expect(reply.content, say).not.toContain(ASK);
    }
  });
});

describe("COACHING_ASKS_WHAT_HAPPENED_ENABLED off", () => {
  it("the bare request says everything is there and never asks (the reported bug)", async () => {
    useFlags(INTENT_FLAGS);
    const reply = await chat([coach(BARE[0]!)]);
    expect(reply.content).toMatch(/Everything I need is here/);
    expect(reply.content).not.toContain(ASK);
  });
});

describe("COACHING_ASKS_WHAT_HAPPENED_ENABLED on: once per card, and what counts as an account (QA-4 / QA-6, 26 Oct 2026)", () => {
  const twins = (text: string) => [text, text.charAt(0).toUpperCase() + text.slice(1), text.toUpperCase()];

  it("after the app has asked, no reply makes it ask again", async () => {
    useFlags(ON);
    for (const reply of ["ok", "yes", "idk", "nothing", "no", "Ok", "IDK"]) {
      const card = await chat([coach("coaching for devon harlan"), coach(reply)]);
      expect(card.content, reply).not.toContain(ASK);
    }
  });

  it("a clause that only says what did not happen is not an account: it asks", async () => {
    useFlags(ON);
    for (const wording of [
      "coaching for devon harlan, she was not late",
      "coaching for devon harlan, she was never late",
      "coaching for devon harlan, she didn't do anything wrong",
      "coaching for devon harlan, nothing happened",
      "coaching for devon harlan, no incident",
    ]) {
      for (const say of twins(wording)) expect((await chat([coach(say)])).content, say).toContain(ASK);
    }
  });

  // On the card itself the employee reader currently joins the two names ("Devon Harlan Rory Vance";
  // the name readers' own fix), so the rule is pinned on the step with the card's employee as intended.
  it("an account about somebody else is not this employee's: it asks", async () => {
    const { askWhatHappened } = await import("./coaching-what-happened");
    const card = { content: "Here is what I would put on a **Coaching Form**.", citations: [], recommendedVideoIds: [], formProposal: { templateKey: "coaching", employeeName: "Devon Harlan" } };
    for (const wording of ["coaching for devon harlan, rory vance was late today", "coaching for devon harlan and rory vance was late today"]) {
      for (const say of twins(wording)) {
        expect(askWhatHappened(card as never, say, []).content, say).toContain(ASK);
      }
    }
    expect(askWhatHappened(card as never, "coaching for devon harlan, she was late today", []).content).not.toContain(ASK);
  });

  it("this employee's own account still never asks, in every case", async () => {
    useFlags(ON);
    for (const say of twins("coaching for devon harlan, she was late today")) {
      expect((await chat([coach(say)])).content, say).not.toContain(ASK);
    }
  });
});
