import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * AI TIME LIMITS: DRAFTING AND CHAT REVISION (QA, 14 Nov 2026)
 * ============================================================================
 *
 * Both calls ran on the SDK's 10-minute default: a stalled model held the route
 * until the platform killed it at maxDuration (120 s), and the manager got the
 * platform's error, not a reply. Now each ends at the helper limit
 * (AI_HELPER_TIMEOUT_MS, 1 s here) with a short message to show, a server log
 * line (route, call, duration; no form text), and never an empty reply.
 *
 * Driven through the real create and draft routes and the real
 * `reviseActiveForm`, with the harness of `chat-revision-single-writer.test.ts`
 * (its Salon Director, its knowledge provider, its invented Marnie Quill). Only
 * the model stalls.
 */

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
  /* Sunny's harness's manager: a Salon Director for one salon. */
  role: "salon_director",
  scope: { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] } as unknown,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revise: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: unknown },
  reviseCalls: 0,
  directory: [] as unknown[],
  stall: null as string | null,
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

vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  const { DEFAULT_PERMISSION_MATRIX, hasPermission } = await import("@/lib/permissions");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "manager-1",
          email: "manager@example.com",
          displayName: "Manager",
          role: state.role,
          scope: state.scope,
          verified: true,
        },
        permission,
        provider: "supabase",
      };
    },
  };
});

/*
 * The drafting model answers `state.draft` and the revision model `state.revise`, unless `state.stall` names the
 * call: then the request is accepted and nothing comes back. The call honours its abort signal, as the SDK does.
 */
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }, options?: { signal?: AbortSignal }) => {
        const tool = request.tool_choice?.name ?? "write_form_fields";
        if (tool === "revise_form_fields") state.reviseCalls += 1;
        if (state.stall === tool) {
          return new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("Request was aborted."))));
        }
        return {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", name: tool, input: tool === "revise_form_fields" ? state.revise : state.draft }],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      async search() {
        return [];
      }
      async fetchRoleGrounding() {
        const row = (index: number, locator: string, content: string) => ({
          chunk_id: `pmf-${index}`,
          document_id: "doc-progression",
          document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          category: "leadership_coaching",
          locator,
          page: null,
          section: null,
          content,
          similarity: 0,
        });
        return {
          ok: true,
          grounding: {
            role: { id: "performance_management_framework" },
            documentId: "doc-progression",
            documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
            matchedBy: "tag",
            rows: [
              row(0, "SECTION 2 – PERFORMANCE MANAGEMENT LADDER", "Solve the issue at the lowest appropriate level."),
              row(1, "10.7 Final operating rule for Ask Sunny", "Classify the issue before escalating."),
            ],
            presentGroups: ["escalation_ladder", "final_operating_rule"],
          },
        };
      }
      async fetchOfficialPolicyManual() {
        return {
          ok: true,
          documentId: JBA_MANUAL_DOCUMENT.id,
          documentTitle: JBA_MANUAL_DOCUMENT.title,
          matchedBy: "tag",
          chunks: JBA_MANUAL_CHUNKS,
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

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
    readStoreRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { reviseActiveForm } = await import("@/lib/forms/chat-revision");
const instancesRoute = await import("@/app/api/forms/instances/route");
const instanceRoute = await import("@/app/api/forms/instances/[id]/route");
const draftRoute = await import("@/app/api/forms/instances/[id]/draft/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-20",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await draftRoute.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await instancesRoute.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  joinOverview();
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { status: response.status });
  return body;
}

async function observation(id: string): Promise<string | null | undefined> {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { values: { fieldKey: string; value: string | null }[] };
  return body.values.find((row) => row.fieldKey === "observation")?.value;
}

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-22T15:00:00Z",
});
const answered = (content: string): ChatMessage =>
  ({ id: `a${(sequence += 1)}`, role: "assistant", content, createdAt: "2026-10-22T15:00:01Z" }) as ChatMessage;

const chat = () => new Request("https://app.test/api/chat", { method: "POST", headers: { cookie: "session=abc" } });

