import "server-only";

import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { convertToModelMessages, jsonSchema, stepCountIs, streamText, tool, type LanguageModelUsage, type SystemModelMessage, type ToolSet, type UIMessage } from "ai";
import { logAiTimeout } from "@/lib/ai/time-limit";
import { helperTimeoutMs } from "@/lib/config/ai-timeouts";

import { persistSpendRow } from "@/lib/ai/chat-trace";
import type { TokenUsage } from "@/lib/ai/model-prices";

import { callHub, type HubAnswer } from "../partner/client.server";

type JSONSchema7 = Exclude<Parameters<typeof jsonSchema>[0], PromiseLike<unknown> | (() => unknown)>;

/**
 * THE DM L10 TAB'S ASSISTANT: the Leadership Hub's assistant, run on Ask Sunny's own Anthropic key.
 *
 * What is the Hub's, fetched from the Hub per request (partner API `assistant-config`), so nothing drifts:
 *   - the system prompt (the Hub's, plus a note on what is and is not available from Ask Sunny),
 *   - the model ids (the Hub's ASSISTANT_MODEL default, Opus for Deep think), step limit, output cap, thinking and
 *     effort (Deep think), the web tools' limits and the attachment limits: the very constants the Hub's route uses,
 *   - the tools: getMeeting, getMeetingRecaps and draftNote, with the Hub's descriptions and input schemas. Their
 *     results are computed BY THE HUB (`assistant-tool`), as this person, limited to the meetings Ask Sunny may open,
 *   - Anthropic's web search and web fetch (the owner's decision, 13 Nov 2026), with the Hub's limits. Ask Sunny's
 *     @ai-sdk/anthropic (the newest release for AI SDK 6) has the 20260209 versions of these tools, not the Hub's
 *     20260318: see PARITY.md.
 * What is Ask Sunny's: the API key (ANTHROPIC_API_KEY, already set), a per-person rate limit like the Hub's, and
 * Ask Sunny's own spend controls: the route asks `modelSpendGuard` first (the monthly budget, and the daily cap where
 * it is on), exactly as chat does, and every answer's token usage is written as a spend row in chat_traces
 * (source "l10_assistant", `recordAssistantSpend`), which is what the monthly budget counts.
 * Not here (only in the Hub): Salon Details, reports, the tracker.
 */

const MAX_MESSAGES = 60;
const RATE_LIMIT = { windowMs: 10 * 60_000, max: 20 }; // the Hub's limit for its assistant

const hits = new Map<string, number[]>();
export function assistantRateLimit(key: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (recent.length >= RATE_LIMIT.max) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.ceil((recent[0] + RATE_LIMIT.windowMs - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < RATE_LIMIT.windowMs)) hits.delete(k);
  return { ok: true };
}

type Effort = "low" | "medium" | "high";
export interface WebTools {
  webSearch: { maxUses: number };
  webFetch: { maxUses: number; citations: { enabled: boolean } };
}

/** The Hub's values, used only when an older Hub does not send them yet (they are the same constants). */
export const HUB_DEFAULTS = {
  thinking: { type: "adaptive", display: "summarized" } as const,
  effort: { fast: "medium", deep: "high" } as { fast: Effort; deep: Effort },
  attachments: { maxFiles: 5, maxBytes: 10 * 1024 * 1024 },
};

export interface HubAssistantConfig {
  system: string;
  model: string;
  deepModel: string;
  maxSteps: number;
  maxOutputTokens: number;
  thinking: { type: "adaptive"; display: "summarized" | "omitted" };
  effort: { fast: Effort; deep: Effort };
  /** Anthropic's web search and fetch, with the Hub's limits; null when the Hub does not offer them. */
  webTools: WebTools | null;
  attachments: { maxFiles: number; maxBytes: number };
  tools: Record<"getMeeting" | "getMeetingRecaps", { description: string; inputSchema: JSONSchema7 }> & {
    /** The Hub's note drafter (a card the person sends themselves). Absent from a Hub that does not offer it yet. */
    draftNote?: { description: string; inputSchema: JSONSchema7 };
  };
}

