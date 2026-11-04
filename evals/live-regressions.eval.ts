import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CA_CHAIN,
  CA_SALES_SCENARIOS,
  DRY_SCRIPTS,
  GATE_SCENARIOS,
  GLOSSARY_SCENARIOS,
  LIVE_FAILURE_SCENARIOS,
  LIVE_ROSTER,
  MANAGER_SCENARIOS,
  managerDryScripts,
  NAME_SCENARIOS,
  type LiveCriterion,
  type LiveExpect,
  type LiveScenario,
} from "@/app/api/chat/replay-pack/nov4-live-regressions-scenarios";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { AccessScope, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * REGRESSION SET #1, LIVE — OPT-IN WITH LIVE=1, NEVER IN CI
 * ============================================================================
 *
 * Ported from Ask Bubbles (c20e858, bb29452), in this app's setting: a Salon
 * Director at the Kearney salon, the testers' invented people.
 *
 * The replay pack (`src/app/api/chat/replay-pack/nov4-live-regressions-cases.ts`)
 * scripts the models. This runs the SAME scenarios
 * (`nov4-live-regressions-scenarios.ts`) through the real chat route with the
 * REAL model calls of the old path (production's flags, Step B off), and
 * records per case: the old-path reply, the saved diff, the ms, and — once
 * step 3 exists — the new path's.
 *
 *   LIVE=1 npx vitest run --config vitest.eval.config.mts evals/live-regressions.eval.ts
 *
 * Without LIVE=1 or LIVE_DRY=1 every test is skipped and `vitest.eval.config.mts`
 * leaves the file out, so `npm run eval` and CI never load it.
 *
 * LIVE_DRY=1 — THE SAME SCRIPT WITH NO NETWORK AND NO KEY:
 *
 *   LIVE_DRY=1 npx vitest run --config vitest.eval.config.mts evals/live-regressions.eval.ts
 *
 * The Anthropic client and the AI SDK call are replaced by stand-ins: the
 * drafting and revision calls write the replay pack's scripted baseline
 * texts (`DRY_SCRIPTS`), the answering call says "A grounded answer.", any
 * other tool call returns no tool use (the caller's fallback). Every stand-in
 * call goes through the same counter and cap. It proves the plumbing: each
 * chain creates a draft, its edit turns reach the drafting and revision paths,
 * the saved values are recorded, and the counter counts. Results go to
 * evals/results/live-regressions.dry.{json,md}. LIVE=1 wins if both are set.
 *
 * MODES (env, read only with LIVE=1):
 *   LIVE_SCENARIOS=all|failures|names|gate|glossary|ca-sales|none  which
 *                          scenarios (default all: the live failures, the 40
 *                          name runs, then the 8 edit-tool gate wordings on an
 *                          open Corrective Action). The flag sets are never in
 *                          "all": glossary (CHAT_GLOSSARY_ENABLED: sf-s12's
 *                          "msb" and two name controls) and ca-sales
 *                          (CA_SALES_POLICY_ENABLED: the replay pack's
 *                          nov4-ca-sales-policy-cases.ts, live). Each fits in
 *                          LIVE_CAP=30. Each of their scenarios has an
 *                          expected outcome, written PASS or FAIL into the
 *                          results; a FAIL is recorded, it never fails the run.
 *                          managers: the five exact manager messages (Pau via
 *                          QA, 4 Nov), one PASS/FAIL column per criterion.
 *                          QA runs it twice, flag OFF and ON:
 *                            LIVE_SCENARIOS=managers                (OFF)
 *                            LIVE_SCENARIOS=managers LIVE_FLAGS=CHAT_GLOSSARY_ENABLED,CA_SALES_POLICY_ENABLED  (ON)
 *                          each within LIVE_CAP=30.
 *   LIVE_CREATE_REPEAT=1   also: the same Corrective Action (T1, then Create)
 *                          5 times with Step B's flags OFF and 5 times ON;
 *                          counts the saved Observations that lose the
 *                          surname (do not contain "Jane Doe"). Runs first.
 *   LIVE_NEW_PATH=1        also run each scenario on the new path: step 3's
 *                          FORM_EDIT_TOOL_IN_STREAM_ENABLED with the single
 *                          writer it needs. Each run records how many answering
 *                          calls were offered `edit_form`.
 *
 * LIVE_MAIN_MODEL=<model id>  the ANSWERING call only (the request that carries
 *                          `thinking`, i.e. the main call that is offered
 *                          `edit_form`) goes to this model; every other call
 *                          stays on Haiku. Its own cap: 30 answering calls per
 *                          run (Pau, 4 Nov: "allowed on a small capped set,
 *                          about 30 calls per run, only for the step 3
 *                          comparison, inside the script process only"). Past
 *                          that cap nothing more is sent. Unset: all Haiku.
 *
 * PAU'S FLAG PROCEDURE (4 Nov 2026): before each Production flip, QA runs this
 * in QA's own session with the flag on and a small cap:
 *
 *   LIVE=1 LIVE_CAP=30 LIVE_SCENARIOS=glossary LIVE_FLAGS=CHAT_GLOSSARY_ENABLED npx vitest run --config vitest.eval.config.mts evals/live-regressions.eval.ts
 *
 * LIVE_CAP=<n>            the run's call cap (default 100). A positive integer,
 *                          at most 100; anything else is refused before any
 *                          call (the file fails to load).
 * LIVE_FLAGS=A_ENABLED,B_ENABLED  these flags are "true" in this process, set
 *                          before the first app import and again on every
 *                          scenario run, on top of production's flags
 *                          (production-flags.json on + assumedOn). Only names
 *                          of the form /^[A-Z0-9_]+$/ ending in _ENABLED; any
 *                          other name is refused before any call. The results
 *                          header lists them.
 *
 * SPEND: every model call — the Anthropic client (`getAnthropicClient`, which
 * `callClaude*`, the drafting and the revision calls use) and the AI SDK
 * (`callFormPatchModel`) — goes through one counter that stops at LIVE_CAP
 * (default 100) calls per run, with no retries (`maxRetries: 0`). The app's own client
 * (`getAnthropicClient`) is replaced, so the key and base URL below are the
 * only ones used. Every call is forced to Haiku
 * (CLAUDE_READER_MODEL): ANTHROPIC_MODEL / ANTHROPIC_HAIKU_MODEL /
 * ANTHROPIC_READER_MODEL are set to it in this process only, and the wrapper
 * overwrites `model` on every request. The base URL is explicit
 * (https://api.anthropic.com), whatever ANTHROPIC_BASE_URL says. Input and
 * output tokens are summed into the results.
 *
 * THE KEY: ANTHROPIC_API_KEY is read from this process's environment only
 * when LIVE=1, when the client is first built. It is never printed, logged or
 * written to the results.
 *
 * Results: evals/results/live-regressions.json and .md (git-ignored).
 */

const LIVE = process.env.LIVE === "1";
/** No network, no key: the stand-in models (see above). */
const DRY = !LIVE && process.env.LIVE_DRY === "1";

const live = vi.hoisted(() => {
  /** CLAUDE_READER_MODEL's default (src/lib/config/models.ts); checked against the module below. */
  const HAIKU = process.env.ANTHROPIC_READER_MODEL || "claude-haiku-5-5";
  if (process.env.LIVE === "1" || process.env.LIVE_DRY === "1") {
    // This process only, before the app's model config is first imported.
    process.env.ANTHROPIC_MODEL = HAIKU;
    process.env.ANTHROPIC_HAIKU_MODEL = HAIKU;
    process.env.ANTHROPIC_READER_MODEL = HAIKU;
  }
  /* LIVE_CAP and LIVE_FLAGS, checked before anything is imported or called. */
  const active = process.env.LIVE === "1" || process.env.LIVE_DRY === "1";
  const capText = process.env.LIVE_CAP?.trim() ?? "";
  if (active && capText !== "" && (!/^[0-9]+$/.test(capText) || Number(capText) < 1 || Number(capText) > 100)) {
    throw new Error(`live-regressions: LIVE_CAP must be a positive integer of at most 100 (got "${capText}"); nothing was sent`);
  }
  const FLAGS = (process.env.LIVE_FLAGS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const refused = FLAGS.filter((name) => !/^[A-Z0-9_]+$/.test(name) || !name.endsWith("_ENABLED"));
  if (active && refused.length) {
    throw new Error(`live-regressions: LIVE_FLAGS takes only flag names ending in _ENABLED (A-Z, 0-9, _); refused: ${refused.map((name) => JSON.stringify(name)).join(", ")}; nothing was sent`);
  }
  if (active) {
    // This process only, before the first app import: some flags are read once, when a module loads.
    for (const name of FLAGS) process.env[name] = "true";
  }
  const meter = {
    HAIKU,
    /** LIVE_CAP (default 100, at most 100). */
    CAP: capText === "" ? 100 : Number(capText),
    /** LIVE_FLAGS: on in every scenario run, on top of production's flags. */
    FLAGS: active ? FLAGS : [],
    /** LIVE_MAIN_MODEL: the answering call's model (unset: Haiku), and its own cap. */
    MAIN_MODEL: process.env.LIVE_MAIN_MODEL?.trim() || null,
    MAIN_CAP: 30,
    mainCalls: 0,
    BASE_URL: "https://api.anthropic.com",
    calls: 0,
    /** Answering calls whose request offered the `edit_form` tool (step 3). */
    offered: 0,
    /** The calls by kind: draft (write_form_fields), revision (revise_form_fields), answer (text), tool (any other tool), patch (AI SDK). */
    kinds: { draft: 0, revision: 0, answer: 0, tool: 0, patch: 0 } as Record<"draft" | "revision" | "answer" | "tool" | "patch", number>,
    /** LIVE_DRY=1: what the stand-in drafting and revision models write next. */
    dry: { draft: {} as Record<string, string>, checked: {} as Record<string, string[]>, revision: {} as Record<string, string> },
    capped: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    /** The model for this request: the answering call (it carries `thinking`) on LIVE_MAIN_MODEL, within its cap; all else Haiku. */
    modelFor(body: unknown): string {
      if (!meter.MAIN_MODEL || !(body as { thinking?: unknown }).thinking) return meter.HAIKU;
      if (meter.mainCalls >= meter.MAIN_CAP) {
        meter.capped = true;
        throw new Error(`live-regressions: main-model cap reached (${meter.MAIN_CAP} answering calls on ${meter.MAIN_MODEL})`);
      }
      meter.mainCalls += 1;
      return meter.MAIN_MODEL;
    },
    /** One model call, counted before it is sent; past the cap nothing is sent. */
    take(kind: "draft" | "revision" | "answer" | "tool" | "patch"): void {
      if (process.env.LIVE !== "1" && process.env.LIVE_DRY !== "1") throw new Error("live-regressions: a model call without LIVE=1 or LIVE_DRY=1");
      if (meter.calls >= meter.CAP) {
        meter.capped = true;
        throw new Error(`live-regressions: spend cap reached (${meter.CAP} model calls)`);
      }
      meter.calls += 1;
      meter.kinds[kind] += 1;
    },
    add(usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | null | undefined): void {
      if (!usage) return;
      meter.inputTokens += usage.input_tokens ?? 0;
      meter.outputTokens += usage.output_tokens ?? 0;
      meter.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      meter.cacheWriteTokens += usage.cache_creation_input_tokens ?? 0;
    },
  };
  return meter;
});

const actor = vi.hoisted(() => ({ directory: [] as unknown[] }));

/* -------------------------------------------------- the real model, metered -- */

vi.mock("@/lib/ai/anthropic", async () => {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  let client: InstanceType<typeof Anthropic> | null = null;
  const real = () => {
    if (process.env.LIVE !== "1") throw new Error("live-regressions: a real model call without LIVE=1");
    // The key from this process's environment, never logged; the base URL explicit; no retries.
    client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: live.BASE_URL, maxRetries: 0 });
    return client;
  };
  type Body = Parameters<InstanceType<typeof Anthropic>["messages"]["create"]>[0];
  type Options = Parameters<InstanceType<typeof Anthropic>["messages"]["create"]>[1];
  const kindOf = (body: unknown) => {
    const tool = (body as { tool_choice?: { name?: string } }).tool_choice?.name;
    return tool === "write_form_fields" ? "draft" : tool === "revise_form_fields" ? "revision" : tool ? "tool" : "answer";
  };
  /** LIVE_DRY=1: the stand-in's reply, as the SDK shapes it. */
  const standIn = (body: unknown) => {
    const kind = kindOf(body);
    const usage = { input_tokens: 1, output_tokens: 1 };
    if (kind === "draft") return { role: "assistant", model: live.HAIKU, stop_reason: "tool_use", content: [{ type: "tool_use", id: "dry-draft", name: "write_form_fields", input: { values: live.dry.draft, checked: live.dry.checked } }], usage };
    if (kind === "revision") return { role: "assistant", model: live.HAIKU, stop_reason: "tool_use", content: [{ type: "tool_use", id: "dry-revision", name: "revise_form_fields", input: { values: live.dry.revision } }], usage };
    // The answer, and no tool use for any other tool: its caller's fallback, as when the model declines.
    return { role: "assistant", model: live.HAIKU, stop_reason: "end_turn", content: [{ type: "text", text: kind === "answer" ? "A grounded answer." : "" }], usage };
  };
  const dry = () => process.env.LIVE !== "1" && process.env.LIVE_DRY === "1";
  const noteOffer = (body: unknown) => {
    if ((body as { tools?: { name?: string }[] }).tools?.some((tool) => tool.name === "edit_form")) live.offered += 1;
  };
  const messages = {
    create: async (body: Body, options?: Options) => {
      live.take(kindOf(body));
      noteOffer(body);
      const model = live.modelFor(body);
      const response = dry() ? standIn(body) : await real().messages.create({ ...body, model } as Body, { ...options, maxRetries: 0 });
      live.add((response as { usage?: Parameters<typeof live.add>[0] }).usage);
      return response;
    },
    stream: (body: Parameters<InstanceType<typeof Anthropic>["messages"]["stream"]>[0], options?: Options) => {
      live.take(kindOf(body));
      noteOffer(body);
      const model = live.modelFor(body);
      if (dry()) {
        const message = standIn(body);
        live.add(message.usage);
        const fake = { on: () => fake, finalMessage: async () => message };
        return fake;
      }
      const stream = real().messages.stream({ ...body, model }, { ...options, maxRetries: 0 });
      stream.finalMessage().then(
        (message) => live.add(message.usage),
        () => {},
      );
      return stream;
    },
  };
  return { Anthropic, getAnthropicClient: () => ({ messages }), __setAnthropicClient: () => {} };
});

/* Step B's form-patch model (AI SDK), metered the same way; only reached with Step B's flags on. */
vi.mock("@/lib/forms/form-patch-call", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/form-patch-call")>();
  return {
    ...actual,
    callFormPatchModel: async (input: { system: string; prompt: string; schema: Record<string, unknown> }) => {
      try {
        live.take("patch");
      } catch {
        return { fallback: "error" as const };
      }
      // LIVE_DRY=1: the stand-in falls back, so the turn runs the old path.
      if (process.env.LIVE !== "1") return { fallback: "error" as const };
      try {
        const { generateObject, jsonSchema } = await import("ai");
        const { createAnthropic } = await import("@ai-sdk/anthropic");
        const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: `${live.BASE_URL}/v1` });
        const result = await generateObject({
          model: anthropic(live.HAIKU),
          schema: jsonSchema(input.schema),
          system: input.system,
          prompt: input.prompt,
          temperature: 0,
          maxOutputTokens: 1500,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(actual.formPatchTimeoutMs()),
        });
        live.add({ input_tokens: result.usage.inputTokens ?? 0, output_tokens: result.usage.outputTokens ?? 0 });
        return { ok: true as const, output: result.object };
      } catch {
        return { fallback: "error" as const };
      }
    },
  };
});

/* -------------------------------------------- everything else stays local -- */

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

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => Object.assign(fakeSupabase(store), { rpc: async () => ({ data: [], error: null }) }),
}));
vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
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
  const { KEARNEY: scope } = await import("@/app/api/chat/replay-pack/cases");
  return {
    authorizeRequest: async (_request: Request, permission: string) => {
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, "salon_director" as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: { subject: "live-regressions", email: "live-regressions@example.test", displayName: "Live Regressions", role: "salon_director", scope, verified: true },
        permission,
        provider: "supabase",
      };
    },
  };
});
vi.mock("@/lib/analytics/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics/record")>()),
  openTurn: async () => "turn-live",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));
vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { manualChunkFromRow } = await import("@/lib/ai/full-manual-load");
  const rows = (await import("@/test/fixtures/jba-manual-production-151.json")).default;
  return {
    SupabaseKnowledgeProvider: class {
      async search() {
        return [];
      }
      async match() {
        return [];
      }
      /*
       * THE PERFORMANCE MANAGEMENT FRAMEWORK, as the replay pack serves it. This app's Corrective Action (DPOA) is
       * governed by it: without a framework read the draft route withholds the draft (fails closed, after 1 s
       * and 3 s retries), so Create would save no Observation — the same symptom as the missing overview join.
       */
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
      async fetchNamedHandbook() {
        return { ok: false, reason: "not used" };
      }
      async fetchOfficialPolicyManual() {
        return {
          ok: true as const,
          documentId: "doc-jba",
          documentTitle: "2025 JBA Policy Manual - Edited 5-2025",
          documentCategory: "policies_compliance",
          matchedBy: "fallback" as const,
          ownerConfirmed: true,
          chunks: (rows.chunks as Parameters<typeof manualChunkFromRow>[0][]).map(manualChunkFromRow),
        };
      }
    },
  };
});
/* A general question embeds the question; a fixed vector, no network. */
vi.mock("@/lib/embeddings", async () => {
  const { EMBEDDING_DIMENSIONS } = await import("@/lib/config/models");
  return { getEmbeddingProvider: () => ({ dimensions: EMBEDDING_DIMENSIONS, embedQuery: async () => [0.2, 0.1, 0.4] }) };
});
vi.mock("@/lib/knowledge/recall-match", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/knowledge/recall-match")>()),
  matchRecallKnowledge: async () => [],
}));
vi.mock("@/lib/knowledge", () => ({
  getKnowledgeProvider: () => {
    throw new Error("not on the server");
  },
}));
vi.mock("@/lib/reporting/read/report-briefing", () => ({ loadReportBriefing: async () => null }));
vi.mock("@/lib/reporting/read/employee-facts", () => ({
  loadEmployeeFacts: async () => null,
  NO_EMPLOYEE_DATA_REASON: "no dataset",
  NO_EMPLOYEE_DATASET_REASON: "no dataset",
  EMPLOYEE_DATA_HEADING: "CURRENT EMPLOYEE PERFORMANCE DATA",
}));
/* The scenario's directory, as the replay pack reads it. */
vi.mock("@/lib/forms/employee-roster", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/forms/employee-roster")>();
  return {
    ...actual,
    readDirectoryFacts: async (scope: AccessScope | null) =>
      actual.scopeRoster(actor.directory as never, scope).map((person) => ({ ...person, title: (person as { positionName?: string | null }).positionName ?? null, primaryLocationName: "Kearney" })),
    loadScopedRoster: async (scope: AccessScope | null) => actual.scopeRoster(actor.directory as never, scope),
  };
});
vi.mock("@/lib/forms/prior-forms", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/forms/prior-forms")>()),
  priorFormsReadingForChat: async () => ({ attach: [], possible: [], identity: "none" }),
}));

