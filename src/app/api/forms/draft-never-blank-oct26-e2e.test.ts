import { APIError } from "@anthropic-ai/sdk";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * A CORRECTIVE ACTION DRAFT IS NEVER FILED BLANK — END TO END
 * ============================================================================
 *
 * Found in the sibling app's production, 26 Oct 2026 (the tester's run), and
 * this route has the same gap. One manager turn, a correct card, Create
 * draft — and the prefill recorded `drafted` with
 * `{"fields": [], "rejected": []}`: no Observation, no policy. Intermittent:
 * the same sentence filled three fields for another name in the same run.
 * QA: every blank came from Create clicks fired 5–6 at once; the same
 * wordings created one at a time all filled. Both apps share the model quota.
 *
 * WHY. The route took whatever the model's tool call held as the draft. A call
 * whose `values` came back empty, omitted, JSON-encoded as a string, split into
 * one object per section, or keyed by the field's label was dropped by the
 * route's own responsibility check — whose rejections are never reported (the
 * write's second check only ever sees what survived, so `rejected` is always
 * empty) — and an empty draft was written as a success. No guard drops these
 * turns' Observation: every realistic Observation survives (see the
 * neighbours below). A model error (429, 529, overloaded) is not swallowed by
 * the route — it fails the prefill — so it is replayed here too.
 * DRAFT_NEVER_BLANK_ENABLED reads those shapes, tries a failed or empty call
 * again up to twice (after 1 s, then 3 s), and otherwise writes the
 * Observation from the manager's own incident clause — the "Issue" the card
 * showed — recording every reason on a drafted event.
 *
 * Ported from the sibling app; the salon here is this app's own.
 *
 * The turns are the production turns, word for word, names invented. Only
 * identity, the model, the knowledge provider, the directory read and the
 * database are stand-ins.
 */

const DODGE = "loc-0309";

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
};

type ToolInput = { values?: unknown; checked?: unknown };
/*
 * One model reply: a tool call, a thrown error, a reply with no tool call at
 * all, or any of those after the call has taken `takesMs` of the clock.
 */
type ModelReply = ToolInput | { throws: unknown } | { noTool: true } | { takesMs: number; then: ModelReply };

const state = vi.hoisted(() => ({
  role: "salon_director",
  scope: null as unknown,
  /** What the drafting model returns, one entry per call; the last repeats. */
  drafts: [] as ModelReply[],
  calls: 0,
  /** Per employee (as the prompt names them): that employee's replies, in order; the last repeats. */
  scripts: {} as Record<string, ModelReply[]>,
  scriptCalls: {} as Record<string, number>,
  /** The drafted event that says why cannot be written. */
  failOutcomeInsert: false,
  /** How long the framework read takes before it fails. */
  frameworkTakesMs: 0,
  /** The pauses the route took before each retry. */
  pauses: [] as number[],
  framework: true,
  directory: [] as unknown[],
  manual: null as null | { chunks: unknown[] },
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => {
    const db = fakeSupabase(store);
    if (!state.failOutcomeInsert) return db;
    /* Only the outcome event fails: the write's own event still lands. */
    return new Proxy(db, {
      get(target, key, receiver) {
        if (key !== "from") return Reflect.get(target, key, receiver);
        return (table: string) => {
          const query = target.from(table);
          if (table !== "form_instance_events") return query;
          return new Proxy(query, {
            get(inner, name, innerReceiver) {
              if (name !== "insert") return Reflect.get(inner, name, innerReceiver);
              return (row: { detail?: Record<string, unknown> }) =>
                row && row.detail && "reasons" in row.detail
                  ? Promise.resolve({ data: null, error: { message: "insert refused" } })
                  : inner.insert(row as never);
            },
          });
        };
      },
    });
  },
}));

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
      create: async (request: { messages?: { content?: unknown }[] }) => {
        const prompt = String(request.messages?.[0]?.content ?? "");
        const scripted = Object.keys(state.scripts).find((name) => prompt.includes(`EMPLOYEE: ${name}`));
        let reply: Record<string, unknown>;
        if (scripted) {
          const turn = state.scriptCalls[scripted] ?? 0;
          state.scriptCalls[scripted] = turn + 1;
          const list = state.scripts[scripted]!;
          reply = (list[Math.min(turn, list.length - 1)] ?? {}) as Record<string, unknown>;
        } else {
          reply = (state.drafts[Math.min(state.calls, state.drafts.length - 1)] ?? {}) as Record<string, unknown>;
        }
        state.calls += 1;
        /* Let concurrent drafts interleave, as they do against a real API. */
        await new Promise((resolve) => setImmediate(resolve));
        while ("takesMs" in reply) {
          vi.setSystemTime(Date.now() + (reply.takesMs as number));
          reply = reply.then as Record<string, unknown>;
        }
        if ("throws" in reply) throw reply.throws;
        if ("noTool" in reply) {
          return { stop_reason: "end_turn", content: [{ type: "text", text: "I could not complete this form." }] };
        }
        return { stop_reason: "tool_use", content: [{ type: "tool_use", name: "write_form_fields", input: reply }] };
      },
    },
  }),
}));

vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async search() {
      return [];
    }
    async fetchRoleGrounding() {
      if (state.frameworkTakesMs) vi.setSystemTime(Date.now() + state.frameworkTakesMs);
      if (!state.framework) throw new Error("connection terminated");
      const row = (index: number, locator: string, content: string) => ({
        chunk_id: `pmf-${index}`,
        document_id: "doc-progression",
        document_title: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
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
          documentTitle: "PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
          matchedBy: "tag",
          rows: [
            row(0, "SECTION 2 – PERFORMANCE MANAGEMENT LADDER", "Solve the issue at the lowest appropriate level."),
            row(1, "10.7 Final operating rule", "Classify the issue before escalating."),
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
        matchedBy: "tag",
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

process.env.NEXT_PUBLIC_DEMO_MODE = "false";

/* The backoff is real in production; here each pause is recorded and skipped. */
vi.mock("@/lib/forms/draft-never-blank", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/draft-never-blank")>();
  return {
    ...actual,
    pauseBeforeRetry: async (ms: number) => {
      state.pauses.push(ms);
    },
  };
});

vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(state.directory as never, scope),
  };
});

const { ensureTemplateLibrary, listTemplateSummaries } = await import("@/lib/forms/repository");
const { proposeFormForTurn } = await import("@/lib/ai/form-proposal");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const instancesRoute = await import("./instances/route");
const instanceRoute = await import("./instances/[id]/route");
const draftRoute = await import("./instances/[id]/draft/route");