export function readConfig(a: HubAnswer): HubAssistantConfig | null {
  const b = a.body as Partial<HubAssistantConfig>;
  if (a.status !== 200 || typeof b.system !== "string" || typeof b.model !== "string" || typeof b.deepModel !== "string" || !b.tools) return null;
  if (!/^claude-[a-z0-9-]+$/.test(b.model) || !/^claude-[a-z0-9-]+$/.test(b.deepModel)) return null;
  const raw = a.body as Record<string, unknown>;
  const effort = (v: unknown, fallback: Effort): Effort => (v === "low" || v === "medium" || v === "high" ? v : fallback);
  const e = (raw.effort ?? {}) as { fast?: unknown; deep?: unknown };
  const t = (raw.thinking ?? {}) as { type?: unknown; display?: unknown };
  const uses = (v: unknown, max: number) => Math.min(Math.max(Math.trunc(Number(v)) || 0, 0), max);
  const w = raw.webTools as { webSearch?: { maxUses?: unknown }; webFetch?: { maxUses?: unknown; citations?: { enabled?: unknown } } } | undefined;
  const webTools: WebTools | null =
    w && uses(w.webSearch?.maxUses, 10) > 0 && uses(w.webFetch?.maxUses, 10) > 0
      ? { webSearch: { maxUses: uses(w.webSearch?.maxUses, 10) }, webFetch: { maxUses: uses(w.webFetch?.maxUses, 10), citations: { enabled: w.webFetch?.citations?.enabled === true } } }
      : null;
  const at = (raw.attachments ?? {}) as { maxFiles?: unknown; maxBytes?: unknown };
  return {
    system: b.system,
    model: b.model,
    deepModel: b.deepModel,
    // Safety bounds only (the Hub sends 8 and 16,000, which pass through unchanged).
    maxSteps: Math.min(Math.max(Number(b.maxSteps) || 8, 1), 12),
    maxOutputTokens: Math.min(Math.max(Number(b.maxOutputTokens) || 16_000, 1000), 16_000),
    thinking: { type: "adaptive", display: t.display === "omitted" ? "omitted" : "summarized" },
    effort: { fast: effort(e.fast, HUB_DEFAULTS.effort.fast), deep: effort(e.deep, HUB_DEFAULTS.effort.deep) },
    webTools,
    // Never above the Hub's limits (a request must also stay under Vercel's ~4.5 MB body limit).
    attachments: {
      maxFiles: uses(at.maxFiles, 5) || HUB_DEFAULTS.attachments.maxFiles,
      maxBytes: Math.min(Math.max(Number(at.maxBytes) || HUB_DEFAULTS.attachments.maxBytes, 1), HUB_DEFAULTS.attachments.maxBytes),
    },
    tools: b.tools,
  };
}

/** Anthropic's server-side web tools with the Hub's limits (20260209: the newest this SDK has, see PARITY.md). */
export function webTools(config: HubAssistantConfig): ToolSet {
  if (!config.webTools) return {};
  return {
    web_search: anthropic.tools.webSearch_20260209({ maxUses: config.webTools.webSearch.maxUses }),
    web_fetch: anthropic.tools.webFetch_20260209({ maxUses: config.webTools.webFetch.maxUses, citations: config.webTools.webFetch.citations }),
  };
}

/** The Hub's two meeting tools, each executed by the Hub for this person (never with data from this server). */
export function hubTools(config: HubAssistantConfig, email: string, meetingKey: string, call: typeof callHub = callHub): ToolSet {
  const make = (name: "getMeeting" | "getMeetingRecaps" | "draftNote") =>
    tool({
      description: config.tools[name]!.description,
      inputSchema: jsonSchema<Record<string, unknown>>(config.tools[name]!.inputSchema),
      execute: async (input) => {
        const a = await call("assistant-tool", email, { key: meetingKey, tool: name, input });
        if (a.status === 200 && a.body.result) return a.body.result;
        return { source: "Leadership Hub", href: `/meetings/${meetingKey}`, data: { error: "The meeting could not be read just now. Do not guess; tell the person and point them to the page." } };
      },
    });
  // draftNote only drafts (the Hub returns a card); nothing is sent until the person presses Send on it.
  return { getMeeting: make("getMeeting"), getMeetingRecaps: make("getMeetingRecaps"), ...(config.tools.draftNote ? { draftNote: make("draftNote") } : {}) };
}

