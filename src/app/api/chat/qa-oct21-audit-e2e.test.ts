import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { draftNoInventedPlanEnabled } from "@/lib/config/chat-quality-flags";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * INDEPENDENT QA AUDIT — THE SIX CORRECTIVE ACTION REPORTS OF 21 OCT 2026
 * ============================================================================
 *
 * A District Manager rated six Corrective Action conversations low on 21 Oct
 * 2026 in Ask Bubbles. Ported from its audit — Ask Sunny shares the Corrective
 * Action code and the JBA Policy Manual — each is replayed here the way a
 * manager's browser plays it: every turn
 * through POST /api/chat (correction, policy change, redraft, revision, then
 * the proposal, in the route's own order), the card's Create draft through
 * `createInlineForm`, and the form read, finalized and reopened through the
 * real forms routes.
 *
 * THE DRAFTING MODEL IS REPLAYED, NOT IDEALISED. Where production stored what
 * the model wrote (form_instance_values, 21 Oct), the stand-in returns that
 * text — the wrong dates, the long Action Plan, the Standards of Conduct box
 * — with the employee's name replaced. What is under test is whether the code
 * now around the model turns that into the form the manager asked for.
 *
 * The manual is the JBA Policy Manual's layout (headings, pages, sections)
 * with invented wording, and the neighbouring sections a lookup must not land on
 * (`test/fixtures/jba-manual-ca-sections.ts`). Faked: identity, the database
 * (in-memory), the employee directory read, the general-answer model, and
 * analytics. Every person is synthetic.
 *
 * ASK SUNNY'S OWN RULE, kept: the warning level is set on the form, not asked
 * in chat. Payroll is read with Ask Bubbles' reader since PR #129; the
 * wordings below state the Yes outright, which both read the same. Ask Bubbles' chat correction of the warning
 * level and its server-side guard against a second Create are not in Ask
 * Sunny, so those scenarios are not here.
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
  /** What the drafting model writes (write_form_fields). */
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  /** What the revising model writes (revise_form_fields). */
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  draftCalls: 0,
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "admin" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-dm",
          email: "qa-dm@example.test",
          displayName: "QA District Manager",
          role: "admin",
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
        else state.draftCalls += 1;
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

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const { createInlineForm } = await import("@/features/chat/create-inline-form");
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const instanceRoute = await import("../forms/instances/[id]/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");
const pdfRoute = await import("../forms/instances/[id]/pdf/route");
const { listInstances } = await import("@/lib/forms/instances");

const TODAY = "2026-10-21";

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

/** The browser's `formsFetch`, dispatched straight into the route handlers. */
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

/**
 * The chat thread as the browser holds it, every turn sent through
 * POST /api/chat as `chat-screen.tsx` sends it.
 */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;

  async say(question: string) {
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
    const payload = (await response.json()) as {
      content: string;
      formProposal?: ChatFormProposal;
      formUpdate?: { instanceId: string; updated: string[] };
      error?: string;
    };
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
    if (payload.formProposal) this.proposal = payload.formProposal;
    return payload;
  }

  /** The card's Create draft button. */
  async create() {
    expect(this.proposal, "no card to create from").not.toBeNull();
    const result = await createInlineForm({
      proposal: this.proposal!,
      messages: this.messages,
      call,
      onCreated: () => {},
    });
    this.instanceId = toUuid(result.reference.instanceId);
    return { id: this.instanceId, draftWarning: result.draftWarning, draftNotice: result.draftNotice ?? null };
  }
}

type Row = { fieldKey: string; value: string | null; checked: string[]; filledBy: string };

