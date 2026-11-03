import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * FORM_EDIT_NAME_GATE_ROSTER_ENABLED — A CAPITALISED WORD IS NOT ANOTHER PERSON
 * ============================================================================
 *
 * Master plan step 2 (3 Nov 2026). With a form open, the revision drops an
 * edit that names somebody other than the form's employee, and names were read
 * from capital letters: "Must", "Practice", "Daily Stats", "Dez" (the plan's
 * QA findings) read as other people, so the edit went to the ordinary answer.
 * With the flag, a word is another person only when it matches somebody active
 * at the manager's own salons (`readStoreRoster`, step 1).
 *
 * Setup is `coaching-qa-fixes-e2e.test.ts`'s: conversation -> card -> Create ->
 * draft -> `reviseActiveForm`, with the model, identity, directory read and
 * database faked. The store roster is the real scoping over this file's rows.
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
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revise: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: unknown },
  calls: [] as { tool: string; system: string; prompt: string }[],
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
      create: async (request: {
        system: string;
        messages: { content: string }[];
        tool_choice: { name: string };
      }) => {
        const tool = request.tool_choice.name;
        state.calls.push({ tool, system: request.system, prompt: request.messages[0]!.content });
        return {
          content: [
            {
              type: "tool_use",
              name: tool,
              input: tool === "revise_form_fields" ? state.revise : state.draft,
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
    async fetchRoleGrounding(role: { id: string }) {
      return {
        ok: true,
        grounding: {
          role: { id: role.id },
          documentId: "doc-progression",
          documentTitle: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            {
              chunk_id: "pmf-0",
              document_id: "doc-progression",
              document_title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
              category: "leadership_coaching",
              locator: "SECTION 2",
              page: null,
              section: null,
              content: "Solve the issue at the lowest appropriate level.",
              similarity: 0,
            },
          ],
        },
      };
    }
    async fetchOfficialPolicyManual() {
      return { ok: false, reason: "not needed" };
    }
  },
}));

/*
 * THE DIRECTORY READ IS FAKED; ITS SCOPING IS NOT. `loadScopedRoster` is the
 * real `scopeRoster` over the rows each test supplies, so what a manager can
 * be matched against is decided by the production rule.
 */
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) =>
      actual.scopeRoster(state.directory as never, scope),
    readStoreRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const { reviseActiveForm } = await import("@/lib/forms/chat-revision");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-01",
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

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    instance: Record<string, unknown>;
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy: string }[];
  };
}

let turn = 0;
const said = (content: string): ChatMessage => ({
  id: `m-${(turn += 1)}`,
  role: "user",
  content,
  createdAt: "2026-10-01T15:00:00Z",
});
const answered = (content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `a-${(turn += 1)}`,
  role: "assistant",
  content,
  createdAt: "2026-10-01T15:00:00Z",
  ...extra,
});

async function propose(messages: ChatMessage[], continueTemplateKey?: string) {
  const current = messages[messages.length - 1]!;
  return proposeFormForTurn({
    history: messages.slice(0, -1),
    question: current.content,
    questionMessageId: current.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-10-01",
    ...(continueTemplateKey ? { continueTemplateKey } : {}),
  });
}

async function createFrom(messages: ChatMessage[], continueTemplateKey?: string) {
  const response = await propose(messages, continueTemplateKey);
  const proposal = response!.formProposal!;
  expect(proposal.supportsInlineDraft, response!.content).toBe(true);
  const result = await createInlineForm({ proposal, messages, call, onCreated: () => {} });
  return { response: response!, proposal, id: result.reference.instanceId, warning: result.draftWarning };
}

async function revise(id: string, history: ChatMessage[], question: string, today = "2026-10-01") {
  return reviseActiveForm({
    request: new Request("https://app.test/api/chat", { method: "POST" }),
    instanceId: id,
    question,
    history,
    today,
  });
}


const SALON_SCOPE = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };

