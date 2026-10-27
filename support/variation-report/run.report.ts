import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE VARIATION REPORT — HOW MUCH THE WORDING MOVES THE RESULT (MEASURING ONLY)
 * ============================================================================
 *
 * Pau, 27 Oct 2026: "try it and see how big of a change it will be". Real
 * manager chats (names invented) are replayed through the same server path
 * the e2e tests use — POST /api/chat, `createInlineForm`, the draft route —
 * with this app's production flags, the full production manual and the model
 * stubbed out (the extraction model names nobody; the drafting model writes
 * nothing, so the manager's-words fallback is what lands). Each seed is
 * rewritten automatically (case, punctuation, typos, date formats, name
 * forms, spacing) and every variant is scored against the seed's expected
 * form. It PRINTS pass rates; it asserts nothing, so it never turns CI red,
 * and it is not part of `npm test` (its own config, outside `src/`).
 *
 *   npm run variation-report
 *
 * AI_READS_CODE_CHECKS_ENABLED adds a third mode, "+ AI reader", run only when
 * VARIATION_READER is set. Its model replies are recorded once and replayed
 * after (`src/lib/ai/reader/replay.ts`, `recordings/<app>/`):
 *
 *   VARIATION_READER=replay npm run variation-report    offline; a missing reply = flag off
 *   VARIATION_READER=record npm run variation-report    calls the model (ANTHROPIC_API_KEY)
 *   VARIATION_LIMIT=20 …                                a smoke run: 20 variants spread over the seeds
 *   VARIATION_KINDS=name:20,typo:17 …                   that many variants of each kind, spread over the seeds
 *   VARIATION_READER_TIMEOUT_MS=5000 …                 the reader's limit in this run (default: the app's 2 s)
 *   VARIATION_READER_MODEL=<id> …                       record the reader with another model
 *   VARIATION_RECORDINGS_DIR=<dir> …                    read and write recordings in a folder of its own
 *   VARIATION_EXTRA_FLAGS=A_ENABLED,B_ENABLED …         more flags on in the "this week's fixes" modes (the list in this file is older than the app)
 *   VARIATION_FLAG_INSTEAD_OF_AI=A_ENABLED …            the last mode runs this flag, with no AI reader, for a no-model change
 *   VARIATION_BUDGET_USD=3 …                            record mode stops calling the model once live calls cost this much
 *
 * With VARIATION_READER set, this app's live slot call (`record_intent_slots`,
 * INTENT_EXTRACTION_ENABLED) is recorded and replayed too, in a mode of its
 * own: the stubbed modes measure the code's readers alone, and production
 * runs them beside the real slot call (QA, 27 Oct 2026). The gate compares
 * "+ AI reader" against that recorded baseline.
 */

