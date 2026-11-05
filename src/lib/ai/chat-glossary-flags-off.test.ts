import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import PRODUCTION_FLAGS from "@/config/production-flags.json";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import { JBA_MANUAL_CA_CHUNKS } from "@/test/fixtures/jba-manual-ca-sections";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * CHAT_GLOSSARY_ENABLED OFF: EVERY MODEL REQUEST AND REPLY, BYTE FOR BYTE
 * ============================================================================
 *
 * Ported from Ask Bubbles (40146f84, #419), in this app's
 * setting: a salon director at the Kearney salon, invented people. A short
 * script — the sf-s12 report ("I need to make a corrective action for msb"),
 * a policy question, a question about MSB, and a Corrective Action request
 * for a person on the roster — is run through the real chat route with the
 * real `call-claude` (only the Anthropic client is stubbed; this app streams
 * the answering call through `messages.create` with `stream: true`), so every
 * request body the client receives is recorded: the main answering call and
 * the form reader's call. With the flag off — on production's flags, and with
 * nothing set — the bodies and the replies are those of Ask Sunny's main
 * before this flag (67041242), recorded in `chat-glossary-flags-off.main.json`
 * (`RECORD_MAIN_FIXTURE=1` on that commit rewrites it).
 *
 * A control: with the flag on, the main call and the reader's call carry the
 * glossary block, and the msb turn differs.
 */

const sent = vi.hoisted(() => ({ bodies: [] as string[] }));

const store = {
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

/** Invented people at the Kearney salon (none of them is on the directory fixtures). */
const SALON = "loc-0309";
const DIRECTORY = [
  { id: "gl-thea", firstName: "Thea", lastName: "Quillfeather", preferredFirstName: null, employmentStatus: "active", salonIds: [SALON], positionName: "Tanning Consultant" },
  { id: "gl-rowan", firstName: "Rowan", lastName: "Fennimoor", preferredFirstName: null, employmentStatus: "active", salonIds: [SALON], positionName: "Tanning Consultant" },
];

// The fixture names the default model and effort, whatever the shell sets.
vi.mock("@/lib/config/models", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/models")>()),
  CLAUDE_MODEL: "claude-sonnet-5",
  CLAUDE_EFFORT: "medium",
  CLAUDE_READER_MODEL: "claude-haiku-5",
}));

vi.mock("@/lib/ai/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/anthropic")>();
  const usage = { input_tokens: 1, output_tokens: 1 };
  const reply = (body: { tools?: { name?: string }[]; messages?: unknown }) => {
    const tool = body.tools?.[0]?.name;
    if (tool === "record_form_reading") {
      // As the live reader did: "msb" copied as the employee.
      const text = JSON.stringify(body.messages ?? []);
      const msb = /corrective action for msb/.test(text);
      return {
        stop_reason: "tool_use",
        usage,
        content: [{ type: "tool_use", id: "t1", name: tool, input: { employee: msb ? { value: "msb", evidence: "corrective action for msb" } : null, incident: null, incidentDate: null } }],
      };
    }
    if (tool && tool !== "edit_form") return { stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t2", name: tool, input: {} }] };
    return { stop_reason: "end_turn", usage, content: [{ type: "text", text: "An answer from the policy manual." }] };
  };
  async function* events(text: string) {
    yield { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } };
    yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
    yield { type: "content_block_stop", index: 0 };
    yield { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } };
    yield { type: "message_stop" };
  }
  return {
    ...actual,
    getAnthropicClient: () => ({
      messages: {
        create: async (body: { tools?: { name?: string }[]; messages?: unknown; stream?: boolean }) => {
          sent.bodies.push(`create ${JSON.stringify(body)}`);
          const message = reply(body);
          if (body.stream && message.stop_reason === "end_turn") return events("An answer from the policy manual.");
          return message;
        },
      },
    }),
  };
});

