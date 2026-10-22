import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA F-12, 22 OCT 2026 — ANSWERING "WHICH SALON IS THIS ABOUT?" IN THE CHAT
 * ============================================================================
 *
 * A salon director covering two salons opened a form and was asked which
 * salon it is about; "410" left the open form for free-form chat, the card
 * disappeared, and the manager had to start again. Replayed through Ask
 * Sunny's real proposal flow (with the open form's template sent as the
 * browser sends it), `createInlineForm` and the real create / review routes:
 *
 *   - a bare salon number or name answers the salon question — only when the
 *     salon question is open — and keeps the intake;
 *   - a correction ("sorry, it's …", "no wait, it's …", "actually …") does too;
 *   - times, prices, dates and quantities are never a salon;
 *   - an ambiguous or unassigned salon is asked about, never picked;
 *   - the employee and every other answer already given are kept.
 *
 * Only Ask Sunny's own salons are used. Every person is synthetic.
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

/**
 * Every turn's response, null included — for a turn that may leave the forms
 * path (the browser then shows an answer, not a card). What is checked is that
 * no response ever puts a place, or a word like "both", on the card.
 */
async function everyTurn(turns: string[]) {
  const messages: ChatMessage[] = [];
  const responses: (Awaited<ReturnType<typeof proposeFormForTurn>> | null)[] = [];
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
      policyManual: async () => (state.manual?.chunks as never) ?? null,
      ...(open ? { continueTemplateKey: open } : {}),
    });
    responses.push(response);
    if (response?.formProposal) open = response.formProposal.templateKey;
    messages.push(message, {
      id: `a${sequence}`,
      role: "assistant",
      content: response?.content ?? "(answered outside the forms path)",
      createdAt: "2026-10-21T18:00:01Z",
      ...(response?.formProposal ? { formProposal: response.formProposal } : {}),
    } as ChatMessage);
  }
  return responses;
}

/* Synthetic people only. */
const DIRECTORY = [
  { id: "e-1", firstName: "Pat", lastName: "Rivera", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Sam", lastName: "Jones", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
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
  vi.setSystemTime(new Date("2026-10-21T18:00:00Z"));
  await ensureTemplateLibrary("system");
});

async function filed(turns: string[], observation: string, checked: Record<string, string[]> = {}) {
  const played = await conversation(turns);
  state.draft = { values: { observation: `Observed:\n${observation}` }, checked };
  const { reference } = await played.create();
  return { ...played, form: await review(reference.instanceId) };
}


/* Ask Sunny's own salons: NE Lincoln 27th Street (0310), NE Lincoln O Street (0311), NE Omaha Pacific (0410, Google store code 254). */
const TWO: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0410"] };
const LINCOLN_TWO: AccessScope = { level: "salon", primaryAreaId: "loc-0310", alsoCoversAreaIds: ["loc-0311"] };
/* 306 is salon 0306 (MO Kansas City Wornall) AND Google store code 306 (salon 0462, KS Manhattan). */
const COLLIDING: AccessScope = { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: ["loc-0462"] };
const DISTRICT: AccessScope = { level: "district", primaryAreaId: "dist-dugan-rachael", alsoCoversAreaIds: [] };
const GLOBAL: AccessScope = { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };

/* Off the directory, so nothing but the manager's words can place the form. */
const ASKS = "create a coaching form for Jo Test, late 3 times this week";

async function asked(scope: AccessScope, opening = ASKS) {
  state.scope = scope;
  const { proposal } = await conversation([opening]);
  expect(proposal).toMatchObject({ employeeName: "Jo Test", status: "needs_location", locationResolution: "needs_selection" });
  return proposal;
}

describe("criterion 5: a salon reply to the salon question keeps the intake and sets the salon", () => {
  it.each([
    ["410", "loc-0410"],
    ["0410", "loc-0410"],
    ["#410", "loc-0410"],
    ["salon 410", "loc-0410"],
    ["410.", "loc-0410"],
    ["254", "loc-0410"], // Google store code 254 is NE Omaha Pacific; no salon 0254
    ["310", "loc-0310"],
    ["omaha pacific", "loc-0410"],
    ["Omaha Pacific", "loc-0410"],
    ["the omaha pacific salon", "loc-0410"],
    ["lincoln 27th street", "loc-0310"],
    ["it's omaha pacific", "loc-0410"],
  ])("%j", async (reply, salon) => {
    await asked(TWO);
    state.scope = TWO;
    const { proposal } = await conversation([ASKS, reply]);
    expect(proposal).toMatchObject({ templateKey: "coaching", employeeName: "Jo Test", locationId: salon, status: "ready" });
  });

  it.each([
    ["sorry, it's omaha pacific", "loc-0410"],
    ["no wait, it's omaha pacific", "loc-0410"],
    ["actually, omaha pacific", "loc-0410"],
    ["actually it's salon 410", "loc-0410"],
    ["sorry, it's #0410", "loc-0410"],
  ])("a correction to a salon already on the card: %j", async (reply, salon) => {
    state.scope = TWO;
    const { responses, proposal } = await conversation(["create a coaching form for Jo Test at lincoln 27th street, late 3 times", reply]);
    expect(responses[0]!.formProposal).toMatchObject({ employeeName: "Jo Test", locationId: "loc-0310", status: "ready" });
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: salon, status: "ready" });
  });

  it("the answer is remembered on later turns", async () => {
    state.scope = TWO;
    const { proposal } = await conversation([ASKS, "410", "she was late again today"]);
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: "loc-0410", status: "ready" });
  });
});