/** Invented people only; the repository is public. */
const ROSTER = [
  { id: "e-1", firstName: "Quinn", lastName: "Marlowe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
  { id: "e-2", firstName: "Dale", lastName: "Ferris", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
  { id: "e-3", firstName: "Mara", lastName: "Quill", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
  { id: "e-4", firstName: "Ivy", lastName: "Hollis", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0462"] },
];

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

const state = vi.hoisted(() => ({
  slotReading: "none" as "none" | "ca" | "copy",
  remapObservation: null as string | null,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  chatModelCalls: 0,
  directory: [] as unknown[],
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
          scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
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

const reader = vi.hoisted(() => ({
  call: null as null | ((input: never) => Promise<unknown>),
  /** The recorded live slot call, in the modes that run it. */
  slots: null as null | ((input: never) => Promise<{ input: unknown }>),
  /** Each merge this variant made: what the checked reading filled, and where it disagreed. */
  merges: [] as { filled: readonly string[]; disputed: readonly string[] }[],
}));

vi.mock("@/lib/ai/reader/merge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/reader/merge")>();
  return {
    ...actual,
    mergeCheckedReading: (checked: Parameters<typeof actual.mergeCheckedReading>[0]) => {
      const merge = actual.mergeCheckedReading(checked);
      if (checked) reader.merges.push(merge);
      return merge;
    },
  };
});

vi.mock("@/lib/ai/call-claude", () => ({
  // AI_READS_CODE_CHECKS_ENABLED: the recorded (or recording) model; none outside the AI mode.
  callClaudeToolTimed: async (input: never) => {
    if (!reader.call) throw new Error("no reader model in this mode");
    return reader.call(input);
  },
  callClaude: async () => {
    state.chatModelCalls += 1;
    return ANSWER;
  },
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "extract_form_fields") {
      const text = JSON.stringify(input.messages ?? []);
      return {
        templateKey: /\b(?:ca|corrective action)\b/i.test(text) ? "dpoa" : null,
        // The report measures the code's own reading: the extraction model names nobody.
        employeeName: null,
        observation: state.remapObservation,
        actionPlan: null,
      };
    }
    if (input.tool?.name !== "record_intent_slots") return null;
    if (reader.slots) {
      // As in production, a failed slot call is no reading (`intent-extraction.ts`).
      try {
        return (await reader.slots({ ...input, timeoutMs: 30_000 } as never)).input;
      } catch {
        return null;
      }
    }
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
  },
}));

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        const revising = request.tool_choice?.name === "revise_form_fields";
        if (revising) state.revisionCalls += 1;
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: revising ? "revise_form_fields" : "write_form_fields",
              input: revising ? state.revision : state.draft,
            },
          ],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { manualChunkFromRow } = await import("@/lib/ai/full-manual-load");
  const rows = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
  return {
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
    async fetchNamedHandbook() {
      return { ok: false, reason: "not used" };
    }
    async fetchOfficialPolicyManual() {
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
        documentCategory: "policies_compliance",
        matchedBy: "tag",
        chunks: (rows.chunks as Parameters<typeof manualChunkFromRow>[0][]).map(manualChunkFromRow),
      };
    }
  },
};
});

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
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
const chatRoute = await import("@/app/api/chat/route");
const instancesRoute = await import("@/app/api/forms/instances/route");
const draftRoute = await import("@/app/api/forms/instances/[id]/draft/route");

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
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.slotReading = "none";
  state.remapObservation = null;
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.directory = [
    ...ROSTER,
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



/* ======================================================================= *
 * THE REPORT
 * ======================================================================= */

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { budgetExceeded, replayTransport } from "@/lib/ai/reader/replay";

import { SEEDS, type Seed } from "./seeds";
import { variantsOf, type Variant } from "./variants";

/** Live in this app's production since 26 Oct 2026 (QA), beyond the harness's base list. */
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
/** The fixes merged this week, default off in production. */
const NEW_FIXES = [
  "NOT_DEDUCTIBLE_READ_ENABLED",
  "PRIOR_STEP_SENTENCE_ENABLED",
  "EXIT_FULFILLED_IS_LAST_DAY_ENABLED",
  "FUTURE_PRIOR_ROW_DROP_ENABLED",
  "NAME_QUESTION_ONLY_ENABLED",
  "MEETING_NOT_LATENESS_PLAN_ENABLED",
  "PLAN_PAYROLL_SENTENCE_ENABLED",
  "JOB_TITLE_NOT_INCIDENT_ENABLED",
  "ANIMAL_ANYWHERE_ENABLED",
] as const;
// VARIATION_EXTRA_FLAGS=A_ENABLED,B_ENABLED: flags shipped since the list above, on in every "this week's fixes" mode.
const EXTRA = (process.env.VARIATION_EXTRA_FLAGS ?? "").split(",").map((name) => name.trim()).filter(Boolean);
// VARIATION_FLAG_INSTEAD_OF_AI=LAST_FIRST_NAME_READ_ENABLED: the last mode runs that flag with the real slot call
// and NO AI reader (its row is still labelled "+ AI reader"), to measure a no-model change against the same baseline.
const INSTEAD = process.env.VARIATION_FLAG_INSTEAD_OF_AI?.trim() || null;
const AI = INSTEAD ?? "AI_READS_CODE_CHECKS_ENABLED";
const READER_MODE = process.env.VARIATION_READER === "record" ? "record" : process.env.VARIATION_READER === "replay" ? "replay" : null;
const TODAYS = "production + this week's fixes";
const TODAY_REAL = "production + this week's fixes, real slot call";
const WITH_AI = "production + this week's fixes, real slot call + AI reader";
const MODES: readonly { name: string; flags: readonly string[]; slots?: boolean; reader?: boolean }[] = [
  { name: "production", flags: [] },
  { name: TODAYS, flags: [...NEW_FIXES, ...EXTRA] },
  ...(READER_MODE
    ? [
        { name: TODAY_REAL, flags: [...NEW_FIXES, ...EXTRA], slots: true },
        { name: WITH_AI, flags: [...NEW_FIXES, ...EXTRA, AI], slots: true, reader: !INSTEAD },
      ]
    : []),
];
// VARIATION_RECORDINGS_DIR: a folder of its own (a scratch experiment); unset, the committed recordings.
const recordings = (part: string) =>
  process.env.VARIATION_RECORDINGS_DIR
    ? `${process.env.VARIATION_RECORDINGS_DIR.replace(/\/$/, "")}/${part}/`
    : fileURLToPath(new URL(`./recordings/${process.env.VARIATION_APP ?? "app"}/${part}/`, import.meta.url));
// VARIATION_READER_TIMEOUT_MS: the reader's limit in this run instead of the app's 2 s; VARIATION_READER_MODEL: record the reader with another model.
const readerLimit = Number(process.env.VARIATION_READER_TIMEOUT_MS ?? "");
const transport = READER_MODE
  ? replayTransport(recordings("reader"), READER_MODE, {
      ...(Number.isFinite(readerLimit) && readerLimit > 0 ? { limitMs: readerLimit } : {}),
      ...(process.env.VARIATION_READER_MODEL ? { model: process.env.VARIATION_READER_MODEL } : {}),
    })
  : null;
const slotTransport = READER_MODE ? replayTransport(recordings("slots"), READER_MODE) : null;

/**
 * VARIATION_KINDS=name:20,typo:17: that many variants of each listed kind, spread
 * evenly over the seeds, the same ones each run. Kinds not listed are left out.
 */
function ofKinds<T extends { variant: Variant }>(all: readonly T[]): readonly T[] {
  const wanted = (process.env.VARIATION_KINDS ?? "").split(",").map((part) => part.trim().split(":")).filter((part) => part[0]);
  if (wanted.length === 0) return all;
  return wanted.flatMap(([kind, count]) => {
    const these = all.filter((one) => one.variant.kind === kind);
    const n = Number(count);
    return Number.isInteger(n) && n > 0 && n < these.length ? Array.from({ length: n }, (_unused, index) => these[Math.floor((index * these.length) / n)]!) : these;
  });
}

/** VARIATION_LIMIT=N: N variants, spread evenly over every seed's list, the same N each run. */
function limited<T>(all: readonly T[]): readonly T[] {
  const limit = Number(process.env.VARIATION_LIMIT ?? "");
  if (!Number.isInteger(limit) || limit <= 0 || limit >= all.length) return all;
  return Array.from({ length: limit }, (_unused, index) => all[Math.floor((index * all.length) / limit)]!);
}

/** Haiku 4.5 list price per million tokens. */
const PRICE = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };

