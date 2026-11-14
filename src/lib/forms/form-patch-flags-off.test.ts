import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * Step B, the no-import tests (FORM_PATCH_REDUCER_ENABLED,
 * FORM_REPLY_FROM_DIFF_ENABLED). The AI SDK is imported in one module only,
 * and with both flags unset the chat and draft routes never load it.
 */

const loaded = vi.hoisted(() => ({ call: false, modules: [] as string[] }));

vi.mock("@/lib/forms/form-patch-call", () => {
  loaded.call = true;
  return { callFormPatchModel: vi.fn(async () => ({ fallback: "error" })) };
});

/* Step B's wiring modules: each records a load, and is otherwise the real module. */
vi.mock("@/lib/forms/form-patch-turn", async (importOriginal) => {
  loaded.modules.push("form-patch-turn");
  return importOriginal();
});
vi.mock("@/lib/forms/form-reducer-draft", async (importOriginal) => {
  loaded.modules.push("form-reducer-draft");
  return importOriginal();
});
vi.mock("@/lib/forms/form-snapshot", async (importOriginal) => {
  loaded.modules.push("form-snapshot");
  return importOriginal();
});
vi.mock("@/lib/forms/form-patch-model", async (importOriginal) => {
  loaded.modules.push("form-patch-model");
  return importOriginal();
});
vi.mock("@/lib/forms/form-diff-reply", async (importOriginal) => {
  loaded.modules.push("form-diff-reply");
  return importOriginal();
});

/* ------------------------------------------------- a chat, in memory ---- */
/* The pattern of the replay pack (`src/app/api/chat/replay-pack/replay-pack-e2e.test.ts`). */

const store = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
  chat_conversations: [],
  chat_messages: [],
  chat_traces: [],
  chat_form_state: [],
  chat_form_incidents: [],
} as unknown as FakeStore;

const DIRECTORY = [
  { id: "e-2", firstName: "Remy", lastName: "Calder", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  assertLiveMode: () => {},
  assertNoConfigurationProblems: () => {},
  assertWithinRateLimit: () => {},
}));
vi.mock("@/lib/config/server-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/server-env")>()),
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  supabaseReadiness: () => ({ ready: true, missing: [] }),
}));
vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async (_request: Request, permission: string) => ({
    identity: {
      subject: "qa-manager",
      email: "qa-manager@example.test",
      displayName: "QA Manager",
      role: "salon_director",
      scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] },
      verified: true,
    },
    permission,
    provider: "supabase",
  }),
}));
vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));
vi.mock("@/lib/ai/call-claude", () => ({
  callClaudeToolTimed: async () => ({ input: { employee: null, incident: null, incidentDate: null }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
  callClaude: async () => "A grounded answer from the policy manual.",
  callClaudeTool: async (input: { tool?: { name?: string } }) =>
    input.tool?.name === "extract_form_fields" ? { templateKey: "dpoa", employeeName: null, observation: null, actionPlan: null } : null,
}));
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => ({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            name: request.tool_choice?.name === "revise_form_fields" ? "revise_form_fields" : "write_form_fields",
            // The draft writes something, so the draft route reaches its write (and, flag on, the reducer).
            input: request.tool_choice?.name === "revise_form_fields" ? { values: {} } : { values: { observation: "Observed:\nUnderperformance in the month of October." } },
          },
        ],
      }),
    },
  }),
}));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async fetchNamedHandbook() {
      return { ok: false, reason: "offline", problem: "not_found" };
    }
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding(role: { id: string }) {
      return {
        ok: true,
        grounding: {
          role: { id: role.id },
          documentId: "doc-progression",
          documentTitle: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            {
              chunk_id: "pmf-0",
              document_id: "doc-progression",
              document_title: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
              category: "leadership_coaching",
              locator: "SECTION 2",
              page: null,
              section: null,
              content: "Solve the issue at the lowest appropriate level.",
              similarity: 0,
            },
          ],
          presentGroups: ["escalation_ladder"],
        },
      };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: JBA_MANUAL_CA_CHUNKS,
      };
    }
  },
}));
vi.mock("@/lib/knowledge/recall-match", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/recall-match")>()),
  matchRecallKnowledge: async () => [],
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    readDirectoryFacts: async (scope: AccessScope | null) =>
      actual.scopeRoster(DIRECTORY as never, scope).map((person) => ({
        ...person,
        title: DIRECTORY.find((row) => row.id === person.id)?.positionName ?? null,
        primaryLocationName: "Kearney",
      })),
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(DIRECTORY as never, scope),
  };
});
vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

const FLAGS = ["FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const name of FLAGS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const ONLY = "src/lib/forms/form-patch-call.ts";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if ((name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) out.push(path);
  }
  return out;
}

/*
 * ONE REVIEWED EXCEPTION (QA, 13 Nov 2026): the DM L10 tab's Leadership Assistant (src/features/l10/assistant) is
 * built on the AI SDK, on its own route (/api/l10/assistant) and its own page. The point of this guard is that chat
 * and forms never load the AI SDK while Step B's flags are off; the L10 assistant is outside both, and the second test
 * below keeps it that way: nothing outside the L10 tab imports it.
 */
const L10_ASSISTANT = ["src/features/l10/assistant/", "src/app/api/l10/"];
const isL10 = (path: string) => L10_ASSISTANT.some((dir) => path.split("\\").join("/").startsWith(dir));

