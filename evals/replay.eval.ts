import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createId } from "@/lib/utils/id";
import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";
import type { ChatFormProposal, ChatMessage } from "@/types";

import {
  type EvalCase,
  type EvalResult,
  type EvalRosterPerson,
  compareToBaseline,
  judgeCase,
  latencySummary,
  medianRun,
  modeFlags,
  readEvalFlags,
  renderTable,
  rosterTables,
  speedVerdict,
  withoutTime,
} from "./replay-harness";

/**
 * ============================================================================
 * REPLAY EVAL — EVERY REPLAY CASE THROUGH POST /api/chat, FLAGS OFF AND ON
 * ============================================================================
 *
 * Step 0 of the master plan (3 Nov 2026): the real failed chats, word for
 * word, re-run on every pull request so a fix stops silently breaking another
 * case. Each case in `evals/replay_set.json` is replayed turn by turn through
 * the real chat route, twice:
 *
 *   OFF  today's app: production's flags (`src/config/production-flags.json`,
 *        "on" and "assumedOn") and nothing else. Must equal `evals/baseline.json`
 *        exactly, case by case. A case that changed with every new flag off is
 *        a change to today's app, which the plan forbids.
 *   ON   the same, plus the step's own flags (`evals/flags.json` "on"). No
 *        case that passes OFF may fail ON, and ON may be at most 25% slower.
 *
 * DETERMINISTIC AND LOCAL. The database is in memory (`fakeSupabase`), the
 * clock is fixed, and every model call gets a neutral stand-in: the
 * extraction model reads nothing, the drafting model writes nothing, the
 * answering model says "A grounded answer.". What is scored is therefore the
 * app's own code — the answer cascade, the name and salon checks, the card —
 * not a live model. Nothing here opens a network connection.
 *
 * `EVAL_UPDATE_BASELINE=1 npm run eval` rewrites the baseline. Only do that
 * when the change to a flags-off result is intended, and say why in the PR.
 */

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
  employee_access_directory: [],
  employee_location_affiliations: [],
  woven_location_map: [],
  salons: [],
} as unknown as FakeStore & Record<string, Record<string, unknown>[]>;

const actor = vi.hoisted(() => ({
  role: "owner" as string,
  scope: { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] } as Record<string, unknown>,
}));

