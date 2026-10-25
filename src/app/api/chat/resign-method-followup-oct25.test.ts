import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "SHE RESIGNED BY TEXT" — HOW EMPLOYEE RESIGNED, FILLED ONLY FROM THE MANAGER
 * ============================================================================
 *
 * Pau's decision (25 Oct 2026, both apps): on the Resignation/Exit Form the
 * "How Employee Resigned" line stays BLANK when the manager only said "she
 * resigned" — Ask Sunny never guesses the method. The manager fills it on the
 * form, or types it in chat as a follow-up ("she resigned by text"), and the
 * open form's line is updated.
 *
 * Every turn goes through POST /api/chat in the route's own order (the open
 * form's correction first), the card's Create through `createInlineForm`, and
 * the form is read back through the forms route. This app's live form path:
 * intent extraction on, the full remap off. The drafting model is a stand-in
 * that writes nothing for the method (it may not: the line is the manager's).
 *
 * "She told me verbally" names the method as clearly as "by text" does, but
 * was not read; it fills "Verbal" only with RESIGN_METHOD_FOLLOWUP_ENABLED.
 * Wording that names no method ("she let me know she quit") stays blank.
 * Synthetic names throughout.
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, state.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role: state.role,
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

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => {
    state.chatModelCalls += 1;
    return "A grounded answer.";
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
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* Each case loads the template library and runs several routes; a shared machine needs more than 5s. */
vi.setConfig({ hookTimeout: 30_000, testTimeout: 30_000 });

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const instanceRoute = await import("../forms/instances/[id]/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");
const { readExitDetails } = await import("@/lib/forms/exit-details");

const TODAY = "2026-10-25";

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? TODAY,
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
      if (row.revises_instance_id === id) row.revises_instance_id = uuid;
    }
  }
  return uuid;
}

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formOpened?: { instanceId: string; templateName: string; revisesInstanceId: string | null };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card opened by an answer becomes the open form. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;

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
          ...(this.proposal && !this.instanceId ? { continueProposalTemplateKey: this.proposal.templateKey } : {}),
          ...(this.instanceId ? { activeFormInstanceId: this.instanceId } : {}),
        }),
      }),
    );
    const payload = (await response.json()) as Answer & { error?: string };
    expect(response.status, JSON.stringify(payload)).toBe(200);
    this.messages.push(
      { id, role: "user", content: question, createdAt: `${TODAY}T15:00:00Z` } as ChatMessage,
      {
        id: `a${this.sequence}`,
        role: "assistant",
        content: payload.content,
        createdAt: `${TODAY}T15:00:01Z`,
        ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
      } as ChatMessage,
    );
    if (payload.formProposal) {
      this.proposal = payload.formProposal;
      this.instanceId = null;
    }
    if (payload.formOpened) {
      payload.formOpened.instanceId = toUuid(payload.formOpened.instanceId);
      this.instanceId = payload.formOpened.instanceId;
    }
    return payload;
  }

  async create() {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({
      proposal: this.proposal!,
      messages: this.messages,
      call,
      onCreated: () => {},
    });
    this.instanceId = toUuid(result.reference.instanceId);
    return this.instanceId;
  }
}

class JoiningRows extends Array<Record<string, unknown>> {
  override push(...rows: Record<string, unknown>[]) {
    const count = super.push(...rows);
    joinOverview();
    return count;
  }
}

