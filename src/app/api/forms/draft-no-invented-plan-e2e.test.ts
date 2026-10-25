import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * NO "GOING FORWARD" THE MANAGER NEVER TYPED — END TO END
 * ============================================================================
 *
 * QA, 25 Oct 2026: the saved Observation of a Corrective Action Form carried
 * an AI-written "Going Forward" paragraph ("<Name> plans travel and
 * preparation so that … notifies the salon in advance if arriving late is
 * unavoidable") with ACTION_PLAN_MANAGER_ONLY_ENABLED on.
 * DRAFT_NO_INVENTED_PLAN_ENABLED drops it; Observed and Expectation stay.
 *
 * The harness below is `action-plan-manager-only-e2e.test.ts`'s:
 * Pau, 25 Oct 2026: when the manager typed no action plan, the Corrective
 * Action Form's Action Plan stays blank — no "Management will review …"
 * sentence and no closing written onto it. A plan the manager typed ("action
 * plan: …") is the Action Plan word for word. ACTION_PLAN_MANAGER_ONLY_ENABLED.
 *
 * The C-list turn from QA B5 (conv_mvnmf1ik2lqkfld), in this app's words,
 * through the real proposal flow, `createInlineForm` and the real create /
 * draft / review routes. Only identity, the model, the knowledge provider and
 * the database are stand-ins. Every person is synthetic. The card on the live
 * chat path is covered by `src/lib/ai/action-plan-manager-only-live-path.test.ts`.
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
  role: "salon_director",
  scope: null as unknown,
  /*
   * How the manual was found: "fallback" (by its title, as in production) or
   * "tag" (an administrator-approved manual). Either way Finalize works the
   * same (owner decision, 22 Oct 2026: warning only).
   */
  manualMatchedBy: "fallback" as "tag" | "fallback",
  /** What the drafting model returns. */
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  /** What the drafting model was given, per call: its system prompt and messages. */
  modelNotes: [] as string[],
  manual: null as null | { chunks: unknown[] },
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

vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { system?: unknown; messages?: unknown[] }) => {
        state.modelNotes.push(JSON.stringify([request.system ?? null, request.messages ?? []]));
        return {
          content: [{ type: "tool_use", name: "write_form_fields", input: state.draft }],
        };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    // A healthy Performance Management Framework, so the governed draft runs.
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
      if (!state.manual) return { ok: false, reason: "The official policy manual is not in the knowledge base." };
      return {
        ok: true,
        documentId: "doc-manual",
        documentTitle: "JBA Policy Manual",
        documentCategory: "policies_compliance",
        matchedBy: state.manualMatchedBy,
        chunks: state.manual.chunks,
      };
    }
  },
}));

vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("getKnowledgeProvider() is the browser knowledge client and must not be used on the server");
  },
}));

/*
 * THE DIRECTORY READ IS FAKED; ITS SCOPING IS NOT — see
 * `coaching-feedback-e2e.test.ts`.
 */
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
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

/** The view's join, which the fake does not model — see `exit-form-e2e.test.ts`. */
function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-21",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

const requests: { url: string; body: Record<string, unknown> }[] = [];

/** The browser's `formsFetch`, dispatched straight into the route handlers. */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
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
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    instance: Record<string, unknown>;
    values: {
      fieldKey: string;
      value: string | null;
      checked: string[];
      filledBy: string;
      provenance?: Record<string, unknown>;
    }[];
  };
}

const field = (form: Awaited<ReturnType<typeof review>>, key: string) =>
  form.values.find((entry) => entry.fieldKey === key);

