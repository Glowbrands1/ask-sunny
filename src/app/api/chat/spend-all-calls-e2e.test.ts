import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PAU AND QA, 28 OCT 2026 — EVERY CLAUDE CALL IS COUNTED
 * ============================================================================
 *
 * SPEND_GUARD_ALL_CALLS_ENABLED (default off). Through the real chat route,
 * the real Create (the draft route) and the real `call-claude.ts`, with a fake
 * Anthropic client wrapped as `anthropic.ts` wraps the real one: every call a
 * turn makes goes on its trace row (`slots.spend`), the Create card's draft
 * call goes on a spend row of its own, and the monthly read counts them all
 * while the daily cap still counts answer rows only. Off, the rows are as
 * before. Harness from keeps-own-place-e2e.test.ts; names are invented.
 */

const store: FakeStore & { chat_traces: Record<string, unknown>[] } = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
  chat_traces: [],
};

const state = vi.hoisted(() => ({
  slotReading: "none" as "none" | "ca" | "copy",
  remapObservation: null as string | null,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return {
    ...actual,
    assertLiveMode: () => {},
    assertNoConfigurationProblems: () => {},
    assertWithinRateLimit: () => {},
  };
});

vi.mock("@/lib/config/server-env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/server-env")>();
  return { ...actual, liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }) };
});

vi.mock("@/lib/auth/server", async () => {
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "district_manager" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: "district_manager",
          scope: (state as { scope?: unknown }).scope ?? { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));

const ANSWER = "A grounded answer from the policy manual.";

const toolInput = vi.hoisted(() => ({ fn: null as null | ((input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => unknown) }));
toolInput.fn = async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "extract_form_fields") {
      const text = JSON.stringify(input.messages ?? []);
      return {
        templateKey: /\b(?:ca|corrective action)\b/i.test(text) ? "dpoa" : null,
        employeeName: /rory vance/i.test(text) ? "Rory Vance" : null,
        observation: state.remapObservation,
        actionPlan: null,
      };
    }
    if (input.tool?.name !== "record_intent_slots") return null;
    if (state.slotReading === "copy") {
      const text = JSON.stringify(input.messages ?? []);
      const manager = (text.split("Manager:").pop() ?? text).replace(/\\n/g, "\n");
      const dates = manager.match(/\b\d{1,2}-\d{1,2}\b/g) ?? [];
      return {
        employee: /rory vance/i.test(manager) ? "Rory Vance" : null,
        salon: /kearney/i.test(manager) ? "Kearney" : null,
        title: null,
        incidentType: /\blate\b/i.test(manager) ? "late" : null,
        incidentDate: dates[0] ?? null,
        payrollAmount: null,
        warningLevel: null,
        formType: "Corrective Action Form",
        formTurn: true,
        policyHeading: null,
      };
    }
    return {
      employee: null,
      salon: null,
      title: null,
      incidentType: null,
      incidentDate: null,
      payrollAmount: null,
      warningLevel: null,
      formType: state.slotReading === "ca" ? "Corrective Action Form" : null,
      formTurn: state.slotReading === "ca",
      policyHeading: null,
    };
  };

/*
 * The Anthropic client the app gets: a fake that answers like the other chat
 * tests, wrapped exactly as `anthropic.ts` wraps the real one.
 */
const usageOf = (model: string) => (model.includes("opus") ? { input_tokens: 2000, output_tokens: 300 } : { input_tokens: 400, output_tokens: 40 });
vi.mock("@/lib/ai/anthropic", async () => {
  const { meteredClient } = await import("@/lib/ai/spend-meter");
  const fake = {
    messages: {
      create: async (request: { model: string; stream?: boolean; tool_choice?: { name?: string }; tools?: { name?: string }[]; messages?: { content?: unknown }[] }) => {
        state.calls.push(request.tool_choice?.name ?? (request.stream ? "answer" : "message"));
        if (request.stream) {
          return (async function* () {
            yield { type: "message_start", message: { model: request.model, usage: { input_tokens: 2000, output_tokens: 1 } } };
            yield { type: "content_block_delta", delta: { type: "text_delta", text: ANSWER } };
            yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } };
          })();
        }
        const name = request.tool_choice?.name ?? request.tools?.[0]?.name;
        const input =
          name === "write_form_fields" ? state.draft : name === "revise_form_fields" ? state.revision : toolInput.fn!({ tool: { name }, messages: request.messages });
        return { model: request.model, stop_reason: "tool_use", content: [{ type: "tool_use", name, input }], usage: usageOf(request.model) };
      },
    },
  };
  return { getAnthropicClient: () => meteredClient(fake), __setAnthropicClient: () => {} };
});

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
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

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

// No embedding service offline: the manual search finds nothing, as in the other chat tests.
vi.mock("@/lib/knowledge/recall-match", () => ({ matchRecallKnowledge: async () => [] }));
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
    readDirectoryFacts: async () => [],
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