/* Synthetic people at one salon. */
const DIRECTORY = [
  { id: "e-1", firstName: "Marlo", lastName: "Quist", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Sela", lastName: "Brandt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
];

/* The drafting model's stand-in: an Additional Details line, and nothing for the method. */
const EXIT_MODEL = { values: { details: "Marlo Quist resigned." }, checked: {} };

const FLAG = "RESIGN_METHOD_FOLLOWUP_ENABLED";
const PROFILE = ["INTENT_EXTRACTION_ENABLED"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  state.role = "salon_director";
  state.draft = EXIT_MODEL;
  state.revision = { values: {} };
  state.revisionCalls = 0;
  state.chatModelCalls = 0;
  state.directory = DIRECTORY;
  for (const name of [...PROFILE, FLAG, "FORM_FULL_REMAP_ENABLED"]) saved.set(name, process.env[name]);
  for (const name of PROFILE) process.env[name] = "true";
  delete process.env.FORM_FULL_REMAP_ENABLED;
  process.env[FLAG] = "true";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

type Row = { fieldKey: string; value: string | null; checked: string[] };

async function method(id: string): Promise<string | null> {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { values: Row[] };
  const row = body.values.find((entry) => entry.fieldKey === "resignation_method");
  return row?.value ? row.value : null;
}

/* The manager's request, naming no method. */
const EXIT_REQUEST = "Create an exit form for Marlo Quist, she resigned";

/** The exit card, created, with the form open in the thread. */
async function openExitForm() {
  const thread = new Thread();
  const first = await thread.say(EXIT_REQUEST);
  expect(first.formProposal?.templateKey).toBe("stc-exit");
  const id = await thread.create();
  return { thread, first, id };
}

describe('case (a): "she resigned" alone leaves How Employee Resigned blank', () => {
  it("the card lists it as left blank and the created form has no method", async () => {
    const { first, id } = await openExitForm();
    expect(first.content).toMatch(/Left blank for you to review:\*\*[^\n]*How Employee Resigned/);
    expect(first.content).not.toMatch(/- \*\*How Employee Resigned:\*\*/);
    expect(await method(id)).toBeNull();
  });

  it('a follow-up "she resigned" on the open form still writes no method', async () => {
    const { thread, id } = await openExitForm();
    const reply = await thread.say("she resigned");
    expect(reply.formUpdate?.updated ?? []).not.toContain("How Employee Resigned");
    expect(await method(id)).toBeNull();
  });

  it("the same with the flag off", async () => {
    delete process.env[FLAG];
    const { first, id } = await openExitForm();
    expect(first.content).toMatch(/Left blank for you to review:\*\*[^\n]*How Employee Resigned/);
    expect(await method(id)).toBeNull();
  });
});

describe('case (b): with the exit form open, "she resigned by text" fills the line', () => {
  it("Pau's exact wording updates the open form to Text message", async () => {
    const { thread, id } = await openExitForm();
    const reply = await thread.say("she resigned by text");
    expect(reply.formUpdate?.instanceId).toBe(id);
    expect(reply.formProposal).toBeUndefined();
    expect(await method(id)).toBe("Text message");
  });

  it.each([
    ["she resigned by text message", "Text message"],
    ["she texted me she quit", "Text message"],
    ["resigned via email", "Email"],
    ["she told me verbally", "Verbal"],
  ])("%s → %s", async (followUp, expected) => {
    const { thread, id } = await openExitForm();
    const reply = await thread.say(followUp);
    expect(reply.formUpdate?.instanceId).toBe(id);
    expect(await method(id)).toBe(expected);
  });

  it.each([
    "she let me know she quit",
    "she resigned, not sure how she told the SD",
    "she got a verbal warning last month and then resigned",
  ])("%s: names no method, so the line stays blank", async (followUp) => {
    const { thread, id } = await openExitForm();
    await thread.say(followUp);
    expect(await method(id)).toBeNull();
  });

  it('flag off: "by text" still fills the line; "verbally" is not read', async () => {
    delete process.env[FLAG];
    const texted = await openExitForm();
    await texted.thread.say("she resigned by text");
    expect(await method(texted.id)).toBe("Text message");
    const told = await openExitForm();
    await told.thread.say("she told me verbally");
    expect(await method(told.id)).toBeNull();
  });
});

describe("before Create: the follow-up on the open card", () => {
  it('"she resigned by text" after the card is shown is on the form when it is created', async () => {
    const thread = new Thread();
    await thread.say(EXIT_REQUEST);
    const second = await thread.say("she resigned by text");
    expect(second.formProposal?.templateKey).toBe("stc-exit");
    expect(second.content).toMatch(/- \*\*How Employee Resigned:\*\* Text message/);
    const id = await thread.create();
    expect(await method(id)).toBe("Text message");
  });
});

describe("the reader, with RESIGN_METHOD_FOLLOWUP_ENABLED", () => {
  const read = (text: string) => readExitDetails(text, TODAY).resignationMethod;

  it.each([
    ["she told me verbally", "Verbal"],
    ["She gave a verbal resignation on Monday.", "Verbal"],
    ["she put in a verbal notice", "Verbal"],
    ["she told me verbally in person", "In person"],
    ["she didn't tell me verbally, she texted me", "Text message"],
    ["she resigned", null],
    ["she got a verbal warning last week and then resigned", null],
    ["Did she resign verbally?", null],
  ])("%s → %s", (text, expected) => {
    expect(read(text)).toBe(expected);
  });

  it("off, verbally is not read", () => {
    delete process.env[FLAG];
    expect(read("she told me verbally")).toBeNull();
    expect(read("she resigned by text")).toBe("Text message");
  });
});
