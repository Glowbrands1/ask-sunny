import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA, 26 OCT 2026 — A COACHING SENTENCE ON A CORRECTIVE ACTION IS A PRIOR
 * ============================================================================
 *
 * QA tester, Ask Sunny production 8365e21f, LATE_OPEN_DATE_ENABLED and
 * PRIOR_ACTIONS_PARSE_ENABLED on, at the card stage. The tester's words, word
 * for word ("rory vance" is the tester's invented name):
 *
 *   T1 "create a ca for rory vance at kearney, she was late on 10-5 and 10-15.
 *       i coached her on 10-16 about being late"
 *       → Date 10/5; Observation of Offense only the coaching sentence (the
 *         lateness gone); no Prior actions.
 *   D1 "create a ca for rory vance. i coached her on 10-16 about being late.
 *       she was late again today"
 *       → Date today; Observation the coaching only; no Prior actions.
 *   D2 "ca for rory vance, she came in late on 10-5, i coached her on 10-16"
 *       → Date 10/5; Observation both clauses; no Prior actions.
 *   D3 "ca for rory vance, coached her 10-16, written warning on 10-20"
 *       → Date 10/20, the prior written warning's day; no Prior actions.
 *
 * And a SAVED production draft from T1 (coordinator, 26 Oct 2026): the
 * Observation read "…arrived late … on October 5, 2026, and again." and
 * "…was coached about being late on October 5, 2026" — 10-15 lost, the
 * coaching moved onto a lateness date — with no prior action. The model's
 * dates were rewritten by code: `correctDraftedDates` reads only dates with a
 * year, so "October 15/16" were "invented" and replaced with the form's date.
 *
 * Behind PRIOR_SENTENCE_FIX_ENABLED (default off, same flag in both apps):
 *
 *   (a) the form's Date is never a prior step's date; with no incident date
 *       left (D3) it follows the rule for a request with no date;
 *   (b) the incident clause stays in the Observation, and the coaching or
 *       prior clause is not used as it;
 *   (c) "i coached her on 10-16", "coached her 10-16" and "written warning on
 *       10-20" are Prior actions rows, read by the existing prior-actions
 *       reader (`statedPriorActions` / `priorSteps`);
 *   and on the created draft, every date the manager gave stays as given, a
 *   coaching sentence carries the coaching's date, and the coaching is the
 *   Prior actions row.
 *
 * A Coaching Form is unchanged: there "I coached her on 10-16" is the form's
 * own event. Every turn goes through POST /api/chat (and Create through the
 * draft route) with this app's production flags. Flag off, each case reads
 * as production did. Synthetic names; "Corvin Mallow" is invented.
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
  slotReading: "none" as "none" | "ca" | "copy",
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

vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => {
    state.chatModelCalls += 1;
    return ANSWER;
  },
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name !== "record_intent_slots") return null;
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
const chatRoute = await import("./route");
const instancesRoute = await import("../forms/instances/route");
const draftRoute = await import("../forms/instances/[id]/draft/route");

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