function setFlags(extra: readonly string[]) {
  for (const name of [...ALL_FLAGS, ...LIVE_SINCE, ...NEW_FIXES, AI, "ACTION_PLAN_MANAGER_ONLY_ENABLED"]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE_SINCE, ...extra]) process.env[name] = "true";
  // QA: manager-only plans are off in production since 26 Oct 2026.
  delete process.env.ACTION_PLAN_MANAGER_ONLY_ENABLED;
}

async function reset() {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.slotReading = "none";
  state.remapObservation = null;
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.directory = [...ROSTER];
  await ensureTemplateLibrary("system");
}

interface Field {
  readonly value: string;
  readonly checked: readonly string[];
}
interface Outcome {
  readonly replies: string[];
  readonly fields: Record<string, Field>;
  readonly error: string | null;
}

async function replay(turns: readonly string[], chatOnly: boolean, openingQuestion = false): Promise<Outcome> {
  const thread = new Thread();
  const replies: string[] = [];
  if (openingQuestion) {
    // A plain question first: this harness answers questions by a policy search it does not stub, so it is history.
    thread.messages.push(
      { id: "m0", role: "user", content: turns[0]!, createdAt: `${TODAY}T12:27:00Z` } as ChatMessage,
      { id: "a0", role: "assistant", content: ANSWER, createdAt: `${TODAY}T12:27:01Z` } as ChatMessage,
    );
    replies.push(ANSWER);
  }
  for (const turn of openingQuestion ? turns.slice(1) : turns) {
    try {
      replies.push((await thread.say(turn)).content);
    } catch (error) {
      return { replies, fields: {}, error: `turn "${turn.slice(0, 40)}": ${String((error as Error).message).slice(0, 120)}` };
    }
  }
  if (chatOnly) return { replies, fields: {}, error: null };
  if (!thread.proposal) return { replies, fields: {}, error: "no form card" };
  try {
    state.draft = { values: {} };
    const id = await thread.create();
    const fields: Record<string, Field> = {};
    for (const row of store.form_instance_values.filter((entry) => entry.instance_id === id)) {
      fields[String(row.field_key)] = {
        value: String(row.value ?? ""),
        checked: Array.isArray(row.checked) ? (row.checked as string[]) : [],
      };
    }
    return { replies, fields, error: null };
  } catch (error) {
    return { replies, fields: {}, error: `create: ${String((error as Error).message).slice(0, 160)}` };
  }
}