/** The chat route only accepts a UUID for the open form; the fake numbers rows `fake-N`. */
function toUuid(id: string): string {
  if (/^[0-9a-f-]{36}$/.test(id)) return id;
  const uuid = randomUUID();
  for (const table of ["form_instances", "form_instance_values", "form_instance_events"] as const) {
    for (const row of store[table]) {
      if (row.id === id) row.id = uuid;
      if (row.instance_id === id) row.instance_id = uuid;
    }
  }
  return uuid;
}

const TODAY = "2026-10-26";

/**
 * Ask Sunny's production env, exactly (Vercel production, read 26 Oct 2026
 * 09:44Z, with the coordinator's correction; PROD-FLAGS-2026-10-26-0944Z).
 * Every other flag is off — FORM_FULL_REMAP and REMAP_INCIDENT_FIX among them.
 */
const PRODUCTION = [
  "APP_PASSWORD_HELP_ENABLED",
  "DRAFT_NEVER_BLANK_ENABLED",
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "EXIT_INTAKE_FIX_ENABLED",
  "FOLLOW_UP_NOT_PRIOR_ENABLED",
  "LATE_OPEN_PAYROLL_FROM_FORM_ENABLED",
  "MANUAL_NEGATED_LIST_NOTE_ENABLED",
  "NAME_BEFORE_TITLE_ENABLED",
  "POLICY_SPECIFIC_TOPICS_ENABLED",
  "REOPEN_VERB_GUARD_ENABLED",
  "SENSITIVE_DEFAULTS_REDACT_ENABLED",
  "STATE_CODE_NOT_A_PERSON_ENABLED",
  "ACTION_PLAN_MANAGER_ONLY_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "CHAT_STYLE_RULES_ENABLED",
  "CHAT_TRACE_ENABLED",
  "CROSS_CHAT_REPLY_GUARD_ENABLED",
  "CURRENT_MANUAL_SCOPE_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "HYBRID_SEARCH_ENABLED",
  "INTENT_EXTRACTION_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "PLACE_SPAN_GUARD_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "PRIOR_COACHING_OPTIONAL_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "RETRIEVAL_RECALL_ENABLED",
  "SELF_CHECK_ENABLED",
  "SEND_AFTER_HYDRATE_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "SECOND_FORM_ENABLED",
  "STORED_SLOTS_NOT_A_REQUEST_ENABLED",
] as const;
/** Not production here: the full remap and the flags QA-6 ran it with, as extra coverage. */
const REMAP_EXTRA = ["FORM_FULL_REMAP_ENABLED", "REMAP_INCIDENT_FIX_ENABLED"] as const;
const FLAG = "PRIOR_SENTENCE_FIX_ENABLED";
/** FORM_DATE_INCIDENT_ONLY_ENABLED (D3, =0 in production) is pinned by each case, never read from the shell. */
const FIO = "FORM_DATE_INCIDENT_ONLY_ENABLED";
const ALL_FLAGS = [...PRODUCTION, ...REMAP_EXTRA, FLAG, FIO, "CODE_SLOTS_ENABLED", "POLICY_CITATION_ENABLED", "FORM_STATE_ENABLED", "REMAP_DRAFT_SOURCES_ENABLED", "NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED", "INTENT_PAYROLL_MANAGER_ONLY_ENABLED", "CHAT_DATA_TOOLS_ENABLED", "CHAT_MEMORY_ENABLED"];

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formSelection?: unknown;
  formOpened?: { instanceId: string };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card the answer carried stays open. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;
  private readonly conversationId = `conv-${randomUUID()}`;

  async say(question: string): Promise<Answer> {
    const history = this.messages.map(({ id, role, content }) => ({ id, role, content }));
    const id = `m${(this.sequence += 1)}`;
    const response = await chatRoute.POST(
      new Request("https://app.test/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          mode: "standard",
          history,
          questionMessageId: id,
          conversationId: this.conversationId,
          ...(this.proposal && !this.instanceId ? { continueProposalTemplateKey: this.proposal.templateKey } : {}),
          ...(this.instanceId ? { activeFormInstanceId: this.instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T12:28:00Z` } as ChatMessage,
      {
        id: `a${this.sequence}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T12:28:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) this.proposal = payload.formProposal;
    return payload;
  }

  /** The card's Create, as the browser does it. */
  async create(): Promise<string> {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({ proposal: this.proposal!, messages: this.messages, call, onCreated: () => {} });
    this.instanceId = toUuid(result.reference.instanceId);
    return this.instanceId;
  }
}


const saved = new Map<string, string | undefined>();
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, { template_key: template?.key, template_name: template?.name, layout_family: template?.layout_family, template_version: version?.version });
  }
}
class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) {
    const count = super.push(...rows);
    joinOverview();
    return count;
  }
}
beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof typeof store)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.slotReading = "none";
  state.remapObservation = null;
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.directory = [
    { id: "e-1", firstName: "Rory", lastName: "Vance", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
  ];
  for (const name of ALL_FLAGS) saved.set(name, process.env[name]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:30:00Z`));
  await ensureTemplateLibrary("system");
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});




const LIVE_SINCE = [
  "PRIOR_SENTENCE_FIX_ENABLED",
  "DATE_ANSWER_APPLIED_ENABLED",
  "PAYROLL_TYPO_NOT_A_NAME_ENABLED",
  "REQUEST_LINE_ACCOUNT_ENABLED",
  "ATTENDANCE_ACTION_PLAN_ENABLED",
  "HIDE_NO_POLICY_MATCH_NOTICE_ENABLED",
  "ANSWER_NOT_A_NAME_ENABLED",
  "POLICY_SPECIFIC_TOPICS_ENABLED",
] as const;

const SPEND = "SPEND_GUARD_ALL_CALLS_ENABLED";
const { spendUsageRows } = await import("@/lib/ai/spend-guard-store");
const { usageCostUsd } = await import("@/lib/ai/model-prices");
type TraceRow = { conversation_id: string | null; user_id: string | null; model: string | null; intent: string | null; input_tokens: number | null; slots: Record<string, unknown> };
const traces = () => store.chat_traces as unknown as TraceRow[];

async function flushWrites() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function createdCard(on: boolean) {
  for (const name of [...ALL_FLAGS, ...LIVE_SINCE, SPEND, "CHAT_TRACE_ENABLED"]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE_SINCE, "CHAT_TRACE_ENABLED"]) process.env[name] = "true";
  if (on) process.env[SPEND] = "true";
  state.calls = [];
  state.slotReading = "copy";
  state.directory = [
    { id: "e-1", firstName: "Rory", lastName: "Vance", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
  ];
  const thread = new Thread();
  await thread.say("What is the attendance policy?");
  await flushWrites();
  await thread.say("create a ca for rory vance at kearney. she was late on 10-20");
  await flushWrites();
  await thread.create();
  await flushWrites();
  return { thread };
}

/** What the monthly budget reads (`spend-guard-store.ts`), row by row, flag on. */
function monthlyUsage(rows: readonly TraceRow[]) {
  return rows.flatMap((row) => {
    const spend = spendUsageRows(row.slots?.spend);
    if (spend && spend.length > 0) return spend;
    return row.model ? [{ model: row.model, inputTokens: row.input_tokens, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }] : [];
  });
}

describe("SPEND_GUARD_ALL_CALLS_ENABLED", () => {
  it("on: each chat turn's row carries every call it made; the Create card's draft is a spend row of its own", async () => {
    await createdCard(true);
    expect(state.calls).toContain("answer");
    expect(state.calls).toContain("write_form_fields");
    const chatRows = traces().filter((row) => row.intent !== "spend");
    expect(chatRows).toHaveLength(2);
    // The answering turn: its row is metered and lists the helpers and the answer.
    const answered = chatRows.find((row) => row.model !== null)!;
    expect(answered.slots.metered).toBe(true);
    expect(spendUsageRows(answered.slots.spend)!.map((call) => call.model)).toEqual([
      "claude-haiku-4-5",
      "claude-haiku-4-5",
      "claude-haiku-4-5",
      "claude-opus-5",
    ]);
    // A call after the turn's row was written (the self-check's repair) is a spend row of the chat.
    const spendRows = traces().filter((row) => row.intent === "spend");
    expect(spendRows.map((row) => row.slots.spend_source)).toEqual(["chat", "forms_draft"]);
    // Create: no conversation, no model, the manager's id, and every draft attempt (DRAFT_NEVER_BLANK retries).
    const draft = spendRows[1]!;
    expect(draft).toMatchObject({ conversation_id: null, model: null, user_id: "qa-manager" });
    expect(state.calls.filter((call) => call === "write_form_fields")).toHaveLength(3);
    expect(spendUsageRows(draft.slots.spend)).toEqual(
      Array.from({ length: 3 }, () => ({ model: "claude-opus-5", inputTokens: 2000, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 })),
    );
    // Every call the fake client answered is on exactly one row.
    const counted = traces().flatMap((row) => spendUsageRows(row.slots?.spend) ?? []);
    expect(counted).toHaveLength(state.calls.length);
    // The daily cap still counts answer rows only: no spend row has a model.
    expect(spendRows.every((row) => row.model === null)).toBe(true);
    // No spend row joins a conversation, so no turn's slots are read from one (`form-remap-scope.ts`).
    expect(spendRows.every((row) => row.conversation_id === null)).toBe(true);
  });

  it("on: the month's cost includes the draft and the helpers, more than the answer rows alone", async () => {
    await createdCard(true);
    const all = monthlyUsage(traces()).reduce((sum, row) => sum + usageCostUsd(row), 0);
    const answersOnly = traces()
      .filter((row) => row.model !== null)
      .reduce((sum, row) => sum + usageCostUsd({ model: row.model, inputTokens: row.input_tokens, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null }), 0);
    expect(all).toBeGreaterThan(answersOnly);
  });

  it("off: no spend on any row and no spend row (as main)", async () => {
    await createdCard(false);
    expect(state.calls).toContain("write_form_fields");
    expect(traces().length).toBeGreaterThan(0);
    expect(traces().some((row) => row.intent === "spend")).toBe(false);
    expect(traces().some((row) => "spend" in (row.slots ?? {}) || "metered" in (row.slots ?? {}))).toBe(false);
  });
});