/* An invented person, on the roster (the sibling test's; on no directory fixture). */
const DIRECTORY = [
  { id: "e-1", firstName: "Marnie", lastName: "Quill", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"], positionName: null },
];

const OBSERVED = "Marnie Quill was late to open on 10-20-26.";
const REQUEST = "Create a corrective action for Marnie Quill. She was late to open on 10-20-26. Verbal warning. No payroll deduct.";

/** A Corrective Action Form created in chat whose Observation reads OBSERVED. */
async function createdForm() {
  const message = said(REQUEST);
  const response = await proposeFormForTurn({
    history: [],
    question: message.content,
    questionMessageId: message.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-10-22",
  });
  const proposal = response!.formProposal!;
  expect(proposal.templateKey).toBe("dpoa");
  expect(proposal.employeeName).toBe("Marnie Quill");
  if (!state.draft.values?.observation) {
    state.draft = { values: { observation: OBSERVED }, checked: { warning_type: ["verbal"], offense_type: ["tardiness"] } };
  }
  const { reference } = await createInlineForm({ proposal, messages: [message], call, onCreated: () => {} });
  const history: ChatMessage[] = [message, { ...answered(response!.content), formProposal: proposal } as ChatMessage];
  expect(await observation(reference.instanceId)).toBe(OBSERVED);
  return { id: reference.instanceId, history };
}

const revise = (id: string, history: ChatMessage[], question: string) =>
  reviseActiveForm({ request: chat(), instanceId: id, question, history, today: "2026-10-22" });

process.env.AI_HELPER_TIMEOUT_MS = "1000";

const { AI_TIMEOUT_MESSAGE } = await import("@/lib/ai/time-limit");
const { draftNeverBlankEnabled } = await import("@/lib/config/chat-quality-flags");
const { errorResponse } = await import("@/lib/api/respond");

let errors: { mock: { calls: unknown[][] } };

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.draft = { values: {}, checked: {} };
  state.revise = { values: {} };
  state.reviseCalls = 0;
  state.stall = null;
  state.directory = DIRECTORY;
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:00:00Z"));
  await ensureTemplateLibrary("system");
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const timeoutLines = (call: string) =>
  errors.mock.calls.map((args: unknown[]) => String(args[0])).filter((line: string) => line.startsWith("[ai.timeout]") && line.includes(`call=${call} `));

describe("a stalled drafting call", () => {
  it("ends at the helper limit: a short message (never an empty reply) and a log line with the route, the call and the duration", async () => {
    const { id } = await createdForm();
    // The manager asks Sunny to draft the form again, and the drafting model stalls.
    state.stall = "write_form_fields";
    const started = performance.now();
    const response = await draftRoute.POST(
      new Request(`https://app.test/api/forms/instances/${id}/draft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: REQUEST }),
      }),
      { params: Promise.resolve({ id }) },
    );
    const elapsed = performance.now() - started;
    const body = (await response.json()) as { error?: string; values?: unknown };

    if (draftNeverBlankEnabled()) {
      // DRAFT_NEVER_BLANK_ENABLED on: a timeout is one more failed attempt; the draft is the manager's words or the message.
      expect(response.ok ? body.values : body.error).toBeTruthy();
    } else {
      expect(response.status).toBe(504);
      expect(body.error).toBe(AI_TIMEOUT_MESSAGE);
    }
    const lines = timeoutLines("draft");
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/^\[ai\.timeout\] route=forms_draft call=draft duration_ms=\d+ limit_ms=1000$/);
    // Nothing from the form or the manager in the log.
    expect(errors.mock.calls.flat().join("\n")).not.toMatch(/Marnie|late to open/);
    // The limit, not the platform's 120 s, ended it.
    expect(elapsed).toBeLessThan(10_000);
    // Never blank: with the flag off the form keeps what it had; on, the manager's own words fill it.
    expect(await observation(id)).toBeTruthy();
    if (!draftNeverBlankEnabled()) expect(await observation(id)).toBe(OBSERVED);
  }, 20_000);
});

describe("a stalled chat revision", () => {
  it("ends at the helper limit with the short message for the chat reply and a log line", async () => {
    state.draft = { values: { observation: OBSERVED }, checked: { warning_type: ["verbal"], offense_type: ["tardiness"] } };
    const { id, history } = await createdForm();
    state.stall = "revise_form_fields";
    const started = performance.now();
    const failure = await revise(id, history, "reword the observation to sound more professional").then(
      () => null,
      (error: unknown) => error,
    );
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(state.reviseCalls).toBe(1);
    // The chat route answers this error through errorResponse: the manager reads the message.
    const response = errorResponse(failure, "POST /api/chat");
    expect(response.status).toBe(504);
    expect(((await response.json()) as { error: string }).error).toBe(AI_TIMEOUT_MESSAGE);
    expect(timeoutLines("chat_revision")).toEqual([
      expect.stringMatching(/^\[ai\.timeout\] route=unknown call=chat_revision duration_ms=\d+ limit_ms=1000$/),
    ]);
    expect(errors.mock.calls.flat().join("\n")).not.toMatch(/Marnie|late to open/);
    // The form keeps what it had.
    expect(await observation(id)).toBe(OBSERVED);
  }, 20_000);
});