function joinOverview() {
  for (const row of store.form_instances ?? []) {
    const template = store.form_templates!.find((entry) => entry.id === row.template_id);
    const version = store.form_template_versions.find((entry) => entry.id === row.template_version_id);
    Object.assign(row, {
      form_date: row.form_date ?? "2026-10-22",
      template_key: template?.key,
      template_name: template?.name,
      layout_family: template?.layout_family,
      template_version: version?.version,
    });
  }
}

let lastDraft: Record<string, unknown> | null = null;
/* The draft route's own answer, kept even when it is an error. */
let lastDraftStatus: number | null = null;
let lastDraftBody: unknown = null;

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
  if (draft) {
    lastDraftStatus = response.status;
    lastDraftBody = body;
  }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  if (draft) lastDraft = body as Record<string, unknown>;
  return body;
}

async function review(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    values: { fieldKey: string; value: string | null; checked: string[]; filledBy?: string; provenance?: Record<string, unknown> }[];
  };
}

let sequence = 0;

/** The manager's one turn, through the real proposal flow, filed as the chat's Create draft does. */
async function createFromTurn(turn: string, employeeName: string) {
  const message: ChatMessage = { id: `m${(sequence += 1)}`, role: "user", content: turn, createdAt: "2026-10-26T15:00:00Z" };
  const response = await proposeFormForTurn({
    history: [],
    question: turn,
    questionMessageId: message.id,
    actor: { role: state.role as never, scope: state.scope as AccessScope },
    summaries: await listTemplateSummaries(),
    today: "2026-10-26",
    policyManual: async () => (state.manual?.chunks as never) ?? null,
  });
  expect(response?.formProposal, `no card for ${JSON.stringify(turn)}`).toBeTruthy();
  expect(response!.formProposal!.templateKey).toBe("dpoa");
  const messages: ChatMessage[] = [
    message,
    {
      id: `a${sequence}`,
      role: "assistant",
      content: response!.content,
      createdAt: "2026-10-26T15:00:01Z",
      formProposal: response!.formProposal,
    } as ChatMessage,
  ];
  /* The card as the manager files it: the employee and the salon they confirmed. */
  const proposal: ChatFormProposal = {
    ...response!.formProposal!,
    employeeName,
    locationId: DODGE,
    status: "ready",
    supportsInlineDraft: true,
  };
  lastDraft = null;
  const created = await createInlineForm({ proposal, messages, call, onCreated: () => {} });
  const form = await review(created.reference.instanceId);
  const events = (store.form_instance_events ?? []).filter(
    (event) => event.instance_id === created.reference.instanceId && event.kind === "drafted",
  ) as { detail: Record<string, unknown> }[];
  return {
    created,
    form,
    events,
    /* The event that says why, when there is one. */
    outcome: events.map((event) => event.detail).find((detail) => Array.isArray(detail.reasons)) ?? null,
    draft: lastDraft as Record<string, unknown> | null,
    value: (key: string) => (form.values.find((entry) => entry.fieldKey === key)?.value ?? "").trim(),
  };
}

/* The burst's six, invented too: Create pressed on all six cards in the same second. */
const BURST_PEOPLE = [
  { first: "Corisande", last: "Vell" },
  { first: "Ambrose", last: "Quillet" },
  { first: "Isaura", last: "Penhallow" },
  { first: "Lucan", last: "Threlkeld" },
  { first: "Ottoline", last: "Carrow" },
  { first: "Bastian", last: "Kilcoyne" },
];

/* Invented people only; neither is on any directory. */
const SHE = { lower: "odalys merriweather", cap: "Odalys Merriweather", first: "Odalys" };
const HE = { lower: "thane pellingham", cap: "Thane Pellingham", first: "Thane" };
const DIRECTORY = [
  { id: "e-1", firstName: "Odalys", lastName: "Merriweather", preferredFirstName: null, employmentStatus: "active", salonIds: [DODGE] },
  { id: "e-2", firstName: "Thane", lastName: "Pellingham", preferredFirstName: null, employmentStatus: "active", salonIds: [DODGE] },
  ...BURST_PEOPLE.map((person, index) => ({
    id: `e-${index + 3}`,
    firstName: person.first,
    lastName: person.last,
    preferredFirstName: null,
    employmentStatus: "active",
    salonIds: [DODGE],
  })),
];

const ATTENDANCE_CHUNK = {
  chunkIndex: 33,
  chunkId: "c-33",
  locator: "Page 14",
  page: 15,
  printedPage: 14,
  sections: [{ heading: "Attendance", page: 14 }],
  section: "Attendance",
  content: "Attendance\nIt is the responsibility of each employee to know his or her work schedule and to always be on\ntime.",
};
const STANDARDS_OF_CONDUCT_CHUNK = {
  chunkIndex: 30,
  chunkId: "c-30",
  locator: "Page 12",
  page: 13,
  printedPage: 12,
  sections: [{ heading: "Standards of Conduct", page: 12 }],
  section: "Standards of Conduct",
  content:
    "Standards of Conduct\nThe Company expects Employees to follow rules of conduct that will protect the interests and\nsafety of all customers, Employees, and The Company.\nThe following are examples (non-inclusive list) of infractions that may result in disciplinary\naction:\no Failing to follow the policies and procedures of The Company",
};
const MANUAL = { chunks: [STANDARDS_OF_CONDUCT_CHUNK, ATTENDANCE_CHUNK] };

/*
 * THE PRODUCTION TURNS, word for word, names invented — all lowercase as typed,
 * and in sentence case (the third is the tester's own sentence-case turn), each
 * with the name lowercase and Capitalized.
 */