/* The knowledge search is a database function; in memory it finds nothing. */
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => Object.assign(fakeSupabase(store), { rpc: async () => ({ data: [], error: null }) }),
}));
vi.mock("@/lib/api/respond", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/respond")>();
  return { ...actual, assertLiveMode: () => {}, assertNoConfigurationProblems: () => {}, assertWithinRateLimit: () => {} };
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
      if (!hasPermission(DEFAULT_PERMISSION_MATRIX, actor.role as never, permission as never)) {
        throw new AuthError("forbidden", "Your role does not have permission to do that.");
      }
      return {
        identity: {
          subject: "eval-manager",
          email: "eval-manager@example.test",
          displayName: "Eval Manager",
          role: actor.role,
          scope: actor.scope,
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
  openTurn: async () => "turn-eval",
  closeTurn: async () => {},
  recordActivity: async () => {},
  recordActivityAsync: () => {},
}));
/* Neutral stand-ins: no model reading helps or hurts a case. */
vi.mock("@/lib/ai/call-claude", () => ({
  callClaude: async () => "A grounded answer.",
  callClaudeTool: async () => null,
  callClaudeToolDetailed: async () => ({ input: {}, inputTokens: 1, outputTokens: 1 }),
}));
vi.mock("@/lib/ai/anthropic", () => ({
  getAnthropicClient: () => ({
    messages: {
      create: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "A grounded answer." }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  }),
}));
vi.mock("@/lib/knowledge/providers/supabase", async () => {
  const { JBA_MANUAL_CHUNKS, JBA_MANUAL_DOCUMENT } = await import("@/lib/ai/__fixtures__/jba-policy-manual");
  return {
    SupabaseKnowledgeProvider: class {
      async search() {
        return [];
      }
      async match() {
        return [];
      }
      async fetchRoleGrounding() {
        return { ok: false, failure: { code: "missing", detail: "not used", missingGroups: [] } };
      }
      async fetchNamedHandbook() {
        return { ok: false, reason: "not used" };
      }
      async fetchOfficialPolicyManual() {
        return {
          ok: true as const,
          documentId: JBA_MANUAL_DOCUMENT.id,
          documentTitle: JBA_MANUAL_DOCUMENT.title,
          documentCategory: JBA_MANUAL_DOCUMENT.category,
          matchedBy: "fallback" as const,
          ownerConfirmed: true,
          chunks: JBA_MANUAL_CHUNKS,
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

process.env.NEXT_PUBLIC_DEMO_MODE = "false";
vi.setConfig({ hookTimeout: 60_000, testTimeout: 120_000 });

/*
 * TODAY'S PRODUCTION IS `src/config/production-flags.json` ("on" and
 * "assumedOn"), the same file the replay pack reads and QA keeps in step with
 * Vercel. `evals/flags.json` holds only the step's own flags.
 */
const PRODUCTION_FLAGS = JSON.parse(readFileSync("src/config/production-flags.json", "utf8")) as { on: string[]; assumedOn?: string[] };
const FLAGS = readEvalFlags({
  production: [...new Set([...PRODUCTION_FLAGS.on, ...(PRODUCTION_FLAGS.assumedOn ?? [])])],
  on: (JSON.parse(readFileSync("evals/flags.json", "utf8")) as { on: unknown }).on,
});
/*
 * SET BEFORE THE APP IS IMPORTED. Some production flags are read once, when a
 * module loads (a NEXT_PUBLIC_ flag is read at build time), so they must be on
 * before the first import, as in production.
 */
for (const flag of FLAGS.production) process.env[flag] = "true";

const { ensureTemplateLibrary } = await import("@/lib/forms/repository");
const chatRoute = await import("@/app/api/chat/route");

/*
 * A SALON THE APP DOES NOT HAVE IS NOT JUDGED. Cases copied word for word from
 * the priority replay fixture (b10, b11, g3, g7) expect "loc-0903" ("Dodge"),
 * a test-only salon that `priority-replay.test.ts` adds to its own mock of
 * `@/data/salons`; the real salon list has no such salon, so no card here can
 * carry it. The fixture stays as written (`judge.eval.ts` checks it); the
 * criterion is skipped for that salon only.
 */
const { PRODUCTION_SALONS } = await import("@/data/salons");
const KNOWN_SALONS = new Set(PRODUCTION_SALONS.map((salon) => salon.id));
function judgedAs(item: EvalCase): EvalCase {
  if (item.criteria.salon === null || KNOWN_SALONS.has(item.criteria.salon)) return item;
  return { ...item, criteria: { ...item.criteria, salon: null } };
}

const CASES = JSON.parse(readFileSync("evals/replay_set.json", "utf8")) as EvalCase[];

const BASELINE_PATH = "evals/baseline.json";
const DEFAULT_TODAY = "2026-10-23";
const RUNS = 3;

const results: { off: EvalResult[]; on: EvalResult[] } = { off: [], on: [] };

function reset(roster: readonly EvalRosterPerson[]) {
  for (const key of Object.keys(store)) store[key] = [];
  Object.assign(store, rosterTables(roster));
}

type Reply = { content: string; formProposal?: ChatFormProposal };

/** One case, every turn through POST /api/chat with the browser's whole messages as history. */
async function replay(item: EvalCase, mode: "off" | "on"): Promise<EvalResult> {
  reset(item.roster ?? []);
  actor.role = item.actor?.role ?? "owner";
  actor.scope = item.actor?.scope ?? { level: "global", primaryAreaId: null, alsoCoversAreaIds: [] };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${item.today ?? DEFAULT_TODAY}T15:00:00Z`));
  const restore = modeFlags({ production: [...FLAGS.production, ...(item.flags ?? [])], on: FLAGS.on }, mode);
  const started = performance.now();
  const messages: ChatMessage[] = [];
  // A well-formed client id, so the route keeps the intake state between turns (`isClientConversationId`).
  const conversationId = createId("conv");
  let proposal: ChatFormProposal | null = null;
  let last = "";
  let error: string | null = null;
  try {
    await ensureTemplateLibrary("system");
    for (const [index, question] of item.turns.entries()) {
      const id = `msg_${item.id}_${mode}_u${index}`;
      const response = await chatRoute.POST(
        new Request("https://app.test/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question,
            mode: "standard",
            history: messages.map(({ id: messageId, role, content }) => ({ id: messageId, role, content })),
            questionMessageId: id,
            conversationId,
            ...(proposal ? { continueProposalTemplateKey: proposal.templateKey } : {}),
          }),
        }),
      );
      const payload = (await response.json()) as Reply & { error?: string };
      if (response.status !== 200) throw new Error(`turn ${index + 1}: HTTP ${response.status} ${payload.error ?? ""}`.trim());
      if (payload.formProposal) proposal = payload.formProposal;
      last = payload.content ?? "";
      messages.push(
        { id, role: "user", content: question, createdAt: "2026-10-23T15:00:00Z" } as ChatMessage,
        {
          id: `msg_${item.id}_${mode}_a${index}`,
          role: "assistant",
          content: payload.content ?? "",
          createdAt: "2026-10-23T15:00:01Z",
          ...(payload.formProposal ? { formProposal: payload.formProposal } : {}),
        } as ChatMessage,
      );
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    restore();
    vi.useRealTimers();
  }
  const ms = Math.round(performance.now() - started);
  return judgeCase({ item: judgedAs(item), proposal, lastReply: last, error, ms });
}

describe("replay eval", () => {
  // Untimed warm-up: the first replay loads every module, which is not a case's time.
  beforeAll(async () => {
    if (CASES[0]) await replay(CASES[0], "off");
  });

  /*
   * Each case runs RUNS times per column, off and on alternating which goes
   * first, so neither column is always the warmer one. The time is the median
   * run; every run must judge the same, or the replay is not deterministic.
   */
  it.each(CASES)("$id flags off and on", async (item) => {
    const runs: { off: EvalResult[]; on: EvalResult[] } = { off: [], on: [] };
    for (let run = 0; run < RUNS; run += 1) {
      const order: ("off" | "on")[] = run % 2 === 0 ? ["off", "on"] : ["on", "off"];
      for (const mode of order) runs[mode].push(await replay(item, mode));
    }
    for (const mode of ["off", "on"] as const) {
      const judged = new Set(runs[mode].map((result) => JSON.stringify(withoutTime(result))));
      expect(judged.size, `${item.id} ${mode}: the runs judged differently`).toBe(1);
      results[mode].push(medianRun(runs[mode]));
    }
  });

  afterAll(() => {
    mkdirSync("evals/results", { recursive: true });
    const off = latencySummary(results.off);
    const on = latencySummary(results.on);
    const report = { flags: FLAGS.on, off: results.off, on: results.on, latency: { off, on } };
    writeFileSync("evals/results/latest.json", `${JSON.stringify(report, null, 2)}\n`);
    const table = renderTable(results.off, results.on, FLAGS.on);
    writeFileSync("evals/results/latest.md", `${table}\n`);
    process.stdout.write(`\n${table}\n`);
  });

  it("flags off equals the recorded baseline, and flags on breaks no case and is at most 25% slower", () => {
    if (process.env.EVAL_UPDATE_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify({ cases: results.off.map(withoutTime) }, null, 2)}\n`);
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { cases: Omit<EvalResult, "ms">[] };
    const verdict = compareToBaseline(baseline.cases, results.off, results.on);
    expect(verdict.offChanged, "flags-off results differ from evals/baseline.json").toEqual([]);
    expect(verdict.onBroke, "a case that passes with the flags off fails with them on").toEqual([]);
    const speed = speedVerdict(results.off, results.on);
    expect(speed.ok, speed.detail).toBe(true);
  });
});