let sequence = 0;
const said = (content: string): ChatMessage => ({
  id: `m${(sequence += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-21T15:00:00Z",
});

/**
 * Plays the manager's turns through the real proposal flow — Ask Sunny's own
 * answers fed forward as history, and the open card's template sent as the
 * browser does — and returns every turn's response plus a `create` that files
 * the last card exactly as the chat's Create draft button does.
 */
async function conversation(turns: string[]) {
  const messages: ChatMessage[] = [];
  const responses: NonNullable<Awaited<ReturnType<typeof proposeFormForTurn>>>[] = [];
  let open: string | undefined;
  for (const text of turns) {
    const message = said(text);
    const response = await proposeFormForTurn({
      history: messages,
      question: message.content,
      questionMessageId: message.id,
      actor: { role: state.role as never, scope: state.scope as AccessScope },
      summaries: await listTemplateSummaries(),
      today: "2026-10-21",
      /* The pinned manual, as server-ask supplies it. */
      policyManual: async () => (state.manual?.chunks as never) ?? null,
      ...(open ? { continueTemplateKey: open } : {}),
    });
    expect(response, `turn left the form intake: ${JSON.stringify(text)}`).not.toBeNull();
    expect(response!.formProposal, text).toBeDefined();
    responses.push(response!);
    open = response!.formProposal!.templateKey;
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content: response!.content,
      createdAt: "2026-10-21T15:00:01Z",
      formProposal: response!.formProposal,
    } as ChatMessage);
  }
  const last = responses[responses.length - 1]!;
  expect(last.formProposal!.templateKey).toBe("dpoa");
  return {
    responses,
    last,
    proposal: last.formProposal!,
    /*
     * The card as the manager files it. The chat's slot reader names the
     * employee on the live path (see the live-path test); the proposal flow on
     * its own reads no name from "Test Employee", so the card's Employee is
     * filled in as the manager fills it.
     */
    create: async () => {
      const proposal: ChatFormProposal = {
        ...last.formProposal!,
        employeeName: "Test Employee",
        locationId: "loc-0309",
        status: "ready",
        supportsInlineDraft: true,
      };
      return createInlineForm({ proposal, messages, call, onCreated: () => {} });
    },
  };
}

/* Synthetic people only. */
const DIRECTORY = [
  { id: "e-1", firstName: "Test", lastName: "Employee", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
];

const STANDARDS_OF_CONDUCT_CHUNK = {
  chunkIndex: 30,
  page: 13,
  printedPage: 12,
  sections: [{ heading: "Standards of Conduct", page: 12 }],
  section: "Standards of Conduct",
  content:
    "12 | P a g e\nStandards of Conduct\nThe Company expects Employees to follow rules of conduct that will protect the interests and\nsafety of all clients, Employees, and The Company.\nThe following are examples (non-inclusive list) of infractions that may result in disciplinary\naction:\no Failing to follow the policies and procedures of The Company\no Failure to complete assigned work or required tasks by the deadline\no Register / Bank shortages",
};

const MANUAL = { chunks: [STANDARDS_OF_CONDUCT_CHUNK] };

const LATE = "create a written CA for Test Employee at Kearney, she was 20 minutes late for her shift on 10-20-26";
const MANAGER_PLAN = "arrive 10 minutes before every shift for the next 30 days";

/* What the drafting model returns: the reported "Going Forward", with an invented person's name. */
const OBSERVED = "Observed:\nOn October 20, 2026, Test Employee arrived 20 minutes late for her scheduled shift.";
const EXPECTATION = "Expectation:\nEmployees are expected to arrive on time and be ready to work at the start of their scheduled shift.";
const GOING_FORWARD =
  "Going Forward:\nTest plans travel and preparation so that she arrives on time, and notifies the salon in advance if arriving late is unavoidable.";
const MODEL_DRAFT = {
  values: { observation: `${OBSERVED}\n\n${EXPECTATION}\n\n${GOING_FORWARD}`, action_plan: "Test will plan her travel." },
  checked: {},
};

const FLAGS = ["DRAFT_NO_INVENTED_PLAN_ENABLED", "ACTION_PLAN_MANAGER_ONLY_ENABLED"];
const savedFlags = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const name of FLAGS) {
    savedFlags.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  requests.length = 0;
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] };
  state.draft = MODEL_DRAFT;
  state.manualMatchedBy = "fallback";
  state.modelNotes = [];
  state.manual = MANUAL;
  state.directory = DIRECTORY;
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-25T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  vi.useRealTimers();
  for (const [name, value] of savedFlags) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function drafted(turns: string[]) {
  const { create } = await conversation(turns);
  const { reference } = await create();
  const form = await review(reference.instanceId);
  return { observation: field(form, "observation")?.value ?? "", plan: field(form, "action_plan")?.value ?? "" };
}

describe("DRAFT_NO_INVENTED_PLAN_ENABLED: the Corrective Action Observation", () => {
  it("off (ACTION_PLAN_MANAGER_ONLY on): the model's Going Forward is saved (the reported failure)", async () => {
    process.env.ACTION_PLAN_MANAGER_ONLY_ENABLED = "true";
    const { observation } = await drafted([LATE]);
    expect(observation).toContain("Going Forward:");
    expect(observation).toContain("notifies the salon in advance");
  });

  it("on: no Going Forward; Observed and Expectation are kept", async () => {
    process.env.ACTION_PLAN_MANAGER_ONLY_ENABLED = "true";
    process.env.DRAFT_NO_INVENTED_PLAN_ENABLED = "true";
    const { observation, plan } = await drafted([LATE]);
    expect(observation).not.toMatch(/Going Forward|plans travel|notifies the salon/);
    expect(observation).toContain("Observed:");
    expect(observation).toContain("20 minutes late");
    expect(observation).toContain("Expectation:");
    expect(plan.trim()).toBe("");
  });

  it("NEVER-BREAK: a typed action plan is kept word for word with both flags on", async () => {
    process.env.ACTION_PLAN_MANAGER_ONLY_ENABLED = "true";
    process.env.DRAFT_NO_INVENTED_PLAN_ENABLED = "true";
    const { observation, plan } = await drafted([`${LATE}. action plan: ${MANAGER_PLAN}`]);
    expect(plan).toBe(MANAGER_PLAN);
    expect(observation).toContain("Observed:");
  });
});