type Case = { label: string; turn: string; person: typeof SHE; incident: "ncns" | "product"; observed: string };
const CASES: Case[] = [
  {
    label: "lowercase, no call no show",
    turn: `create a ca for ${SHE.lower} at dodge, ne. she was a no call no show on 10/22`,
    person: SHE,
    incident: "ncns",
    observed: "Observed:\nOdalys was a no call no show on 10/22.",
  },
  {
    label: "lowercase, took product",
    turn: `create a ca for ${SHE.lower} at dodge, ne. she took product without paying on 10/22`,
    person: SHE,
    incident: "product",
    observed: "Observed:\nOdalys took product without paying on 10/22.",
  },
  {
    label: "sentence case, no call no show (the tester's turn)",
    turn: `Create a CA for ${HE.cap} at Dodge, NE. He was a no call no show on 10/22.`,
    person: HE,
    incident: "ncns",
    observed: "Observed:\nThane was a no call no show on 10/22.",
  },
  {
    label: "sentence case, took product",
    turn: `Create a CA for ${SHE.cap} at Dodge, NE. She took product without paying on 10/22.`,
    person: SHE,
    incident: "product",
    observed: "Observed:\nOdalys took product without paying on 10/22.",
  },
  {
    label: "sentence case with the name lowercase, no call no show",
    turn: `Create a CA for ${HE.lower} at Dodge, NE. He was a no call no show on 10/22.`,
    person: HE,
    incident: "ncns",
    observed: "Observed:\nThane was a no call no show on 10/22.",
  },
  {
    label: "lowercase with the name Capitalized, took product",
    turn: `create a ca for ${SHE.cap} at dodge, ne. she took product without paying on 10/22`,
    person: SHE,
    incident: "product",
    observed: "Observed:\nOdalys took product without paying on 10/22.",
  },
];

/* What the model wrote when the draft was not blank, per incident. */
const MODEL_OBSERVATION = {
  ncns: (first: string) =>
    `Observed:\n${first} was a no call no show for the scheduled shift on 10/22.\n\nExpectation:\nEmployees are expected to work every scheduled shift or notify management before it starts.\n\nGoing Forward:\n${first} should attend every scheduled shift or call before it starts.`,
  product: (first: string) =>
    `Observed:\n${first} took product without paying on 10/22.\n\nExpectation:\nAll product is expected to be paid for before it leaves the salon.\n\nGoing Forward:\n${first} should pay for any product before taking it.`,
};
const TICK = { ncns: ["absenteeism"], product: ["standards_of_conduct"] };

/* The model errors a shared quota answers with under load, as the SDK throws them. */
const MODEL_ERRORS: Record<string, { error: () => unknown; reason: string }> = {
  "429 rate limited": {
    error: () => APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "Rate limited" } }, undefined, new Headers()),
    reason: "model_error 429 rate_limit_error",
  },
  "529 overloaded": {
    error: () => APIError.generate(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers()),
    reason: "model_error 529 overloaded_error",
  },
  "overloaded, no status": {
    error: () => new APIError(undefined, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, undefined, "overloaded_error"),
    reason: "model_error overloaded_error",
  },
};

/* The blank shapes the model's tool call came back in. */
const BLANK_SHAPES: Record<string, (c: Case) => ToolInput> = {
  "empty values": () => ({ values: {}, checked: {} }),
  "omitted values": () => ({}),
  "values as a JSON string": (c) => ({ values: JSON.stringify({ observation: MODEL_OBSERVATION[c.incident](c.person.first) }) }),
  "one object per section": (c) => ({
    values: {
      observation: {
        Observed: MODEL_OBSERVATION[c.incident](c.person.first).split("\n")[1],
        Expectation: "Employees are expected to meet the standard.",
      },
    },
  }),
  "keyed by the field's label": (c) => ({ values: { "Observation of Offense": MODEL_OBSERVATION[c.incident](c.person.first) } }),
};

const FLAG = "DRAFT_NEVER_BLANK_ENABLED";
const PRODUCTION_FLAGS = ["TERSE_SLOT_READ_ENABLED"];
const saved = new Map<string, string | undefined>();

beforeEach(async () => {
  for (const name of [FLAG, ...PRODUCTION_FLAGS]) saved.set(name, process.env[name]);
  delete process.env[FLAG];
  for (const name of PRODUCTION_FLAGS) process.env[name] = "true";
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  state.role = "salon_director";
  state.scope = { level: "salon", primaryAreaId: DODGE, alsoCoversAreaIds: [] };
  state.drafts = [];
  state.calls = 0;
  state.pauses = [];
  state.framework = true;
  state.frameworkTakesMs = 0;
  state.scripts = {};
  state.scriptCalls = {};
  state.failOutcomeInsert = false;
  state.directory = DIRECTORY;
  state.manual = MANUAL;
  sequence = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:00:00Z"));
  await ensureTemplateLibrary("system");
});

