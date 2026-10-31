import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * "IT SAYS UPDATED, THE CARD IS UNCHANGED" — FORM_EDIT_PLAIN_WORDS_ENABLED,
 * FORM_EDIT_HONEST_REPLY_ENABLED
 * ============================================================================
 *
 * PORTED FROM ASK BUBBLES (QA, 30 Oct 2026: production there, a location
 * manager and a regional manager, five low ratings; none here yet, same code). With a Coaching Form draft open, the managers gave the details
 * in plain words, said "make that update", or asked to update the draft "with
 * these details" (the bot's own previous answer). None of those turns reached
 * the revision, so nothing was written — and the ordinary answer said
 * "updated" and printed the Details in the reply. Their exact request wording
 * (the coaching content is this app's, invented), through POST /api/chat with the draft open; the model mocked. Names are invented.
 */

const store: FakeStore = {
  form_instances: [],
  form_instance_values: [],
  form_instance_events: [],
  form_template_versions: [],
  form_templates: [],
  form_template_current: [],
  form_template_assets: [],
  chat_conversations: [],
  chat_messages: [],
  chat_traces: [],
  chat_form_state: [],
  chat_form_incidents: [],
} as unknown as FakeStore;

const revisionAsked = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  slotReading: "none" as "none" | "ca" | "copy",
  remapObservation: null as string | null,
  /** What the form-reading model returns for this turn (extract_form_fields). */
  reading: {} as Record<string, unknown>,
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
  return {
    ...actual,
    liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
    supabaseReadiness: () => ({ ready: true, missing: [] }),
  };
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
          scope: (state as { scope?: unknown }).scope ?? { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] },
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
/** What the answering model says this turn, when a case sets it. */
const said = { answer: null as string | null };