process.env.NEXT_PUBLIC_DEMO_MODE = "false";
vi.setConfig({ hookTimeout: 120_000, testTimeout: 1_800_000 });

/* ------------------------------------------------------------------ flags -- */

const PRODUCTION_FLAGS = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on: string[]; assumedOn?: string[]; off?: string[] };
const PRODUCTION = [...new Set([...PRODUCTION_FLAGS.on, ...(PRODUCTION_FLAGS.assumedOn ?? [])])];
const STEP_B_FLAGS = ["FORM_PATCH_REDUCER_ENABLED", "FORM_REPLY_FROM_DIFF_ENABLED"];
/** Step 3: the edit tool in the main call, with the single writer it needs. */
const NEW_PATH_FLAGS = ["FORM_EDIT_SINGLE_WRITER_ENABLED", "FORM_EDIT_TOOL_IN_STREAM_ENABLED"];

function setFlags(extra: readonly string[]): () => void {
  const names = [...PRODUCTION, ...(PRODUCTION_FLAGS.off ?? []), ...STEP_B_FLAGS, ...NEW_PATH_FLAGS, ...live.FLAGS];
  const saved = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  // LIVE_FLAGS on every scenario run, on top of production's.
  for (const name of [...PRODUCTION, ...live.FLAGS, ...extra]) process.env[name] = "true";
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

/* ----------------------------------------------------------------- replay -- */

/*
 * THE OVERVIEW JOIN, as the replay pack's harness does it: the chat and the
 * draft route read a form with its template's key and name
 * (form_instance_overview); the in-memory store has no view, so each
 * instance row is given them when it is written. Without it the open form
 * has no name ("the open  for <name>", as in the sibling app's first LIVE=1 run) and the draft route finds no
 * template, so Create saved nothing. The fix from Ask Bubbles (bb29452).
 */
function joinOverview(): void {
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

const TODAY = "2026-10-26";

type Routes = {
  chat: typeof import("@/app/api/chat/route");
  instances: typeof import("@/app/api/forms/instances/route");
  draft: typeof import("@/app/api/forms/instances/[id]/draft/route");
  createInlineForm: typeof import("@/features/chat/create-inline-form").createInlineForm;
  continuationFor: typeof import("@/lib/forms/proposal-continuation").continuationFor;
  ensureTemplateLibrary: typeof import("@/lib/forms/repository").ensureTemplateLibrary;
  createId: typeof import("@/lib/utils/id").createId;
  streamHeader: string;
  unwrapStreamed: typeof import("@/lib/api/streamed-response").unwrapStreamed;
};
let routes: Routes;

type Answer = { content: string; formProposal?: ChatFormProposal; formOpened?: { instanceId: string }; formUpdate?: { instanceId: string; updated: string[] } };

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

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const request = new Request(`https://app.test${url}`, init);
  const draft = /^\/api\/forms\/instances\/([^/]+)\/draft$/.exec(url);
  const response = draft
    ? await routes.draft.POST(request, { params: Promise.resolve({ id: draft[1]! }) })
    : url === "/api/forms/instances"
      ? await routes.instances.POST(request)
      : null;
  if (!response) throw new Error(`no route for ${url}`);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}

function values(instanceId: string | null): Record<string, string> {
  if (!instanceId) return {};
  return Object.fromEntries(store.form_instance_values.filter((row) => row.instance_id === instanceId).map((row) => [String(row.field_key), String(row.value ?? "")]));
}

function checkedValues(instanceId: string | null): Record<string, string[]> {
  if (!instanceId) return {};
  return Object.fromEntries(
    store.form_instance_values
      .filter((row) => row.instance_id === instanceId && Array.isArray(row.checked) && (row.checked as unknown[]).length > 0)
      .map((row) => [String(row.field_key), (row.checked as unknown[]).map(String)]),
  );
}

function diff(before: Record<string, string>, after: Record<string, string>): Record<string, { before: string; after: string }> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return Object.fromEntries([...keys].filter((key) => (before[key] ?? "") !== (after[key] ?? "")).map((key) => [key, { before: before[key] ?? "", after: after[key] ?? "" }]));
}