afterEach(() => {
  vi.useRealTimers();
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe.each(CASES)("$label", (c) => {
  describe("flag off: today's behaviour, pinned", () => {
    it("an empty tool call is filed blank, recorded as drafted with no fields and nothing rejected", async () => {
      state.drafts = [{ values: {}, checked: {} }];
      const { events, value } = await createFromTurn(c.turn, c.person.cap);
      expect(state.calls).toBe(1);
      expect(value("observation")).toBe("");
      expect(events.map((event) => event.detail)).toContainEqual({ fields: [], rejected: [] });
    });

    it.each(Object.keys(MODEL_ERRORS))("a model error (%s) fails the prefill: no drafted event, blank", async (name) => {
      state.drafts = [{ throws: MODEL_ERRORS[name]!.error() }];
      const { created, events, value } = await createFromTurn(c.turn, c.person.cap);
      expect(state.calls).toBe(1);
      expect(created.draftWarning).toMatch(/couldn't prefill/);
      expect(value("observation")).toBe("");
      expect(events).toEqual([]);
    });

    it("a JSON-encoded `values` is dropped without a word: blank", async () => {
      state.drafts = [BLANK_SHAPES["values as a JSON string"]!(c)];
      const { events, value } = await createFromTurn(c.turn, c.person.cap);
      expect(value("observation")).toBe("");
      expect(events.map((event) => event.detail)).toContainEqual({ fields: [], rejected: [] });
    });
  });

  describe("flag on: never blank", () => {
    beforeEach(() => {
      process.env[FLAG] = "true";
    });

    it.each(Object.keys(BLANK_SHAPES))("%s, every time: the Observation is the manager's own incident clause", async (shape) => {
      state.drafts = [BLANK_SHAPES[shape]!(c)];
      const { events, value, draft, outcome } = await createFromTurn(c.turn, c.person.cap);
      const observation = value("observation");
      expect(observation).not.toBe("");
      if (shape === "empty values" || shape === "omitted values") {
        /* Tried twice more, after 1 s and 3 s, then the manager's words. */
        expect(state.calls).toBe(3);
        expect(state.pauses).toEqual([1000, 3000]);
        expect(observation).toBe(c.observed);
        expect(draft?.fallback).toBe("manager_words");
        expect(outcome).toMatchObject({ fallback: "manager_words", field: "observation", attempts: 3 });
        expect(outcome!.reasons).toEqual(expect.arrayContaining(["empty_tool_call"]));
      } else {
        /* The model's own text, read from the shape it came in: no retry, no fallback. */
        expect(state.calls).toBe(1);
        expect(observation).toContain(`${c.person.first} `);
        expect(observation).toMatch(c.incident === "ncns" ? /no call no show/ : /took product without paying/);
        expect(draft?.fallback).toBeUndefined();
      }
      const fields = events.flatMap((event) => (Array.isArray(event.detail.fields) ? event.detail.fields : []));
      expect(fields).toContain("observation");
    });

    it.each(Object.keys(MODEL_ERRORS))("a model error (%s), then an answer: the answer is the draft, and the error is recorded", async (name) => {
      state.drafts = [
        { throws: MODEL_ERRORS[name]!.error() },
        { values: { observation: MODEL_OBSERVATION[c.incident](c.person.first) }, checked: { offense_type: TICK[c.incident] } },
      ];
      const { value, outcome, created } = await createFromTurn(c.turn, c.person.cap);
      expect(created.draftWarning).toBeNull();
      expect(state.calls).toBe(2);
      expect(state.pauses).toEqual([1000]);
      expect(value("observation")).toBe(MODEL_OBSERVATION[c.incident](c.person.first));
      expect(value("policy_violated")).not.toBe("");
      expect(outcome).toMatchObject({ attempts: 2, reasons: [MODEL_ERRORS[name]!.reason] });
    });

    it.each(Object.keys(MODEL_ERRORS))("a model error (%s) every time: the manager's words, never blank, every error recorded", async (name) => {
      state.drafts = [{ throws: MODEL_ERRORS[name]!.error() }];
      const { value, outcome, draft, created } = await createFromTurn(c.turn, c.person.cap);
      expect(created.draftWarning).toBeNull();
      expect(state.calls).toBe(3);
      expect(state.pauses).toEqual([1000, 3000]);
      expect(value("observation")).toBe(c.observed);
      expect(draft?.fallback).toBe("manager_words");
      expect(outcome).toMatchObject({ fallback: "manager_words", field: "observation", attempts: 3 });
      expect(outcome!.reasons).toEqual([MODEL_ERRORS[name]!.reason, MODEL_ERRORS[name]!.reason, MODEL_ERRORS[name]!.reason]);
    });

    it("an empty first call and a good retry: the retry's text is used", async () => {
      state.drafts = [{ values: {} }, { values: { observation: MODEL_OBSERVATION[c.incident](c.person.first) }, checked: { offense_type: TICK[c.incident] } }];
      const { value, draft } = await createFromTurn(c.turn, c.person.cap);
      expect(state.calls).toBe(2);
      expect(value("observation")).toBe(MODEL_OBSERVATION[c.incident](c.person.first));
      expect(draft?.fallback).toBeUndefined();
      expect(draft?.retried).toBe(true);
    });

    it("a tick but no text: retried, then the manager's words beside the policy", async () => {
      state.drafts = [{ values: {}, checked: { offense_type: TICK[c.incident] } }];
      const { value } = await createFromTurn(c.turn, c.person.cap);
      expect(state.calls).toBe(3);
      expect(value("observation")).toBe(c.observed);
      expect(value("policy_violated")).not.toBe("");
    });

    it("the fallback invents nothing: every word is the manager's, or the employee's first name", async () => {
      state.drafts = [{ values: {} }];
      const { value } = await createFromTurn(c.turn, c.person.cap);
      const said = new Set(c.turn.toLowerCase().match(/[a-z0-9/]+/g) ?? []);
      const words = value("observation").replace(/^Observed:\s*/, "").toLowerCase().match(/[a-z0-9/]+/g) ?? [];
      expect(words.length).toBeGreaterThan(2);
      for (const word of words) expect(said.has(word) || word === c.person.first.toLowerCase(), word).toBe(true);
    });

    /* Neighbours that must keep working. */
    it("a normal draft still uses the model's text, with one model call", async () => {
      state.drafts = [{ values: { observation: MODEL_OBSERVATION[c.incident](c.person.first) }, checked: { offense_type: TICK[c.incident] } }];
      const { value, draft, outcome } = await createFromTurn(c.turn, c.person.cap);
      expect(state.calls).toBe(1);
      expect(state.pauses).toEqual([]);
      expect(value("observation")).toBe(MODEL_OBSERVATION[c.incident](c.person.first));
      expect(draft?.fallback).toBeUndefined();
      expect(draft?.retried).toBeUndefined();
      expect(outcome).toBeNull();
    });

    it("a short model Observation (\"No call no show on 10/22.\") is kept as written", async () => {
      const short = c.incident === "ncns" ? "No call no show on 10/22." : "Took product without paying on 10/22.";
      state.drafts = [{ values: { observation: short }, checked: { offense_type: TICK[c.incident] } }];
      const { value } = await createFromTurn(c.turn, c.person.cap);
      expect(state.calls).toBe(1);
      expect(value("observation")).toBe(short);
    });

    it("a policy withheld when retrieval finds nothing is still withheld", async () => {
      state.manual = null;
      state.drafts = [{ values: {} }];
      const { value, draft } = await createFromTurn(c.turn, c.person.cap);
      expect(value("observation")).toBe(c.observed);
      expect(value("policy_language")).toBe("");
      expect(draft?.withheld).toContain("policy_language");
    });
  });
});

/*
 * NEVER-BREAK: a draft that fills is byte-identical with the flag on and off —
 * the route's response, every stored line (value, ticks, who filled it, its
 * provenance) and every event.
 */
describe("never-break: a draft that fills is identical with the flag on and off", () => {
  async function snapshot(c: Case, on: boolean) {
    for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
    await ensureTemplateLibrary("system");
    sequence = 0;
    state.calls = 0;
    if (on) process.env[FLAG] = "true";
    else delete process.env[FLAG];
    state.drafts = [{ values: { observation: MODEL_OBSERVATION[c.incident](c.person.first) }, checked: { offense_type: TICK[c.incident] } }];
    const { form, events, draft } = await createFromTurn(c.turn, c.person.cap);
    const strip = (rows: Record<string, unknown>[]) =>
      rows.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !["id", "instance_id", "created_at", "updated_at"].includes(key))),
      );
    return JSON.stringify({
      draft,
      values: form.values.map(({ fieldKey, value, checked, provenance }) => ({ fieldKey, value, checked, provenance })),
      stored: strip((store.form_instance_values ?? []) as Record<string, unknown>[]),
      events: events.map((event) => event.detail),
      calls: state.calls,
    });
  }

  it.each(CASES)("$label", async (c) => {
    const off = await snapshot(c, false);
    const on = await snapshot(c, true);
    expect(on).toBe(off);
    expect(JSON.parse(off).values.find((row: { fieldKey: string }) => row.fieldKey === "observation").value).toBe(
      MODEL_OBSERVATION[c.incident](c.person.first),
    );
  });
});