async function form(id: string) {
  joinOverview();
  const response = await instanceRoute.GET(new Request(`https://app.test/api/forms/instances/${id}`), {
    params: Promise.resolve({ id }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { instance: Record<string, unknown>; values: Row[] };
  const byKey = Object.fromEntries(body.values.map((row) => [row.fieldKey, row])) as Record<string, Row | undefined>;
  return {
    instance: body.instance,
    rows: byKey,
    text: (key: string) => byKey[key]?.value ?? null,
    ticks: (key: string) => byKey[key]?.checked ?? [],
  };
}

async function act(id: string, body: Record<string, unknown>) {
  const response = await instanceRoute.POST(
    new Request(`https://app.test/api/forms/instances/${id}`, { method: "POST", body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  joinOverview();
  const payload = (await response.json()) as { instance?: { id: string; status: string }; error?: string; code?: string };
  return { status: response.status, payload };
}

/** The card's own save: what the manager's inputs hold, sent as PATCH. */
async function save(id: string, values: Record<string, string>, checked: Record<string, string[]> = {}) {
  const response = await instanceRoute.PATCH(
    new Request(`https://app.test/api/forms/instances/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ values, checked }),
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
}

/** Every distinct way a calendar day is spelled on a drafted form. */
const DATE_WORDS = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\b/g;
const datesIn = (text: string | null) => (text ?? "").match(DATE_WORDS) ?? [];

const CLOSING =
  "Future policy violations may result in additional corrective action up to and including termination of employment.";

/** HR's Action Plan: the review sentence, a deduction sentence when one applies, the closing. Nothing else. */
function expectHrPlan(plan: string | null, review: RegExp, deduction: RegExp | null) {
  expect(plan, "Action Plan missing").not.toBeNull();
  const sentences = plan!.split(/(?<=\.)\s+/).filter(Boolean);
  expect(sentences[0]).toMatch(review);
  expect(sentences.at(-1)).toBe(CLOSING);
  if (deduction) {
    expect(sentences).toHaveLength(3);
    expect(sentences[1]).toMatch(deduction);
  } else {
    expect(sentences, plan!).toHaveLength(2);
    expect(plan).not.toMatch(/deduct|\$/i);
  }
}

/* Synthetic people only, at one Sun Tan City salon. */
const DIRECTORY = [
  { id: "e-1", firstName: "Marlo", lastName: "Quist", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
  { id: "e-2", firstName: "Sela", lastName: "Brandt", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0310"] },
];

/** Rows read through the overview VIEW carry their template's columns at once, as Postgres does. */
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
  state.draft = { values: {}, checked: {} };
  state.revision = { values: {} };
  state.draftCalls = 0;
  state.revisionCalls = 0;
  state.chatModelCalls = 0;
  state.directory = DIRECTORY;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  await ensureTemplateLibrary("system");
});

const LEVEL_QUESTION = /Verbal Warning\*\* or a \*\*Written Warning/;
const PAYROLL_QUESTION = /Is payroll deduct applicable\?\*\* Yes or No\?/;

/* ========================================================================= */
/* ISSUE 1 — "got date of incident wrong - was told 10-1-26 but bubbles used */
/* 10-21-26. failed to state $25 will be payroll deducted. noted tardiness/  */
/* leaving early vs late open policy pg.15"                                  */
/* ========================================================================= */

/** Production, 18:18 UTC, name replaced. */
const ISSUE_1 =
  "create verbal ca for marlo quist for opening salon late on 10-1-26. previous coaching is jba policy manual 1-1-26. payroll deduct DOES apply and state $25 will be payroll deducted";

/** What the model wrote on the production form (365d853e), name replaced. */
const ISSUE_1_MODEL = {
  values: {
    observation:
      "Observed:\nMarlo was scheduled to open the salon and did not open the location at the proper time on October 21, 2026, resulting in a late opening.\n\nExpectation:\nAn employee assigned to open the salon is expected to arrive with enough time to complete all opening duties and have the location ready to open at the scheduled time.\n\nGoing Forward:\nMarlo should plan arrival time to allow for all opening duties.",
    action_plan:
      "Marlo is expected to adhere to the Sun Tan City attendance policy by opening the salon on time and ready for clients at the start of the scheduled shift. Moving forward, Marlo should arrive with enough time to complete all opening duties before the salon's scheduled opening and notify management as soon as possible if running late. Management will monitor compliance and provide coaching as needed.",
    policy_violated: "Tardiness/Leaving Early",
    prior_actions: "JBA Policy Manual coaching — signed 01/01/2026",
  },
  checked: { offense_type: ["tardiness"] },
};

describe("Issue 1: a late opening on 10-1-26 with a $25 payroll deduction", () => {
  it("the production conversation: dated 10-1-26, Verbal, $25 Yes, Late Opening p.15 quoted, $25 in the plan", async () => {
    const thread = new Thread();
    const card = await thread.say(ISSUE_1);

    expect(card.formProposal?.templateKey).toBe("dpoa");
    expect(card.formProposal?.employeeName).toBe("Marlo Quist");
    expect(card.content).not.toMatch(LEVEL_QUESTION);
    expect(card.content).toMatch(/Is payroll deduct applicable\? \*\*Yes\*\*/);
    /* 1-1-26 is the coaching's date, not a second incident to choose between. */
    expect(card.content).not.toMatch(/Which date goes on the form/);

    state.draft = ISSUE_1_MODEL;
    const { id, draftWarning } = await thread.create();
    expect(draftWarning).toBeNull();
    const f = await form(id);

    expect(f.text("form_date")).toBe("2026-10-01");
    expect(f.text("observation")).toContain("October 1, 2026");
    expect(f.text("observation")).not.toContain("October 21");
    expect(f.ticks("warning_type")).toEqual(["verbal"]);
    expect(f.ticks("payroll_deduct")).toEqual(["yes"]);
    expect(f.text("policy_violated")).toMatch(/Late Opening/);
    expect(f.text("policy_language")).toMatch(/Late Opening/);
    expect(f.text("policy_language")).toMatch(/\$25\.00 via payroll deduction/);
    expect(f.text("policy_language")).toMatch(/p(?:age|\.)\s*15\b/i);
    expect(f.text("policy_language")).not.toMatch(/Cell Phone|Standards of Conduct|Texting/);
    expect(f.text("prior_actions")).toMatch(/01\/01\/2026|1-1-26/);
    expectHrPlan(f.text("action_plan"), /^Management will review the Late Opening/, /^\$25(?:\.00)? will be deducted from Marlo's pay\.$/);
  });

  it.each([
    ["10/1/26"],
    ["10/01/2026"],
    ["10-01-26"],
    ["oct 1"],
    ["October 1st"],
  ])("the incident date written %s still dates the form 1 Oct 2026, never the day it is created", async (spelled) => {
    const thread = new Thread();
    await thread.say(`create verbal ca for marlo quist for opening the salon late on ${spelled}. payroll deduct $25`);
    state.draft = ISSUE_1_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.text("form_date")).toBe("2026-10-01");
    expect(f.text("observation")).not.toContain("October 21");
    expect(datesIn(f.text("observation"))).toContain("October 1, 2026");
  });

  it.each([
    ["payroll deduct DOES apply and state $25 will be payroll deducted", "$25"],
    ["$25 will be deducted from her check", "$25"],
    ["payroll deduction of 25 dollars applies", "$25"],
    ["payroll deduction of $25.00 applies", "$25.00"],
    ["payroll deduct applies", "$25.00"],
  ])('"%s" is a Yes, and the plan states %s', async (payroll, amount) => {
    const thread = new Thread();
    const card = await thread.say(`create verbal ca for marlo quist for opening salon late on 10-1-26. ${payroll}`);
    expect(card.formProposal?.payrollDeduct).toBe("yes");
    expect(card.content).not.toMatch(PAYROLL_QUESTION);
    state.draft = ISSUE_1_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.ticks("payroll_deduct")).toEqual(["yes"]);
    expect(f.text("action_plan")).toContain(`${amount} will be deducted from Marlo's pay.`);
  });

  it("an opening missed by a manager on duty, said in other words, still cites Late Opening, not Attendance alone", async () => {
    const thread = new Thread();
    await thread.say("create verbal ca for marlo quist. she was scheduled to open on 10-1-26 and the salon didn't open until 10:25. payroll deduct $25");
    state.draft = ISSUE_1_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.text("policy_language")).toMatch(/Late Opening/);
    expect(f.text("action_plan")).toMatch(/Late Opening/);
  });

  it("a late ARRIVAL (not an opening) is never given the Late Opening section or its $25", async () => {
    const thread = new Thread();
    await thread.say("create verbal ca for marlo quist, she arrived 20 minutes late for her 2pm shift on 10-1-26. no payroll deduct");
    state.draft = {
      values: { observation: "Observed:\nOn October 1, 2026, Marlo arrived 20 minutes late for a 2pm shift." },
      checked: { offense_type: ["tardiness"] },
    };
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.text("policy_language") ?? "").not.toMatch(/Late Opening|\$25/);
    expect(f.text("action_plan")).not.toMatch(/\$|deduct/);
  });
});

/* ========================================================================= */
/* ISSUE 2 — "bubbles did not fill out any section of the CA"                */
/* ========================================================================= */

/** Production, 18:08 UTC, name replaced. Answered "written". */
const ISSUE_2 =
  "create a written CA for sela brandt for not attending the monthly meeting on 10-20-26. previous coaching: jba policy manual 1-1-26, verbal ca 9-1-26. payroll deduct not applicable";

const MEETING_MODEL = {
  values: {
    observation:
      "Observed:\nSela did not attend the scheduled monthly meeting on October 20, 2026.\n\nExpectation:\nSela is expected to attend scheduled required meetings.\n\nGoing Forward:\nSela should attend all scheduled monthly meetings.",
  },
  checked: { offense_type: ["standards_of_conduct"] },
};

describe("Issue 2: a request answered with one word drafts the whole form", () => {
  it('the production conversation, then "written": every section the manager gave is on the form', async () => {
    const thread = new Thread();
    const card = await thread.say(ISSUE_2);
    /* "a written CA" is the level; it is not asked again. */
    expect(card.content).not.toMatch(LEVEL_QUESTION);
    expect(card.formProposal?.warningLevel).toBe("written");
    const answer = await thread.say("written");
    expect(answer.formProposal?.warningLevel).toBe("written");

    state.draft = MEETING_MODEL;
    const { id, draftWarning } = await thread.create();
    expect(draftWarning).toBeNull();
    const f = await form(id);

    expect(f.text("form_date")).toBe("2026-10-20");
    expect(f.text("observation")).toMatch(/monthly meeting on October 20, 2026/);
    expect(f.ticks("warning_type")).toEqual(["written"]);
    expect(f.ticks("payroll_deduct")).toEqual(["no"]);
    expect(f.ticks("offense_type").length).toBeGreaterThan(0);
    expect(f.text("policy_violated")).toBeTruthy();
    expect(f.text("policy_language")).toBeTruthy();
    expect(f.text("prior_actions")).toMatch(/01\/01\/2026/);
    expect(f.text("prior_actions")).toMatch(/09\/01\/2026/);
    expectHrPlan(f.text("action_plan"), /^Management will review the .+ with Sela\.$/, null);
  });

  /*
   * OWNER DECISION, 22 Oct 2026: a missed monthly meeting is Attendance, not
   * Standards of Conduct. The manual's Attendance section says
   * "Seminars/Meetings/ Training sessions" count as scheduled shifts; the
   * model's Standards of Conduct box is not kept.
   */
  it("a missed monthly meeting is cited under Attendance, never Standards of Conduct", async () => {
    const thread = new Thread();
    await thread.say(ISSUE_2);
    state.draft = MEETING_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.ticks("offense_type")).toEqual(["absenteeism"]);
    expect(f.text("policy_violated")).toMatch(/Attendance|Absenteeism/);
    expect(f.text("policy_violated")).not.toMatch(/Standards of Conduct/);
    expect(f.text("policy_language")).toMatch(/Attendance/);
    expect(f.text("policy_language")).toMatch(/Seminars\/Meetings\/ Training sessions/);
    expect(f.text("policy_language")).not.toMatch(/Standards of Conduct/);
    expectHrPlan(f.text("action_plan"), /^Management will review the Attendance policy with Sela\.$/, null);
  });

  it.each([["verbal"], ["Verbal warning"], ["it's a verbal"], ["written warning please"]])(
    'a request with no level, answered "%s", keeps the account and the answer',
    async (reply) => {
      const thread = new Thread();
      const first = await thread.say(
        "create a ca for sela brandt for not attending the monthly meeting on 10-20-26. payroll deduct not applicable",
      );
      void first;
      const second = await thread.say(reply);
      const level = /written/i.test(reply) ? "written" : "verbal";
      expect(second.formProposal?.warningLevel).toBe(level);
      expect(second.content).not.toMatch(LEVEL_QUESTION);

      state.draft = MEETING_MODEL;
      const { id } = await thread.create();
      const f = await form(id);
      expect(f.ticks("warning_type")).toEqual([level]);
      expect(f.text("observation")).toMatch(/monthly meeting/);
      expect(f.text("form_date")).toBe("2026-10-20");
      expect(f.ticks("payroll_deduct")).toEqual(["no"]);
      /* The model was given the account, not just the one-word answer. */
      expect(state.draftCalls).toBe(1);
    },
  );

  it("several short answers in a row lose nothing given earlier", async () => {
    const thread = new Thread();
    await thread.say("create a ca for sela brandt for not attending the monthly meeting on 10-20-26");
    await thread.say("verbal");
    const third = await thread.say("no payroll deduct");
    expect(third.formProposal?.warningLevel).toBe("verbal");
    expect(third.formProposal?.payrollDeduct).toBe("no");
    expect(third.content).not.toMatch(LEVEL_QUESTION);

    state.draft = MEETING_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.ticks("warning_type")).toEqual(["verbal"]);
    expect(f.ticks("payroll_deduct")).toEqual(["no"]);
    expect(f.text("observation")).toMatch(/monthly meeting/);
    expect(f.text("form_date")).toBe("2026-10-20");
  });
});

/* ========================================================================= */
/* ISSUE 3 — "cited S.O.Conduct vs the cell phone/smart watch policy page    */
/* 19. had to tell bubbles twice it was a verbal CA"                         */
/* ========================================================================= */

/** Production, 16:58 UTC, name replaced. */
const ISSUE_3 =
  "create a verbal corrective action form for marlo quist. on 10-20-26 marlo was talking on her cell phone for over 30 minutes";

/** What the model wrote (b68c8892), name replaced: Standards of Conduct, and the creation date. */
const ISSUE_3_MODEL = {
  values: {
    observation:
      "Observed:\nOn October 21, 2026, Marlo was observed talking on a cell phone for over 30 minutes while on shift.\n\nExpectation:\nEmployees are expected to remain focused on work duties during their scheduled shift.\n\nGoing Forward:\nMarlo should keep personal phone use to designated breaks.",
    policy_violated: "Standards of Conduct",
    action_plan:
      "Marlo is expected to adhere to the Sun Tan City standards of conduct policy by remaining focused on assigned work duties throughout the scheduled shift. Management will monitor compliance and provide coaching as needed.",
  },
  checked: { offense_type: ["standards_of_conduct"] },
};

describe("Issue 3: personal phone use cites the Cell Phone/Smart Watch Policy, p.19", () => {
  it("the production conversation: Verbal read once, p.19 quoted, no Standards of Conduct, the 10-20-26 date kept", async () => {
    const thread = new Thread();
    const card = await thread.say(ISSUE_3);
    expect(card.content).not.toMatch(LEVEL_QUESTION);
    expect(card.formProposal?.warningLevel).toBe("verbal");

    state.draft = ISSUE_3_MODEL;
    const { id } = await thread.create();
    const f = await form(id);

    expect(f.ticks("warning_type")).toEqual(["verbal"]);
    expect(f.text("policy_violated")).toMatch(/Cell Phone\/Smart Watch/);
    expect(f.text("policy_violated")).not.toMatch(/Standards of Conduct/);
    expect(f.ticks("offense_type")).not.toContain("standards_of_conduct");
    expect(f.text("policy_language")).toMatch(/Cell Phone\/Smart Watch Policy/);
    expect(f.text("policy_language")).toMatch(/p(?:age|\.)\s*19\b/i);
    expect(f.text("policy_language")).not.toMatch(/Standards of Conduct/);
    expect(f.text("form_date")).toBe("2026-10-20");
    expect(f.text("observation")).toContain("October 20, 2026");
    expect(f.text("observation")).not.toContain("October 21");
    expectHrPlan(f.text("action_plan"), /^Management will review the Cell Phone\/Smart Watch policy with Marlo\.$/, null);
  });

  it('the second production conversation: a request, "no payroll deduct", then "verbal" — Verbal is asked at most once', async () => {
    const thread = new Thread();
    const first = await thread.say(
      "create a corrective action form for marlo quist. on 10-20-26 marlo was talking on her cell phone for over 30 minutes",
    );
    void first;
    await thread.say("no payroll deduct");
    const third = await thread.say("verbal");
    expect(third.formProposal?.warningLevel).toBe("verbal");
    expect(third.content).not.toMatch(LEVEL_QUESTION);
    state.draft = ISSUE_3_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.ticks("warning_type")).toEqual(["verbal"]);
    expect(f.ticks("payroll_deduct")).toEqual(["no"]);
    expect(f.text("policy_language")).toMatch(/Cell Phone\/Smart Watch Policy/);
  });

  it.each([
    ["was texting on her phone at the register"],
    ["was on her phone for 20 minutes during her shift"],
    ["kept answering calls on her smart watch while helping guests"],
    ["violated the cell phone policy"],
  ])("described as \"%s\": the Cell Phone/Smart Watch Policy, never Standards of Conduct", async (account) => {
    const thread = new Thread();
    await thread.say(`create verbal ca for marlo quist, on 10-20-26 she ${account}. no payroll deduct`);
    state.draft = ISSUE_3_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.text("policy_language")).toMatch(/Cell Phone\/Smart Watch Policy/);
    expect(f.text("policy_violated")).not.toMatch(/Standards of Conduct/);
  });

  /*
   * TWO POLICIES DESCRIBED (QA follow-up, 22 Oct 2026): "social media on her
   * phone" answers both the Cell Phone/Smart Watch Policy (p.19) and the
   * Social Media Policy (p.22). Neither is chosen for the manager, and the
   * draft's own guess is not kept: they are asked, and their answer is cited.
   */
  const SOCIAL =
    "create verbal ca for marlo quist, on 10-20-26 she was scrolling social media on her phone on the sales floor. no payroll deduct";

  it("the card asks which policy, offering both with their pages", async () => {
    const thread = new Thread();
    const card = await thread.say(SOCIAL);
    expect(card.content).toMatch(/\*\*Which policy applies\?\*\*/);
    expect(card.content).toMatch(/Cell Phone\/Smart Watch Policy\*\* \(page 19\)/);
    expect(card.content).toMatch(/Social Media Policy\*\* \(page 22\)/);
  });

  it("created without an answer: no guessed policy is cited, and the draft says the policy is left for the manager", async () => {
    const thread = new Thread();
    await thread.say(SOCIAL);
    state.draft = ISSUE_3_MODEL;
    const { id, draftNotice } = await thread.create();
    const f = await form(id);
    expect(f.ticks("offense_type")).not.toContain("standards_of_conduct");
    expect(f.text("policy_language") ?? "").toBe("");
    expect(f.text("policy_violated") ?? "").not.toMatch(/Standards of Conduct/);
    expect(draftNotice).toMatch(/more than one policy in the manual — Cell Phone\/Smart Watch Policy \(page 19\) or Social Media Policy \(page 22\)/);
    expect(f.text("action_plan")).toMatch(/^Management will review the applicable company policy with Marlo\./);

    /* Then named in chat, it is cited from the manual. */
    await thread.say("add the Cell Phone/Smart Watch Policy");
    expect((await form(id)).text("policy_language")).toMatch(/Cell Phone\/Smart Watch Policy/);
  });

  it.each([
    ["the cell phone policy", /Cell Phone\/Smart Watch Policy/, /Social Media Policy/],
    ["social media policy", /Social Media Policy/, /Cell Phone\/Smart Watch/],
  ])('answered "%s": that section is cited, and only it', async (answer, cited, notCited) => {
    const thread = new Thread();
    await thread.say(SOCIAL);
    const card = await thread.say(answer);
    expect(card.formProposal?.templateKey).toBe("dpoa");
    expect(card.content).not.toMatch(/Which policy applies/);
    state.draft = ISSUE_3_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.text("policy_language")).toMatch(cited);
    expect(f.text("policy_language")).not.toMatch(notCited);
    expect(f.text("policy_language")).not.toMatch(/Standards of Conduct/);
  });

  it("a specific box the account settles is kept: a late arrival on her phone is Attendance, not a question", async () => {
    const thread = new Thread();
    const card = await thread.say("create verbal ca for marlo quist, she was 20 minutes late on 10-20-26 because she was on social media on her phone. no payroll deduct");
    expect(card.content).not.toMatch(/Which policy applies/);
    state.draft = { values: { observation: "Observed:\nOn October 20, 2026, Marlo arrived 20 minutes late." }, checked: { offense_type: ["tardiness"] } };
    const { id } = await thread.create();
    expect((await form(id)).ticks("offense_type")).toContain("tardiness");
  });

  it("a phone call that is NOT personal use (calling in late) is not cited as the Cell Phone policy", async () => {
    const thread = new Thread();
    await thread.say(
      "create verbal ca for marlo quist, on 10-20-26 she texted me she would be late instead of calling and arrived 40 minutes late. no payroll deduct",
    );
    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Marlo texted that she would be late and arrived 40 minutes late." },
      checked: { offense_type: ["tardiness"] },
    };
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.text("policy_language") ?? "").not.toMatch(/Cell Phone\/Smart Watch/);
    expect(f.ticks("offense_type")).toContain("tardiness");
  });
});