vi.mock("@/lib/forms/form-patch-call", () => ({
  FORM_PATCH_DEFAULT_TIMEOUT_MS: 5_000,
  formPatchTimeoutMs: () => 5_000,
  callFormPatchModel: async () => ({ fallback: "error" }),
}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
vi.mock("@/lib/api/respond", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/respond")>()),
  assertLiveMode: () => {},
  assertNoConfigurationProblems: () => {},
  assertWithinRateLimit: () => {},
}));
vi.mock("@/lib/config/server-env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config/server-env")>()),
  liveReadiness: () => ({ mode: "live", missing: [], problems: [], ready: true }),
  supabaseReadiness: () => ({ ready: true, missing: [] }),
}));
vi.mock("@/lib/auth/server", () => ({
  authorizeRequest: async (_request: Request, permission: string) => ({
    identity: {
      subject: "qa-manager",
      email: "qa-manager@example.test",
      displayName: "QA Manager",
      role: "salon_director",
      scope: { level: "salon", primaryAreaId: "loc-0309", alsoCoversAreaIds: [] },
      verified: true,
    },
    permission,
    provider: "supabase",
  }),
}));
vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-qa",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));
vi.mock("@/lib/knowledge/providers/supabase", () => ({
  SupabaseKnowledgeProvider: class {
    async fetchNamedHandbook() {
      return { ok: false, reason: "offline", problem: "not_found" };
    }
    async search() {
      return [];
    }
    async match() {
      return [];
    }
    async fetchRoleGrounding() {
      return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
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
vi.mock("@/lib/knowledge/recall-match", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/recall-match")>()),
  matchRecallKnowledge: async () => [],
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
      actual.scopeRoster(DIRECTORY as never, scope).map((person) => ({ ...person, title: (person as { positionName?: string | null }).positionName ?? null, primaryLocationName: "Kearney" })),
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(DIRECTORY as never, scope),
  };
});
vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

const FLAG = "CHAT_GLOSSARY_ENABLED";
/*
 * Production's flags WITHOUT this one: the test is "this flag off", and from
 * 4 Nov 2026 production-flags.json lists CHAT_GLOSSARY_ENABLED on (QA's flip).
 * The recorded fixture is main before the glossary, so the base must leave it off.
 */
/*
 * CA_SALES_POLICY_ENABLED and FORM_NAME_FROM_ROSTER_ENABLED are left out too:
 * they went on in production together (5 Nov 2026) after the fixture was
 * recorded, and they change the msb script's replies on their own; this test
 * is about the glossary flag alone.
 */
const PRODUCTION = [...PRODUCTION_FLAGS.on, ...PRODUCTION_FLAGS.assumedOn].filter(
  (name) => name !== FLAG && name !== "CA_SALES_POLICY_ENABLED" && name !== "FORM_NAME_FROM_ROSTER_ENABLED",
);
const TOUCHED = [...new Set([FLAG, "FORM_EDIT_SINGLE_WRITER_ENABLED", "FORM_EDIT_TOOL_IN_STREAM_ENABLED", ...PRODUCTION, ...PRODUCTION_FLAGS.off])];
const saved = new Map<string, string | undefined>();

beforeAll(() => {
  for (const name of TOUCHED) saved.set(name, process.env[name]);
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T15:30:00Z"));
});
afterAll(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

function setFlags(base: "production" | "none", on: readonly string[]) {
  for (const name of TOUCHED) delete process.env[name];
  if (base === "production") for (const name of PRODUCTION) process.env[name] = "true";
  for (const name of on) process.env[name] = "true";
}

type Answer = { content: string; formProposal?: ChatFormProposal };

/** The script: each turn's reply, and every request body the client received. */
async function script(): Promise<{ replies: unknown[]; bodies: string[] }> {
  const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
  const chatRoute = await import("@/app/api/chat/route");
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  await ensureTemplateLibrary("system");
  sent.bodies.length = 0;

  const replies: unknown[] = [];
  const chat = () => {
    const messages: ChatMessage[] = [];
    const conversationId = createId("conv");
    return {
      async say(question: string): Promise<Answer> {
        const response = await chatRoute.POST(
          new Request("https://app.test/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              question,
              mode: "standard",
              history: messages.map(({ id, role, content, formProposal }) => ({ id, role, content, ...(formProposal ? { formProposal } : {}) })),
              questionMessageId: `m${messages.length}`,
              conversationId,
              ...(continuationFor(messages) ? { continueProposalTemplateKey: continuationFor(messages)!.templateKey } : {}),
            }),
          }),
        );
        const raw = (await response.json()) as Answer;
        const payload = response.headers.get("x-chat-stream") ? (raw as unknown as { body: Answer }).body : raw;
        replies.push({ question, status: response.status, content: payload.content, employeeName: payload.formProposal?.employeeName ?? null, status_: payload.formProposal?.status ?? null });
        messages.push(
          { id: `m${messages.length}`, role: "user", content: question, createdAt: "2026-10-26T12:00:00Z" } as ChatMessage,
          { id: `a${messages.length}`, role: "assistant", content: payload.content, createdAt: "2026-10-26T12:00:01Z", ...(payload.formProposal ? { formProposal: payload.formProposal } : {}) } as ChatMessage,
        );
        return payload;
      },
    };
  };

  const msb = chat();
  await msb.say("I need to make a corrective action for msb");
  await msb.say("what does the policy manual say about being late to open?");
  const question = chat();
  await question.say("What does MSB stand for?");
  const thea = chat();
  await thea.say("Create a Corrective Action for Thea Quillfeather, she was late to open on 10-20-26");

  // Ids and conversation keys differ per run; the bodies are compared without them.
  const bodies = sent.bodies.map((body) => body.replace(/conv_[A-Za-z0-9_-]+/g, "conv_*"));
  return { replies, bodies };
}

const FIXTURE = join("src", "lib", "ai", "chat-glossary-flags-off.main.json");
const RECORDING = process.env.RECORD_MAIN_FIXTURE === "1";
const GLOSSARY_HEAD = "ABBREVIATIONS MANAGERS USE";

describe("CHAT_GLOSSARY_ENABLED off: the model requests and replies, byte for byte", () => {
  const runs: Record<string, { replies: unknown[]; bodies: string[] }> = {};

  it("production's flags and no flags: equal to main", async () => {
    setFlags("production", []);
    runs.production = await script();
    setFlags("none", []);
    runs.none = await script();
    if (RECORDING) {
      writeFileSync(FIXTURE, `${JSON.stringify(runs, null, 1)}\n`);
      return;
    }
    expect(existsSync(FIXTURE), `${FIXTURE} is missing`).toBe(true);
    const main = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof runs;
    expect(runs.production.bodies).toEqual(main.production!.bodies);
    expect(runs.production.replies).toEqual(main.production!.replies);
    expect(runs.none.bodies).toEqual(main.none!.bodies);
    expect(runs.none.replies).toEqual(main.none!.replies);
    for (const run of Object.values(runs)) for (const body of run.bodies) expect(body).not.toContain(GLOSSARY_HEAD);
  }, 120_000);

  it.skipIf(RECORDING)("control: with the flag on, the main call and the reader carry the glossary, and the msb turn changes", async () => {
    setFlags("production", [FLAG]);
    const on = await script();
    const main = JSON.parse(readFileSync(FIXTURE, "utf8")) as typeof runs;
    expect(on.bodies).not.toEqual(main.production!.bodies);
    const answering = on.bodies.filter((body) => body.includes("QUESTION\\n\\n"));
    const reader = on.bodies.filter((body) => body.includes('"record_form_reading"'));
    expect(answering.length).toBeGreaterThan(0);
    expect(reader.length).toBeGreaterThan(0);
    for (const body of [...answering, ...reader]) expect(body).toContain(GLOSSARY_HEAD);
    expect(on.replies[0]).not.toEqual(main.production!.replies[0]);
  }, 120_000);
});