/*
 * A FAILED READ BEFORE THE MODEL. The framework a Corrective Action is
 * governed by is read first, and a read that fails withholds the draft. Under
 * load that read is tried again; still failing, the draft is withheld as
 * before, and the reason is on a drafted event instead of nowhere.
 */
describe("the governing framework's read fails", () => {
  const c = CASES[0]!;

  it("flag off: withheld, with no event", async () => {
    state.framework = false;
    state.drafts = [{ values: { observation: MODEL_OBSERVATION.ncns(c.person.first) } }];
    const { value, events } = await createFromTurn(c.turn, c.person.cap);
    expect(state.calls).toBe(0);
    expect(value("observation")).toBe("");
    expect(events).toEqual([]);
  });

  it("flag on: read again after 1 s and 3 s; still failing, withheld with the reason recorded", async () => {
    process.env[FLAG] = "true";
    state.framework = false;
    state.drafts = [{ values: { observation: MODEL_OBSERVATION.ncns(c.person.first) } }];
    const { value, outcome } = await createFromTurn(c.turn, c.person.cap);
    expect(state.pauses).toEqual([1000, 3000]);
    expect(state.calls).toBe(0);
    expect(value("observation")).toBe("");
    expect(outcome).toEqual({ attempts: 3, reasons: ["framework_read_failed"] });
  });
});

/*
 * QA-2, 26 Oct 2026: the retries are bounded by time as well as by count; the
 * outcome event can never fail a written draft; and the production shape — six
 * Create presses in the same second — ends with no blank form.
 */
describe("the time budget (80 s from the request's start)", () => {
  const c = CASES[0]!;
  const GOOD = { values: { observation: MODEL_OBSERVATION.ncns(c.person.first) }, checked: { offense_type: TICK.ncns } };

  beforeEach(() => {
    process.env[FLAG] = "true";
  });

  it("a slow first call (81 s) that came back empty: no retry, the manager's words, the reason recorded", async () => {
    state.drafts = [{ takesMs: 81_000, then: { values: {} } }, GOOD];
    const { value, outcome } = await createFromTurn(c.turn, c.person.cap);
    expect(state.calls).toBe(1);
    expect(state.pauses).toEqual([]);
    expect(value("observation")).toBe(c.observed);
    expect(outcome).toMatchObject({ fallback: "manager_words", attempts: 1 });
    expect(outcome!.reasons).toEqual(expect.arrayContaining(["empty_tool_call", "time_budget_exceeded"]));
  });

  it("a slow first call (81 s) that failed: no retry, the manager's words", async () => {
    state.drafts = [{ takesMs: 81_000, then: { throws: MODEL_ERRORS["529 overloaded"]!.error() } }, GOOD];
    const { value, outcome, created } = await createFromTurn(c.turn, c.person.cap);
    expect(created.draftWarning).toBeNull();
    expect(state.calls).toBe(1);
    expect(value("observation")).toBe(c.observed);
    expect(outcome!.reasons).toEqual(["model_error 529 overloaded_error", "time_budget_exceeded"]);
  });

  it("control: a first call of 79 s is still retried", async () => {
    state.drafts = [{ takesMs: 79_000, then: { values: {} } }, GOOD];
    const { value } = await createFromTurn(c.turn, c.person.cap);
    expect(state.calls).toBe(2);
    expect(value("observation")).toBe(MODEL_OBSERVATION.ncns(c.person.first));
  });

  it("a framework read that fails after 81 s is not read again", async () => {
    state.framework = false;
    state.frameworkTakesMs = 81_000;
    const { outcome } = await createFromTurn(c.turn, c.person.cap);
    expect(state.pauses).toEqual([]);
    expect(outcome).toEqual({ attempts: 1, reasons: ["framework_read_failed", "time_budget_exceeded"] });
  });
});

describe("the outcome event cannot be written", () => {
  it("the draft already written still returns 200 with its values, and the failure is logged", async () => {
    process.env[FLAG] = "true";
    state.failOutcomeInsert = true;
    state.drafts = [{ values: {} }];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const c = CASES[0]!;
      const { value, draft, created, outcome } = await createFromTurn(c.turn, c.person.cap);
      expect(created.draftWarning).toBeNull();
      expect(draft).not.toBeNull();
      expect((draft!.values as Record<string, string>).observation).toBe(c.observed);
      expect(value("observation")).toBe(c.observed);
      expect(outcome).toBeNull();
      expect(logged.mock.calls.map((args) => String(args[0]))).toEqual(
        expect.arrayContaining([expect.stringMatching(/could not record the drafted event/)]),
      );
    } finally {
      logged.mockRestore();
    }
  });
});