/* ========================================================================= */
/* ISSUE 4 — "did not state in the action plan that [she] would be payroll   */
/* deducted $3.25"                                                           */
/* ========================================================================= */

/** Production, 15:29 UTC, name replaced; then "verbal", then "yes payroll deduct". */
const ISSUE_4 =
  "create ca form for sela brandt. sela had a register shortage of $3.25 on 10-20-26. payroll deduct of $3.25 is applicable";

/** What the model wrote (d25b95f5), name replaced. */
const ISSUE_4_MODEL = {
  values: {
    observation:
      "Observed:\nOn October 20, 2026, Sela's register was found to be short by $3.25.\n\nExpectation:\nEmployees are expected to accurately count and reconcile their register drawer.\n\nGoing Forward:\nSela should carefully count the drawer at the start and end of each shift.",
    action_plan:
      "Sela is expected to adhere to the Sun Tan City cash handling and register accuracy policy by counting, verifying, and reconciling the register drawer accurately during each shift. Management will monitor compliance and provide coaching as needed.",
    policy_violated: "Standards of Conduct",
  },
  checked: { offense_type: ["standards_of_conduct"] },
};

const SHORTAGE = "create verbal ca for sela brandt. sela had a register shortage of $3.25 on 10-20-26.";

describe("Issue 4: a $3.25 payroll deduction reaches the Action Plan", () => {
  it("the production conversation: Yes read, not asked; the plan states $3.25 exactly", async () => {
    const thread = new Thread();
    const card = await thread.say(ISSUE_4);
    expect(card.formProposal?.payrollDeduct).toBe("yes");
    expect(card.content).not.toMatch(PAYROLL_QUESTION);
    await thread.say("verbal");
    const third = await thread.say("yes payroll deduct");
    expect(third.formProposal?.payrollDeduct).toBe("yes");

    state.draft = ISSUE_4_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.ticks("payroll_deduct")).toEqual(["yes"]);
    expect(f.ticks("warning_type")).toEqual(["verbal"]);
    expect(f.text("form_date")).toBe("2026-10-20");
    expectHrPlan(f.text("action_plan"), /^Management will review the Standards of Conduct policy with Sela\.$/, /^\$3\.25 will be deducted from Sela's pay\.$/);
  });

  it.each([
    ["payroll deduct of $3.25 is applicable", "yes", "$3.25"],
    ["payroll deduct applies and $3.25 will be deducted from check", "yes", "$3.25"],
    ["payroll deduct applies, deduct $3.25 from her paycheck", "yes", "$3.25"],
    ["payroll deduct applies, she will be payroll deducted 3.25", "yes", "$3.25"],
    ["no payroll deduct", "no", null],
    ["payroll deduct not applicable", "no", null],
    ["do not payroll deduct the $3.25", "no", null],
    ["the $3.25 payroll deduction is waived", "no", null],
    ["payroll deduct: no", "no", null],
  ])('"%s" → %s, and the plan states %s', async (payroll, answer, amount) => {
    const thread = new Thread();
    const card = await thread.say(`${SHORTAGE} ${payroll}`);
    expect(card.formProposal?.payrollDeduct, card.content).toBe(answer);
    state.draft = ISSUE_4_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.ticks("payroll_deduct")).toEqual([answer]);
    if (amount) expect(f.text("action_plan")).toContain(`${amount} will be deducted from Sela's pay.`);
    else expect(f.text("action_plan")).not.toMatch(/deduct|\$/i);
  });

  it.each([["not sure about payroll deduct yet"], ["maybe payroll deduct $3.25?"], ["should I payroll deduct the $3.25?"]])(
    'ambiguous "%s" is asked, never saved as Yes',
    async (payroll) => {
      const thread = new Thread();
      const card = await thread.say(`${SHORTAGE} ${payroll}`);
      expect(card.formProposal?.payrollDeduct ?? null).toBeNull();
      expect(card.content).toMatch(PAYROLL_QUESTION);
      state.draft = ISSUE_4_MODEL;
      const { id } = await thread.create();
      const f = await form(id);
      expect(f.ticks("payroll_deduct")).not.toContain("yes");
      expect(f.text("action_plan") ?? "").not.toMatch(/will be deducted/);
    },
  );

  it("after the form exists: the amount changed, then cancelled, then restored — the plan follows each time and nothing else moves", async () => {
    const thread = new Thread();
    await thread.say(`${SHORTAGE} payroll deduct of $3.25 is applicable`);
    state.draft = ISSUE_4_MODEL;
    const { id } = await thread.create();
    const before = await form(id);

    const changed = await thread.say("change the payroll deduction to $5.00");
    let f = await form(id);
    expect(f.text("action_plan"), changed.content).toContain("$5.00");
    expect(f.ticks("payroll_deduct")).toEqual(["yes"]);
    expect(f.text("action_plan")).toContain("$5.00 will be deducted from Sela's pay.");
    expect(f.text("action_plan")).not.toContain("$3.25");

    await thread.say("actually cancel the payroll deduction");
    f = await form(id);
    expect(f.ticks("payroll_deduct")).toEqual(["no"]);
    expect(f.text("action_plan")).not.toMatch(/deduct|\$/i);

    await thread.say("payroll deduct applies after all, $3.25 will be deducted");
    f = await form(id);
    expect(f.ticks("payroll_deduct")).toEqual(["yes"]);
    expect(f.text("action_plan")).toContain("$3.25 will be deducted from Sela's pay.");

    for (const key of ["observation", "policy_violated", "policy_language", "form_date", "prior_actions"]) {
      expect(f.text(key), key).toBe(before.text(key));
    }
    expect(f.ticks("warning_type")).toEqual(before.ticks("warning_type"));
    expect(f.ticks("offense_type")).toEqual(before.ticks("offense_type"));
  });
});