interface Turn {
  readonly said: string;
  readonly reply: string;
  readonly updated: readonly string[];
  readonly diff: Record<string, { before: string; after: string }>;
}

interface PathRun {
  readonly turns: readonly Turn[];
  /** The last turn's reply: the old path's answer to the scenario's own message. */
  readonly reply: string;
  readonly card: { readonly templateKey: string | null; readonly employeeName: string | null } | null;
  readonly field: string | null;
  readonly fieldValue: string | null;
  readonly ms: number;
  readonly calls: number;
  /** Answering calls offered `edit_form` during this scenario. */
  readonly offered: number;
  /** The calls by kind during this scenario. */
  readonly kinds: Record<string, number>;
  /** The form Create made (null: none). */
  readonly instanceId: string | null;
  /** Every saved value at the end. */
  readonly saved: Record<string, string>;
  /** Every saved checkbox at the end (e.g. offense_type). */
  readonly checked: Record<string, string[]>;
  readonly error: string | null;
}

/** One scenario, every step through the real routes, with `flags` on top of production's. */
const NO_CARD = "no card to create from";

/*
 * T1 sometimes gives no card (the model's choice, run to run). It is reported as
 * "NO CARD at T1", never as an edit that did not stick. It is NOT retried: the
 * live key's rule is no retries (maxRetries 0, no loops).
 */