describe("six Create presses at once (the production burst)", () => {
  const turnFor = (person: { first: string; last: string }) =>
    `create a ca for ${person.first.toLowerCase()} ${person.last.toLowerCase()} at dodge, ne. she was a no call no show on 10/22`;
  const good = (first: string) => ({ values: { observation: MODEL_OBSERVATION.ncns(first) }, checked: { offense_type: TICK.ncns } });
  /* What the model gives each of the six: some blank, some not; a blank that repeats stays blank. */
  const SCRIPT = (person: { first: string }, index: number) =>
    [
      [{ values: {} }, good(person.first)],
      [{ noTool: true }, good(person.first)],
      [good(person.first)],
      [{ values: {} }],
      [{ noTool: true }],
      [good(person.first)],
    ][index]! as ModelReply[];
  const BLANK_FIRST = new Set([0, 1, 3, 4]);

  async function burst() {
    const prepared = [];
    for (const person of BURST_PEOPLE) {
      const turn = turnFor(person);
      const message: ChatMessage = { id: `m${(sequence += 1)}`, role: "user", content: turn, createdAt: "2026-10-26T15:00:00Z" };
      const response = await proposeFormForTurn({
        history: [],
        question: turn,
        questionMessageId: message.id,
        actor: { role: state.role as never, scope: state.scope as AccessScope },
        summaries: await listTemplateSummaries(),
        today: "2026-10-26",
        policyManual: async () => (state.manual?.chunks as never) ?? null,
      });
      expect(response?.formProposal?.templateKey).toBe("dpoa");
      const messages: ChatMessage[] = [
        message,
        { id: `a${sequence}`, role: "assistant", content: response!.content, createdAt: "2026-10-26T15:00:01Z", formProposal: response!.formProposal } as ChatMessage,
      ];
      const proposal: ChatFormProposal = {
        ...response!.formProposal!,
        employeeName: `${person.first} ${person.last}`,
        locationId: DODGE,
        status: "ready",
        supportsInlineDraft: true,
      };
      prepared.push({ proposal, messages });
    }
    const created = await Promise.all(
      prepared.map(({ proposal, messages }) => createInlineForm({ proposal, messages, call, onCreated: () => {} })),
    );
    return Promise.all(
      created.map(async (entry) => {
        const form = await review(entry.reference.instanceId);
        const events = (store.form_instance_events ?? [])
          .filter((event) => event.instance_id === entry.reference.instanceId && event.kind === "drafted")
          .map((event) => (event as { detail: Record<string, unknown> }).detail);
        return {
          warning: entry.draftWarning,
          observation: (form.values.find((row) => row.fieldKey === "observation")?.value ?? "").trim(),
          events,
          outcome: events.find((detail) => Array.isArray(detail.reasons)) ?? null,
        };
      }),
    );
  }

  beforeEach(() => {
    BURST_PEOPLE.forEach((person, index) => {
      state.scripts[`${person.first} ${person.last}`] = SCRIPT(person, index);
    });
  });

  it("flag on: none ends blank; each fills or uses the manager's words, and every blank attempt records its reason", async () => {
    process.env[FLAG] = "true";
    const results = await burst();
    results.forEach((result, index) => {
      const person = BURST_PEOPLE[index]!;
      expect(result.warning, person.first).toBeNull();
      expect(result.observation, person.first).not.toBe("");
      const blankAttempts = Math.min(state.scriptCalls[`${person.first} ${person.last}`]!, index === 3 || index === 4 ? 3 : 1);
      if (index === 2 || index === 5) {
        expect(result.observation).toBe(MODEL_OBSERVATION.ncns(person.first));
        expect(result.outcome).toBeNull();
      } else if (index === 0 || index === 1) {
        expect(result.observation).toBe(MODEL_OBSERVATION.ncns(person.first));
      } else {
        expect(result.observation).toBe(`Observed:\n${person.first} was a no call no show on 10/22.`);
        expect(result.outcome).toMatchObject({ fallback: "manager_words", attempts: 3 });
      }
      if (BLANK_FIRST.has(index)) {
        const recorded = (result.outcome!.reasons as string[]).filter((reason) => /^(empty_tool_call|no_tool_call)/.test(reason));
        expect(recorded.length, person.first).toBe(blankAttempts);
        expect(recorded[0]).toBe(index === 1 || index === 4 ? "no_tool_call stop_reason=end_turn" : "empty_tool_call");
      }
    });
  });

  it("flag off: the ones the model left blank are filed blank, as on main", async () => {
    const results = await burst();
    results.forEach((result, index) => {
      const person = BURST_PEOPLE[index]!;
      if (BLANK_FIRST.has(index)) {
        expect(result.observation, person.first).toBe("");
        expect(result.events, person.first).toContainEqual({ fields: [], rejected: [] });
      } else {
        expect(result.observation, person.first).toBe(MODEL_OBSERVATION.ncns(person.first));
      }
      expect(result.outcome).toBeNull();
    });
    expect(Object.values(state.scriptCalls).every((count) => count === 1)).toBe(true);
  });
});

/*
 * QA-2, 26 Oct 2026: an account told only as what did not happen — "She never
 * opened the salon on time." — was read as no account at all, so the draft
 * got no retry and no fallback and could still end blank. "did not", "didn't"
 * and "no call" are pinned beside it.
 */
describe("an account told as what did not happen", () => {
  const NEGATED: { label: string; turn: string; observed: string }[] = [
    {
      label: "lowercase, never (salon)",
      turn: "create a ca for odalys merriweather at dodge, ne. she never opened the salon on time",
      observed: "Observed:\nOdalys never opened the salon on time.",
    },
    {
      label: "Sentence case, never (salon)",
      turn: "Create a CA for Odalys Merriweather at Dodge, NE. She never opened the salon on time.",
      observed: "Observed:\nOdalys never opened the salon on time.",
    },
    {
      label: "lowercase, did not (no state: \"<store>, NE. ... did not\" is refused at Create, a separate bug)",
      turn: "create a ca for odalys merriweather at dodge. she did not clock in on 10/22",
      observed: "Observed:\nOdalys did not clock in on 10/22.",
    },
    {
      label: "Sentence case, didn't",
      turn: "Create a CA for Odalys Merriweather at Dodge, NE. She didn't clock in on 10/22.",
      observed: "Observed:\nOdalys didn't clock in on 10/22.",
    },
    {
      label: "lowercase, no call",
      turn: "create a ca for odalys merriweather at dodge, ne. she was a no call on 10/22",
      observed: "Observed:\nOdalys was a no call on 10/22.",
    },
  ];

  describe.each(NEGATED)("$label", ({ turn, observed }) => {
    it("flag on: never blank — retried, then the manager's words", async () => {
      process.env[FLAG] = "true";
      state.drafts = [{ values: {} }];
      const { value, outcome } = await createFromTurn(turn, SHE.cap);
      expect(state.calls).toBe(3);
      expect(value("observation")).toBe(observed);
      expect(outcome).toMatchObject({ fallback: "manager_words", field: "observation", attempts: 3 });
    });

    it("flag off: filed blank, as on main", async () => {
      state.drafts = [{ values: {} }];
      const { value, events } = await createFromTurn(turn, SHE.cap);
      expect(state.calls).toBe(1);
      expect(value("observation")).toBe("");
      expect(events.map((event) => event.detail)).toContainEqual({ fields: [], rejected: [] });
    });
  });
});