const PRODUCTION = [
  "INTENT_EXTRACTION_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "POLICY_CITATION_ENABLED",
  "SECOND_FORM_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
] as const;
const FLAG = "PRIOR_SENTENCE_FIX_ENABLED";
const ALL_FLAGS = [...PRODUCTION, FLAG, "CODE_SLOTS_ENABLED", "FORM_FULL_REMAP_ENABLED", "MANAGER_WORDS_ONLY_ENABLED"];

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
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.directory = [
    { id: "e-1", firstName: "Rory", lastName: "Vance", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"] },
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


const LIVE = {
  T1: "create a ca for rory vance at kearney, she was late on 10-5 and 10-15. i coached her on 10-16 about being late",
  D1: "create a ca for rory vance. i coached her on 10-16 about being late. she was late again today",
  D2: "ca for rory vance, she came in late on 10-5, i coached her on 10-16",
  D3: "ca for rory vance, coached her 10-16, written warning on 10-20",
} as const;

/** The same words in Sentence case: each sentence opens with a capital, and "i" is "I". */
function sentenceCase(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`).replace(/\bi\b/g, "I");
}

const CASINGS = [
  ["lowercase", (text: string) => text],
  ["Sentence case", sentenceCase],
] as const;

const READINGS = [
  ["a slot reading that names nothing", "none"],
  ["the Corrective Action reading", "ca"],
  ["a reading that copies the first date", "copy"],
] as const;

function useProfile(fix: boolean) {
  for (const name of ALL_FLAGS) delete process.env[name];
  for (const name of PRODUCTION) process.env[name] = "true";
  if (fix) process.env[FLAG] = "true";
}

/** The card's "Prior actions" line, without its confirmation. */
function priorLine(content: string): string | null {
  const line = /\*\*Prior actions:\*\*\s*([^\n]+)/.exec(content)?.[1];
  return line ? line.replace(/, as you said\b.*$/, "") : null;
}

function observation(content: string): string {
  return /\*\*Observation of Offense:\*\*\s*([^\n]*)/.exec(content)?.[1] ?? "";
}

async function card(said: string) {
  const thread = new Thread();
  const answer = await thread.say(said);
  return { thread, answer, proposal: answer.formProposal ?? null };
}

describe.each(READINGS)("flag on, with %s", (_label, reading) => {
  beforeEach(() => {
    useProfile(true);
    state.slotReading = reading;
  });

  describe.each(CASINGS)("%s", (_casing, cased) => {
    it("T1: dated 10/5, the lateness is the Observation, the coaching is the prior action", async () => {
      const { answer, proposal } = await card(cased(LIVE.T1));
      expect(proposal?.templateKey).toBe("dpoa");
      expect(proposal?.formDate).toBe("2026-10-05");
      expect(observation(answer.content)).toMatch(/she was late on 10-5 and 10-15/i);
      expect(observation(answer.content)).not.toMatch(/coach/i);
      expect(priorLine(answer.content)).toBe("Coaching about being late — 10/16/2026");
    });

    it("D1: dated today, \"she was late again today\" is the Observation, the coaching is the prior action", async () => {
      const { answer, proposal } = await card(cased(LIVE.D1));
      expect(proposal?.formDate).toBe(TODAY);
      expect(observation(answer.content)).toMatch(/she was late again today/i);
      expect(observation(answer.content)).not.toMatch(/coach/i);
      expect(priorLine(answer.content)).toBe("Coaching about being late — 10/16/2026");
    });

    it("D2: dated 10/5, the coaching clause leaves the Observation for the prior actions", async () => {
      const { answer, proposal } = await card(cased(LIVE.D2));
      expect(proposal?.formDate).toBe("2026-10-05");
      expect(observation(answer.content)).toMatch(/she came in late on 10-5/i);
      expect(observation(answer.content)).not.toMatch(/coach/i);
      expect(priorLine(answer.content)).toBe("Coaching — 10/16/2026");
    });

    it("D3: never dated 10/20; dated as a request with no date, with both priors listed", async () => {
      // Main's rule for a request with no date, on the same profile.
      const undated = await card(cased("ca for rory vance"));
      const { answer, proposal } = await card(cased(LIVE.D3));
      expect(proposal?.formDate ?? null).not.toBe("2026-10-20");
      expect(proposal?.formDate ?? null).not.toBe("2026-10-16");
      expect(proposal?.formDate ?? null).toBe(undated.proposal?.formDate ?? null);
      expect(answer.content).not.toMatch(/\*\*Date:\*\* 10\/(?:20|16)\/2026/);
      expect(observation(answer.content)).not.toMatch(/coach|written warning/i);
      expect(priorLine(answer.content)).toBe("Coaching — 10/16/2026; Written warning — 10/20/2026");
    });
  });

  it("negation: \"she was never coached before\" lists no prior action", async () => {
    const { answer, proposal } = await card("create a ca for rory vance, she was late on 10-20. she was never coached before");
    expect(proposal?.formDate).toBe("2026-10-20");
    expect(priorLine(answer.content)).toBeNull();
  });

  it("negation: \"i never coached her on 10-16\" lists no prior action", async () => {
    const { answer } = await card("create a ca for rory vance, she was late on 10-20. i never coached her on 10-16");
    expect(priorLine(answer.content)).toBeNull();
  });

  it("another person: \"i coached Corvin Mallow on 10-16\" stays off Rory's priors and date", async () => {
    const { answer, proposal } = await card("create a ca for rory vance, she was late on 10-20. i coached Corvin Mallow on 10-16");
    expect(proposal?.formDate ?? null).not.toBe("2026-10-16");
    expect(priorLine(answer.content) ?? "").not.toMatch(/10\/16/);
  });

  it("two clauses: two coachings are two prior actions, and the lateness dates the form", async () => {
    const { answer, proposal } = await card("create a ca for rory vance, she was late on 10-20. i coached her on 10-1 and i coached her on 10-16");
    expect(proposal?.formDate).toBe("2026-10-20");
    expect(priorLine(answer.content)).toBe("Coaching — 10/01/2026; Coaching — 10/16/2026");
    expect(observation(answer.content)).not.toMatch(/coach/i);
  });

  it("a real incident date after the coaching dates the form", async () => {
    const { answer, proposal } = await card("create a ca for rory vance. i coached her on 10-16 about being late, she was late again on 10-22");
    expect(proposal?.formDate).toBe("2026-10-22");
    expect(priorLine(answer.content)).toBe("Coaching about being late — 10/16/2026");
    expect(observation(answer.content)).toMatch(/she was late again on 10-22/);
  });
});

describe("a Coaching Form is unchanged: the coaching held is never a prior action there", () => {
  it("flag on reads the Coaching Form exactly as flag off", async () => {
    const said = "coaching form for rory vance at kearney, she was late on 10-5 and 10-15, I coached her on 10-16 about being late";
    useProfile(false);
    const off = await card(said);
    useProfile(true);
    const on = await card(said);
    expect(on.proposal?.templateKey).toBe("coaching");
    expect(on.proposal?.formDate).toBe(off.proposal?.formDate);
    expect(priorLine(on.answer.content)).toBeNull();
    expect(on.answer.content.replace(/conv-[\w-]+/g, "")).toBe(off.answer.content.replace(/conv-[\w-]+/g, ""));
  });
});

/*
 * NEVER-BREAK: with the flag off, each case reads exactly as production
 * 8365e21f did (and this branch's base): the values the QA tester reported.
 */
describe.each(READINGS)("flag off, with %s: as production", (_label, reading) => {
  beforeEach(() => {
    useProfile(false);
    state.slotReading = reading;
  });

  it("T1", async () => {
    const { answer, proposal } = await card(LIVE.T1);
    expect(proposal?.formDate).toBe("2026-10-05");
    expect(observation(answer.content)).toBe(
      "It happened at NE Kearney. Policy reference: Attendance, JBA Policy Manual p.14. i coached her on 10-16 about being late",
    );
    expect(priorLine(answer.content)).toBeNull();
  });

  it("D1", async () => {
    const { answer, proposal } = await card(LIVE.D1);
    expect(proposal?.formDate).toBe(TODAY);
    expect(observation(answer.content)).toBe(
      "It happened at NE Kearney. Policy reference: Attendance, JBA Policy Manual p.14. i coached her on 10-16 about being late.",
    );
    expect(priorLine(answer.content)).toBeNull();
  });

  it("D2", async () => {
    const { answer, proposal } = await card(LIVE.D2);
    expect(proposal?.formDate).toBe("2026-10-05");
    expect(observation(answer.content)).toBe(
      "It happened at NE Kearney. Policy reference: Attendance, JBA Policy Manual p.14. ca for rory vance, she came in late on 10-5, i coached her on 10-16",
    );
    expect(priorLine(answer.content)).toBeNull();
  });

  it("D3", async () => {
    const { answer, proposal } = await card(LIVE.D3);
    expect(proposal?.formDate).toBe("2026-10-20");
    expect(priorLine(answer.content)).toBeNull();
  });
});

/*
 * ============================================================================
 * THE CREATED DRAFT (the draft route)
 * ============================================================================
 */
const MODEL_OBSERVATION =
  "Observed: Rory Vance arrived late for the scheduled shift on October 5, 2026, and again on October 15, 2026. Rory Vance was coached about being late on October 16, 2026.\n\nExpectation: Rory Vance is expected to arrive on time for every scheduled shift.";
/** The saved production draft's Observation, as the model's own output. */
const SAVED_BAD_OBSERVATION =
  "Observed: Rory Vance arrived late for the scheduled shift on October 5, 2026, and again. Rory Vance was coached about being late on October 5, 2026.\n\nExpectation: Rory Vance is expected to arrive on time for every scheduled shift.";

async function createdDraft(said: string, observationText: string) {
  state.draft = { values: { observation: observationText, prior_actions: "" } };
  const thread = new Thread();
  await thread.say(said);
  const id = await thread.create();
  const value = (key: string) =>
    (store.form_instance_values.find((row) => row.instance_id === id && row.field_key === key)?.value as string | undefined) ?? null;
  return { observation: value("observation"), priorActions: value("prior_actions"), formDate: value("form_date") };
}

describe.each(CASINGS)("the created draft from T1 (%s)", (_casing, cased) => {
  it("flag on: both lateness dates and the coaching's 10/16 stay, and the coaching is the prior action", async () => {
    useProfile(true);
    const draft = await createdDraft(cased(LIVE.T1), MODEL_OBSERVATION);
    expect(draft.formDate).toBe("2026-10-05");
    expect(draft.observation).toContain("on October 5, 2026, and again on October 15, 2026.");
    expect(draft.observation).toContain("coached about being late on October 16, 2026.");
    expect(draft.priorActions).toBe("Coaching about being late — 10/16/2026");
  });

  it("flag on: a model that puts the coaching on 10/5 is corrected to the manager's 10/16", async () => {
    useProfile(true);
    const draft = await createdDraft(cased(LIVE.T1), MODEL_OBSERVATION.replace("October 16", "October 5"));
    expect(draft.observation).toContain("on October 5, 2026, and again on October 15, 2026.");
    expect(draft.observation).toContain("coached about being late on October 16, 2026.");
    expect(draft.observation).not.toContain("coached about being late on October 5");
  });

  it("flag on: the saved production text itself gets the coaching's own date, and nothing is invented", async () => {
    useProfile(true);
    const draft = await createdDraft(cased(LIVE.T1), SAVED_BAD_OBSERVATION);
    expect(draft.observation).toContain("coached about being late on October 16, 2026.");
    // "and again." names no date; the draft does not write one the model did not.
    expect(draft.observation).toContain("on October 5, 2026, and again.");
    expect(draft.priorActions).toBe("Coaching about being late — 10/16/2026");
  });

  it("flag off: the draft is exactly what production saved", async () => {
    useProfile(false);
    const draft = await createdDraft(cased(LIVE.T1), MODEL_OBSERVATION);
    expect(draft.formDate).toBe("2026-10-05");
    expect(draft.observation).toBe(
      "Observed:\nRory Vance arrived late for the scheduled shift on October 5, 2026, and again. Rory Vance was coached about being late on October 5, 2026.\n\nExpectation:\nRory Vance is expected to arrive on time for every scheduled shift.",
    );
    expect(draft.priorActions).toBeNull();
  });
});

describe("the created draft: probes", () => {
  it("another person's coaching date stays off Rory's coaching sentence and priors", async () => {
    useProfile(true);
    const draft = await createdDraft(
      "create a ca for rory vance, she was late on 10-20. i coached Corvin Mallow on 10-16",
      "Observed: Rory Vance arrived late on October 20, 2026. Rory Vance was coached about being late on October 20, 2026.",
    );
    expect(draft.observation).not.toContain("October 16");
    expect(draft.priorActions ?? "").not.toContain("10/16");
  });

  it("a date the manager gave for the incident stays as given", async () => {
    useProfile(true);
    const draft = await createdDraft(
      "create a ca for rory vance. i coached her on 10-16 about being late, she was late again on 10-22",
      "Observed: Rory Vance arrived late on October 22, 2026, after being coached about being late on October 16, 2026.",
    );
    expect(draft.formDate).toBe("2026-10-22");
    expect(draft.observation).toContain("arrived late on October 22, 2026, after being coached about being late on October 16, 2026.");
    expect(draft.priorActions).toBe("Coaching about being late — 10/16/2026");
  });
});