const LIST = /I'll need a few details first|please provide me with these details/i;
const PAYROLL_OPEN = /Is payroll deduct applicable\?(?!\s*\*\*(?:Yes|No)\*\*)/;

/** Each check the seed names: [check, passed, what was read]. */
function score(seed: Seed, out: Outcome): [string, boolean, string][] {
  const e = seed.expect;
  const f = (key: string) => out.fields[key] ?? { value: "", checked: [] };
  const results: [string, boolean, string][] = [];
  const check = (name: string, ok: boolean, read: string) => results.push([name, ok, read]);
  const yesNo = (field: Field) => (field.checked.join(",") || field.value).toLowerCase();
  if (out.error && !seed.chatOnly) {
    check("form created", false, out.error);
    return results;
  }
  // Counted on success too, so the row reads as a rate.
  if (!seed.chatOnly) check("form created", true, "");
  if (e.employee) check("employee", f("employee_name").value.toLowerCase() === e.employee.toLowerCase(), f("employee_name").value);
  if (e.date) check("date", f("form_date").value === e.date, f("form_date").value);
  if (e.prior) {
    const rows = f("prior_actions").value.split("\n").filter((line) => line.trim() !== "");
    const all = e.prior.every((date) => rows.some((row) => row.includes(date)));
    check("prior", all && (!e.priorExact || rows.length === e.prior.length), rows.join(" | ") || "(none)");
  }
  if (e.payroll) check("payroll", yesNo(f("payroll_deduct")).includes(e.payroll), yesNo(f("payroll_deduct")) || "(blank)");
  if (e.amountInPlan) check("amount in plan", f("action_plan").value.includes(e.amountInPlan), f("action_plan").value.slice(0, 90));
  if (e.warning) check("warning", yesNo(f("warning_type")).includes(e.warning), yesNo(f("warning_type")) || "(blank)");
  if (e.policy) {
    const both = `${f("policy_violated").value} / ${f("policy_language").value.slice(0, 40)}`;
    check("policy", e.policy.test(both), both);
  }
  if (e.planNot) check("plan fits", !e.planNot.test(f("action_plan").value), f("action_plan").value.slice(0, 90));
  if (e.observedNot) check("observation", !e.observedNot.test(f("observation").value.trim()), f("observation").value.slice(0, 60));
  if (e.jobTitle) check("job title", e.jobTitle.test(f("job_title").value), f("job_title").value || "(blank)");
  if (e.location) check("location", e.location.test(f("location").value), f("location").value || "(blank)");
  if (e.noticeGiven) check("notice given", f("notice_given_date").value === e.noticeGiven, f("notice_given_date").value || "(blank)");
  if (e.noticeFulfilled) check("notice fulfilled", f("notice_fulfilled_date").value === e.noticeFulfilled, f("notice_fulfilled_date").value || "(blank)");
  if (e.lastDay) check("last day", f("last_day_worked").value === e.lastDay, f("last_day_worked").value || "(blank)");
  if (e.rehire) check("rehire", yesNo(f("eligible_for_rehire")).includes(e.rehire), yesNo(f("eligible_for_rehire")) || "(blank)");
  if (e.oneQuestion) {
    const listed = out.replies.some((reply) => LIST.test(reply));
    const twice = out.replies.some((reply, i) => i > 0 && reply === out.replies[i - 1] && /\?/.test(reply));
    check("one question", !listed && !twice && !out.error, out.error ?? (listed ? "asked a list" : twice ? "asked the same twice" : "ok"));
  }
  if (e.payrollAskedOnce) {
    const asked = out.replies.slice(1).filter((reply) => PAYROLL_OPEN.test(reply)).length;
    check("payroll asked again", asked === 0, `${asked} repeat(s)`);
  }
  return results;
}