async function runScenario(scenario: LiveScenario, extraFlags: readonly string[]): Promise<PathRun> {
  for (const key of Object.keys(store) as (keyof FakeStore)[]) store[key] = [];
  store.form_instances = new JoiningRows() as never;
  actor.directory = [...scenario.roster];
  const restore = setFlags(extraFlags);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T15:30:00Z`));
  const callsBefore = live.calls;
  const offeredBefore = live.offered;
  const kindsBefore = { ...live.kinds };
  const script = DRY_SCRIPTS[scenario.id] ?? MANAGER_DRY[scenario.id];
  live.dry.draft = script?.draft ?? {};
  live.dry.checked = script?.checked ?? {};
  live.dry.revision = {};
  let edits = 0;
  const started = performance.now();
  const messages: ChatMessage[] = [];
  const conversationId = routes.createId("conv");
  const turns: Turn[] = [];
  let proposal: ChatFormProposal | null = null;
  let instanceId: string | null = null;
  let error: string | null = null;
  try {
    await routes.ensureTemplateLibrary("system");
    for (const [index, step] of scenario.steps.entries()) {
      if ("create" in step) {
        if (!proposal) throw new Error(NO_CARD);
        const result = await routes.createInlineForm({ proposal, messages, call, onCreated: () => {} });
        instanceId = toUuid(result.reference.instanceId);
        // This app's Create reports one `draftWarning` (null when the draft was written).
        const warning = (result as { draftWarning?: unknown }).draftWarning;
        turns.push({ said: "(Create)", reply: warning ? String(warning) : "(drafted)", updated: [], diff: diff({}, values(instanceId)) });
        continue;
      }
      if (instanceId) {
        // LIVE_DRY=1: the stand-in revision writes the next scripted text (the replay pack's `t.revisionWrites`).
        live.dry.revision = script?.revisions[edits] ?? {};
        edits += 1;
      }
      const before = values(instanceId);
      const id = `m${index}`;
      const continuation = routes.continuationFor(messages);
      const response = await routes.chat.POST(
        new Request("https://app.test/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: step.say,
            mode: "standard",
            history: messages.map(({ id: messageId, role, content, formProposal }) => ({ id: messageId, role, content, ...(formProposal ? { formProposal } : {}) })),
            questionMessageId: id,
            conversationId,
            ...(!instanceId && continuation ? { continueProposalTemplateKey: continuation.templateKey } : {}),
            ...(instanceId ? { activeFormInstanceId: instanceId } : {}),
          }),
        }),
      );
      /*
       * CHAT_RESPONSE_STREAM_ENABLED (on in production): a turn slower than 2 s comes back as a 200 stream whose
       * one JSON document is { status, body } — read it as the browser does (`ai/claude-provider.ts`). Real
       * models are that slow, so without this every live turn would read as an empty reply.
       */
      const { status, body } =
        response.headers.get(routes.streamHeader) === "1" ? routes.unwrapStreamed(await response.text()) : { status: response.status, body: await response.json() };
      const payload = body as Answer & { error?: string };
      if (status !== 200) throw new Error(`"${step.say}": HTTP ${status} ${payload.error ?? ""}`.trim());
      if (payload.formProposal) proposal = payload.formProposal;
      if (payload.formOpened) instanceId = toUuid(payload.formOpened.instanceId);
      messages.push(
        { id, role: "user", content: step.say, createdAt: `${TODAY}T15:30:00Z` } as ChatMessage,
        { id: `a${index}`, role: "assistant", content: payload.content, createdAt: `${TODAY}T15:30:01Z`, ...(payload.formProposal ? { formProposal: payload.formProposal } : {}) } as ChatMessage,
      );
      turns.push({ said: step.say, reply: payload.content, updated: payload.formUpdate?.updated ?? [], diff: diff(before, values(instanceId)) });
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    restore();
    vi.useRealTimers();
  }
  const saved = values(instanceId);
  const checked = checkedValues(instanceId);
  return {
    turns,
    reply: turns.at(-1)?.reply ?? "",
    card: proposal ? { templateKey: proposal.templateKey ?? null, employeeName: proposal.employeeName ?? null } : null,
    field: scenario.field,
    fieldValue: scenario.field ? (saved[scenario.field] ?? null) : null,
    ms: Math.round(performance.now() - started),
    calls: live.calls - callsBefore,
    offered: live.offered - offeredBefore,
    kinds: Object.fromEntries(Object.entries(live.kinds).map(([kind, count]) => [kind, count - kindsBefore[kind as keyof typeof kindsBefore]])),
    instanceId,
    saved,
    checked,
    error,
  };
}

const MANAGER_DRY = managerDryScripts();

/** A scenario's `expect` over its recorded run: PASS, or FAIL with why. Recorded only, never asserted. */
function judge(expectation: LiveExpect, run: PathRun, criteria: readonly LiveCriterion[] = []): Outcome {
  const outcome = {
    card: run.card,
    reply: run.reply,
    replies: run.turns.filter((turn) => turn.said !== "(Create)").map((turn) => turn.reply),
    saved: run.saved,
    checked: run.checked,
    error: run.error === NO_CARD ? "NO CARD (nothing to create from)" : run.error,
  };
  const why = expectation.check(outcome);
  const columns = criteria.map((criterion) => {
    const failed = criterion.check(outcome);
    return { name: criterion.name, result: failed ? ("FAIL" as const) : ("PASS" as const), ...(failed ? { why: failed } : {}) };
  });
  return { result: why ? "FAIL" : "PASS", expected: expectation.says, ...(why ? { why } : {}), ...(columns.length ? { criteria: columns } : {}) };
}

/* ---------------------------------------------------------------- results -- */

interface Outcome {
  readonly result: "PASS" | "FAIL";
  /** The scenario's expected outcome, in words. */
  readonly expected: string;
  readonly why?: string;
  /** The managers' set: one result per criterion (card, no-ask, msb-name, cites-soc). */
  readonly criteria?: readonly { readonly name: string; readonly result: "PASS" | "FAIL"; readonly why?: string }[];
}

/** `expect`: the flag sets' PASS / FAIL (old path; LIVE_FLAGS are on in it). Null: the scenario has no expected outcome. */
const results: { id: string; oldPath: PathRun; newPath: PathRun | null; expect: Outcome | null }[] = [];
/** The calls the create repeat made (counted in the same cap). */
const repeatCalls = { value: 0 };
const repeat: { off: { saved: string | null; losesSurname: boolean }[]; on: { saved: string | null; losesSurname: boolean }[] } = { off: [], on: [] };

/** LIVE_CASES=id,id: only these cases (after LIVE_SCENARIOS), e.g. the ones a capped run did not reach. */
function scenarios(): readonly LiveScenario[] {
  const only = (process.env.LIVE_CASES ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const picked = pickScenarios();
  return only.length ? picked.filter((scenario) => only.includes(scenario.id)) : picked;
}

function pickScenarios(): readonly LiveScenario[] {
  const which = process.env.LIVE_SCENARIOS ?? "all";
  if (which === "none") return [];
  if (which === "failures") return LIVE_FAILURE_SCENARIOS;
  if (which === "names") return NAME_SCENARIOS;
  if (which === "gate") return GATE_SCENARIOS;
  if (which === "glossary") return GLOSSARY_SCENARIOS;
  if (which === "ca-sales") return CA_SALES_SCENARIOS;
  if (which === "managers") return MANAGER_SCENARIOS;
  return [...LIVE_FAILURE_SCENARIOS, ...NAME_SCENARIOS, ...GATE_SCENARIOS];
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);

function writeResults(): void {
  mkdirSync("evals/results", { recursive: true });
  const spend = {
    model: live.HAIKU,
    /** LIVE_MAIN_MODEL: the answering call's model and how many answering calls it took (unset: null, all Haiku). */
    mainModel: live.MAIN_MODEL,
    mainCalls: live.mainCalls,
    mainCap: live.MAIN_CAP,
    mode: DRY ? "dry (stand-in models, no network)" : "live",
    /** LIVE_FLAGS: on in every scenario run, on top of production's flags. */
    liveFlags: live.FLAGS,
    scenarioSet: process.env.LIVE_SCENARIOS ?? "all",
    calls: live.calls,
    kinds: live.kinds,
    cap: live.CAP,
    capped: live.capped,
    inputTokens: live.inputTokens,
    outputTokens: live.outputTokens,
    cacheReadTokens: live.cacheReadTokens,
    cacheWriteTokens: live.cacheWriteTokens,
  };
  const lostSurname = { off: repeat.off.filter((run) => run.losesSurname).length, on: repeat.on.filter((run) => run.losesSurname).length };
  const base = DRY ? "evals/results/live-regressions.dry" : "evals/results/live-regressions";
  const checks = results.filter((run) => run.expect);
  const passed = checks.filter((run) => run.expect?.result === "PASS").length;
  writeFileSync(`${base}.json`, `${JSON.stringify({ ranAt: new Date().toISOString(), liveFlags: live.FLAGS, spend, expectations: { passed, failed: checks.length - passed }, createRepeat: { ...repeat, lostSurname }, scenarios: results }, null, 2)}\n`);
  const lines = [
    `# Live regressions (regression set #1)${DRY ? " — DRY RUN, stand-in models" : ""}`,
    "",
    `Flags on top of production's (LIVE_FLAGS): ${live.FLAGS.length ? live.FLAGS.join(", ") : "none"}. Scenarios: ${spend.scenarioSet}.`,
    "",
    `Model ${spend.model}${spend.mainModel ? ` (answering call: ${spend.mainModel}, ${spend.mainCalls}/${spend.mainCap})` : ""}; ${spend.calls}/${spend.cap} calls (draft ${spend.kinds.draft}, revision ${spend.kinds.revision}, answer ${spend.kinds.answer}, other tools ${spend.kinds.tool}, patch ${spend.kinds.patch})${spend.capped ? " (CAP REACHED: later calls were not sent)" : ""}; tokens in ${spend.inputTokens}, out ${spend.outputTokens} (cache read ${spend.cacheReadTokens}, write ${spend.cacheWriteTokens}).`,
    "",
  ];
  if (repeat.off.length || repeat.on.length) {
    lines.push(`Create repeat ("${CA_CHAIN[0]}" → Create): Observation loses "Jane Doe" in ${lostSurname.off}/${repeat.off.length} with Step B OFF, ${lostSurname.on}/${repeat.on.length} with Step B ON.`, "");
  }
  if (checks.length) {
    lines.push(`Expected outcomes: ${passed} PASS, ${checks.length - passed} FAIL of ${checks.length} (${checks.reduce((sum, run) => sum + run.oldPath.calls, 0)} calls).`, "", "| Case | Result | Expected | Why (FAIL) | calls |", "|---|---|---|---|---|");
    for (const { id, oldPath, expect: outcome } of checks) lines.push(`| ${id} | **${outcome!.result}** | ${cell(outcome!.expected)} | ${cell(outcome!.why ?? "")} | ${oldPath.calls} |`);
    lines.push("");
    const NAMES = ["card", "no-ask", "msb-name", "cites-soc"];
    const graded = checks.filter((run) => run.expect?.criteria);
    if (graded.length) {
      lines.push("Per criterion (card: a card is made, #2 asks once which employee; no-ask: never asks what happened; msb-name: MSB never a name; cites-soc: Standards of Conduct with heading and page):", "");
      lines.push(`| Case | ${NAMES.join(" | ")} | Why (FAIL) |`, `|---|${NAMES.map(() => "---|").join("")}---|`);
      for (const { id, expect: outcome } of graded) {
        const column = (name: string) => outcome!.criteria!.find((entry) => entry.name === name);
        const whys = outcome!.criteria!.filter((entry) => entry.why).map((entry) => `${entry.name}: ${entry.why}`).join("; ");
        lines.push(`| ${id} | ${NAMES.map((name) => (column(name) ? `**${column(name)!.result}**` : "n/a")).join(" | ")} | ${cell(whys)} |`);
      }
      lines.push("");
    }
  }
  lines.push("| Case | Draft created | Edit turns that changed the form | Old path reply | Saved diff (last turn) | Card | ms | calls (draft/revision) | New path |", "|---|---|---|---|---|---|---|---|---|");
  for (const { id, oldPath, newPath } of results) {
    const last = oldPath.turns.at(-1);
    const changed = last ? Object.entries(last.diff).map(([key, value]) => `${key}: ${value.after}`).join("; ") : "";
    const card = oldPath.card ? `${oldPath.card.templateKey ?? "?"} / ${oldPath.card.employeeName ?? "—"}` : "—";
    const fresh = newPath ? `${cell(newPath.error ?? newPath.reply)} (calls ${newPath.calls}: answer ${newPath.kinds.answer}, revision ${newPath.kinds.revision}; offered edit_form ${newPath.offered})` : "not run (LIVE_NEW_PATH=1)";
    const created = oldPath.instanceId ? "yes" : "no";
    const editTurns = oldPath.turns.filter((turn) => turn.said !== "(Create)").slice(1);
    const edited = oldPath.instanceId ? `${editTurns.filter((turn) => Object.keys(turn.diff).length > 0).length}/${editTurns.length}` : "—";
    lines.push(
      `| ${id} | ${created} | ${edited} | ${cell(oldPath.error === NO_CARD ? "NO CARD at T1" : oldPath.error ? `ERROR ${oldPath.error}` : oldPath.reply)} | ${cell(changed || "—")} | ${cell(card)} | ${oldPath.ms} | ${oldPath.calls} (${oldPath.kinds.draft}/${oldPath.kinds.revision}) | ${fresh} |`,
    );
  }
  writeFileSync(`${base}.md`, `${lines.join("\n")}\n`);
}