/*
 * QA-2, 26 Oct 2026, on the account the fallback is written from:
 *   - a negation that clears the employee, or is only conversation, is NOT an
 *     account: no retry for it, and no Observation made of it;
 *   - two incidents in one turn are both kept, in the manager's words.
 */
describe("what counts as the manager's account (flag on)", () => {
  const LEAD = {
    lowercase: "create a ca for odalys merriweather at dodge, ne. ",
    "Sentence case": "Create a CA for Odalys Merriweather at Dodge, NE. ",
  } as const;
  const lower = (text: string) => text.toLowerCase();

  beforeEach(() => {
    process.env[FLAG] = "true";
  });

  const NOT_AN_ACCOUNT = [
    "She never had a problem with attendance, great employee.",
    "She was never late.",
    "She didn't do anything wrong.",
    "Never mind.",
    "I never said she was late.",
  ];
  describe.each(NOT_AN_ACCOUNT.flatMap((sentence) => [
    { label: `lowercase: ${lower(sentence)}`, turn: `${LEAD.lowercase}${lower(sentence).replace(/\.$/, "")}` },
    { label: `Sentence case: ${sentence}`, turn: `${LEAD["Sentence case"]}${sentence}` },
  ]))("$label", ({ turn }) => {
    it("is not an account: no retry, and no Observation is made of it", async () => {
      state.drafts = [{ values: {} }];
      const { value, outcome, draft } = await createFromTurn(turn, SHE.cap);
      expect(state.calls).toBe(1);
      expect(state.pauses).toEqual([]);
      expect(value("observation")).toBe("");
      expect(draft?.fallback).toBeUndefined();
      /* Still not silent: the empty call is recorded. */
      expect(outcome).toEqual({ attempts: 1, reasons: ["empty_tool_call"] });
    });
  });

  const ACCOUNTS: { sentence: string; observed: string }[] = [
    { sentence: "She never opened the salon on time. She also left early on 10/20.", observed: "Observed:\nOdalys never opened the salon on time. Odalys also left early on 10/20." },
    { sentence: "She never clocked in on 10/22.", observed: "Observed:\nOdalys never clocked in on 10/22." },
    { sentence: "She never showed up on 10/22.", observed: "Observed:\nOdalys never showed up on 10/22." },
  ];
  describe.each(ACCOUNTS.flatMap(({ sentence, observed }) => [
    { label: `lowercase: ${lower(sentence)}`, turn: `${LEAD.lowercase}${lower(sentence).replace(/\.$/, "")}`, observed },
    { label: `Sentence case: ${sentence}`, turn: `${LEAD["Sentence case"]}${sentence}`, observed },
  ]))("$label", ({ turn, observed }) => {
    it("is the account: retried, then the manager's words, every incident kept", async () => {
      state.drafts = [{ values: {} }];
      const { value, outcome } = await createFromTurn(turn, SHE.cap);
      expect(state.calls).toBe(3);
      expect(value("observation")).toBe(observed);
      expect(outcome).toMatchObject({ fallback: "manager_words", field: "observation", attempts: 3 });
    });
  });
});

/*
 * FLAG OFF IS MAIN, EXACTLY. The model call and the prose guards now run
 * through closures for every draft, flag or no flag. Driven with the flag off,
 * a filled, an empty, a malformed and a failed model call give byte for byte
 * what origin/main (3a0d9012) gave: the route's status and body, the card's
 * warning, every stored line with its provenance, and every event. The golden
 * values were captured by running this same test against origin/main.
 */