interface Row {
  readonly mode: string;
  readonly seed: string;
  readonly variant: Variant;
  readonly checks: [string, boolean, string][];
  /** AI_READS_CODE_CHECKS_ENABLED: fields the checked reading filled, and fields it disputed (today's value kept). */
  readonly filled?: readonly string[];
  readonly disputed?: readonly string[];
}

const pct = (pass: number, total: number) => (total === 0 ? "—" : `${Math.round((100 * pass) / total)}% (${pass}/${total})`);

function table(title: string, rows: Row[], key: (row: Row) => string): string {
  const groups = new Map<string, { pass: number; total: number; checksPass: number; checksTotal: number }>();
  for (const row of rows) {
    const g = groups.get(key(row)) ?? { pass: 0, total: 0, checksPass: 0, checksTotal: 0 };
    g.total += 1;
    if (row.checks.every(([, ok]) => ok)) g.pass += 1;
    g.checksTotal += row.checks.length;
    g.checksPass += row.checks.filter(([, ok]) => ok).length;
    groups.set(key(row), g);
  }
  const lines = [`| ${title} | variants fully right | checks right |`, "|---|---|---|"];
  for (const [name, g] of groups) lines.push(`| ${name} | ${pct(g.pass, g.total)} | ${pct(g.checksPass, g.checksTotal)} |`);
  return lines.join("\n");
}

function byCheck(rows: Row[]): string {
  const groups = new Map<string, { pass: number; total: number }>();
  for (const row of rows) for (const [name, ok] of row.checks) {
    const g = groups.get(name) ?? { pass: 0, total: 0 };
    g.total += 1;
    if (ok) g.pass += 1;
    groups.set(name, g);
  }
  const lines = ["| field | right |", "|---|---|"];
  for (const [name, g] of groups) lines.push(`| ${name} | ${pct(g.pass, g.total)} |`);
  return lines.join("\n");
}