export function validMessages(raw: unknown): UIMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  for (const m of raw) {
    if (!m || typeof m !== "object" || !["user", "assistant"].includes((m as UIMessage).role) || !Array.isArray((m as UIMessage).parts)) return null;
  }
  return raw as UIMessage[];
}

/**
 * The Hub route's attachment guard, word for word: images and PDFs only, at most `maxFiles` per message and `maxBytes`
 * each (the Hub's 5 and 10 MB, from its config), inline data URLs only. Only a person's own messages may carry files.
 */
export function attachmentProblem(messages: UIMessage[], limits: { maxFiles: number; maxBytes: number } = HUB_DEFAULTS.attachments): string | undefined {
  for (const m of messages) {
    const files = m.parts.filter((p) => p?.type === "file");
    if (m.role !== "user") {
      if (files.length) return "Only images and PDFs can be attached.";
      continue;
    }
    if (files.length > limits.maxFiles) return `Attach at most ${limits.maxFiles} files per message.`;
    for (const f of files) {
      if (f.type !== "file") continue;
      if (typeof f.mediaType !== "string" || !/^(image\/(png|jpe?g|gif|webp)|application\/pdf)$/.test(f.mediaType)) return "Only images and PDFs can be attached.";
      // Only inline data URLs: a remote URL would make the server or model provider fetch an address the client chose.
      if (typeof f.url !== "string" || !f.url.startsWith("data:")) return "Attachments must be uploaded from your device.";
      if ((f.url.length * 3) / 4 > limits.maxBytes * 1.02) return "Each file must be 10 MB or smaller.";
    }
  }
}

/** Web searches the answer made, from Anthropic's raw usage of each step (server_tool_use.web_search_requests). */
export function webSearchCount(steps: readonly { usage?: LanguageModelUsage }[]): number {
  let n = 0;
  for (const s of steps) {
    const raw = s.usage?.raw as { server_tool_use?: { web_search_requests?: unknown } } | undefined;
    const v = Number(raw?.server_tool_use?.web_search_requests);
    if (Number.isFinite(v) && v > 0) n += v;
  }
  return n;
}

/** One answer's model usage as Ask Sunny's spend guard counts it (uncached input, output, cache reads and writes). */
export function spendFromUsage(model: string, usage: LanguageModelUsage | undefined): TokenUsage | null {
  if (!usage) return null;
  const n = (v: number | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const cacheRead = n(usage.inputTokenDetails?.cacheReadTokens);
  const cacheWrite = n(usage.inputTokenDetails?.cacheWriteTokens);
  const input = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, n(usage.inputTokens) - cacheRead - cacheWrite);
  const row = { model, inputTokens: n(input), outputTokens: n(usage.outputTokens), cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite };
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens > 0 ? row : null;
}

/**
 * Writes one answer's usage where the monthly budget counts it. Never throws; never blocks the answer. Web searches are
 * recorded with it (`webSearchRequests`); neither app has a per-search price yet, so the budget counts their tokens
 * (the results come back as input tokens) and the count is there for when one is set.
 */