/* ========================================================================= */
/* ISSUE 5 — "bubbles repeated the date of the offense"                      */
/* ========================================================================= */

/** Production, 15:16 UTC, name replaced; then "verbal". */
const ISSUE_5 =
  "create ca form for marlo quist for violating attendance policy on 10-20-26. verbal. no payroll deduct. jba manual 1-1-26 for previous coaching";

/** What the model wrote (a9c3bb36), name replaced: the creation date, twice. */
const ISSUE_5_MODEL = {
  values: {
    observation:
      "Observed:\nOn October 21, 2026, Marlo was reported as having violated the attendance policy on October 21, 2026.\n\nExpectation:\nMarlo is expected to arrive on time and be ready to work at the start of each scheduled shift.\n\nGoing Forward:\nMarlo should report for scheduled shifts on time.",
    prior_actions: "Coaching — JBA Manual 1-1-26",
  },
  checked: { offense_type: ["tardiness"] },
};

/** The same production slip on an account that says what happened: the creation date, twice. */
const LATE_TWICE_MODEL = {
  values: {
    observation:
      "Observed:\nOn October 21, 2026, Marlo arrived 30 minutes late for the scheduled shift on October 21, 2026.\n\nExpectation:\nMarlo is expected to arrive on time.\n\nGoing Forward:\nMarlo should plan to arrive early.",
  },
  checked: { offense_type: ["tardiness"] },
};

