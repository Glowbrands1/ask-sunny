import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE REVISION'S SAVE THROUGH THE ONE WRITER (FORM_EDIT_SINGLE_WRITER_ENABLED)
 * ============================================================================
 *
 * Pau's approved hunk in `chat-revision.ts` (4 Nov 2026): with the flag on,
 * `reviseActiveForm` saves through `writeRevisionEdits(..., { actorId,
 * latest: input.question, notes })` (`form-write.ts`). QA's merge condition,
 * in Pau's words, needs evidence for two things:
 *
 *   (1) writeRevisionEdits receives the latest manager message (`latest:
 *       input.question`), so the no-dropped-words rule applies to revisions;
 *   (2) a revision that drops words is refused.
 *
 * Driven through the REAL `reviseActiveForm` on a Corrective Action draft
 * created the production way (proposal -> `createInlineForm` -> the create
 * and draft routes). Only identity, the model, the knowledge provider, the
 * directory read and the database are stand-ins; `writeRevisionEdits` and
 * `applyAssistantRevision` are wrapped (spied), never replaced. Marnie Quill
 * is an invented person, on no directory fixture in this app; she works at
 * one salon (loc-0310), and the manager is that salon's Salon Director.
 *
 * Ported from Ask Bubbles (0eca3906). Setup is this app's
 * `src/app/api/forms/corrective-action-chat-edits-e2e.test.ts`'s: its Salon
 * Director, its knowledge provider with the real JBA manual fixture, its
 * create and draft routes. Every wording takes the same route here as in
 * Bubbles: the field-naming request reaches the save, and Pau's own wording
 * is refused by `keepsSubstance` before it — (a0) proves it, not assumes it.
 *
 * Before the hunk (chat-revision.ts at HEAD~1), (a), (b) and (b') fail: the
 * revision saved through `applyAssistantRevision` and never reached
 * `writeRevisionEdits`. (c) records what main does with the flag off: the
 * rewrite that drops Marnie and the date is saved.
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
}));

const spies = vi.hoisted(() => ({
  writeRevisionEdits: [] as unknown[][],
  applyAssistantRevision: [] as unknown[][],
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

/* The first draft answers `state.draft`; the revision model answers `state.revise`. */
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async (request: { tool_choice?: { name?: string } }) => {
        const tool = request.tool_choice?.name ?? "write_form_fields";
        if (tool === "revise_form_fields") state.reviseCalls += 1;
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

/* Spies that call through: the real one writer, the real old writer. */
vi.mock("@/lib/forms/form-write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/form-write")>();
  return {
    ...actual,
    writeRevisionEdits: async (...args: Parameters<typeof actual.writeRevisionEdits>) => {
      spies.writeRevisionEdits.push(args);
      return actual.writeRevisionEdits(...args);
    },
  };
});

vi.mock("@/lib/forms/instances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/instances")>();
  return {
    ...actual,
    applyAssistantRevision: async (...args: Parameters<typeof actual.applyAssistantRevision>) => {
      spies.applyAssistantRevision.push(args);
      return actual.applyAssistantRevision(...args);
    },
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
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
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

/* An invented person, on the roster. */
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
  state.draft = { values: { observation: OBSERVED }, checked: { warning_type: ["verbal"], offense_type: ["tardiness"] } };
  const { reference } = await createInlineForm({ proposal, messages: [message], call, onCreated: () => {} });
  const history: ChatMessage[] = [message, { ...answered(response!.content), formProposal: proposal } as ChatMessage];
  expect(await observation(reference.instanceId)).toBe(OBSERVED);
  return { id: reference.instanceId, history };
}

const revise = (id: string, history: ChatMessage[], question: string) =>
  reviseActiveForm({ request: chat(), instanceId: id, question, history, today: "2026-10-22" });

const FLAG = "FORM_EDIT_SINGLE_WRITER_ENABLED";
/*
 * The manager's message names the Observation. Pau's example, "make it sound
 * more professional", names no field: `scopeRevision` reads it as a rewording
 * and `keepsSubstance` (revision.ts) refuses a rewrite that loses the date
 * before any save, with the flag on or off — case (a0). Naming the field is
 * the request that reaches the save, so (a) and (c) use it.
 */
const PROFESSIONAL = "reword the observation to sound more professional";
const DROPPED = "The employee was late to open.";
const REDATED = "Marnie Quill was late to open on 10-21-26.";

type RevisionArgs = [string, { values: Record<string, string> }, readonly string[], { actorId: string; latest: string; notes?: string }];

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.draft = { values: {}, checked: {} };
  state.revise = { values: {} };
  state.reviseCalls = 0;
  state.directory = DIRECTORY;
  spies.writeRevisionEdits = [];
  spies.applyAssistantRevision = [];
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env[FLAG];
  vi.useRealTimers();
});