vi.mock("@/lib/ai/call-claude", () => ({
  /*
   * The AI reader (AI_READS_CODE_CHECKS_ENABLED), as the live model reads a
   * lone first name: the name exactly as typed, with its sentence as evidence.
   */
  callClaudeToolTimed: async (input: { messages?: { content?: unknown }[] }) => {
    const text = JSON.stringify(input.messages ?? []);
    const manager = (text.split("Manager: ").pop() ?? "").split("\n")[0]!.replace(/\\"/g, '"').replace(/"\}.*$/, "");
    const named = String(state.reading.employeeName ?? "");
    const name = /\b(katrin)\b/i.exec(manager)?.[1] ?? (named && manager.toLowerCase().includes(named.toLowerCase()) ? named : null);
    return {
      input: {
        employee: name ? { value: name, evidence: manager } : null,
        incident: /late/.test(manager) ? { value: "late", evidence: manager } : null,
        incidentDate: /10\/20/.test(manager) ? { value: "2026-10-20", evidence: "10/20" } : null,
      },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
  callClaude: async () => {
    state.chatModelCalls += 1;
    return said.answer ?? ANSWER;
  },
  callClaudeTool: async (input: { tool?: { name?: string }; messages?: { content?: unknown }[] }) => {
    if (input.tool?.name === "extract_form_fields") {
      const text = JSON.stringify(input.messages ?? []);
      return {
        templateKey: /follow-?up coaching/i.test(text) ? "follow-up-coaching" : /\b(?:ca|corrective action)\b/i.test(text) ? "dpoa" : null,
        employeeName: null,
        observation: state.remapObservation,
        actionPlan: null,
        ...state.reading,
      };
    }
    if (input.tool?.name !== "record_intent_slots") return null;
    if (state.slotReading === "copy") {
      const text = JSON.stringify(input.messages ?? []);
      // The model reads the whole conversation; the warning level only from an answer to its question.
      const manager = (text.split("Manager:").pop() ?? text).replace(/\n/g, "\n");
      const all = text.split("Manager:").slice(1).map((turn) => turn.split("Assistant:")[0]!).join("\n");
      const dates = all.match(/\b\d{1,2}-\d{1,2}\b/g) ?? [];
      return {
        employee: /quinn marlowe/i.test(all) ? "Quinn Marlowe" : null,
        salon: /kearney/i.test(all) ? "Kearney" : null,
        title: null,
        incidentType: /\blate\b/i.test(all) ? "late" : null,
        incidentDate: dates[0] ?? null,
        payrollAmount: null,
        warningLevel: /^\s*(verbal|written)\W*$/i.exec(manager)?.[1]?.toLowerCase() ?? null,
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
        if (revising) {
          state.revisionCalls += 1;
          revisionAsked.push(JSON.stringify((request as { messages?: unknown }).messages ?? []));
        }
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
    // A seed names the handbook; offline there is none, as a failed lookup.
    async fetchNamedHandbook() {
      return { ok: false, reason: "offline", problem: "not_found" };
    }
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

/** A question that is not a form request searches the manual; nothing to embed offline. */
vi.mock("@/lib/knowledge/recall-match", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/recall-match")>()),
  matchRecallKnowledge: async () => [],
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
    readDirectoryFacts: async (scope: AccessScope | null) =>
      // No position on record unless the case gives one: the title is the manager's or asked.
      actual.scopeRoster(state.directory as never, scope).map((person) => ({ ...person, title: (person as { positionName?: string | null }).positionName ?? null, primaryLocationName: "Kearney" })),
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

/** This app's production env, as the sibling e2e tests pin it (see `job-title-from-words-e2e.test.ts`). */
const PRODUCTION = [
  "APP_PASSWORD_HELP_ENABLED",
  "DRAFT_NEVER_BLANK_ENABLED",
  "DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED",
  "EXIT_INTAKE_FIX_ENABLED",
  "FOLLOW_UP_NOT_PRIOR_ENABLED",
  "LATE_OPEN_PAYROLL_FROM_FORM_ENABLED",
  "MANUAL_NEGATED_LIST_NOTE_ENABLED",
  "NAME_BEFORE_TITLE_ENABLED",
  "POLICY_SPECIFIC_TOPICS_ENABLED",
  "REOPEN_VERB_GUARD_ENABLED",
  "SENSITIVE_DEFAULTS_REDACT_ENABLED",
  "STATE_CODE_NOT_A_PERSON_ENABLED",
  "ACTION_PLAN_MANAGER_ONLY_ENABLED",
  "ACTION_PLAN_SENTENCES_ENABLED",
  "ATTENDANCE_POLICY_CITATION_ENABLED",
  "CA_TEMPLATE_MAP_ENABLED",
  "CHAT_STYLE_RULES_ENABLED",
  "CHAT_TRACE_ENABLED",
  "CROSS_CHAT_REPLY_GUARD_ENABLED",
  "CURRENT_MANUAL_SCOPE_ENABLED",
  "DRAFT_MERGE_ENABLED",
  "FEWSHOT_EXAMPLES_ENABLED",
  "FORM_CHOICE_STATED_ENABLED",
  "FULL_MANUAL_CONTEXT_ENABLED",
  "GLOBAL_SALON_ASK_ENABLED",
  "GROUNDED_ENTITIES_ENABLED",
  "HYBRID_SEARCH_ENABLED",
  "INTENT_EXTRACTION_ENABLED",
  "KEEP_FORM_EMPLOYEE_ENABLED",
  "LATE_OPEN_DATE_ENABLED",
  "LONG_CONTEXT_ENABLED",
  "MANAGER_PAYROLL_AMOUNT_ONLY_ENABLED",
  "MANAGER_WORDS_ONLY_ENABLED",
  "MANUAL_SECTION_DEDUPE_ENABLED",
  "NOT_A_NAME_GUARD_ENABLED",
  "PAYROLL_AMOUNT_FIELD_ENABLED",
  "PLACE_SPAN_GUARD_ENABLED",
  "POLICY_PAGE_REQUIRED_ENABLED",
  "PRINTED_PAGE_CITATION_ENABLED",
  "PRIOR_ACTIONS_PARSE_ENABLED",
  "PRIOR_COACHING_OPTIONAL_ENABLED",
  "QUERY_REWRITE_ENABLED",
  "RETRIEVAL_RECALL_ENABLED",
  "SELF_CHECK_ENABLED",
  "SEND_AFTER_HYDRATE_ENABLED",
  "TITLE_WHOLE_WORD_ENABLED",
  "TYPED_NAME_PROCEEDS_ENABLED",
  "WARNING_LEVEL_MANAGER_ONLY_ENABLED",
  "FIELD_ACCURACY_ENABLED",
  "SLOT_RETENTION_ENABLED",
  "DRAFT_DEDUPE_ENABLED",
  "SECOND_FORM_ENABLED",
  "STORED_SLOTS_NOT_A_REQUEST_ENABLED",
] as const;
/** Not production here: the full remap and the flags QA-6 ran it with, as extra coverage. */
const REMAP_EXTRA = ["FORM_FULL_REMAP_ENABLED", "REMAP_INCIDENT_FIX_ENABLED"] as const;
const FLAG = "PRIOR_SENTENCE_FIX_ENABLED";
/** FORM_DATE_INCIDENT_ONLY_ENABLED (D3, =0 in production) is pinned by each case, never read from the shell. */
const FIO = "FORM_DATE_INCIDENT_ONLY_ENABLED";
const ALL_FLAGS = [...PRODUCTION, ...REMAP_EXTRA, FLAG, FIO, "CODE_SLOTS_ENABLED", "POLICY_CITATION_ENABLED", "FORM_STATE_ENABLED", "REMAP_DRAFT_SOURCES_ENABLED", "NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED", "INTENT_PAYROLL_MANAGER_ONLY_ENABLED", "CHAT_DATA_TOOLS_ENABLED", "CHAT_MEMORY_ENABLED"];

type Answer = {
  content: string;
  formProposal?: ChatFormProposal;
  formSelection?: unknown;
  formOpened?: { instanceId: string; revisesInstanceId?: string | null };
  formUpdate?: { instanceId: string; updated: string[] };
};

/** The thread as the browser holds it: a card the answer carried stays open. */
class Thread {
  readonly messages: ChatMessage[] = [];
  proposal: ChatFormProposal | null = null;
  instanceId: string | null = null;
  private sequence = 0;
  // A well-formed client id, so the route keeps the intake state between turns (`isClientConversationId`).
  private readonly conversationId = createId("conv");

  async say(question: string, reading: Record<string, unknown> = {}): Promise<Answer> {
    state.reading = reading;
    const history = this.messages.map(({ id, role, content, formProposal }) => ({ id, role, content, ...(formProposal ? { formProposal } : {}) }));
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
          // As the browser does: the card on screen, or the intake still asking (`continuationFor`).
          ...(!this.instanceId && continuationFor(this.messages) ? { continueProposalTemplateKey: continuationFor(this.messages)!.templateKey } : {}),
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
    if (payload.formOpened) this.instanceId = toUuid(payload.formOpened.instanceId);
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
  state.reading = {};
  state.draft = { values: {} };
  state.revision = { values: {} };
  state.directory = [
    { id: "e-1", firstName: "Quinn", lastName: "Marlowe", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
    { id: "e-2", firstName: "Dale", lastName: "Ferris", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
    { id: "e-3", firstName: "Ivy", lastName: "Hollis", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
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





const JT = "JOB_TITLE_FROM_WORDS_ENABLED";

function setProduction(on: boolean) {
  for (const name of [...ALL_FLAGS, JT]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of PRODUCTION) process.env[name] = "true";
  // Live in this app.
  for (const name of [FLAG, "POSITION_ANSWER_GUARD_ENABLED", "PRIOR_STEP_SENTENCE_ENABLED", "DATE_ANSWER_APPLIED_ENABLED", "DATE_ANSWER_KEEPS_OPEN_ENABLED", "NAME_QUESTION_ONLY_ENABLED"]) process.env[name] = "true";
  process.env.REMAP_DRAFT_SOURCES_ENABLED = "true";
  process.env.NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED = "true";
  if (on) process.env[JT] = "true";
}



const PLAIN = "FORM_EDIT_PLAIN_WORDS_ENABLED";
const HONEST = "FORM_EDIT_HONEST_REPLY_ENABLED";

/** The process the manager typed (LM chat, 30 Oct). */
const PROCESS =
  "this is what i am wanting to coach on: getting rooms ready between guests, here are the details of the process: wipe down the bed with the approved cleaner, use a fresh towel, empty the trash, reset the timer and check the room before the next guest is taken back.";
/** What the answering model wrote back, as it did live: a claim, and the Details in the reply. */
const CLAIMED =
  "Here's the updated **Coaching Form** for Marnie Holloway.\n\n**Details of Coaching:**\nObserved: Rooms are not always reset between guests.\nExpectation: Wipe the bed with the approved cleaner, use a fresh towel, empty the trash and check the room before the next guest.";
const WRITTEN = "Observed: Rooms are cleaned, restocked and checked before every guest.";

async function openDraft(flags: { plain?: boolean; honest?: boolean }) {
  setProduction(false);
  for (const name of [PLAIN, HONEST]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  if (flags.plain) process.env[PLAIN] = "true";
  if (flags.honest) process.env[HONEST] = "true";
  state.directory = [
    { id: "e-1", firstName: "Marnie", lastName: "Holloway", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-66"], positionName: null },
  ];
  state.draft = { values: { coaching_details: "Observed:\nCoaching on room turnover." } };
  const thread = new Thread();
  const card = await thread.say("create a coaching form for Marnie Holloway at Kearney", { templateKey: "coaching", employeeName: "Marnie Holloway" });
  expect(card.formProposal?.templateKey).toBe("coaching");
  const id = await thread.create();
  state.revisionCalls = 0;
  revisionAsked.length = 0;
  state.revision = { values: { coaching_details: WRITTEN } };
  const details = () => store.form_instance_values.find((row) => row.instance_id === id && row.field_key === "coaching_details")?.value;
  return { thread, id, details };
}

/** The manager's next turn (RM chat, 30 Oct), when the card had not changed. */
const SEEN = "i don't see the details updated in the draft card. Do i need to copy and paste it? or should it be automatically updating?";

const CLAIM = /here's the updated|updated the \*\*coaching form|update applied|applied to the draft/i;

describe('"this is what i am wanting to coach on: …" with the draft open', () => {
  it("off (production today): nothing written, and the reply says it was updated", async () => {
    const { thread, details } = await openDraft({});
    said.answer = CLAIMED;
    const reply = await thread.say(PROCESS);
    expect(reply.formUpdate).toBeUndefined();
    expect(state.revisionCalls).toBe(0);
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
    // Here (unlike the sibling app) the intake reads the account as a new card's, beside the open draft.
    expect(reply.content).toMatch(/what I would put on a \*\*Coaching Form/i);
  });

  it("off: the reply to \"i don't see the details updated\" says it updated, with nothing written", async () => {
    const { thread, details } = await openDraft({});
    said.answer = CLAIMED;
    const reply = await thread.say(SEEN);
    expect(reply.formUpdate).toBeUndefined();
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
    expect(reply.content).toMatch(CLAIM);
  });

  it("FORM_EDIT_PLAIN_WORDS: the details are written into the draft, and the card is told", async () => {
    const { thread, id, details } = await openDraft({ plain: true });
    said.answer = CLAIMED;
    const reply = await thread.say(PROCESS);
    expect(reply.formUpdate?.instanceId).toBe(id);
    expect(reply.formUpdate?.updated).toContain("coaching_details");
    expect(details()).toContain("Rooms are cleaned, restocked and checked");
    expect(revisionAsked.join("\n")).toContain("wipe down the bed with the approved cleaner");
  });

  it("FORM_EDIT_HONEST_REPLY: when nothing was written, the reply never says it was", async () => {
    const { thread } = await openDraft({ honest: true });
    said.answer = CLAIMED;
    const reply = await thread.say(SEEN);
    expect(reply.formUpdate).toBeUndefined();
    expect(reply.content).not.toMatch(CLAIM);
    expect(reply.content).toMatch(/nothing on the form has changed/i);
    // What it drafted stays, for the manager to have written.
    expect(reply.content).toContain("use a fresh towel");
  });
});

describe('"make that update" after a reply that printed the Details', () => {
  it("off: nothing written", async () => {
    const { thread, details } = await openDraft({});
    said.answer = CLAIMED;
    await thread.say(SEEN);
    said.answer = "Here's the update applied to the draft: **Details of Coaching:** Observed: the room is checked before each guest.";
    const reply = await thread.say("make that update");
    expect(reply.formUpdate).toBeUndefined();
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
  });

  it("FORM_EDIT_PLAIN_WORDS: the Details the previous reply printed are written", async () => {
    const { thread, details } = await openDraft({ plain: true });
    said.answer = CLAIMED;
    await thread.say(SEEN);
    const reply = await thread.say("make that update");
    expect(reply.formUpdate?.updated).toContain("coaching_details");
    expect(details()).toContain("Rooms are cleaned, restocked and checked");
    expect(revisionAsked.at(-1)).toContain("use a fresh towel, empty the trash");
  });
});

describe('"can you upate the draft with these details of coaching?" after a how-to answer', () => {
  const GUIDE = "Here is how to turn a room: wipe the bed with the approved cleaner, replace the towel, empty the trash, and check the room before the next guest goes back.";

  it("off: refused as if the details were missing", async () => {
    const { thread, details } = await openDraft({});
    said.answer = GUIDE;
    await thread.say("how do i turn a room between guests?");
    said.answer = "I don't see the actual details in your message — just the request to add them.";
    const reply = await thread.say("can you upate the draft with these details of coaching?");
    expect(reply.formUpdate).toBeUndefined();
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
  });

  it("FORM_EDIT_PLAIN_WORDS: \"these details\" are the previous answer's, written into the draft", async () => {
    const { thread, details } = await openDraft({ plain: true });
    said.answer = GUIDE;
    await thread.say("how do i turn a room between guests?");
    const reply = await thread.say("can you upate the draft with these details of coaching?");
    expect(reply.formUpdate?.updated).toContain("coaching_details");
    expect(details()).toContain("Rooms are cleaned, restocked and checked");
    expect(revisionAsked.at(-1)).toContain("check the room before the next guest goes back");
  });
});

describe("a stated behaviour of the employee with her coaching draft open", () => {
  const SAID = "Marnie took the next guest back before the room had been cleaned";

  it("off: answered, nothing written", async () => {
    const { thread, details } = await openDraft({});
    said.answer = "Want me to add this to the coaching form? Tell me exactly what to write.";
    const reply = await thread.say(SAID);
    expect(reply.formUpdate).toBeUndefined();
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
  });

  it("FORM_EDIT_PLAIN_WORDS: it goes to the Details of Coaching", async () => {
    const { thread, details } = await openDraft({ plain: true });
    const reply = await thread.say(SAID);
    expect(reply.formUpdate?.updated).toContain("coaching_details");
    expect(details()).toContain("Rooms are cleaned, restocked and checked");
    expect(revisionAsked.at(-1)).toContain("took the next guest back before the room");
  });

  it("FORM_EDIT_PLAIN_WORDS: a question about her is still answered, not written", async () => {
    const { thread } = await openDraft({ plain: true });
    const reply = await thread.say("how long has Marnie worked here?");
    expect(reply.formUpdate).toBeUndefined();
    expect(state.revisionCalls).toBe(0);
  });
});

/*
 * PORTED FROM THE ASK BUBBLES LIVE CHECK, 31 Oct 2026 (QA's tester, A6): after
 * a how-to answer, "can you upate the draft with these details of coaching?"
 * wrote nothing — the answer's capitalised terms read as other people to the
 * open-form revision, which dropped the request, and the ordinary answer ran
 * instead. The answer below is this app's own (invented); its "Approved
 * Cleaner", "Front Desk", "Use Bed Status", "Help Desk" and "that's a separate
 * process — equipment repair" read as people here the same way.
 */
const LIVE_GUIDE = [
  "Here's how to turn a room between guests, pulled from the company knowledge base:",
  "",
  "**Cleaning the bed**",
  "- Spray the acrylic with the Approved Cleaner and wipe it with a fresh towel.",
  "",
  "**Before the next guest**",
  "- Reset the timer at the Front Desk and check the room.",
  "",
  "**If a bed is out of service**",
  "That's a separate process — equipment repair. Use Bed Status to mark it down. Note this only applies to beds — for a spray booth issue, you submit a Help Desk request instead.",
].join("\n");
const THESE = "can you upate the draft with these details of coaching?";
const UNRELATED = "Those sources are about how coaching forms should generally be structured";

describe('live check A6: "can you upate the draft with these details of coaching?" after an answer full of capitalised terms', () => {
  async function ask(revision: typeof state.revision, flags: { plain?: boolean; honest?: boolean } = { plain: true, honest: true }) {
    const draft = await openDraft(flags);
    state.revision = revision;
    said.answer = LIVE_GUIDE;
    await draft.thread.say("how do i turn a room between guests?");
    said.answer = `${UNRELATED} — not specific facts about turning a room. There's nothing in them to add.`;
    const reply = await draft.thread.say(THESE);
    return { ...draft, reply };
  }

  it("FORM_EDIT_PLAIN_WORDS: the answer is written into Details, and the card is told", async () => {
    const { reply, id, details } = await ask({ values: { coaching_details: WRITTEN } });
    expect(reply.formUpdate?.instanceId).toBe(id);
    expect(reply.formUpdate?.updated).toContain("coaching_details");
    expect(details()).toContain("Rooms are cleaned, restocked and checked");
    expect(reply.content).not.toContain(UNRELATED);
    // The revision drafted from the answer itself.
    expect(revisionAsked.at(-1)).toContain("Use Bed Status to mark it down");
  });

  it("the revision model makes no change: nothing written, and never the unrelated answer", async () => {
    const { reply, details } = await ask({ values: {} });
    expect(reply.formUpdate).toBeUndefined();
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
    expect(reply.content).not.toContain(UNRELATED);
    expect(state.revisionCalls).toBe(1);
  });

  it("both flags off (as before): nothing written", async () => {
    const { reply, details } = await ask({ values: { coaching_details: WRITTEN } }, {});
    expect(reply.formUpdate).toBeUndefined();
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
  });
});

describe('live check A5: "make that update" after a reply that offered no update', () => {
  it("FORM_EDIT_PLAIN_WORDS: that reply is not written into Details", async () => {
    const { thread, details } = await openDraft({ plain: true, honest: true });
    said.answer = "It should update automatically — no copy-and-paste needed, since changes here go straight to the draft card. If you're not seeing the towel detail reflected there, try refreshing the card view.";
    await thread.say(SEEN);
    said.answer = "Tell me what to add.";
    const reply = await thread.say("make that update");
    expect(reply.formUpdate).toBeUndefined();
    expect(state.revisionCalls).toBe(0);
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
  });
});

describe("a turn read as content for the form that the revision still refuses", () => {
  // The manager's own words naming somebody else keep the revision's own rule: not written to Marnie's form.
  const SAID = "this is what i am wanting to coach on: Jordan Blake showed the team how to clean the beds";

  it("FORM_EDIT_HONEST_REPLY: said plainly, never the ordinary answer", async () => {
    const { thread, details } = await openDraft({ plain: true, honest: true });
    said.answer = "Here's the updated **Coaching Form** for Marnie Holloway.";
    const reply = await thread.say(SAID);
    expect(reply.formUpdate).toBeUndefined();
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
    expect(reply.content).toMatch(/^\*\*Nothing on the form has changed yet\.\*\* I couldn't add that to the Details of Coaching/);
    expect(state.revisionCalls).toBe(0);
  });
});

/*
 * INDEPENDENT REVIEW, 31 Oct 2026, item 4: the honest reply ends "Say make
 * that update and I'll write it into the draft, or edit the card and press
 * Save changes" — and after "make that update" that sentence was written into
 * the Details. Both flags on, the replies the route itself produced.
 */
describe("both flags on: the honest reply, then \"make that update\"", () => {
  it("writes the Details the reply kept, never the reply's own instruction", async () => {
    const { thread, details } = await openDraft({ plain: true, honest: true });
    said.answer = CLAIMED;
    const honest = await thread.say(SEEN);
    expect(honest.content).toMatch(/^\*\*Nothing on the form has changed yet\.\*\*/);
    expect(honest.content).toContain("make that update");
    const reply = await thread.say("make that update");
    expect(reply.formUpdate?.updated).toContain("coaching_details");
    expect(details()).toContain("Rooms are cleaned, restocked and checked");
    const asked = revisionAsked.at(-1) ?? "";
    expect(asked).toContain("use a fresh towel, empty the trash");
    expect(asked).not.toMatch(/press \*\*save changes\*\*|I'll write it into the draft|Nothing on the form has changed/i);
  });
});

describe('independent review item 5: "Marnie was late 3 times this week what should I put for the policy"', () => {
  it("FORM_EDIT_PLAIN_WORDS: answered, never written into Details", async () => {
    const { thread, details } = await openDraft({ plain: true, honest: true });
    const reply = await thread.say("Marnie was late 3 times this week what should I put for the policy");
    expect(reply.formUpdate).toBeUndefined();
    expect(state.revisionCalls).toBe(0);
    expect(details()).not.toContain("Rooms are cleaned, restocked and checked");
  });
});

afterEach(() => {
  said.answer = null;
});