describe("Issue 5: the incident date is stated once, as given", () => {
  it("the production conversation: never the creation date, never twice — and an emptied Observed is said on the card", async () => {
    const thread = new Thread();
    const card = await thread.say(ISSUE_5);
    expect(card.formProposal?.warningLevel).toBe("verbal");
    expect(card.content).not.toMatch(/Which date goes on the form/);
    await thread.say("verbal");

    state.draft = ISSUE_5_MODEL;
    const { id, draftNotice } = await thread.create();
    const f = await form(id);
    expect(f.text("form_date")).toBe("2026-10-20");
    const observation = f.text("observation") ?? "";
    expect(observation).not.toContain("October 21");
    expect(datesIn(observation).length).toBeLessThanOrEqual(1);
    /*
     * "was reported as having violated the attendance policy" is a finding the
     * Observed section may not make (`policy-claim-guard.ts`); with nothing
     * else in the account, the section is left for the manager — and they are
     * told so, rather than shown a blank.
     */
    if (!/Observed:\s*\S/.test(observation.split(/Expectation:/)[0]!)) {
      expect(draftNotice).toMatch(/kept the observation to what was seen/);
    }
  });

  it.each([["10-20-26"], ["10/20/26"], ["10-20-2026"], ["oct 20"], ["October 20"]])(
    "written %s: dated 20 Oct, and the Observed sentence states it once",
    async (spelled) => {
      const thread = new Thread();
      await thread.say(`create verbal ca for marlo quist, she arrived 30 minutes late for her shift on ${spelled}. no payroll deduct`);
      state.draft = LATE_TWICE_MODEL;
      const { id } = await thread.create();
      const f = await form(id);
      expect(f.text("form_date")).toBe("2026-10-20");
      const observed = f.text("observation")!.split(/Expectation:/)[0]!;
      expect(observed).toContain("Marlo arrived 30 minutes late");
      expect(datesIn(observed), observed).toEqual(["October 20, 2026"]);
    },
  );

  it("a date corrected after the form exists moves the form's Date and the Observed paragraph together", async () => {
    const thread = new Thread();
    await thread.say("create verbal ca for marlo quist, she was 30 minutes late on 10-20-26. no payroll deduct");
    state.draft = {
      values: { observation: "Observed:\nOn October 20, 2026, Marlo arrived 30 minutes late for the scheduled shift." },
      checked: { offense_type: ["tardiness"] },
    };
    const { id } = await thread.create();
    const moved = await thread.say("the date was wrong, it happened on 10-19-26");
    const f = await form(id);
    expect(f.text("form_date"), moved.content).toBe("2026-10-19");
    expect(f.text("observation")).not.toContain("October 20, 2026");
    expect(f.text("observation")).toContain("October 19, 2026");
  });
});

