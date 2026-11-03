import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import PRODUCTION_FLAGS from "@/config/production-flags.json";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

import type { ReplayContext } from "./cases";
import { CASES } from "./index";

/**
 * ============================================================================
 * THE REPLAY PACK — EVERY REPORTED WORDING, WITH PRODUCTION'S FLAGS
 * ============================================================================
 *
 * QA, 3 Nov 2026 (Pau: "This is a repeated problem. I've fixed some of it
 * before but still keep appearing."). Fixes kept landing on one reader or one
 * path, default off, tested with a flag set production does not run — so a
 * new wording slipped past them. Every reported chat is a case here (`cases/`,
 * the manager's exact words, invented people), run through POST /api/chat
 * with the flags in `src/config/production-flags.json`, and asserted as an
 * invariant (no refusal repeated, no "updated" without an update, the card's
 * subject is the person named, …), not as wording.
 *
 * A case still broken in production is `status: "open"`: it is expected to
 * fail, so the day it passes (a flag turned on, a fix merged) the pack says so
 * and the case is moved to "fixed". `fixFlags` are run as well: with them on
 * the case must pass, so a fix cannot miss the path production takes.
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

// As production builds the role table when the ASD may create forms (NEXT_PUBLIC_, read once at load).
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_ASSISTANT_MANAGER_CREATE_ENABLED = "true";
});

const revisionAsked = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({
  slotReading: "none" as "none" | "ca" | "copy",
  remapObservation: null as string | null,
  /** What the form-reading model returns for this turn (extract_form_fields). */
  reading: {} as Record<string, unknown>,
  draft: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown> },
  revision: {} as { values?: Record<string, unknown>; checked?: Record<string, unknown>; clear?: string[] },
  revisionCalls: 0,
  draftCalls: 0,
  toolCalls: 0,
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
      const role = (state as { role?: string }).role ?? "district_manager";
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "qa-manager",
          email: "qa-manager@example.test",
          displayName: "QA Manager",
          role,
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
    state.toolCalls += 1;
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
    state.toolCalls += 1;
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
        if (!revising) state.draftCalls += 1;
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
      // Woven's position for each person, as the directory read returns it.
      actual.scopeRoster(state.directory as never, scope).map((person) => ({
        ...person,
        title: (state.directory as { id: string; positionName?: string | null }[]).find((row) => row.id === person.id)?.positionName ?? null,
        primaryLocationName: "Kearney",
      })),
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
const chatRoute = await import("../route");
const instancesRoute = await import("../../forms/instances/route");
const draftRoute = await import("../../forms/instances/[id]/draft/route");

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

/** Production's flags, from `src/config/production-flags.json`. */
const PRODUCTION = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn];
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






const KNOWN_OFF = PRODUCTION_FLAGS.off;

function production(extra: readonly string[] = []) {
  for (const name of [...ALL_FLAGS, ...KNOWN_OFF, ...extra]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const name of [...PRODUCTION, ...extra]) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    process.env[name] = "true";
  }
}

function setScope(scope: unknown) {
  (state as { scope?: unknown }).scope = scope;
}
function setRole(role: string | undefined) {
  (state as { role?: string }).role = role;
}
afterEach(() => {
  setScope(undefined);
  setRole(undefined);
  said.answer = null;
});

function context(): ReplayContext {
  return {
    thread: () => new Thread(),
    as: (role, scope) => {
      setRole(role);
      setScope(scope);
    },
    directory: (rows) => {
      state.directory = rows as never;
    },
    draftWrites: (values) => {
      state.draft = { values };
    },
    revisionWrites: (values) => {
      state.revision = { values };
    },
    modelSays: (text) => {
      said.answer = text;
    },
    calls: () => ({ chat: state.chatModelCalls, draft: state.draftCalls, revision: state.revisionCalls, tool: state.toolCalls }),
    forms: () => store.form_instances as never,
    values: (instanceId) =>
      Object.fromEntries(store.form_instance_values.filter((row) => row.instance_id === instanceId).map((row) => [String(row.field_key), String(row.value ?? "")])),
  };
}

/*
 * EVERY NAME IN THE FLAG FILE IS A FLAG THIS APP READS. A typo, or a flag
 * since deleted, would otherwise be "on" in the pack and nowhere else, and the
 * pack would test a production that does not exist.
 */
function sourceText(dir: string): string {
  let out = "";
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out += sourceText(path);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out += readFileSync(path, "utf8");
  }
  return out;
}

describe("src/config/production-flags.json", () => {
  it("names only flags this app reads, each once", () => {
    const source = sourceText("src");
    const names = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn, ...PRODUCTION_FLAGS.off];
    expect(names.filter((name) => !source.includes(`"${name}"`) && !source.includes(`process.env.${name}`))).toEqual([]);
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
  });
});

describe("the replay pack", () => {
  for (const replay of CASES) {
    const title = `${replay.id}: ${replay.title}`;
    if (replay.status === "fixed") {
      it(`${title} — holds with production's flags`, async () => {
        production();
        await replay.run(context());
      });
    } else {
      // Still broken in production: expected to fail. The day it passes, move it to "fixed".
      it.fails(`${title} — OPEN in production (${replay.status.open})`, async () => {
        production();
        await replay.run(context());
      });
    }
    if (replay.fixFlags?.length) {
      it(`${title} — holds with ${replay.fixFlags.join(", ")} on`, async () => {
        production(replay.fixFlags);
        await replay.run(context());
      });
    }
  }
});