describe("flag off is byte-identical to main", () => {
  const c = CASES[0]!;
  const DRAFTS: Record<string, ModelReply> = {
    filled: { values: { observation: MODEL_OBSERVATION.ncns(c.person.first) }, checked: { offense_type: TICK.ncns } },
    empty: { values: {}, checked: {} },
    malformed: { values: JSON.stringify({ observation: MODEL_OBSERVATION.ncns(c.person.first) }) },
    "model error": { throws: MODEL_ERRORS["529 overloaded"]!.error() },
  };
  const GOLDEN: Record<string, string> = {
    "filled":
      "{\"status\":200,\"body\":{\"values\":{\"observation\":\"Observed:\\nOdalys was a no call no show for the scheduled shift on 10/22.\\n\\nExpectation:\\nEmployees are expected to work every scheduled shift or notify management before it starts.\\n\\nGoing Forward:\\nOdalys should attend every scheduled shift or call before it starts.\",\"policy_violated\":\"Absenteeism\",\"policy_language\":\"It is the responsibility of each employee to know his or her work schedule and to always be on\\ntime.\\n\\nSource: JBA Policy Manual \u2014 Attendance, p. 14\",\"action_plan\":\"Management will review the Attendance policy with Odalys. Future policy violations may result in additional corrective action up to and including termination of employment.\"},\"checked\":{\"offense_type\":[\"absenteeism\"]},\"withheld\":[],\"rejected\":[],\"placeholders\":{\"cleaned\":[],\"emptied\":[]},\"narrative\":{\"adjusted\":[],\"emptied\":[]},\"policyClaims\":{\"adjusted\":[],\"emptied\":[]},\"policyRequirements\":{\"adjusted\":[],\"replaced\":[]},\"policyAttributions\":{\"adjusted\":[],\"emptied\":[]},\"datesCorrected\":[],\"policyDerived\":[\"policy_violated\",\"policy_language\"],\"timeframeEmptied\":[],\"followUpEmptied\":[],\"framingAdjusted\":[],\"employeeNamed\":[],\"priorActions\":{\"added\":[],\"removed\":[]},\"notice\":\"Woven does not see a matching policy in the knowledge base, so the policy fields are left for you to complete.\",\"sensitiveRefused\":{},\"caPolicy\":{\"applied\":false,\"reason\":\"no_suggestion\",\"ambiguous\":null},\"sources\":[],\"statedFacts\":[]},\"warning\":null,\"values\":[{\"fieldKey\":\"employee_name\",\"value\":\"Odalys Merriweather\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"form_date\",\"value\":\"2026-10-22\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"location\",\"value\":\"NE Kearney\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"observation\",\"value\":\"Observed:\\nOdalys was a no call no show for the scheduled shift on 10/22.\\n\\nExpectation:\\nEmployees are expected to work every scheduled shift or notify management before it starts.\\n\\nGoing Forward:\\nOdalys should attend every scheduled shift or call before it starts.\",\"checked\":[],\"filledBy\":\"ai\",\"provenance\":{}},{\"fieldKey\":\"policy_violated\",\"value\":\"Absenteeism\",\"checked\":[],\"filledBy\":\"ai\",\"provenance\":{\"grounded\":false,\"derived\":true,\"source\":\"offense_type\",\"verified\":true}},{\"fieldKey\":\"policy_language\",\"value\":\"It is the responsibility of each employee to know his or her work schedule and to always be on\\ntime.\\n\\nSource: JBA Policy Manual \u2014 Attendance, p. 14\",\"checked\":[],\"filledBy\":\"ai\",\"provenance\":{\"grounded\":true,\"verified\":true,\"source\":\"official_policy_manual\",\"matchedBy\":\"tag\",\"ownerConfirmed\":true,\"documentId\":\"doc-manual\",\"documentTitle\":\"JBA Policy Manual\",\"sections\":[{\"locator\":\"Attendance\",\"page\":14,\"foundBy\":\"sheet_heading\",\"chunkIndex\":33}],\"citation\":[{\"policyText\":\"It is the responsibility of each employee to know his or her work schedule and to always be on\\ntime.\",\"documentTitle\":\"JBA Policy Manual\",\"sectionTitle\":\"Attendance\",\"pageLabel\":\"14\",\"documentId\":\"doc-manual\",\"source\":\"official_policy_manual\"}]}},{\"fieldKey\":\"action_plan\",\"value\":\"Management will review the Attendance policy with Odalys. Future policy violations may result in additional corrective action up to and including termination of employment.\",\"checked\":[],\"filledBy\":\"ai\",\"provenance\":{\"source\":\"corrective_action_plan\",\"policySource\":\"direct_policy\",\"policies\":[\"Attendance\"],\"payroll\":null}},{\"fieldKey\":\"offense_type\",\"value\":null,\"checked\":[\"absenteeism\"],\"filledBy\":\"ai\",\"provenance\":{}}],\"events\":[{\"fields\":[\"observation\",\"policy_violated\",\"policy_language\",\"action_plan\"],\"rejected\":[]}],\"calls\":1}",
    "empty":
      "{\"status\":200,\"body\":{\"values\":{},\"checked\":{},\"withheld\":[\"policy_violated\",\"policy_language\"],\"rejected\":[],\"placeholders\":{\"cleaned\":[],\"emptied\":[]},\"narrative\":{\"adjusted\":[],\"emptied\":[]},\"policyClaims\":{\"adjusted\":[],\"emptied\":[]},\"policyRequirements\":{\"adjusted\":[],\"replaced\":[]},\"policyAttributions\":{\"adjusted\":[],\"emptied\":[]},\"datesCorrected\":[],\"policyDerived\":[],\"timeframeEmptied\":[],\"followUpEmptied\":[],\"framingAdjusted\":[],\"employeeNamed\":[],\"priorActions\":{\"added\":[],\"removed\":[]},\"notice\":\"Woven does not see a matching policy in the knowledge base, so the policy fields are left for you to complete.\",\"sensitiveRefused\":{},\"caPolicy\":{\"applied\":false,\"reason\":\"no_suggestion\",\"ambiguous\":null},\"sources\":[],\"statedFacts\":[]},\"warning\":null,\"values\":[{\"fieldKey\":\"employee_name\",\"value\":\"Odalys Merriweather\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"form_date\",\"value\":\"2026-10-22\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"location\",\"value\":\"NE Kearney\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}}],\"events\":[{\"fields\":[],\"rejected\":[]}],\"calls\":1}",
    "malformed":
      "{\"status\":200,\"body\":{\"values\":{},\"checked\":{},\"withheld\":[\"policy_violated\",\"policy_language\"],\"rejected\":[],\"placeholders\":{\"cleaned\":[],\"emptied\":[]},\"narrative\":{\"adjusted\":[],\"emptied\":[]},\"policyClaims\":{\"adjusted\":[],\"emptied\":[]},\"policyRequirements\":{\"adjusted\":[],\"replaced\":[]},\"policyAttributions\":{\"adjusted\":[],\"emptied\":[]},\"datesCorrected\":[],\"policyDerived\":[],\"timeframeEmptied\":[],\"followUpEmptied\":[],\"framingAdjusted\":[],\"employeeNamed\":[],\"priorActions\":{\"added\":[],\"removed\":[]},\"notice\":\"Woven does not see a matching policy in the knowledge base, so the policy fields are left for you to complete.\",\"sensitiveRefused\":{},\"caPolicy\":{\"applied\":false,\"reason\":\"no_suggestion\",\"ambiguous\":null},\"sources\":[],\"statedFacts\":[]},\"warning\":null,\"values\":[{\"fieldKey\":\"employee_name\",\"value\":\"Odalys Merriweather\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"form_date\",\"value\":\"2026-10-22\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"location\",\"value\":\"NE Kearney\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}}],\"events\":[{\"fields\":[],\"rejected\":[]}],\"calls\":1}",
    "model error":
      "{\"status\":500,\"body\":{\"error\":\"Something went wrong. Nothing was answered or saved.\",\"code\":\"internal\"},\"warning\":\"Your draft was created, but Sunny couldn't prefill the details. You can complete them below.\",\"values\":[{\"fieldKey\":\"employee_name\",\"value\":\"Odalys Merriweather\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"form_date\",\"value\":\"2026-10-22\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}},{\"fieldKey\":\"location\",\"value\":\"NE Kearney\",\"checked\":[],\"filledBy\":\"system\",\"provenance\":{}}],\"events\":[],\"calls\":1}",
  };

  it.each(Object.keys(DRAFTS))("%s", async (name) => {
    state.drafts = [DRAFTS[name]!];
    const { created, form, events } = await createFromTurn(c.turn, c.person.cap);
    const ids = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
    const snapshot = JSON.stringify({
      status: lastDraftStatus,
      body: lastDraftBody,
      warning: created.draftWarning ?? null,
      values: form.values.map(({ fieldKey, value, checked, filledBy, provenance }) => ({ fieldKey, value, checked, filledBy, provenance })),
      events: events.map((event) => event.detail),
      calls: state.calls,
    }).replace(ids, "<id>");
    if (process.env.NB_CAPTURE_GOLDEN) {
      (await import("node:fs")).appendFileSync(process.env.NB_CAPTURE_GOLDEN, `${JSON.stringify([name, snapshot])}\n`);
      return;
    }
    expect(snapshot).toBe(GOLDEN[name]);
  });
});