/* ========================================================================= */
/* ISSUE 6 — "Other: failure to complete required task - woven deadline of  */
/* 9-30-26 … where it got 9-30-26 i dont know. action plan … should only     */
/* have 2 sentences"                                                         */
/* ========================================================================= */

/** Production, 14:22 UTC, name replaced. */
const ISSUE_6 =
  "create corrective action for sela brandt for violating standards of conduct policy on 10-20-26. sela failed to acknowledge policies in woven by the 10-15-26 deadline.";

/** What the model wrote (c334bf2d), name replaced — and an Other it might write. */
const ISSUE_6_MODEL = {
  values: {
    observation:
      "Observed:\nSela did not acknowledge the required policies in Woven by the October 21, 2026 deadline.\n\nExpectation:\nEmployees are expected to complete required Woven acknowledgements and training items by the assigned deadline.\n\nGoing Forward:\nSela should log into Woven promptly when a task is assigned.",
    action_plan:
      "Sela is expected to adhere to the Sun Tan City standards of conduct policy by completing required policy acknowledgements and assigned tasks within the designated deadlines. Moving forward, Sela should check Woven regularly during scheduled shifts and complete any outstanding acknowledgements or training as soon as they are assigned. Management will monitor compliance and provide coaching as needed.",
    other_offense: "Failure to complete required task — Woven deadline of September 30, 2026 not met",
    policy_violated: "Standards of Conduct",
  },
  checked: { offense_type: ["standards_of_conduct", "other"] },
};

describe("Issue 6: no invented Other, the deadline stays the deadline, a two-sentence plan", () => {
  it("the production conversation: Other blank, no September date, the 10-15 deadline not rewritten, HR's plan", async () => {
    const thread = new Thread();
    const card = await thread.say(ISSUE_6);
    await thread.say("verbal");
    expect(card.formProposal?.templateKey).toBe("dpoa");
    await thread.say("no payroll deduct");

    state.draft = ISSUE_6_MODEL;
    const { id } = await thread.create();
    const f = await form(id);

    expect(f.ticks("offense_type")).toEqual(["standards_of_conduct"]);
    expect(f.text("other_offense") ?? "").toBe("");
    expect(JSON.stringify(Object.values(f.rows))).not.toMatch(/September 30|9-30-26|9\/30/);
    /* The deadline is 15 Oct; the form is not dated by it. */
    expect(f.text("form_date")).not.toBe("2026-10-15");
    expect(f.text("observation")).not.toMatch(/October 21, 2026 deadline/);
    expectHrPlan(f.text("action_plan"), /^Management will review the Standards of Conduct policy with Sela\.$/, null);
  });

  it("the card's save cannot bring an Other back that the manager did not type: a stored Other is the manager's alone", async () => {
    const thread = new Thread();
    await thread.say(`${ISSUE_6} verbal. no payroll deduct`);
    state.draft = ISSUE_6_MODEL;
    const { id } = await thread.create();
    expect((await form(id)).text("other_offense") ?? "").toBe("");
    /* What browser form history put in the box, saved by the card, is recorded as the manager's. */
    await save(id, { other_offense: "Typed by the manager" });
    expect((await form(id)).rows.other_offense?.filledBy).toBe("manager");
  });
});

/* ========================================================================= */
/* THE WHOLE WORKFLOW — CREATE, CORRECT, FINALIZE, REOPEN                    */
/* ========================================================================= */