export function recordAssistantSpend(userId: string, call: TokenUsage | null, persist: typeof persistSpendRow = persistSpendRow, webSearchRequests = 0): void {
  if (!call && webSearchRequests <= 0) return;
  const row = { ...(call ?? { model: null, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), ...(webSearchRequests > 0 ? { webSearchRequests } : {}) };
  void persist({ source: "l10_assistant", userId, calls: [row] });
}

/** The usage of the steps that finished (for a stopped answer, whose total never arrives). */
function sumSteps(steps: readonly { usage: LanguageModelUsage }[]): LanguageModelUsage | undefined {
  if (steps.length === 0) return undefined;
  const add = (a: number | undefined, b: number | undefined) => (a ?? 0) + (b ?? 0);
  return steps.reduce<LanguageModelUsage>(
    (t, s) => ({
      ...t,
      inputTokens: add(t.inputTokens, s.usage.inputTokens),
      outputTokens: add(t.outputTokens, s.usage.outputTokens),
      inputTokenDetails: {
        noCacheTokens: add(t.inputTokenDetails?.noCacheTokens, s.usage.inputTokenDetails?.noCacheTokens),
        cacheReadTokens: add(t.inputTokenDetails?.cacheReadTokens, s.usage.inputTokenDetails?.cacheReadTokens),
        cacheWriteTokens: add(t.inputTokenDetails?.cacheWriteTokens, s.usage.inputTokenDetails?.cacheWriteTokens),
      },
    }),
    { ...steps[0].usage, inputTokens: 0, outputTokens: 0, inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } as LanguageModelUsage,
  );
}

/** The L10 assistant's whole answer, under its route's maxDuration (300 s). */
export const L10_TOTAL_TIMEOUT_MS = 280_000;

/** An abort the time limit caused (the AI SDK aborts with a TimeoutError or AbortError). */
function isTimeoutError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "TimeoutError" || name === "AbortError";
}

export async function streamHubAssistant(input: { config: HubAssistantConfig; messages: UIMessage[]; deep: boolean; email: string; userId: string; meetingKey: string; signal?: AbortSignal }) {
  const { config, deep } = input;
  const modelId = deep ? config.deepModel : config.model;
  let recorded = false;
  const record = (usage: LanguageModelUsage | undefined, steps: readonly { usage?: LanguageModelUsage }[]) => {
    if (recorded) return;
    recorded = true;
    recordAssistantSpend(input.userId, spendFromUsage(modelId, usage), persistSpendRow, webSearchCount(steps));
  };
  // The Hub's system prompt with the Hub's cache breakpoint (Anthropic caches tools + system as one prefix).
  const system: SystemModelMessage = { role: "system", content: config.system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } };
  const startedAt = Date.now();
  const result = streamText({
    model: anthropic(modelId),
    system,
    // Images and PDFs the person attached go to the model as file parts (Claude reads PDFs natively), as in the Hub.
    messages: await convertToModelMessages(input.messages),
    tools: { ...webTools(config), ...hubTools(config, input.email, input.meetingKey) },
    stopWhen: stepCountIs(config.maxSteps),
    maxOutputTokens: config.maxOutputTokens,
    abortSignal: input.signal,
    /*
     * AI TIME LIMITS (QA, 14 Nov 2026): a stream that goes quiet for the helper limit (30 s) is stopped, and the whole
     * answer ends inside the route's 300 s. Not a 45 s step limit: a deep-think step can run past a minute while it
     * streams. The reply on a timeout is the onError message below; the log line is written there.
     */
    timeout: { totalMs: L10_TOTAL_TIMEOUT_MS, chunkMs: helperTimeoutMs() },
    onError: () => {},
    providerOptions: {
      anthropic: {
        thinking: config.thinking,
        effort: deep ? config.effort.deep : config.effort.fast,
      } satisfies AnthropicLanguageModelOptions,
    },
    onAbort: ({ steps }) => record(sumSteps(steps), steps),
    onFinish: ({ totalUsage, steps }) => {
      record(totalUsage, steps);
      // Counts only. Never log message content.
      console.info("[l10-assistant] usage", JSON.stringify({ model: modelId, deep, steps: steps.length, inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0, webSearches: webSearchCount(steps) }));
    },
  });
  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    // Web results and cited pages show as sources under the answer, as in the Hub.
    sendSources: true,
    onError: (error) => {
      const e = error as { name?: string; statusCode?: number };
      // AI TIME LIMITS: a timeout gets its own log line (route, call, duration; no content).
      if (isTimeoutError(error) && !input.signal?.aborted) logAiTimeout(deep ? "l10_assistant_deep" : "l10_assistant", Date.now() - startedAt, L10_TOTAL_TIMEOUT_MS, "l10_assistant");
      console.error("[l10-assistant] stream error", JSON.stringify({ name: e?.name ?? "unknown", status: e?.statusCode ?? null, deep }));
      return "The assistant could not answer just now. Please try again in a minute.";
    },
  });
}