describe("the AI SDK is imported only by the form-patch call module", () => {
  it("no other production source imports it", () => {
    const needles = ['from "ai"', "from 'ai'", 'import("ai")', "import('ai')", "@ai-sdk/anthropic"];
    const offenders = sources("src").filter((path) => path !== ONLY && !isL10(path) && needles.some((needle) => readFileSync(path, "utf8").includes(needle)));
    expect(offenders).toEqual([]);
  });

  it("the DM L10 assistant (the one exception) is reached only from the DM L10 tab, never from chat or forms", () => {
    const outside = sources("src").filter(
      (path) => !path.split("\\").join("/").startsWith("src/features/l10/") && !isL10(path) && /@\/features\/l10\/assistant/.test(readFileSync(path, "utf8")),
    );
    expect(outside).toEqual([]);
  });

  it("the call module imports it only dynamically", () => {
    const source = readFileSync(ONLY, "utf8");
    expect(source).toContain('await import("ai")');
    expect(source).toContain('await import("@ai-sdk/anthropic")');
    expect(source).not.toContain('from "ai"');
    expect(source).not.toContain('from "@ai-sdk/anthropic"');
  });
});

describe("with both flags unset", () => {
  it("both flags read false", async () => {
    const { formPatchReducerEnabled, formReplyFromDiffEnabled } = await import("@/lib/config/chat-quality-flags");
    expect(formPatchReducerEnabled()).toBe(false);
    expect(formReplyFromDiffEnabled()).toBe(false);
  });

  it("loading the chat route and the draft route does not load the call module", async () => {
    const chat = await import("@/app/api/chat/route");
    const draft = await import("@/app/api/forms/instances/[id]/draft/route");
    expect(typeof chat.POST).toBe("function");
    expect(typeof draft.POST).toBe("function");
    expect(loaded.call).toBe(false);
  }, 60_000);

  it("a chat turn on an open draft, and the draft route's POST, load none of Step B's modules, and no formDiff is returned", async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
    const { createInlineForm } = await import("@/features/chat/create-inline-form");
    const chatRoute = await import("@/app/api/chat/route");
    const instancesRoute = await import("@/app/api/forms/instances/route");
    const draftRoute = await import("@/app/api/forms/instances/[id]/draft/route");
    await ensureTemplateLibrary("system");

    const drafted: Record<string, unknown>[] = [];
    const call = async <T,>(url: string, init?: RequestInit): Promise<T> => {
      const request = new Request(`https://app.test${url}`, init);
      const id = url.startsWith("/api/forms/instances/") ? url.split("/")[4]! : null;
      const response = id ? await draftRoute.POST(request, { params: Promise.resolve({ id }) }) : await instancesRoute.POST(request);
      const body = (await response.json()) as T & Record<string, unknown>;
      if (id) drafted.push(body);
      if (!response.ok) throw new Error(String(body.error ?? response.status));
      return body;
    };

    const messages: ChatMessage[] = [];
    let instanceId: string | null = null;
    const say = async (question: string) => {
      const response = await chatRoute.POST(
        new Request("https://app.test/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question,
            mode: "standard",
            history: messages.map(({ id, role, content, formProposal }) => ({ id, role, content, ...(formProposal ? { formProposal } : {}) })),
            questionMessageId: `m${messages.length}`,
            ...(instanceId ? { activeFormInstanceId: instanceId } : {}),
          }),
        }),
      );
      const payload = (await response.json()) as { content: string; formProposal?: ChatFormProposal } & Record<string, unknown>;
      expect(response.status, JSON.stringify(payload)).toBe(200);
      messages.push(
        { id: `m${messages.length}`, role: "user", content: question, createdAt: "2026-11-03T12:00:00Z" } as ChatMessage,
        { id: `a${messages.length}`, role: "assistant", content: payload.content, createdAt: "2026-11-03T12:00:01Z", ...(payload.formProposal ? { formProposal: payload.formProposal } : {}) } as ChatMessage,
      );
      return payload;
    };

    const first = await say("CA for Remy Calder for underperformance in the month of October");
    expect(first.formProposal, first.content).toBeTruthy();
    const created = await createInlineForm({ proposal: first.formProposal!, messages, call, onCreated: () => {} });
    // The chat route only accepts a UUID for the open form; the fake numbers rows `fake-N`.
    const uuid = randomUUID();
    for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
      for (const row of store[table]) {
        if (row.id === created.reference.instanceId) row.id = uuid;
        if (row.instance_id === created.reference.instanceId) row.instance_id = uuid;
      }
    }
    instanceId = uuid;
    expect(drafted.length, "the draft route was not called").toBeGreaterThan(0);
    for (const body of drafted) expect(body).not.toHaveProperty("formDiff");

    const turn = await say("Previous coaching was when she signed the policy manual, signed May 2025");
    expect(turn).not.toHaveProperty("formDiff");
    /*
     * The same reply as main: this exact chat, run on origin/main before Step B
     * (3 Nov 2026, the same mocks), answered with this body, field for field.
     */
    expect(turn).toEqual({ content: "A grounded answer from the policy manual.", citations: [], coverage: "grounded", recommendedVideoIds: [], turnId: "turn-qa" });
    expect(loaded.call).toBe(false);
    expect(loaded.modules).toEqual([]);
  }, 60_000);

  it("the mock does record a load (the check above can fail)", async () => {
    await import("@/lib/forms/form-patch-model");
    expect(loaded.call).toBe(true);
    await import("@/lib/forms/form-patch-turn");
    expect(loaded.modules).toContain("form-patch-turn");
  });
});
