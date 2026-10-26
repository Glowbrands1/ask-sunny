import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA-6 / QA-7, 26 OCT 2026 — PRIOR SENTENCES AND TWO INCIDENT DATES, ON THE
 * LIVE PATH (THE FULL REMAP)
 * ============================================================================
 *
 * QA-6 re-ran PRIOR_SENTENCE_FIX at 05308f1a with Ask Sunny's FULL
 * production env (FORM_FULL_REMAP on) through POST /api/chat, card and
 * created draft. QA's turns, word for word, with this file's invented name
 * (Rory Vance) for theirs:
 *
 *   D1 "ca for rory vance, coached her 10-16, written warning on 10-20"
 *      → Date 10/20 (the prior written warning's), What happened "written
 *        warning"; the priors were right with the flag on.
 *   D2 "create a ca for rory vance at kearney, she was late on 10-5 and 10-15.
 *       i coached her on 10-16 about being late"
 *      → Date 10/5 (10/15 with FORM_DATE_INCIDENT_ONLY), What happened "late
 *        on 10-5 and" — the second date cut off.
 *
 * QA-7: "i coached her on 10-16 and <another name> on 10-17" listed the other
 * person's 10/17 as Rory's prior, and "i coached her coworker, not her, on
 * 10-16" gave Rory a prior.
 *
 * Coordinator's ruling (PRIOR_SENTENCE_FIX_ENABLED, both apps): two incident
 * dates are asked ONCE ("Which date goes on the form?"), both stay in What
 * happened, and the form is dated the day it is created until the manager
 * answers; the answer sets it; "change the date to …" still works; an earlier
 * step's date is never an incident date; a range ("from 10-5 to 10-9") is one
 * incident dated its first day; one date asks nothing.
 *
 * Every turn through POST /api/chat, and Create through the draft route, with
 * the production env below; FORM_DATE_INCIDENT_ONLY_ENABLED pinned (unset, and
 * an extra run with it on). Flag off, each case reads as production does
 * today. "Corvin Mallow" is invented.
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
  remapObservation: null as string | null,
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
    if (input.tool?.name === "extract_form_fields") {
      const text = JSON.stringify(input.messages ?? []);
      return {
        templateKey: /\b(?:ca|corrective action)\b/i.test(text) ? "dpoa" : null,
        employeeName: /rory vance/i.test(text) ? "Rory Vance" : null,
        observation: state.remapObservation,
        actionPlan: null,
      };
    }
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

/**
 * Ask Sunny's production env as QA-6 runs it (coordinator, 26 Oct 2026): the
 * full remap, intent extraction, and the flags on with them.
 */
const PRODUCTION = [
  "FORM_FULL_REMAP_ENABLED",
  "INTENT_EXTRACTION_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "REMAP_INCIDENT_FIX_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "EXIT_INTAKE_FIX_ENABLED",
  "REOPEN_VERB_GUARD_ENABLED",
  "PLACE_SPAN_GUARD_ENABLED",
  "STATE_CODE_NOT_A_PERSON_ENABLED",
] as const;
const FLAG = "PRIOR_SENTENCE_FIX_ENABLED";
/** FORM_DATE_INCIDENT_ONLY_ENABLED (D3, off in production) is pinned by each case, never read from the shell. */
const FIO = "FORM_DATE_INCIDENT_ONLY_ENABLED";
const ALL_FLAGS = [...PRODUCTION, FLAG, FIO, "CODE_SLOTS_ENABLED", "GROUNDED_ENTITIES_ENABLED", "QUERY_REWRITE_ENABLED", "POLICY_CITATION_ENABLED", "SECOND_FORM_ENABLED", "GLOBAL_SALON_ASK_ENABLED", "DRAFT_MERGE_ENABLED", "FULL_MANUAL_CONTEXT_ENABLED", "FEWSHOT_EXAMPLES_ENABLED", "LONG_CONTEXT_ENABLED", "REMAP_DRAFT_SOURCES_ENABLED", "NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED"];

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
  state.remapObservation = null;
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


function useProfile(fix: boolean, fio = false) {
  for (const name of ALL_FLAGS) delete process.env[name];
  for (const name of PRODUCTION) process.env[name] = "true";
  if (fix) process.env[FLAG] = "true";
  if (fio) process.env[FIO] = "true";
}

const SAID = {
  D1: "ca for rory vance, coached her 10-16, written warning on 10-20",
  D2: "create a ca for rory vance at kearney, she was late on 10-5 and 10-15. i coached her on 10-16 about being late",
  TWO: "create a ca for rory vance at kearney, she was late on 10-5 and 10-15",
  THREE: "create a ca for rory vance at kearney, she was late 10/5, 10/15 and 10/16",
  RANGE: "create a ca for rory vance at kearney, she was late from 10-5 to 10-9",
  ONE: "create a ca for rory vance at kearney, she was late on 10-5",
  OTHER_IN_LIST: "create a ca for rory vance at kearney, she was late on 10-5. i coached her on 10-16 and corvin mallow on 10-17",
  COWORKER: "create a ca for rory vance at kearney, she was late on 10-5. i coached her coworker, not her, on 10-16",
} as const;

/** Sentence case: each sentence opens with a capital, and "i" is "I". */
function sentenceCase(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`).replace(/\bi\b/g, "I");
}

const CASINGS = [
  ["lowercase", (text: string) => text],
  ["Sentence case", sentenceCase],
  ["CAPS", (text: string) => text.toUpperCase()],
] as const;

const FIO_RUNS = [
  ["D3 unset", false],
  ["D3 on", true],
] as const;

const ASKS = /Which date goes on the form\?/;
const asksAbout = (dates: readonly string[]) =>
  new RegExp(String.raw`You mentioned more than one date \(${dates.map((day) => `\\*\\*${day.replace("/", "\\/")}\\*\\*`).join(", ")}\)\. Which date goes on the form\?`);

async function card(said: string) {
  const thread = new Thread();
  const answer = await thread.say(said);
  return { thread, answer, proposal: answer.formProposal ?? null };
}

const MODEL_OBSERVATION =
  "Observed: Rory Vance arrived late on October 5, 2026, and again on October 15, 2026. Rory Vance was coached about being late on October 16, 2026.";

/**
 * Create, as the browser does it. A remap card names the manager's turns only
 * with REMAP_DRAFT_SOURCES_ENABLED (production drafts from those turns, as
 * QA-6's saved drafts show), so `draftSources()` turns it on before the turns
 * of each draft case, on both sides of the flag.
 */
function draftSources() {
  process.env.REMAP_DRAFT_SOURCES_ENABLED = "true";
  process.env.NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED = "true";
}

async function created(thread: Thread, observationText: string) {
  state.draft = { values: { observation: observationText, prior_actions: "" } };
  const id = await thread.create();
  const value = (key: string) =>
    (store.form_instance_values.find((row) => row.instance_id === id && row.field_key === key)?.value as string | undefined) ?? null;
  return { observation: value("observation"), priorActions: value("prior_actions"), formDate: value("form_date") };
}

describe.each(FIO_RUNS)("flag on, %s", (_fioLabel, fio) => {
  beforeEach(() => useProfile(true, fio));

  describe.each(CASINGS)("%s", (_casing, cased) => {
    it("D1: never dated 10/20 or 10/16; \"written warning\" is not What happened; both priors listed", async () => {
      const { answer, proposal } = await card(cased(SAID.D1));
      expect(proposal?.templateKey).toBe("dpoa");
      expect(proposal?.formDate ?? null).toBeNull();
      expect(answer.content).not.toMatch(/\*\*Date:\*\*/);
      expect(proposal?.issue ?? "").not.toMatch(/written warning|coach/i);
      expect(proposal?.priorActions).toBe("Coaching — 10/16/2026\nWritten warning — 10/20/2026");
    });

    it("D2: asks once which of 10/5 and 10/15, both stay in What happened, the coaching is the prior action", async () => {
      const { answer, proposal } = await card(cased(SAID.D2));
      expect(proposal?.formDate ?? null).toBeNull();
      expect(answer.content).toMatch(asksAbout(["10/5", "10/15"]));
      expect(proposal?.issue ?? "").toMatch(/late on 10-5 and 10-15/i);
      // The manager's words, as typed: "about being late" in their casing.
      expect(proposal?.priorActions?.toLowerCase()).toBe("coaching about being late — 10/16/2026");
    });

    it("\"late on 10-5 and 10-15\" asks, and keeps both dates", async () => {
      const { answer, proposal } = await card(cased(SAID.TWO));
      expect(proposal?.formDate ?? null).toBeNull();
      expect(answer.content).toMatch(asksAbout(["10/5", "10/15"]));
      expect(proposal?.issue ?? "").toMatch(/late on 10-5 and 10-15/i);
    });

    it("\"late 10/5, 10/15 and 10/16\" asks, and keeps all three dates", async () => {
      const { answer, proposal } = await card(cased(SAID.THREE));
      expect(proposal?.formDate ?? null).toBeNull();
      expect(answer.content).toMatch(asksAbout(["10/5", "10/15", "10/16"]));
      expect(proposal?.issue ?? "").toMatch(/late 10\/5, 10\/15 and 10\/16/i);
    });

    it("\"from 10-5 to 10-9\" is one incident: no question, dated its first day, the range kept", async () => {
      const { answer, proposal } = await card(cased(SAID.RANGE));
      expect(proposal?.formDate).toBe("2026-10-05");
      expect(answer.content).not.toMatch(ASKS);
      expect(proposal?.issue ?? "").toMatch(/late from 10-5 to 10-9/i);
    });

    it("a single date asks nothing", async () => {
      const { answer, proposal } = await card(cased(SAID.ONE));
      expect(proposal?.formDate).toBe("2026-10-05");
      expect(answer.content).not.toMatch(ASKS);
    });

    it("the answer sets the date, the question is not asked again, and \"change the date to …\" still works", async () => {
      const { thread } = await card(cased(SAID.D2));
      const answered = await thread.say(cased("10/15"));
      expect(answered.formProposal?.formDate).toBe("2026-10-15");
      expect(answered.content).not.toMatch(ASKS);
      expect(answered.formProposal?.issue ?? "").toMatch(/late on 10-5 and 10-15/i);
      const changed = await thread.say(cased("change the date to 10-20"));
      expect(changed.formProposal?.formDate).toBe("2026-10-20");
      expect(changed.content).not.toMatch(ASKS);
    });

    it.each([
      ["most recent", "2026-10-15"],
      ["the first one", "2026-10-05"],
    ] as const)("the answer \"%s\" sets the date", async (reply, iso) => {
      const { thread } = await card(cased(SAID.TWO));
      const answered = await thread.say(cased(reply));
      expect(answered.formProposal?.formDate).toBe(iso);
    });

    it("QA-7: another person in the same list stays off Rory's priors", async () => {
      draftSources();
      const { thread, proposal } = await card(cased(SAID.OTHER_IN_LIST));
      expect(proposal?.priorActions).toBe("Coaching — 10/16/2026");
      expect(proposal?.formDate).toBe("2026-10-05");
      // In capitals the create route reads "CORVIN MALLOW" as a second person and asks which (as on main); the card is pinned.
      if (_casing === "CAPS") return;
      const draft = await created(thread, "Observed: Rory Vance arrived late on October 5, 2026.");
      expect(draft.priorActions).toBe("Coaching — 10/16/2026");
    });

    it("QA-7: \"i coached her coworker, not her, on 10-16\" is no prior of Rory's", async () => {
      draftSources();
      const { thread, proposal } = await card(cased(SAID.COWORKER));
      expect(proposal?.priorActions ?? null).toBeNull();
      const draft = await created(thread, "Observed: Rory Vance arrived late on October 5, 2026.");
      expect(draft.priorActions ?? null).toBeNull();
    });

    it("the created draft from D2, once answered: card Date = draft Date, both lateness dates and the coaching's 10/16 kept, the coaching the prior action", async () => {
      draftSources();
      const { thread } = await card(cased(SAID.D2));
      const answered = await thread.say(cased("10/15"));
      const draft = await created(thread, MODEL_OBSERVATION);
      expect(draft.formDate).toBe(answered.formProposal?.formDate);
      expect(draft.formDate).toBe("2026-10-15");
      expect(draft.observation).toContain("on October 5, 2026, and again on October 15, 2026.");
      expect(draft.observation).toContain("coached about being late on October 16, 2026.");
      expect(draft.priorActions?.toLowerCase()).toBe("coaching about being late — 10/16/2026");
    });

    it("the created draft from D2, before the answer, is dated today and keeps every date", async () => {
      draftSources();
      const { thread } = await card(cased(SAID.D2));
      const draft = await created(thread, MODEL_OBSERVATION.replace("October 16", "October 5"));
      expect(draft.formDate).toBe(TODAY);
      expect(draft.observation).toContain("on October 5, 2026, and again on October 15, 2026.");
      // A coaching put on a lateness date gets the manager's 10/16.
      expect(draft.observation).toContain("coached about being late on October 16, 2026.");
    });

    it("the created draft from D1: dated today, both priors listed", async () => {
      draftSources();
      const { thread } = await card(cased(SAID.D1));
      const draft = await created(thread, "Observed: Rory Vance has prior coaching and a written warning on file.");
      expect(draft.formDate).toBe(TODAY);
      expect(draft.priorActions).toBe("Coaching — 10/16/2026\nWritten warning — 10/20/2026");
    });
  });
});

/** Production today (main e4ff78ec, flag off, D3 unset): QA-6's live failures, pinned. */
const MAIN: Record<string, { formDate: string | null; issue: string | null; priorActions: string | null }> = {
  D1: { formDate: "2026-10-20", issue: "written warning", priorActions: null },
  D2: { formDate: "2026-10-05", issue: "late on 10-5 and", priorActions: null },
  TWO: { formDate: "2026-10-05", issue: "late on 10-5 and", priorActions: null },
  THREE: { formDate: "2026-10-16", issue: "and", priorActions: null },
  RANGE: { formDate: "2026-10-09", issue: "late from 10-5 to", priorActions: null },
  ONE: { formDate: "2026-10-05", issue: "late", priorActions: null },
  OTHER_IN_LIST: { formDate: "2026-10-17", issue: "late", priorActions: null },
  COWORKER: { formDate: "2026-10-05", issue: "not her", priorActions: null },
};
/** Where D3 (FORM_DATE_INCIDENT_ONLY_ENABLED) on changes production's reading. */
const FIO_MAIN: Record<string, { formDate: string | null; issue: string | null; priorActions: string | null } | undefined> = {
  D2: { formDate: "2026-10-15", issue: "late on 10-5 and", priorActions: null },
  TWO: { formDate: "2026-10-15", issue: "late on 10-5 and", priorActions: null },
};

/*
 * NEVER-BREAK: with the flag off, each case reads exactly as production does
 * today (main e4ff78ec), the live failures included.
 */
describe.each(FIO_RUNS)("flag off, %s: as production", (_fioLabel, fio) => {
  beforeEach(() => useProfile(false, fio));

  it.each(Object.entries(MAIN))("%s", async (key, expected) => {
    const { proposal } = await card(SAID[key as keyof typeof SAID]);
    const want = fio && FIO_MAIN[key] ? FIO_MAIN[key]! : expected;
    expect({ formDate: proposal?.formDate ?? null, issue: proposal?.issue ?? null, priorActions: proposal?.priorActions ?? null }).toEqual(want);
  });
});
