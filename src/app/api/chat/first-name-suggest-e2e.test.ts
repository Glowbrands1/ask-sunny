import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * QA AND PAU, 28 OCT 2026 — A FIRST NAME ALONE IS ASKED ABOUT, FROM THE ROSTER
 * ============================================================================
 *
 * FIRST_NAME_SUGGEST_ENABLED (default off). "create a ca for quinn …" went
 * ahead with a card for the bare first name; "quinn was late on 10/20, write
 * her up" and "I have an employee quinn who …" lost the quinn. Through the
 * chat route and Create with the production flags: the manager's own roster
 * decides the question — two Quinns, "Did you mean …"; one, "Is this for …";
 * none, the reply as before — no card until they answer, asked once, never
 * accepted for them, nobody outside the manager's salons offered. Off, as
 * main. Harness from keeps-own-place-e2e.test.ts; names are invented.
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
  /** The name the AI reader and the intent slots read as typed ("marisol co"), as the live models sometimes do. */
  typedName: null as string | null,
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

vi.mock("@/lib/ai/call-claude", () => ({
  /*
   * The AI reader (AI_READS_CODE_CHECKS_ENABLED), as the live model reads a
   * lone first name: the name exactly as typed, with its sentence as evidence.
   */
  callClaudeToolTimed: async (input: { messages?: { content?: unknown }[] }) => {
    const text = JSON.stringify(input.messages ?? []);
    const manager = (text.split("Manager: ").pop() ?? "").split("\\n")[0]!.replace(/\\"/g, '"').replace(/"\}.*$/, "");
    const name = /\b(katrin)\b/i.exec(manager)?.[1] ?? null;
    const typed = state.typedName && manager.toLowerCase().includes(state.typedName) ? state.typedName : null;
    return {
      input: {
        employee: typed ? { value: typed, evidence: manager } : name ? { value: name, evidence: manager } : null,
        incident: /late/.test(manager) ? { value: "late", evidence: manager } : null,
        incidentDate: /10\/20/.test(manager) ? { value: "2026-10-20", evidence: "10/20" } : null,
      },
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
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
    const typed = state.typedName && JSON.stringify(input.messages ?? []).toLowerCase().includes(state.typedName) ? state.typedName : null;
    return {
      employee: typed,
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
 * Ask Sunny's production env, exactly (Vercel production, read 26 Oct 2026
 * 09:44Z, with the coordinator's correction; PROD-FLAGS-2026-10-26-0944Z).
 * Every other flag is off — FORM_FULL_REMAP and REMAP_INCIDENT_FIX among them.
 */
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
  state.typedName = null;
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




const LIVE_SINCE = [
  "PRIOR_SENTENCE_FIX_ENABLED",
  "DATE_ANSWER_APPLIED_ENABLED",
  "PAYROLL_TYPO_NOT_A_NAME_ENABLED",
  "REQUEST_LINE_ACCOUNT_ENABLED",
  "ATTENDANCE_ACTION_PLAN_ENABLED",
  "HIDE_NO_POLICY_MATCH_NOTICE_ENABLED",
  "ANSWER_NOT_A_NAME_ENABLED",
  "POLICY_SPECIFIC_TOPICS_ENABLED",
] as const;

type Card = ChatFormProposal;
const FLAG_ON = "FIRST_NAME_SUGGEST_ENABLED";
const KEARNEY = "loc-0309";
const LAWRENCE = "loc-0468";
const person = (id: string, first: string, last: string, salon = KEARNEY) => ({
  id, firstName: first, lastName: last, preferredFirstName: null, employmentStatus: "active", salonIds: [salon],
});
const ROSTERS = {
  one: [person("e-1", "Quinn", "Marlowe"), person("e-3", "Rowan", "Kestrel")],
  two: [person("e-1", "Quinn", "Marlowe"), person("e-2", "Quinn", "Ashby"), person("e-3", "Rowan", "Kestrel")],
  zero: [person("e-3", "Rowan", "Kestrel")],
} as const;
const WORDINGS = [
  "create a ca for quinn. she was late on 10/20. no payroll deduct. verbal warning",
  "quinn was late on 10/20, write her up",
  "I have an employee quinn who was late on 10/20. create a ca",
];

function production(on: boolean, roster: keyof typeof ROSTERS | unknown[], scope?: unknown) {
  for (const name of [...ALL_FLAGS, ...LIVE_SINCE, FLAG_ON]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...LIVE_SINCE]) process.env[name] = "true";
  if (on) process.env[FLAG_ON] = "true";
  (state as { scope?: unknown }).scope = scope;
  state.directory = Array.isArray(roster) ? roster : [...ROSTERS[roster]];
}

async function said(on: boolean, roster: keyof typeof ROSTERS | unknown[], ...messages: string[]) {
  production(on, roster);
  const thread = new Thread();
  let answer: { content: string; formProposal?: Card } = { content: "" };
  for (const message of messages) answer = (await thread.say(message)) as typeof answer;
  return { thread, answer };
}

describe("two Quinns on the roster: Did you mean, no card", () => {
  for (const wording of WORDINGS) {
    it(`"${wording}"`, async () => {
      const { answer } = await said(true, "two", wording);
      expect(answer.content).toMatch(/^Did you mean \*\*Quinn (?:Marlowe|Ashby)\*\* or \*\*Quinn (?:Marlowe|Ashby)\*\*\? Tell me which, or give the full name\.$/);
      expect(answer.content).toContain("**Quinn Marlowe**");
      expect(answer.content).toContain("**Quinn Ashby**");
      expect(answer.formProposal).toBeUndefined();
    });
  }
});

describe("one Quinn: Is this for, no card", () => {
  for (const wording of WORDINGS) {
    it(`"${wording}"`, async () => {
      const { answer } = await said(true, "one", wording);
      expect(answer.content).toBe("Is this for **Quinn Marlowe**? Tell me if that should change.");
      expect(answer.formProposal).toBeUndefined();
    });
  }
});

describe("no Quinn on the roster: the reply as main", () => {
  for (const wording of WORDINGS) {
    it(`"${wording}"`, async () => {
      const off = (await said(false, "zero", wording)).answer;
      const on = (await said(true, "zero", wording)).answer;
      expect(on.content).toBe(off.content);
      expect(on.formProposal?.employeeName ?? null).toBe(off.formProposal?.employeeName ?? null);
    });
  }
});

describe("the answer", () => {
  it('"yes" to Is this for: the card is for Quinn Marlowe, and Create makes it', async () => {
    const { thread, answer } = await said(true, "one", WORDINGS[1]!, "yes");
    expect(answer.formProposal?.employeeName).toBe("Quinn Marlowe");
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
  });

  it('"no, Quinn Ashby" is read as written, never Quinn Marlowe', async () => {
    const { answer } = await said(true, "two", WORDINGS[1]!, "no, Quinn Ashby");
    expect(answer.formProposal?.employeeName).toBe("Quinn Ashby");
  });

  it("the full name after Did you mean", async () => {
    const { answer } = await said(true, "two", WORDINGS[0]!, "Quinn Ashby");
    expect(answer.formProposal?.employeeName).toBe("Quinn Ashby");
  });

  it('"ashby" after Did you mean is the one option it names', async () => {
    const { answer } = await said(true, "two", WORDINGS[1]!, "ashby");
    expect(answer.formProposal?.employeeName).toBe("Quinn Ashby");
  });

  it("asked once: a reply that is not an answer is not met with the same question again", async () => {
    const { answer } = await said(true, "one", WORDINGS[1]!, "hmm");
    expect(answer.content).not.toContain("Is this for **Quinn Marlowe**?");
  });
});

describe("never", () => {
  it("offers somebody outside the manager's salons", async () => {
    production(true, [person("e-1", "Quinn", "Marlowe"), person("e-2", "Quinn", "Ashby", "loc-0462")], {
      level: "salon", primaryAreaId: KEARNEY, alsoCoversAreaIds: [],
    });
    const answer = (await new Thread().say(WORDINGS[1]!)) as { content: string };
    expect(answer.content).toBe("Is this for **Quinn Marlowe**? Tell me if that should change.");
  });

  it("leaves out an additional salon's Quinn (an additional salon is the manager's own scope: offered)", async () => {
    production(true, [person("e-1", "Quinn", "Marlowe"), person("e-2", "Quinn", "Ashby", LAWRENCE)], {
      level: "salon", primaryAreaId: KEARNEY, alsoCoversAreaIds: [LAWRENCE],
    });
    const answer = (await new Thread().say(WORDINGS[1]!)) as { content: string };
    expect(answer.content).toContain("**Quinn Ashby**");
    expect(answer.content).toContain("**Quinn Marlowe**");
  });

  it("asks when the manager named the person in full", async () => {
    const { answer } = await said(true, "two", "create a ca for quinn marlowe. she was late on 10/20");
    expect(answer.content).not.toMatch(/^Did you mean|^Is this for/);
  });

  it("answers a question with the question", async () => {
    const off = (await said(false, "two", "can I write up quinn for being late?")).answer;
    const on = (await said(true, "two", "can I write up quinn for being late?")).answer;
    expect(on.content).toBe(off.content);
  });
});

describe("flag off (as main)", () => {
  for (const wording of WORDINGS) {
    it(`"${wording}": no suggestion`, async () => {
      const { answer } = await said(false, "two", wording);
      expect(answer.content).not.toMatch(/^Did you mean .+\? Tell me which, or give the full name\.|^Is this for \*\*[^*]+\*\*\? Tell me if that should change\./);
    });
  }
});

/*
 * QA's variation report: every seed's "first name only" variant (the full name
 * replaced by the first name the way the report does it) failed to name the
 * person. With one such person on the roster, the turn that first gives the
 * name is answered with the question about them — never a card for the bare
 * first name.
 */
const { SEEDS } = await import("../../../../support/variation-report/seeds");
const { variantsOf } = await import("../../../../support/variation-report/variants");

describe("the variation report's first-name-only variants", () => {
  for (const seed of SEEDS.filter((entry) => entry.name)) {
    const variant = variantsOf(seed).find((entry) => entry.label === "first name only")!;
    const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    const full = `${cap(seed.name!.first)} ${cap(seed.name!.last)}`;
    it(`${seed.id}: asked "Is this for **${full}**?", never a card for "${seed.name!.first}"`, async () => {
      production(true, [person("e-1", cap(seed.name!.first), cap(seed.name!.last)), person("e-3", "Rowan", "Kestrel")]);
      const thread = new Thread();
      // Turn by turn until the name is asked about: never a card for the bare first name on the way.
      let answer = { content: "" } as { content: string; formProposal?: Card };
      for (const turn of variant.turns) {
        answer = (await thread.say(turn)) as typeof answer;
        expect(answer.formProposal?.employeeName ?? "has a space").toMatch(/\s/);
        if (answer.content.startsWith("Is this for **")) break;
      }
      expect(answer.content).toBe(`Is this for **${full}**? Tell me if that should change.`);
    });
  }
});

/*
 * QA, 28 Oct 2026, live in Ask Bubbles, checked here too: "katherine was late on 10/20, write her
 * up" with one Katherine on the roster gave a card for her full name at once
 * and never asked — the AI reader found the one roster person the first name
 * fits and filled the card. Invented name; the same reading through the
 * reader with AI_READS_CODE_CHECKS_ENABLED.
 */
describe("a first name the reader filled in full (AI_READS_CODE_CHECKS_ENABLED)", () => {
  const ROSTER = [person("e-7", "Katrin", "Dovetail"), person("e-3", "Rowan", "Kestrel")];
  const SAID = "katrin was late on 10/20, write her up";
  const withReader = (on: boolean) => {
    production(on, [...ROSTER]);
    process.env.AI_READS_CODE_CHECKS_ENABLED = "true";
  };

  it("off (as main): the card is filled with the full name at once", async () => {
    if (!saved.has("AI_READS_CODE_CHECKS_ENABLED")) saved.set("AI_READS_CODE_CHECKS_ENABLED", process.env.AI_READS_CODE_CHECKS_ENABLED);
    withReader(false);
    const answer = (await new Thread().say(SAID)) as { formProposal?: Card };
    expect(answer.formProposal?.employeeName).toBe("Katrin Dovetail");
  });

  it("on: asked \"Is this for **Katrin Dovetail**?\" and no card; \"yes\" gives the card for the full name", async () => {
    if (!saved.has("AI_READS_CODE_CHECKS_ENABLED")) saved.set("AI_READS_CODE_CHECKS_ENABLED", process.env.AI_READS_CODE_CHECKS_ENABLED);
    withReader(true);
    const thread = new Thread();
    const asked = (await thread.say(SAID)) as { content: string; formProposal?: Card };
    expect(asked.content).toBe("Is this for **Katrin Dovetail**? Tell me if that should change.");
    expect(asked.formProposal).toBeUndefined();
    const answer = (await thread.say("yes")) as { content: string; formProposal?: Card };
    expect(answer.formProposal?.employeeName).toBe("Katrin Dovetail");
    expect(answer.content).not.toContain("Is this for **");
  });

  it("on, the manager typed the full name: no question", async () => {
    if (!saved.has("AI_READS_CODE_CHECKS_ENABLED")) saved.set("AI_READS_CODE_CHECKS_ENABLED", process.env.AI_READS_CODE_CHECKS_ENABLED);
    withReader(true);
    const answer = (await new Thread().say("katrin dovetail was late on 10/20, write her up")) as { content: string; formProposal?: Card };
    expect(answer.content).not.toMatch(/^Is this for \*\*/);
    expect(answer.formProposal?.employeeName).toBe("Katrin Dovetail");
  });
});


/*
 * QA review, 28 Oct 2026: "on turn 3, any follow-up while the card is open
 * (e.g. "make it a written warning", "she was also 20 minutes late", "change
 * to coaching", the payroll answer, "create it") produces a card with the same
 * full name and the question fires AGAIN, replacing the card." Once the
 * manager has answered the question about a person, that person is confirmed
 * for the rest of the conversation: no follow-up, form switch, warning-level
 * answer, Create or correction asks again.
 */
describe("after the answer, the person stays confirmed (QA review of the reader fill)", () => {
  const ROSTER = [person("e-7", "Katrin", "Dovetail"), person("e-2", "Quinn", "Ashby"), person("e-3", "Rowan", "Kestrel")];
  const SAID = "katrin was late on 10/20, write her up";
  async function confirmed(answer = "yes") {
    if (!saved.has("AI_READS_CODE_CHECKS_ENABLED")) saved.set("AI_READS_CODE_CHECKS_ENABLED", process.env.AI_READS_CODE_CHECKS_ENABLED);
    production(true, [...ROSTER]);
    process.env.AI_READS_CODE_CHECKS_ENABLED = "true";
    const thread = new Thread();
    expect(((await thread.say(SAID)) as { content: string }).content).toBe("Is this for **Katrin Dovetail**? Tell me if that should change.");
    const card = (await thread.say(answer)) as { content: string; formProposal?: Card };
    return { thread, card };
  }

  for (const followUp of ["make it a written warning", "she was also 20 minutes late", "change to coaching", "written", "no payroll deduct", "create it"]) {
    it(`"yes", then "${followUp}": never asked again, and any card stays for Katrin Dovetail`, async () => {
      const { thread, card } = await confirmed();
      expect(card.formProposal?.employeeName).toBe("Katrin Dovetail");
      const next = (await thread.say(followUp)) as { content: string; formProposal?: Card };
      expect(next.content).not.toMatch(/^Is this for \*\*|^Did you mean /);
      if (next.formProposal) expect(next.formProposal.employeeName).toBe("Katrin Dovetail");
    });
  }

  it('"yes", Create, then a follow-up on the open form: never asked again', async () => {
    const { thread } = await confirmed();
    await thread.create();
    const next = (await thread.say("she was also 20 minutes late")) as { content: string };
    expect(next.content).not.toMatch(/^Is this for \*\*|^Did you mean /);
  });

  it('"no, Quinn Ashby": the card is for Quinn Ashby, and a follow-up never asks again', async () => {
    const { thread, card } = await confirmed("no, Quinn Ashby");
    expect(card.formProposal?.employeeName).toBe("Quinn Ashby");
    const next = (await thread.say("make it a written warning")) as { content: string; formProposal?: Card };
    expect(next.content).not.toMatch(/^Is this for \*\*|^Did you mean /);
    if (next.formProposal) expect(next.formProposal.employeeName).toBe("Quinn Ashby");
  });
});

describe("after a Did you mean answer, the person stays confirmed (QA review)", () => {
  it('"ashby" after Did you mean, then "make it a written warning": never asked again', async () => {
    const { thread, answer } = await said(true, "two", WORDINGS[2]!, "ashby");
    expect(answer.formProposal?.employeeName).toBe("Quinn Ashby");
    const next = (await thread.say("make it a written warning")) as { content: string; formProposal?: Card };
    expect(next.content).not.toMatch(/^Is this for \*\*|^Did you mean /);
    if (next.formProposal) expect(next.formProposal.employeeName).toBe("Quinn Ashby");
  });

  it("the app's own numbered Did you mean, then a follow-up: never asked again", async () => {
    const { thread, answer } = await said(true, "two", WORDINGS[0]!);
    expect(answer.content).toMatch(/^Did you mean /);
    const picked = (await thread.say("Quinn Ashby")) as { content: string; formProposal?: Card };
    expect(picked.formProposal?.employeeName).toBe("Quinn Ashby");
    const next = (await thread.say("make it a written warning")) as { content: string; formProposal?: Card };
    expect(next.content).not.toMatch(/^Is this for \*\*|^Did you mean /);
    if (next.formProposal) expect(next.formProposal.employeeName).toBe("Quinn Ashby");
  });
});

/*
 * Pau, live, 29 Oct 2026 (FIRST_NAME_SUGGEST_ENABLED on): "pls create a
 * coaching form for katrin dov" → "Is this for **<full name>**? Tell me if
 * that should change." → "yes" → the card was right, but Create answered
 * "This proposal is out of date: the conversation now says the form is for
 * katrin dov, not <full name>." The creation check read the first turn's
 * "katrin dov" as the person and did not count the name the manager had just
 * accepted. The same shape with an invented roster person: a first name and
 * a partial surname.
 */
describe("a name accepted from the question is the card's person at Create", () => {
  const withReader = (roster: unknown[]) => {
    if (!saved.has("AI_READS_CODE_CHECKS_ENABLED")) saved.set("AI_READS_CODE_CHECKS_ENABLED", process.env.AI_READS_CODE_CHECKS_ENABLED);
    production(true, roster);
    process.env.AI_READS_CODE_CHECKS_ENABLED = "true";
  };

  it('"pls create a coaching form for katrin dov" → "yes" → Create makes the form', async () => {
    withReader([person("e-7", "Katrin", "Dovetail"), person("e-3", "Rowan", "Kestrel")]);
    const thread = new Thread();
    const asked = (await thread.say("pls create a coaching form for katrin dov")) as { content: string };
    expect(asked.content).toBe("Is this for **Katrin Dovetail**? Tell me if that should change.");
    const card = (await thread.say("yes")) as { formProposal?: Card };
    expect(card.formProposal?.employeeName).toBe("Katrin Dovetail");
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
    expect(store.form_instances[0]!.employee_name).toBe("Katrin Dovetail");
  });

  it('Did you mean, answered "ashby" → Create makes the form for Quinn Ashby', async () => {
    const { thread, answer } = await said(true, "two", WORDINGS[2]!, "ashby");
    expect(answer.formProposal?.employeeName).toBe("Quinn Ashby");
    await thread.create();
    expect(store.form_instances[0]!.employee_name).toBe("Quinn Ashby");
  });

  it('Did you mean, answered "the second" → Create makes the form', async () => {
    const { thread, answer } = await said(true, "two", WORDINGS[2]!, "the second");
    expect(answer.formProposal?.employeeName).toBeTruthy();
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
  });

  it('"no, Quinn Ashby" → Create makes the form for Quinn Ashby', async () => {
    const { thread, answer } = await said(true, "two", WORDINGS[2]!, "no, Quinn Ashby");
    expect(answer.formProposal?.employeeName).toBe("Quinn Ashby");
    await thread.create();
    expect(store.form_instances[0]!.employee_name).toBe("Quinn Ashby");
  });

  /*
   * QA / Pau, 29 Oct 2026: "if we pick the suggested name, then creates the
   * form on that name, it says expired so fix that too" — every way of
   * accepting the suggested name, then Create, and the saved form carries it.
   * (The question has no buttons or chips: it is answered by typing.)
   */
  const KATRIN = [
    { ...person("e-7", "Katrin", "Dovetail"), preferredFirstName: "Kit" },
    person("e-3", "Rowan", "Kestrel"),
  ];
  const acceptedThenCreated = async (first: string, answer: string) => {
    withReader(KATRIN);
    const thread = new Thread();
    const asked = (await thread.say(first)) as { content: string };
    expect(asked.content).toBe("Is this for **Katrin Dovetail**? Tell me if that should change.");
    const card = (await thread.say(answer)) as { content: string; formProposal?: Card };
    expect(card.formProposal?.employeeName).toBe("Katrin Dovetail");
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
    expect(store.form_instances[0]!.employee_name).toBe("Katrin Dovetail");
  };

  it('"pls create a coaching form for katrin dov" → the full name typed → Create', () =>
    acceptedThenCreated("pls create a coaching form for katrin dov", "Katrin Dovetail"));

  /*
   * Here (unlike Ask Bubbles) a misspelled surname or a preferred first name
   * with a partial surname is not filled from the roster: the card holds the
   * name as typed and no question is asked, so Create has nothing to refuse.
   * Pinned so a change to that shows up here.
   */
  const typedThenCreated = async (first: string, typed: string) => {
    withReader(KATRIN);
    const thread = new Thread();
    const card = (await thread.say(first)) as { formProposal?: Card };
    expect(card.formProposal?.employeeName).toBe(typed);
    await thread.create();
    expect(store.form_instances[0]!.employee_name).toBe(typed);
  };

  it('a misspelled surname: "pls create a coaching form for katrin dovtail" → Create, never refused', () =>
    typedThenCreated("pls create a coaching form for katrin dovtail", "Katrin Dovtail"));

  it('the preferred name: "pls create a coaching form for kit dov" → Create, never refused', () =>
    typedThenCreated("pls create a coaching form for kit dov", "Kit Dov"));

  it('reader-filled: "katrin was late on 10/20, write her up" → "yes" → Create', async () => {
    withReader(KATRIN);
    const thread = new Thread();
    const asked = (await thread.say("katrin was late on 10/20, write her up")) as { content: string };
    expect(asked.content).toBe("Is this for **Katrin Dovetail**? Tell me if that should change.");
    const card = (await thread.say("yes")) as { formProposal?: Card };
    expect(card.formProposal?.employeeName).toBe("Katrin Dovetail");
    await thread.create();
    expect(store.form_instances[0]!.employee_name).toBe("Katrin Dovetail");
  });

  it('after "katrin dovtail", a later turn naming somebody else still makes the card stale', async () => {
    withReader(KATRIN);
    const thread = new Thread();
    await thread.say("pls create a coaching form for katrin dovtail");
    const stale = thread.proposal!;
    await thread.say("actually this is for Rowan Kestrel, not Katrin");
    thread.proposal = stale;
    await expect(thread.create()).rejects.toThrow(/out of date/);
  });

  /*
   * FIRST_NAME_SUGGEST off with the reader on: no question, the reader fills
   * the roster's Katrin Dovetail from "katrin dov" at once, and Create refused
   * it as out of date — so turning the question off did not unblock Pau.
   * PARTIAL_NAME_CARD_CURRENT_ENABLED lets it through; off, as main.
   */
  const offThenCreate = async (partial: boolean) => {
    withReader(KATRIN);
    delete process.env[FLAG_ON];
    if (!saved.has(PARTIAL)) saved.set(PARTIAL, process.env[PARTIAL]);
    delete process.env[PARTIAL];
    if (partial) process.env[PARTIAL] = "true";
    const thread = new Thread();
    const card = (await thread.say("pls create a coaching form for katrin dov")) as { formProposal?: Card };
    expect(card.formProposal?.employeeName).toBe("Katrin Dovetail");
    return thread;
  };
  const PARTIAL = "PARTIAL_NAME_CARD_CURRENT_ENABLED";

  it("question off, PARTIAL_NAME_CARD_CURRENT on: the reader's card for \"katrin dov\" is created for Katrin Dovetail", async () => {
    const thread = await offThenCreate(true);
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
    expect(store.form_instances[0]!.employee_name).toBe("Katrin Dovetail");
  });

  it("question off, PARTIAL_NAME_CARD_CURRENT on: a later turn naming somebody else still makes it stale", async () => {
    const thread = await offThenCreate(true);
    const stale = thread.proposal!;
    await thread.say("actually this is for Rowan Kestrel, not Katrin");
    thread.proposal = stale;
    await expect(thread.create()).rejects.toThrow(/out of date/);
  });

  it("question off, PARTIAL_NAME_CARD_CURRENT off: as main, Create refuses it", async () => {
    const thread = await offThenCreate(false);
    await expect(thread.create()).rejects.toThrow(/out of date: the conversation now says the form is for katrin dov/);
  });

  /*
   * Audit, 29 Oct 2026: with either flag on, "this isn't for katrin
   * dovetail" after the name was accepted let the old card through — the
   * acceptance paths ran before the exclusion. Main refuses it.
   */
  for (const flags of [
    { suggest: true, partial: false },
    { suggest: false, partial: true },
    { suggest: true, partial: true },
  ]) {
    it(`"this isn't for katrin dovetail" after the name was accepted still refuses the old card (${JSON.stringify(flags)})`, async () => {
      withReader(KATRIN);
      if (!flags.suggest) delete process.env[FLAG_ON];
      if (!saved.has("PARTIAL_NAME_CARD_CURRENT_ENABLED")) saved.set("PARTIAL_NAME_CARD_CURRENT_ENABLED", process.env.PARTIAL_NAME_CARD_CURRENT_ENABLED);
      delete process.env.PARTIAL_NAME_CARD_CURRENT_ENABLED;
      if (flags.partial) process.env.PARTIAL_NAME_CARD_CURRENT_ENABLED = "true";
      const thread = new Thread();
      const first = (await thread.say("create a ca for katrin dov. she was late on 10/20")) as { content: string };
      if (/^Is this for/.test(first.content)) await thread.say("yes");
      const stale = thread.proposal!;
      expect(stale.employeeName).toBe("Katrin Dovetail");
      await thread.say("this isn't for katrin dovetail");
      thread.proposal = stale;
      await expect(thread.create()).rejects.toThrow(/out of date/);
    });
  }

  it("a later correction to somebody else still makes the old card stale", async () => {
    const { thread } = await said(true, "one", WORDINGS[1]!, "yes");
    const stale = thread.proposal!;
    await thread.say("actually this is for Rowan Kestrel, not Quinn");
    thread.proposal = stale;
    await expect(thread.create()).rejects.toThrow(/out of date/);
  });
});

/*
 * QA live, 29 Oct 2026 (Pau's wording; the name invented here): "pls create a
 * coaching form for paulyne co" sometimes asked "Is this for **…**?" and
 * sometimes, when the AI reader's employee was rejected, gave a card for the
 * raw "paulyne co" — no position, no store — and Create saved that. The typed
 * first (or preferred) name plus a surname prefix is matched against the
 * manager's roster in code (PARTIAL_SURNAME_ASK_ENABLED), not by the reader.
 * Here the reader reads nothing for this name.
 */
describe("a first name and a surname prefix are asked about from the roster, without the reader", () => {
  const MARISOL = [
    { ...person("e-8", "Marisol", "Corvane"), preferredFirstName: "Mari" },
    person("e-9", "Rowan", "Kestrel"),
  ];
  const TWO = [person("e-8", "Marisol", "Corvane"), person("e-10", "Marisol", "Cortland"), person("e-9", "Rowan", "Kestrel")];
  const ASK = "PARTIAL_SURNAME_ASK_ENABLED";
  const withAsk = (on: boolean, roster: unknown[], typed = "marisol co") => {
    // The reader and the slots read the name as typed; the reader's is rejected (no roster person has "co" in their name).
    state.typedName = typed;
    if (!saved.has("AI_READS_CODE_CHECKS_ENABLED")) saved.set("AI_READS_CODE_CHECKS_ENABLED", process.env.AI_READS_CODE_CHECKS_ENABLED);
    if (!saved.has(ASK)) saved.set(ASK, process.env[ASK]);
    production(true, roster);
    process.env.AI_READS_CODE_CHECKS_ENABLED = "true";
    // Live in production, 29 Oct 2026: with it on, a name not on the roster stays on the card as typed.
    if (!saved.has("ANTI_LOOP_ENABLED")) saved.set("ANTI_LOOP_ENABLED", process.env.ANTI_LOOP_ENABLED);
    process.env.ANTI_LOOP_ENABLED = "true";
    delete process.env[ASK];
    if (on) process.env[ASK] = "true";
  };

  it('"pls create a coaching form for marisol co" → "Is this for Marisol Corvane?" → "yes" → Create saves Marisol Corvane', async () => {
    withAsk(true, MARISOL);
    const thread = new Thread();
    const asked = (await thread.say("pls create a coaching form for marisol co")) as { content: string; formProposal?: Card };
    expect(asked.content).toBe("Is this for **Marisol Corvane**? Tell me if that should change.");
    expect(asked.formProposal).toBeUndefined();
    const card = (await thread.say("yes")) as { formProposal?: Card };
    expect(card.formProposal?.employeeName).toBe("Marisol Corvane");
    await thread.create();
    expect(store.form_instances).toHaveLength(1);
    expect(store.form_instances[0]!.employee_name).toBe("Marisol Corvane");
  });

  it('the same wording asks every time (three chats)', async () => {
    withAsk(true, MARISOL);
    for (let chat = 0; chat < 3; chat += 1) {
      const asked = (await new Thread().say("pls create a coaching form for marisol co")) as { content: string };
      expect(asked.content).toBe("Is this for **Marisol Corvane**? Tell me if that should change.");
    }
  });

  it('the preferred name: "pls create a coaching form for mari corv" → asked → "yes" → Create', async () => {
    withAsk(true, MARISOL, "mari corv");
    const thread = new Thread();
    const asked = (await thread.say("pls create a coaching form for mari corv")) as { content: string };
    expect(asked.content).toBe("Is this for **Marisol Corvane**? Tell me if that should change.");
    await thread.say("yes");
    await thread.create();
    expect(store.form_instances[0]!.employee_name).toBe("Marisol Corvane");
  });

  it('two people fit "marisol cor" → Did you mean → "cortland" → Create saves Marisol Cortland', async () => {
    withAsk(true, TWO, "marisol cor");
    const thread = new Thread();
    const asked = (await thread.say("pls create a coaching form for marisol cor")) as { content: string };
    expect(asked.content).toMatch(/^Did you mean /);
    expect(asked.content).toContain("**Marisol Corvane**");
    expect(asked.content).toContain("**Marisol Cortland**");
    await thread.say("cortland");
    await thread.create();
    expect(store.form_instances[0]!.employee_name).toBe("Marisol Cortland");
  });

  it('the full name typed ("marisol corvane") is never asked about', async () => {
    withAsk(true, MARISOL, "marisol corvane");
    const answer = (await new Thread().say("pls create a coaching form for marisol corvane")) as { content: string; formProposal?: Card };
    expect(answer.content).not.toMatch(/^(?:Is this for|Did you mean)/);
    expect(answer.formProposal?.employeeName).toBe("Marisol Corvane");
  });

  it('after "yes", a later turn keeps the card and does not ask again', async () => {
    withAsk(true, MARISOL);
    const thread = new Thread();
    await thread.say("pls create a coaching form for marisol co");
    await thread.say("yes");
    const later = (await thread.say("she was late on 10/20")) as { content: string; formProposal?: Card };
    expect(later.content).not.toMatch(/^(?:Is this for|Did you mean)/);
    expect(later.formProposal?.employeeName).toBe("Marisol Corvane");
    await thread.create();
    expect(store.form_instances[0]!.employee_name).toBe("Marisol Corvane");
  });

  it('nobody fits ("marisol zz"): as before, no question', async () => {
    withAsk(true, MARISOL, "marisol zz");
    const answer = (await new Thread().say("pls create a coaching form for marisol zz")) as { content: string; formProposal?: Card };
    expect(answer.content).not.toMatch(/^(?:Is this for|Did you mean)/);
    expect(answer.formProposal?.employeeName?.toLowerCase()).toBe("marisol zz");
  });

  it("off: as main", async () => {
    withAsk(false, MARISOL);
    const answer = (await new Thread().say("pls create a coaching form for marisol co")) as { content: string; formProposal?: Card };
    // The live shape QA saw: a card for the raw typed name, no question.
    expect(answer.content).not.toMatch(/^Is this for/);
    expect(answer.formProposal?.employeeName?.toLowerCase()).toBe("marisol co");
  });
});