describe("workflow: corrections change only what was asked; finalized forms are never changed silently", () => {
  async function created() {
    const thread = new Thread();
    await thread.say(ISSUE_1);
    state.draft = ISSUE_1_MODEL;
    const { id } = await thread.create();
    return { thread, id, before: await form(id) };
  }

  const UNRELATED = ["observation", "policy_violated", "policy_language", "prior_actions", "form_date"];

  it("repeating an answer already on the form changes nothing", async () => {
    const { thread, id, before } = await created();
    await thread.say("it's a verbal warning");
    await thread.say("payroll deduct $25");
    const f = await form(id);
    for (const key of [...UNRELATED, "action_plan"]) expect(f.text(key), key).toBe(before.text(key));
    expect(f.ticks("warning_type")).toEqual(["verbal"]);
    expect(f.ticks("payroll_deduct")).toEqual(["yes"]);
  });

  it("a manager-typed Action Plan is never rebuilt by a payroll correction (only HR's required closing is kept on it)", async () => {
    const { thread, id } = await created();
    const typed = "Marlo will open on time. We will review this in 30 days. $25 will be deducted.";
    await save(id, { action_plan: typed });
    const saved = (await form(id)).text("action_plan");
    /* `required-closing.ts`: the version's closing is put on every write, by design. */
    expect(saved).toBe(`${typed} ${CLOSING}`);
    await thread.say("no payroll deduct");
    const f = await form(id);
    expect(f.ticks("payroll_deduct")).toEqual(["no"]);
    expect(f.text("action_plan")).toBe(saved);
  });

  it("finalize, then reopen as a new draft: the finalized form is untouched and the draft carries every answer", async () => {
    const { id, before } = await created();
    const done = await act(id, { action: "finalize", followUpDate: null });
    expect(done.status, JSON.stringify(done.payload)).toBe(200);
    expect(done.payload.instance?.status).toBe("finalized");

    const reopened = await act(id, { action: "revise" });
    expect(reopened.status, JSON.stringify(reopened.payload)).toBe(200);
    const draftId = toUuid(reopened.payload.instance!.id);
    expect(draftId).not.toBe(id);

    const original = await form(id);
    const copy = await form(draftId);
    expect(original.instance.status).toBe("finalized");
    for (const key of [...UNRELATED, "action_plan"]) {
      expect(original.text(key), key).toBe(before.text(key));
      expect(copy.text(key), key).toBe(before.text(key));
    }
    expect(copy.ticks("warning_type")).toEqual(["verbal"]);
    expect(copy.ticks("payroll_deduct")).toEqual(["yes"]);
  });

  it("a chat correction aimed at a finalized form never changes that finalized record", async () => {
    const { thread, id, before } = await created();
    expect((await act(id, { action: "finalize", followUpDate: null })).status).toBe(200);
    const valuesBefore = JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === id));
    await thread.say("no payroll deduct");
    await thread.say("make it a written warning");
    await thread.say("change the date to 10-2-26");
    expect(JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === id))).toBe(valuesBefore);
    const f = await form(id);
    expect(f.instance.status).toBe("finalized");
    expect(f.text("form_date")).toBe(before.text("form_date"));
  });

  it("a date correction moves the Date and the drafted Observed only — payroll, level, policy and plan stay", async () => {
    const { thread, id, before } = await created();
    const reply = await thread.say("change the date to 10-2-26");
    expect(reply.content).toMatch(/Updated the \*\*Corrective Action Form\*\*/);
    const f = await form(id);
    expect(f.text("form_date")).toBe("2026-10-02");
    expect(f.text("observation")).toContain("October 2, 2026");
    expect(f.text("observation")).not.toContain("October 1, 2026");
    for (const key of ["policy_violated", "policy_language", "prior_actions", "action_plan"]) {
      expect(f.text(key), key).toBe(before.text(key));
    }
    expect(f.ticks("warning_type")).toEqual(["verbal"]);
    expect(f.ticks("payroll_deduct")).toEqual(["yes"]);
    /* The same date again changes nothing. */
    await thread.say("change the date to 10-2-26");
    expect((await form(id)).text("observation")).toBe(f.text("observation"));
    /* And a second correction still moves Ask Bubbles' paragraph: it stayed Ask Bubbles'. */
    const again = await thread.say("sorry, change the date to 10-3-26");
    const g = await form(id);
    expect(g.text("form_date")).toBe("2026-10-03");
    expect(g.text("observation")).toContain("October 3, 2026");
    expect(g.text("observation")).not.toContain("October 2, 2026");
    expect(again.content).not.toMatch(/you wrote that/);
  });

  it("a date correction never rewrites an Observed the manager wrote: it says so instead", async () => {
    const { thread, id } = await created();
    const typed = "Observed:\nOn October 1, 2026 Marlo opened 25 minutes late. I opened for her.";
    await save(id, { observation: typed });
    const reply = await thread.say("the date was wrong, it happened on 10-2-26");
    const f = await form(id);
    expect(f.text("form_date")).toBe("2026-10-02");
    expect(f.text("observation")).toBe(typed);
    expect(reply.content).toMatch(/still names the old date/);
  });

  it("a date correction aimed at a finalized form is made on a new draft; the finalized record is untouched", async () => {
    const { thread, id, before } = await created();
    expect((await act(id, { action: "finalize", followUpDate: null })).status).toBe(200);
    const valuesBefore = JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === id));
    await thread.say("change the date to 10-2-26");
    expect(JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === id))).toBe(valuesBefore);
    const draft = (store.form_instances ?? []).find((row) => row.revises_instance_id === id);
    expect(draft, "no new draft was opened").toBeTruthy();
    const copy = await form(toUuid(draft!.id as string));
    expect(copy.text("form_date")).toBe("2026-10-02");
    expect(copy.text("policy_language")).toBe(before.text("policy_language"));
    expect(copy.ticks("payroll_deduct")).toEqual(["yes"]);
  });

  it("an earlier step's date is never taken for the form's", async () => {
    const { thread, id, before } = await created();
    await thread.say("the previous coaching date should be 1-2-26");
    expect((await form(id)).text("form_date")).toBe(before.text("form_date"));
  });

  it("Written then Verbal before the form exists: the card and the form say Verbal", async () => {
    const thread = new Thread();
    await thread.say("create a written ca for marlo quist for opening the salon late on 10-1-26. payroll deduct $25");
    const changed = await thread.say("actually make it a verbal warning");
    expect(changed.formProposal?.warningLevel).toBe("verbal");
    state.draft = ISSUE_1_MODEL;
    const { id } = await thread.create();
    expect((await form(id)).ticks("warning_type")).toEqual(["verbal"]);
  });

  it("finalizing twice is refused the second time and changes nothing", async () => {
    const { id } = await created();
    expect((await act(id, { action: "finalize", followUpDate: null })).status).toBe(200);
    const valuesBefore = JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === id));
    const again = await act(id, { action: "finalize", followUpDate: null });
    expect(again.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(store.form_instance_values.filter((row) => row.instance_id === id))).toBe(valuesBefore);
  });

  it("a policy named in a later turn, with two policies in it, cites the one the manager chose", async () => {
    const thread = new Thread();
    await thread.say(
      "create verbal ca for marlo quist for violating the cell phone policy on 10-20-26, not the standards of conduct. no payroll deduct",
    );
    state.draft = ISSUE_3_MODEL;
    const { id } = await thread.create();
    const f = await form(id);
    expect(f.text("policy_language")).toMatch(/Cell Phone\/Smart Watch Policy/);
    expect(f.text("policy_violated")).not.toMatch(/Standards of Conduct/);
  });
});

/* ========================================================================= */
/* ONE DATE EVERYWHERE — THE SAVED RECORD, THE REGISTER, THE REOPENED FORM   */
/* ========================================================================= */

/*
 * QA follow-up, 22 Oct 2026: `form_instances.form_date` — what the Forms
 * Register lists, the PDF prints and names, the drafting route treats as the
 * form's date, and person memory reads — was set once at creation. A Date
 * changed on the card or in chat changed only the form's Date line, and
 * "Edit as new draft" dated the new draft the day it was opened.
 */
