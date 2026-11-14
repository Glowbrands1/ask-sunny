import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * THE TYPE OF WARNING IS THE MANAGER'S, NEVER THE MODEL'S (MODEL_WARNING_LEVEL_DISCARDED_ENABLED)
 * ============================================================================
 *
 * QA's 38g live test (14 Nov 2026), the manager's request as typed (name replaced):
 *   "please make a ca for <B> for not doing the 10 minute sanitation on 11/12/26, she was told twice"
 * The card had no level ("I won't guess at them"); Create gave a draft with Type of Warning WRITTEN, filled by the
 * model. The draft route showed the model the Type of Warning group and wrote its tick when no level was stated.
 * Ask Bubbles has discarded the model's level since 9 Oct 2026 ("given verbal warning on 9/21" came back Written).
 *
 * On: the group is not shown to the draft model and a level it ticks anyway is dropped; a level the manager stated
 * ("verbal CA for …", "written warning for …") is ticked at creation from the card and kept. Off, as before. The
 * harness is `hr-feedback-oct21-e2e.test.ts`'s (real proposal flow, createInlineForm, create / draft / review routes).
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
        matchedBy: "fallback",
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
  createdAt: "2026-10-21T18:00:00Z",
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
    responses.push(response!);
    if (response!.formProposal) open = response!.formProposal.templateKey;
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content: response!.content,
      createdAt: "2026-10-21T18:00:01Z",
      ...(response!.formProposal ? { formProposal: response!.formProposal } : {}),
    } as ChatMessage);
  }
  const last = responses[responses.length - 1]!;
  return {
    responses,
    last,
    proposal: last.formProposal!,
    create: async () => createInlineForm({ proposal: last.formProposal!, messages, call, onCreated: () => {} }),
  };
}

/* Synthetic people only. */
const DIRECTORY = [
  { id: "e-1", firstName: "Pat", lastName: "Rivera", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
];

/* THE MANUAL AS THE KNOWLEDGE BASE HOLDS IT: real headings, and the page the manual prints. */
const chunk = (index: number, heading: string, printedPage: number, body: string, sections = [{ heading, page: printedPage }]) => ({
  chunkIndex: index,
  page: printedPage + 1,
  printedPage,
  sections,
  section: heading,
  content: `${printedPage} | P a g e\n${heading}\n${body}`,
});

const MANUAL = {
  chunks: [
    chunk(30, "Standards of Conduct", 12, "The following are examples (non-inclusive list) of infractions that may result in disciplinary\naction:\no Insubordination -the refusal to follow the directions of the manager.\no Register / Bank shortages"),
    chunk(33, "Attendance", 14, "It is the responsibility of each employee to know his or her work schedule and to always be on\ntime."),
    chunk(34, "Late Opening", 15, "When an employee assigned to open a location is unable to open the location at the proper\ntime, the employee must notify the manager as soon as possible. The employee will reimburse The\nCompany $25.00 via payroll deduction."),
    chunk(43, "Cell Phone/Smart Watch Policy", 19, "Personal Employee cell phones are permitted in the workplace but must be kept out of sight."),
    chunk(64, "Visitors in the Workplace", 30, "For personal visitors, Employees must obtain approval from direct Supervisors each time they\ninvite a visitor into the workplace."),
    // Real headings an account's ordinary words also say ("payroll deduct", "time records"): never cited unasked.
    chunk(100, "Payroll Deductions", 39, "Deductions from an employee's pay are made only as required by law."),
    chunk(98, "Time Records", 36, "Employees must record their own time worked accurately."),
  ],
};

beforeEach(async () => {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  requests.length = 0;
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: [] };
  state.draft = { values: {}, checked: {} };
  state.modelNotes = [];
  state.manual = MANUAL;
  state.directory = DIRECTORY;
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T02:25:00Z"));
  delete process.env.MODEL_WARNING_LEVEL_DISCARDED_ENABLED;
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  delete process.env.MODEL_WARNING_LEVEL_DISCARDED_ENABLED;
});

async function filed(turns: string[], observation: string, checked: Record<string, string[]>) {
  const played = await conversation(turns);
  state.draft = { values: { observation: `Observed:\n${observation}` }, checked };
  const { reference } = await played.create();
  return { ...played, form: await review(reference.instanceId) };
}