it("variation report", async () => {
  const rows: Row[] = [];
  const cases = limited(ofKinds(SEEDS.flatMap((seed) => variantsOf(seed).map((variant) => ({ seed, variant })))));
  for (const mode of MODES) {
    reader.call = mode.reader && transport ? (transport.call as never) : null;
    reader.slots = mode.slots && slotTransport ? (slotTransport.call as never) : null;
    for (const { seed, variant } of cases) {
      setFlags([...mode.flags, ...(mode.flags.length > 0 ? (seed.flags ?? []) : [])]);
      await reset();
      reader.merges = [];
      const out = await replay(variant.turns, seed.chatOnly === true, seed.openingQuestion === true);
      rows.push({
        mode: mode.name,
        seed: seed.id,
        variant,
        checks: score(seed, out),
        filled: [...new Set(reader.merges.flatMap((merge) => merge.filled))],
        disputed: [...new Set(reader.merges.flatMap((merge) => merge.disputed))],
      });
    }
  }
  const sections: string[] = [`# Variation report — ${process.env.VARIATION_APP ?? "this app"}`, ""];
  for (const mode of MODES) {
    const mine = rows.filter((row) => row.mode === mode.name);
    const all = mine.length;
    const right = mine.filter((row) => row.checks.every(([, ok]) => ok)).length;
    sections.push(`## ${mode.name}: ${pct(right, all)} of variants fully right`, "");
    sections.push(table("seed", mine, (row) => row.seed), "");
    sections.push(table("variation", mine, (row) => row.variant.kind), "");
    sections.push(byCheck(mine), "");
    sections.push("### Failing variants", "");
    for (const row of mine.filter((entry) => entry.checks.some(([, ok]) => !ok))) {
      const wrong = row.checks.filter(([, ok]) => !ok).map(([name, , read]) => `${name}: ${read}`).join("; ");
      sections.push(`- **${row.seed} · ${row.variant.label}** — ${wrong}  \n  \`${row.variant.turns.join(" / ").slice(0, 220)}\``);
    }
    sections.push("");
  }
  if (transport && slotTransport) {
    const cost = (stats: typeof transport.stats) =>
      (stats.inputTokens * PRICE.input + stats.outputTokens * PRICE.output + stats.cacheReadTokens * PRICE.cacheRead + stats.cacheWriteTokens * PRICE.cacheWrite) /
      1_000_000;
    const chats = rows.filter((row) => row.mode === WITH_AI).length;
    sections.push(`## The recorded model calls (${READER_MODE})`, "", "| call | calls | recorded now | no recording (ran as flag off) | slower than its limit | tokens in / out | Haiku 4.5 list price | per chat | still to record (≈ tokens in) |", "|---|---|---|---|---|---|---|---|---|");
    for (const [name, stats] of [["slot call (today, live)", slotTransport.stats], ["AI reader (new)", transport.stats]] as const) {
      sections.push(
        `| ${name} | ${stats.calls} | ${stats.recorded} | ${stats.missing} | ${stats.slow} | ${stats.inputTokens} / ${stats.outputTokens} | $${cost(stats).toFixed(3)} | $${chats ? (cost(stats) / chats).toFixed(4) : "—"} | ${stats.missing} calls (≈ ${Math.round(stats.missingChars / 4)}) |`,
      );
    }
    sections.push("");
    const seconds = (values: readonly number[], at: number) => (values.length === 0 ? "—" : `${(([...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * at))] ?? 0) / 1000).toFixed(1)} s`);
    sections.push("| call | latencies | median | p90 | under 2 s |", "|---|---|---|---|---|");
    for (const [name, stats] of [["slot call (today, live)", slotTransport.stats], ["AI reader (new)", transport.stats]] as const) {
      sections.push(`| ${name} | ${stats.latencies.length} | ${seconds(stats.latencies, 0.5)} | ${seconds(stats.latencies, 0.9)} | ${stats.latencies.filter((ms) => ms <= 2000).length} |`);
    }
    sections.push("");
    // THE GATE: a variant fully right with today's live path and not with the reader is a loss, whatever else it gains.
    const right = (row: Row | undefined) => Boolean(row?.checks.every(([, ok]) => ok));
    const key = (row: Row) => `${row.seed}|${row.variant.label}`;
    for (const baseline of [TODAY_REAL, TODAYS]) {
      const before = new Map(rows.filter((row) => row.mode === baseline).map((row) => [key(row), row]));
      const lost = rows.filter((row) => row.mode === WITH_AI && right(before.get(key(row))) && !right(row));
      sections.push(`## Lost with the AI reader against "${baseline}": ${lost.length}`, "");
      for (const row of lost) {
        const wrong = row.checks.filter(([, ok]) => !ok).map(([name, , read]) => `${name}: ${read}`).join("; ");
        sections.push(`- **${row.seed} · ${row.variant.label}** — ${wrong}`);
      }
      sections.push("");
    }
    // Disputes are kept as today's value; this is how often blank-and-ask would have fired.
    const mine = rows.filter((row) => row.mode === WITH_AI);
    const kinds = [...new Set(mine.map((row) => row.variant.kind))];
    sections.push("## What the AI reader changed, per variation", "", "| variation | variants | with a field filled | with a dispute (today's value kept) | disputed fields |", "|---|---|---|---|---|");
    for (const kind of kinds) {
      const these = mine.filter((row) => row.variant.kind === kind);
      const fields = new Map<string, number>();
      for (const row of these) for (const field of row.disputed ?? []) fields.set(field, (fields.get(field) ?? 0) + 1);
      sections.push(
        `| ${kind} | ${these.length} | ${these.filter((row) => (row.filled ?? []).length > 0).length} | ${these.filter((row) => (row.disputed ?? []).length > 0).length} | ${[...fields].map(([field, count]) => `${field} ${count}`).join(", ") || "—"} |`,
      );
    }
    sections.push("");
  }
  const report = sections.join("\n");
  mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`./out/report-${process.env.VARIATION_APP ?? "app"}.md`, import.meta.url), report);
  process.stdout.write(`\n${report}\n`);
  if (budgetExceeded.value) throw new Error("VARIATION_BUDGET_USD reached: the recording is incomplete; calls after the budget ran as flag off.");
}, 3_600_000);