describe("a form's date is one date on every surface", () => {
  /** Every place a form's date is shown, read for one form. */
  async function everywhere(id: string) {
    const f = await form(id);
    const listed = (await listInstances("all")).find((row) => row.id === id);
    const pdf = await pdfRoute.GET(new Request(`https://app.test/api/forms/instances/${id}/pdf`), {
      params: Promise.resolve({ id }),
    });
    const filename = /filename="([^"]+)"/.exec(pdf.headers.get("content-disposition") ?? "")?.[1] ?? "";
    return {
      value: f.text("form_date"),
      reopened: String(f.instance.formDate),
      register: listed?.formDate ?? null,
      pdfNamesIt: filename,
    };
  }
  const expectAll = async (id: string, iso: string) => {
    const seen = await everywhere(id);
    expect(seen.value, "Date line").toBe(iso);
    expect(seen.reopened, "reopened form").toBe(iso);
    expect(seen.register, "Forms Register").toBe(iso);
    expect(seen.pdfNamesIt, "PDF").toContain(iso);
  };

  async function created() {
    const thread = new Thread();
    await thread.say(ISSUE_1);
    state.draft = ISSUE_1_MODEL;
    const { id } = await thread.create();
    return { thread, id };
  }

  it("a Date changed on the card", async () => {
    const { id } = await created();
    await expectAll(id, "2026-10-01");
    await save(id, { form_date: "2026-10-03" });
    await expectAll(id, "2026-10-03");
  });

  it("a Date changed in chat, then again, then back", async () => {
    const { thread, id } = await created();
    await thread.say("change the date to 10-2-26");
    await expectAll(id, "2026-10-02");
    await thread.say("sorry, the date should be 10/3/26");
    await expectAll(id, "2026-10-03");
    await thread.say("it was 10-1-26, not 10-3-26");
    await expectAll(id, "2026-10-01");
    expect((await form(id)).text("observation")).toContain("October 1, 2026");
  });

  it("Edit as new draft keeps the form's date, not the day it is reopened; the finalized original keeps its own", async () => {
    const { id } = await created();
    await save(id, { form_date: "2026-10-03" });
    expect((await act(id, { action: "finalize", followUpDate: null })).status).toBe(200);
    const reopened = await act(id, { action: "revise" });
    const draftId = toUuid(reopened.payload.instance!.id);
    await expectAll(draftId, "2026-10-03");
    await expectAll(id, "2026-10-03");
    /* The new draft's date is changed; the finalized record's is not. */
    await save(draftId, { form_date: "2026-10-04" });
    await expectAll(draftId, "2026-10-04");
    await expectAll(id, "2026-10-03");
  });

  it("a later draft is written against the form's current date, not the one it was created with", async () => {
    const { id } = await created();
    await save(id, { form_date: "2026-10-03" });
    state.draft = {
      values: { observation: "Observed:\nOn October 21, 2026, Marlo did not open the salon at the proper time." },
      checked: { offense_type: ["tardiness"] },
    };
    await call(`/api/forms/instances/${id}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "marlo opened the salon late. payroll deduct $25" }),
    });
    expect((await form(id)).text("observation")).toContain("October 3, 2026");
  });
});

/* ========================================================================= */
/* DATE CORRECTIONS: AMBIGUOUS, COMBINED, AND WHAT THEY MUST NOT TOUCH       */
/* ========================================================================= */

describe("date corrections that are ambiguous, combined, or near other dates", () => {
  async function created(model = ISSUE_1_MODEL) {
    const thread = new Thread();
    await thread.say(ISSUE_1);
    state.draft = model;
    const { id } = await thread.create();
    return { thread, id, before: await form(id) };
  }
  const unchanged = async (id: string, before: Awaited<ReturnType<typeof form>>) => {
    const f = await form(id);
    for (const key of ["form_date", "observation", "prior_actions", "action_plan", "policy_language"]) {
      expect(f.text(key), key).toBe(before.text(key));
    }
  };

  it.each([
    ["the date should be 10-2-26 or 10-3-26", /Which date .* October 2, 2026 or October 3, 2026\? I haven't changed it/],
    ["change the date", /What date should .* I haven't changed it/],
    ["the date is wrong", /What date should .* I haven't changed it/],
  ])('"%s" changes nothing and asks', async (text, asked) => {
    const { thread, id, before } = await created();
    const answer = await thread.say(text);
    expect(answer.content).toMatch(asked);
    expect(answer.formUpdate ?? null).toBeNull();
    await unchanged(id, before);
    /* The answer to the question is then taken. */
    await thread.say("change the date to 10-3-26");
    expect((await form(id)).text("form_date")).toBe("2026-10-03");
  });

  it.each([["October 3"], ["10/3/26"], ["it's october 3, 2026"]])(
    'answered "%s" straight after the question, the date is set',
    async (answer) => {
      const { thread, id } = await created();
      await thread.say("the date should be 10-2-26 or 10-3-26");
      await thread.say(answer);
      expect((await form(id)).text("form_date")).toBe("2026-10-03");
    },
  );

  it("a new request for someone else that mentions a date is a new request, not a date question", async () => {
    const { thread, id, before } = await created();
    const answer = await thread.say("Create a new CA for Sela Brandt, she was on her phone. The date is wrong on her timecard");
    expect(answer.content).not.toMatch(/What date should|Which date should/);
    expect(answer.formProposal?.employeeName).toBe("Sela Brandt");
    expect((await form(id)).text("form_date")).toBe(before.text("form_date"));
  });

  it("asks on a finalized form without opening a draft of it", async () => {
    const { thread, id } = await created();
    expect((await act(id, { action: "finalize", followUpDate: null })).status).toBe(200);
    const answer = await thread.say("change the date");
    expect(answer.content).toMatch(/What date should/);
    expect((store.form_instances ?? []).some((row) => row.revises_instance_id === id)).toBe(false);
  });

  it("a Prior Actions line signed the same day as the incident is never moved", async () => {
    const { thread, id } = await created({
      ...ISSUE_1_MODEL,
      values: { ...ISSUE_1_MODEL.values, prior_actions: "Verbal warning — signed 10/01/2026" },
    });
    const prior = (await form(id)).text("prior_actions");
    await thread.say("change the date to 10-2-26");
    const f = await form(id);
    expect(f.text("form_date")).toBe("2026-10-02");
    expect(f.text("observation")).toContain("October 2, 2026");
    expect(f.text("prior_actions")).toBe(prior);
  });

  it("a payroll answer and a date in one message are both made", async () => {
    const { thread, id } = await created();
    await thread.say("no payroll deduct and change the date to 10-2-26");
    const f = await form(id);
    expect(f.ticks("payroll_deduct")).toEqual(["no"]);
    expect(f.text("form_date")).toBe("2026-10-02");
    expect(f.text("action_plan")).not.toMatch(/deduct|\$/i);
  });

  it("the employee's name is still never changed from chat on this form", async () => {
    const { thread, id } = await created();
    await thread.say("change the name to Jane Smith");
    expect((await form(id)).text("employee_name")).toBe("Marlo Quist");
  });

  it("an observation the manager partly rewrote is theirs: a date correction leaves every word of it", async () => {
    const { thread, id } = await created();
    const drafted = (await form(id)).text("observation")!;
    /*
     * DRAFT_NO_INVENTED_PLAN_ENABLED (intended change): the draft has no model
     * "Going Forward:" to rename, so the manager's edit renames a heading that is
     * still there. The point is the same: an observation the manager touched is
     * theirs.
     */
    const edited = draftNoInventedPlanEnabled()
      ? drafted.replace("Expectation:", "Expectation (manager):")
      : drafted.replace("Going Forward:", "Going Forward (manager):");
    expect(edited).not.toBe(drafted);
    await save(id, { observation: edited });
    await thread.say("change the date to 10-2-26");
    await thread.say("change the date to 10-3-26");
    const f = await form(id);
    expect(f.text("form_date")).toBe("2026-10-03");
    expect(f.text("observation")).toBe(edited);
  });

  /*
   * DRAFT_NO_INVENTED_PLAN_ENABLED (dispatcher / QA-2, 26 Oct 2026): with the
   * flag on the draft has no "Going Forward:" to rename, so the test above has
   * no manager edit to keep. Here the manager TYPES their own Going Forward
   * into the drafted observation: date corrections keep every word of it,
   * flag off and on — the flag drops only what the model wrote.
   */
  for (const on of [false, true]) {
    it(`NEVER-BREAK (flag ${on ? "on" : "off"}): a Going Forward the manager typed into the observation survives date corrections`, async () => {
      const before = process.env.DRAFT_NO_INVENTED_PLAN_ENABLED;
      if (on) process.env.DRAFT_NO_INVENTED_PLAN_ENABLED = "true";
      else delete process.env.DRAFT_NO_INVENTED_PLAN_ENABLED;
      try {
        const { thread, id } = await created();
        const drafted = (await form(id)).text("observation")!;
        const edited = `${drafted.replace(/\n*Going Forward:[\s\S]*$/, "")}\n\nGoing Forward:\nMarlo will arrive 30 minutes before opening and text me if running late.`;
        await save(id, { observation: edited });
        await thread.say("change the date to 10-2-26");
        await thread.say("change the date to 10-3-26");
        const f = await form(id);
        expect(f.text("form_date")).toBe("2026-10-03");
        expect(f.text("observation")).toBe(edited);
        expect(f.text("observation")).toContain("Marlo will arrive 30 minutes before opening and text me if running late.");
      } finally {
        if (before === undefined) delete process.env.DRAFT_NO_INVENTED_PLAN_ENABLED;
        else process.env.DRAFT_NO_INVENTED_PLAN_ENABLED = before;
      }
    });
  }
});