const SAID_38G = "please make a ca for pat rivera for not doing the 10 minute sanitation on 11/12/26, she was told twice";
const OBSERVED_38G = "Pat Rivera did not complete the 10-minute sanitation on November 12, 2026, after being told twice.";
/** Whether the draft model was shown the Type of Warning group (its key in the CHECKBOXES list). */
const shownWarningGroup = () => state.modelNotes.some((note) => /CHECKBOXES TO TICK[^"]*warning_type/.test(note));

describe('38g: "please make a ca for <B> for not doing the 10 minute sanitation on 11/12/26, she was told twice"', () => {
  it("flag off: the model's Written is saved, as in production (the bug)", async () => {
    const { proposal, form } = await filed([SAID_38G], OBSERVED_38G, { warning_type: ["written"], offense_type: ["other"] });
    expect(proposal.warningLevel ?? null).toBeNull();
    expect(field(form, "warning_type")!.checked).toEqual(["written"]);
    expect(shownWarningGroup()).toBe(true);
  });

  it("flag on: no level was stated, so Type of Warning stays empty and the model is not shown the group", async () => {
    process.env.MODEL_WARNING_LEVEL_DISCARDED_ENABLED = "true";
    const { proposal, form } = await filed([SAID_38G], OBSERVED_38G, { warning_type: ["written"], offense_type: ["other"] });
    expect(proposal.warningLevel ?? null).toBeNull();
    expect(field(form, "warning_type")?.checked ?? []).toEqual([]);
    expect(shownWarningGroup()).toBe(false);
    // The rest of the model's ticks are kept.
    expect(field(form, "offense_type")!.checked).toEqual(["other"]);
  });

  it("flag on: a Termination the model ticks is still refused", async () => {
    process.env.MODEL_WARNING_LEVEL_DISCARDED_ENABLED = "true";
    const { form } = await filed([SAID_38G], OBSERVED_38G, { warning_type: ["termination"] });
    expect(field(form, "warning_type")?.checked ?? []).toEqual([]);
  });
});

describe("flag on: a level the manager stated is kept", () => {
  beforeEach(() => {
    process.env.MODEL_WARNING_LEVEL_DISCARDED_ENABLED = "true";
  });

  it('"verbal CA for <A> …" keeps Verbal, whatever the model ticks', async () => {
    const { proposal, form } = await filed(
      ["create a verbal CA for pat rivera for not doing the 10 minute sanitation on 11/12/26, she was told twice"],
      OBSERVED_38G,
      { warning_type: ["written"] },
    );
    expect(proposal.warningLevel).toBe("verbal");
    expect(field(form, "warning_type")!.checked).toEqual(["verbal"]);
  });

  it('"written warning for <A> …" keeps Written, whatever the model ticks', async () => {
    const { proposal, form } = await filed(
      ["create a written warning for pat rivera for not doing the 10 minute sanitation on 11/12/26, she was told twice"],
      OBSERVED_38G,
      { warning_type: ["verbal"] },
    );
    expect(proposal.warningLevel).toBe("written");
    expect(field(form, "warning_type")!.checked).toEqual(["written"]);
  });
});

/**
 * The audit's "climbed a rung" shape (QA's read-only split, 14 Nov 2026): 3 of the 27 AI-filled levels were Written where
 * the manager's only level word was "verbal": an EARLIER verbal warning, which the model took one rung up. History is
 * not this form's level; with the flag on nothing is ticked.
 */
describe("flag on: an earlier verbal warning is never climbed to Written", () => {
  beforeEach(() => {
    process.env.MODEL_WARNING_LEVEL_DISCARDED_ENABLED = "true";
  });

  for (const said of [
    "make a ca for pat rivera, late again 30 mins today. she got a verbal warning on 10/21",
    "pat rivera left the register unlocked again tonight, she already had a verbal last month. create a ca",
    "create a corrective action for pat rivera for no call no show on 11/12/26. previous verbal 9/30/26",
  ]) {
    it(`"${said}": the earlier verbal is history, and the model's Written is not saved`, async () => {
      const { proposal, form } = await filed([said], "Pat Rivera did not follow the expectation.", { warning_type: ["written"] });
      expect(proposal.warningLevel ?? null).toBeNull();
      expect(field(form, "warning_type")?.checked ?? []).toEqual([]);
    });
  }
});
