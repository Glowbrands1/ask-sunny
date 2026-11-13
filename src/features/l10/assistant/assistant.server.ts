import "server-only";

import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { convertToModelMessages, jsonSchema, stepCountIs, streamText, tool, type LanguageModelUsage, type ToolSet, type UIMessage } from "ai";

import { persistSpendRow } from "@/lib/ai/chat-trace";
import type { TokenUsage } from "@/lib/ai/model-prices";

import { callHub, type HubAnswer } from "../partner/client.server";

type JSONSchema7 = Exclude<Parameters<typeof jsonSchema>[0], PromiseLike<unknown> | (() => unknown)>;

/**
 * THE DM L10 TAB'S ASSISTANT: the Leadership Hub's assistant, run on Ask Sunny's own Anthropic key.
 *
 * What is the Hub's, fetched from the Hub per request (partner API `assistant-config`), so nothing drifts:
 *   - the system prompt (the Hub's, plus a note on what is and is not available from Ask Sunny),
 *   - the model ids (the Hub's ASSISTANT_MODEL default, Opus for Deep think), step limit and output cap,
 *   - the tools: getMeeting and getMeetingRecaps, with the Hub's descriptions and input schemas. Their results are
 *     computed BY THE HUB (`assistant-tool`), as this person, limited to the meetings Ask Sunny may open.
 * What is Ask Sunny's: the API key (ANTHROPIC_API_KEY, already set), a per-person rate limit like the Hub's, and
 * Ask Sunny's own spend controls: the route asks `modelSpendGuard` first (the monthly budget, and the daily cap where
 * it is on), exactly as chat does, and every answer's token usage is written as a spend row in chat_traces
 * (source "l10_assistant", `recordAssistantSpend`), which is what the monthly budget counts.
 * Not here (only in the Hub): web search, Salon Details, reports, the tracker, note drafts, "Open as document".
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

export interface HubAssistantConfig {
  system: string;
  model: string;
  deepModel: string;
  maxSteps: number;
  maxOutputTokens: number;
  tools: Record<"getMeeting" | "getMeetingRecaps", { description: string; inputSchema: JSONSchema7 }> & {
    /** The Hub's note drafter (a card the person sends themselves). Absent from a Hub that does not offer it yet. */
    draftNote?: { description: string; inputSchema: JSONSchema7 };
  };
}

export function readConfig(a: HubAnswer): HubAssistantConfig | null {
  const b = a.body as Partial<HubAssistantConfig>;
  if (a.status !== 200 || typeof b.system !== "string" || typeof b.model !== "string" || typeof b.deepModel !== "string" || !b.tools) return null;
  if (!/^claude-[a-z0-9-]+$/.test(b.model) || !/^claude-[a-z0-9-]+$/.test(b.deepModel)) return null;
  return {
    system: b.system,
    model: b.model,
    deepModel: b.deepModel,
    maxSteps: Math.min(Math.max(Number(b.maxSteps) || 8, 1), 12),
    maxOutputTokens: Math.min(Math.max(Number(b.maxOutputTokens) || 16_000, 1000), 16_000),
    tools: b.tools,
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
    // Text only (no attachments in Ask Sunny's v1): a file part is refused rather than forwarded.
    if ((m as UIMessage).parts.some((p) => p?.type === "file")) return null;
  }
  return raw as UIMessage[];
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

/** Writes one answer's usage where the monthly budget counts it. Never throws; never blocks the answer. */
export function recordAssistantSpend(userId: string, call: TokenUsage | null, persist: typeof persistSpendRow = persistSpendRow): void {
  if (!call) return;
  void persist({ source: "l10_assistant", userId, calls: [call] });
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

export async function streamHubAssistant(input: { config: HubAssistantConfig; messages: UIMessage[]; deep: boolean; email: string; userId: string; meetingKey: string; signal?: AbortSignal }) {
  const { config, deep } = input;
  const modelId = deep ? config.deepModel : config.model;
  let recorded = false;
  const record = (usage: LanguageModelUsage | undefined) => {
    if (recorded) return;
    recorded = true;
    recordAssistantSpend(input.userId, spendFromUsage(modelId, usage));
  };
  const result = streamText({
    model: anthropic(modelId),
    system: config.system,
    messages: await convertToModelMessages(input.messages),
    tools: hubTools(config, input.email, input.meetingKey),
    stopWhen: stepCountIs(config.maxSteps),
    maxOutputTokens: config.maxOutputTokens,
    abortSignal: input.signal,
    onError: () => {},
    providerOptions: {
      anthropic: {
        thinking: { type: "adaptive", display: "summarized" },
        effort: deep ? "high" : "medium",
      } satisfies AnthropicLanguageModelOptions,
    },
    onAbort: ({ steps }) => record(sumSteps(steps)),
    onFinish: ({ totalUsage, steps }) => {
      record(totalUsage);
      // Counts only. Never log message content.
      console.info("[l10-assistant] usage", JSON.stringify({ model: modelId, deep, steps: steps.length, inputTokens: totalUsage.inputTokens ?? 0, outputTokens: totalUsage.outputTokens ?? 0 }));
    },
  });
  return result.toUIMessageStreamResponse({
    sendReasoning: true,
    onError: (error) => {
      const e = error as { name?: string; statusCode?: number };
      console.error("[l10-assistant] stream error", JSON.stringify({ name: e?.name ?? "unknown", status: e?.statusCode ?? null, deep }));
      return "The assistant could not answer just now. Please try again in a minute.";
    },
  });
}