describe("FORM_EDIT_SINGLE_WRITER_ENABLED on: the revision saves through writeRevisionEdits", () => {
  it("(a) a rewrite that drops Marnie and the date is refused, and the writer was given the manager's exact message", async () => {
    process.env[FLAG] = "true";
    const { id, history } = await createdForm();
    state.revise = { values: { observation: DROPPED } };

    const answer = await revise(id, history, PROFESSIONAL);

    expect(state.reviseCalls).toBe(1);
    expect(spies.applyAssistantRevision).toHaveLength(0);
    // (1) The latest manager message reaches the one writer, verbatim.
    expect(spies.writeRevisionEdits).toHaveLength(1);
    const [instanceId, draft, , context] = spies.writeRevisionEdits[0] as RevisionArgs;
    expect(instanceId).toBe(id);
    expect(draft.values.observation).toBe(DROPPED);
    expect(context.latest).toBe(PROFESSIONAL);
    expect(context.actorId).toBeTruthy();
    // (2) The dropped words are refused: the saved Observation is unchanged, and nothing claims an update.
    expect(await observation(id)).toBe(OBSERVED);
    expect(answer).not.toBeNull();
    expect(answer!.formUpdate?.updated ?? []).not.toContain("observation");
    expect(answer!.content).not.toMatch(/\bUpdated\b/);
  });

  it("(a0) Pau's wording, \"make it sound more professional\": the rewording guard refuses the same rewrite before any save", async () => {
    process.env[FLAG] = "true";
    const { id, history } = await createdForm();
    state.revise = { values: { observation: DROPPED } };

    const answer = await revise(id, history, "make it sound more professional");

    expect(state.reviseCalls).toBe(1);
    expect(spies.writeRevisionEdits).toHaveLength(0);
    expect(spies.applyAssistantRevision).toHaveLength(0);
    expect(await observation(id)).toBe(OBSERVED);
    expect(answer!.content).not.toMatch(/\bUpdated\b/);
  });

  it("(b) a change the latest message names is written — `latest` is what permits it", async () => {
    process.env[FLAG] = "true";
    const { id, history } = await createdForm();
    const question = "change the observation from 10-20-26 to 10-21-26";
    state.revise = { values: { observation: REDATED } };

    const answer = await revise(id, history, question);

    expect(spies.writeRevisionEdits).toHaveLength(1);
    expect((spies.writeRevisionEdits[0] as RevisionArgs)[3].latest).toBe(question);
    expect(await observation(id)).toBe(REDATED);
    expect(answer!.formUpdate?.updated).toContain("observation");
  });

  it("(b') the same new text, when the latest message does not name the date it drops, is refused", async () => {
    process.env[FLAG] = "true";
    const { id, history } = await createdForm();
    const question = "change the observation, the date was 10-21-26";
    state.revise = { values: { observation: REDATED } };

    const answer = await revise(id, history, question);

    expect(spies.writeRevisionEdits).toHaveLength(1);
    expect((spies.writeRevisionEdits[0] as RevisionArgs)[3].latest).toBe(question);
    expect(await observation(id)).toBe(OBSERVED);
    expect(answer!.formUpdate?.updated ?? []).not.toContain("observation");
  });
});

describe("FORM_EDIT_SINGLE_WRITER_ENABLED off: today's applyAssistantRevision path, as on main", () => {
  it("(c) the same rewrite never reaches writeRevisionEdits; applyAssistantRevision saves it, as main does", async () => {
    const { id, history } = await createdForm();
    state.revise = { values: { observation: DROPPED } };

    const answer = await revise(id, history, PROFESSIONAL);

    expect(state.reviseCalls).toBe(1);
    expect(spies.writeRevisionEdits).toHaveLength(0);
    expect(spies.applyAssistantRevision).toHaveLength(1);
    expect((spies.applyAssistantRevision[0] as RevisionArgs)[1].values.observation).toBe(DROPPED);
    // Main's behaviour, recorded: off, nothing stops the dropped words.
    expect(await observation(id)).toBe(DROPPED);
    expect(answer!.formUpdate?.updated).toContain("observation");
  });
});