const DIRECTORY = [
  { id: "e-1", firstName: "Kaitlyn", lastName: "Marsh", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Avery", lastName: "Stone", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310", "loc-0311"] },
  // Shared and service accounts, exactly as the live Woven directory carries them.
  { id: "e-3", firstName: "Risk", lastName: "Management", preferredFirstName: "Risk", employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-4", firstName: "No", lastName: "Manager", preferredFirstName: "No", employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-5", firstName: "GlowBrands", lastName: "IT Support", preferredFirstName: "GlowBrands", employmentStatus: "active", salonIds: ["loc-0310"] },
];

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = SALON_SCOPE;
  state.draft = { values: {}, checked: {} };
  state.revise = { values: {} };
  state.calls = [];
  state.directory = DIRECTORY;
  turn = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-01T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

const modelCalls = (tool: string) => state.calls.filter((entry) => entry.tool === tool).length;
const ref = (id: string, proposal: { proposalId: string; templateName: string }) =>
  answered("Here is the form.", { formInstanceRef: { instanceId: id, proposalId: proposal.proposalId, templateName: proposal.templateName } });

/* ===================================== P2, P3, P6: the open Follow-Up form == */


/** One that already carries findings, one of them the manager's own text. */
async function filledFollowUpForm() {
  const notes =
    "Create a follow-up coaching form for Kaitlyn Marsh. I followed up today: since our coaching on bed sanitizing she has improved — I watched her sanitize every bed on three shifts. We reviewed the checklist together. Next follow-up within 2 weeks.";
  state.draft = {
    values: {
      original_topic: "Bed sanitizing",
      original_expectation: "Every bed is sanitized after each client.",
      follow_up_observation: "Kaitlyn has sanitized every bed after each client since the coaching.",
      specific_evidence: "Observed on three shifts.",
      additional_coaching: "Reviewed the sanitizing checklist together.",
      next_follow_up: "within 2 weeks",
    },
    checked: { progress_level: ["improved"], next_step: ["continue"] },
  };
  const messages = [said(notes)];
  const created = await createFrom(messages);
  const { saveInstanceValues } = await import("@/lib/forms/instances");
  await saveInstanceValues(created.id, { values: { specific_evidence: "Manager's own words: watched 3 shifts." } }, "manager-1");
  return { id: created.id, history: [...messages, ref(created.id, created.proposal)] };
}

const snapshot = async (id: string) =>
  Object.fromEntries((await review(id)).values.map((row) => [row.fieldKey, { value: row.value, checked: row.checked, by: row.filledBy }]));
function changedKeys(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.keys({ ...before, ...after }).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

const FLAG = "FORM_EDIT_NAME_GATE_ROSTER_ENABLED";
const EDITS = [
  "Add that she Must Practice the sanitizing checklist every shift.",
  "Add that she reviewed the checklist with Dez before Daily Stats.",
];

describe("an edit with capitalised words, the Follow-Up form open for Kaitlyn Marsh", () => {
  afterEach(() => {
    delete process.env[FLAG];
  });

  it.each(EDITS)("flag off: %j is read as naming somebody else, and dropped (today's behaviour)", async (question) => {
    const { id, history } = await filledFollowUpForm();
    state.revise = { values: { additional_coaching: "Reviewed the sanitizing checklist together; she will practise it every shift." } };
    expect(await revise(id, history, question)).toBeNull();
    expect(modelCalls("revise_form_fields")).toBe(0);
  });

  it.each(EDITS)("flag on: %j is written into her form — nobody on the salon's roster is named", async (question) => {
    process.env[FLAG] = "true";
    const { id, history } = await filledFollowUpForm();
    const before = await snapshot(id);
    state.revise = { values: { additional_coaching: "Reviewed the sanitizing checklist together; she will practise it every shift." } };
    const answer = await revise(id, history, question);
    expect(answer).not.toBeNull();
    expect(modelCalls("revise_form_fields")).toBe(1);
    expect(changedKeys(before, await snapshot(id))).toEqual(["additional_coaching"]);
  });

  it("flag on: somebody else on the roster is still somebody else", async () => {
    process.env[FLAG] = "true";
    const { id, history } = await filledFollowUpForm();
    expect(await revise(id, history, "Add that Avery Stone also skipped the checklist.")).toBeNull();
    expect(modelCalls("revise_form_fields")).toBe(0);
  });

  it("flag on with no roster to check against: as before", async () => {
    process.env[FLAG] = "true";
    const { id, history } = await filledFollowUpForm();
    state.directory = [];
    expect(await revise(id, history, EDITS[1]!)).toBeNull();
  });
});