describe("criterion 1: a bare number is read only when the salon question is open", () => {
  it.each(["410", "254", "310"])("%j after a card that already has its salon", async (reply) => {
    state.scope = TWO;
    const responses = await everyTurn(["create a coaching form for Jo Test at lincoln 27th street, late 3 times", reply]);
    expect(responses[0]!.formProposal!.locationId).toBe("loc-0310");
    // Whether or not the turn stays on the form, the salon never changes from a bare number.
    expect(responses[1]?.formProposal?.locationId ?? "loc-0310").toBe("loc-0310");
    expect(responses[1]?.formProposal?.employeeName ?? "Jo Test").toBe("Jo Test");
  });

  it("'actually 410' is not a salon: a number in a correction needs a salon word, # or its leading zero", async () => {
    state.scope = TWO;
    const responses = await everyTurn(["create a coaching form for Jo Test at lincoln 27th street, late 3 times", "actually 410"]);
    expect(responses[1]?.formProposal?.locationId ?? "loc-0310").toBe("loc-0310");
  });
});

describe("criterion 2: times, prices, dates and quantities are never a salon", () => {
  it.each(["she got here at 410 today", "4:10", "at 4:10", "410pm", "$254", "254 dollars", "for 410 minutes", "4/10", "410 bottles", "410?"])(
    "%j after the salon question",
    async (reply) => {
      await asked(TWO);
      state.scope = TWO;
      const responses = await everyTurn([ASKS, reply]);
      expect(responses[1]?.formProposal?.locationId ?? null).toBeNull();
      expect(responses[1]?.formProposal?.employeeName ?? "Jo Test").toBe("Jo Test");
    },
  );
});

describe("criterion 4: ambiguous or unassigned salons are asked about, never picked", () => {
  it("'306' names two salons (salon 0306 and Google code 306 = 0462): both offered, neither picked", async () => {
    state.scope = COLLIDING;
    const { proposal } = await conversation([ASKS, "306"]);
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: null, locationResolution: "needs_selection", status: "needs_location" });
    expect([...proposal.authorizedLocationIds].sort()).toEqual(["loc-0306", "loc-0462"]);
  });

  it("'lincoln' is three salons: the manager's two are offered, neither picked", async () => {
    state.scope = LINCOLN_TWO;
    const { proposal } = await conversation([ASKS, "lincoln"]);
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: null, locationResolution: "needs_selection" });
    expect([...proposal.authorizedLocationIds].sort()).toEqual(["loc-0310", "loc-0311"]);
  });

  it("'omaha' is three salons: asked, even though only one of them is the manager's", async () => {
    state.scope = TWO;
    const { proposal } = await conversation([ASKS, "omaha"]);
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: null, locationResolution: "needs_selection" });
    expect(proposal.authorizedLocationIds).toEqual(["loc-0410"]);
  });

  it.each([
    ["kearney", "NE Kearney"],
    ["462", "KS Manhattan"],
    ["salon 0309", "NE Kearney"],
    ["sorry, it's kearney", "NE Kearney"],
  ])("an unassigned salon (%j) is named back and not filed against", async (reply, name) => {
    state.scope = TWO;
    const { proposal, last } = await conversation([ASKS, reply]);
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: null, locationResolution: "needs_selection", namedLocationOutOfScope: name });
    expect([...proposal.authorizedLocationIds].sort()).toEqual(["loc-0310", "loc-0410"]);
    expect(last.content).toContain(`**${name}** isn't a salon on your assignment`);
  });

  it("a district manager stays fail-closed: the reply is not a salon on the form", async () => {
    state.role = "district_manager";
    state.scope = DISTRICT;
    for (const reply of ["kearney", "410", "salon 0309"]) {
      const responses = await everyTurn([ASKS, reply]);
      expect(responses[0]!.formProposal).toMatchObject({ employeeName: "Jo Test", locationResolution: "unavailable" });
      expect(responses[1]?.formProposal?.locationId ?? null).toBeNull();
      expect(responses[1]?.formProposal?.locationResolution ?? "unavailable").toBe("unavailable");
      expect(responses[1]?.formProposal?.employeeName ?? "Jo Test").toBe("Jo Test");
    }
  });

  it("a global administrator may name any roster salon in a correction", async () => {
    state.role = "owner";
    state.scope = GLOBAL;
    const { proposal } = await conversation([ASKS, "sorry, it's salon 462"]);
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: "loc-0462" });
  });
});

describe("criterion 3: the employee and every other answer are kept, on the card and on the saved form", () => {
  it("a Corrective Action answered '410' keeps the employee, level, payroll answer and incident date", async () => {
    state.scope = TWO;
    const CA = "create verbal ca for Jo Test. she was late on 10/15. no payroll deduct";
    const { responses, proposal, form } = await filed([CA, "410"], "Jo Test was late on 10/15/2026.");
    expect(responses[0]!.formProposal).toMatchObject({ employeeName: "Jo Test", status: "needs_location", warningLevel: "verbal", payrollDeduct: "no", formDate: "2026-10-15" });
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: "loc-0410", status: "ready", warningLevel: "verbal", payrollDeduct: "no", formDate: "2026-10-15" });
    expect(form.instance).toMatchObject({ employeeName: "Jo Test", locationId: "loc-0410", formDate: "2026-10-15" });
    expect(form.values.find((v) => v.fieldKey === "payroll_deduct")?.checked).toEqual(["no"]);
  });

  it("a directory employee keeps the directory's spelling through the salon answer", async () => {
    state.scope = TWO;
    state.directory = [{ id: "e-9", firstName: "Jo", lastName: "Test", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310", "loc-0410"] }];
    const { proposal } = await conversation(["create a coaching form for jo test, late 3 times this week", "omaha pacific"]);
    expect(proposal).toMatchObject({ employeeName: "Jo Test", locationId: "loc-0410" });
  });
});