/* ------------------------------------------------------------------ tests -- */

describe.skipIf(!LIVE && !DRY)("live regressions (LIVE=1, or LIVE_DRY=1 with stand-ins)", () => {
  beforeAll(async () => {
    // Production's flags before the first import: some are read once, when a module loads.
    for (const flag of [...PRODUCTION, ...live.FLAGS]) process.env[flag] = "true";
    const models = await import("@/lib/config/models");
    expect([models.CLAUDE_MODEL, models.CLAUDE_HAIKU_MODEL, models.CLAUDE_READER_MODEL], "every model is Haiku in this process").toEqual([live.HAIKU, live.HAIKU, live.HAIKU]);
    routes = {
      chat: await import("@/app/api/chat/route"),
      instances: await import("@/app/api/forms/instances/route"),
      draft: await import("@/app/api/forms/instances/[id]/draft/route"),
      createInlineForm: (await import("@/features/chat/create-inline-form")).createInlineForm,
      continuationFor: (await import("@/lib/forms/proposal-continuation")).continuationFor,
      ensureTemplateLibrary: (await import("@/lib/forms/repository")).ensureTemplateLibrary,
      createId: (await import("@/lib/utils/id")).createId,
      streamHeader: (await import("@/lib/api/streamed-response")).STREAM_HEADER,
      unwrapStreamed: (await import("@/lib/api/streamed-response")).unwrapStreamed,
    };
  });

  afterAll(() => {
    writeResults();
  });

  /* A flag set's dry run rehearses QA's LIVE_CAP=30 command: the create repeat (20 stand-in calls) only when asked. */
  const flagSet = ["glossary", "ca-sales", "managers"].includes(process.env.LIVE_SCENARIOS ?? "");
  it.runIf(process.env.LIVE_CREATE_REPEAT === "1" || (DRY && !flagSet))("the same Corrective Action, created 5 times with Step B off and 5 times on: does the Observation keep \"Jane Doe\"?", async () => {
    const create: LiveScenario = { id: "create-repeat", roster: LIVE_ROSTER, field: "observation", steps: [{ say: CA_CHAIN[0] }, { create: true }] };
    const before = live.calls;
    for (const group of ["off", "on"] as const) {
      for (let run = 0; run < 5 && !live.capped; run += 1) {
        const result = await runScenario(create, group === "on" ? STEP_B_FLAGS : []);
        const saved = result.fieldValue;
        repeat[group].push({ saved, losesSurname: !(saved ?? "").includes("Jane Doe") });
      }
    }
    repeatCalls.value = live.calls - before;
    // Every create saved an Observation: a null is the harness failing, not the model dropping the surname.
    expect(repeat.off.concat(repeat.on).filter((run) => run.saved === null).length, "a create saved no Observation").toBe(0);
  });

  it("every scenario through the real chat route, old path (and the new path with LIVE_NEW_PATH=1)", async () => {
    for (const scenario of scenarios()) {
      if (live.capped) break;
      const oldPath = await runScenario(scenario, []);
      const newPath = process.env.LIVE_NEW_PATH === "1" && !live.capped ? await runScenario(scenario, NEW_PATH_FLAGS) : null;
      const { expect: expectation, criteria } = scenario as { expect?: LiveExpect; criteria?: readonly LiveCriterion[] };
      results.push({ id: scenario.id, oldPath, newPath, expect: expectation ? judge(expectation, oldPath, criteria) : null });
    }
    if (!DRY) return;
    /*
     * LIVE_DRY=1 PROVES THE PLUMBING: each chain creates a draft from the
     * stand-in drafting call, its edit turns reach the revision path and save
     * what the stand-in wrote, and the counter counts the stand-in calls.
     */
    for (const { id, oldPath, expect: outcome } of results) {
      // The flag sets: their PASS / FAIL (an error included) is recorded, never asserted; below, the dry run checks each was judged and the set fits LIVE_CAP=30.
      if (outcome) continue;
      expect(oldPath.error, `${id}: ${oldPath.error}`).toBeNull();
      // A turn the app answers in code (the street address, the Jane Doe card) makes no model call.
      if (!(id in DRY_SCRIPTS)) continue;
      // The gate scenarios: a draft, and no tool offered on the old path; their own checks below.
      if (id.startsWith("gate-")) {
        expect(oldPath.instanceId, `${id}: Create made no form`).not.toBeNull();
        expect(oldPath.offered, `${id}: edit_form offered with the flag off`).toBe(0);
        continue;
      }
      expect(oldPath.calls, `${id}: the counter counted no stand-in call`).toBeGreaterThan(0);
      expect(oldPath.instanceId, `${id}: Create made no form`).not.toBeNull();
      expect(oldPath.kinds.draft, `${id}: Create never reached the drafting call`).toBeGreaterThan(0);
      expect(oldPath.kinds.revision, `${id}: no edit turn reached the revision call`).toBeGreaterThan(0);
      expect(oldPath.fieldValue ?? "", `${id}: no saved ${oldPath.field}`).not.toBe("");
      const editTurns = oldPath.turns.filter((turn) => turn.said !== "(Create)").slice(1);
      expect(editTurns.some((turn) => Object.keys(turn.diff).length > 0), `${id}: no edit turn changed the saved form`).toBe(true);
    }
    /*
     * Step 3's gate, on the new path: an edit asked as a question reaches
     * edit_form (its last turn's main call offered it); a question does not.
     * The stand-in never calls the tool, so each edit is handed to the old chain.
     */
    for (const { id, newPath } of results) {
      if (!newPath || !id.startsWith("gate-")) continue;
      expect(newPath.error, `${id}: ${newPath.error}`).toBeNull();
      if (id.startsWith("gate-edit-")) expect(newPath.offered, `${id}: edit_form was not offered`).toBe(1);
      else expect(newPath.offered, `${id}: edit_form offered on a question`).toBe(0);
    }
    /*
     * The flag sets: every scenario was judged (PASS or FAIL, either is fine
     * here), and the whole set fits QA's LIVE_CAP=30.
     */
    const set = process.env.LIVE_SCENARIOS;
    if (set === "glossary" || set === "ca-sales" || set === "managers") {
      for (const { id, expect: outcome } of results) expect(outcome, `${id}: no expected outcome recorded`).not.toBeNull();
      expect(results.reduce((sum, run) => sum + run.oldPath.calls, 0), `the ${set} set needs more than 30 calls`).toBeLessThanOrEqual(30);
    }
    expect(live.calls, "the counter is the sum of the scenarios' calls").toBe(
      results.reduce((sum, run) => sum + run.oldPath.calls + (run.newPath?.calls ?? 0), 0) + repeatCalls.value,
    );
  });
});

