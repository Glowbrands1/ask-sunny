import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Anthropic from "@anthropic-ai/sdk";

import type { callClaudeToolTimed } from "../call-claude";

/**
 * ============================================================================
 * AI_READS_CODE_CHECKS_ENABLED — RECORDED MODEL REPLIES (REPORTS AND TESTS ONLY)
 * ============================================================================
 *
 * The variation report and the gate replay the reader's model replies offline,
 * so CI never calls the model and two runs compare. Never imported by the app.
 *
 *   record   calls the model (ANTHROPIC_API_KEY) and writes each reply
 *   replay   reads the reply; a missing recording fails the call, so the
 *            reader falls back and the turn is exactly the flag-off turn
 *
 * One JSON file per call, `{ key, model, reply, usage, ms }`, named by its key: the
 * sha256 of `{ model, system, tool, user }` — the same format in both apps.
 * Recordings hold the seeds' invented names only.
 */

type Call = Parameters<typeof callClaudeToolTimed>[0];
type Reply = Awaited<ReturnType<typeof callClaudeToolTimed>>;

export interface Recording {
  readonly key: string;
  readonly model: string;
  readonly reply: unknown;
  readonly usage: Reply["usage"];
  /** How long the live call took. A replay of one over the app's limit fails, as the live call would have. */
  readonly ms: number;
}

export function recordingKey(call: Call): string {
  const user = call.messages.map((message) => message.content).join("\n\n");
  return createHash("sha256")
    .update(JSON.stringify({ model: call.model, system: call.system, tool: call.tool.name, user }))
    .digest("hex");
}

export interface ReplayStats {
  calls: number;
  missing: number;
  /** Replayed replies whose live call took longer than the app's limit. */
  slow: number;
  recorded: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function replayTransport(dir: string, mode: "replay" | "record") {
  const stats: ReplayStats = { calls: 0, missing: 0, slow: 0, recorded: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let client: Anthropic | null = null;
  const count = (usage: Reply["usage"]) => {
    stats.inputTokens += usage.inputTokens;
    stats.outputTokens += usage.outputTokens;
    stats.cacheReadTokens += usage.cacheReadTokens;
    stats.cacheWriteTokens += usage.cacheWriteTokens;
  };
  const call = async (input: Call): Promise<Reply> => {
    stats.calls += 1;
    const key = recordingKey(input);
    const file = join(dir, `${key}.json`);
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Recording;
      count(saved.usage);
      if (saved.ms > input.timeoutMs) {
        stats.slow += 1;
        throw new Error("slower than the limit");
      }
      return { input: saved.reply, usage: saved.usage };
    }
    if (mode === "replay") {
      stats.missing += 1;
      throw new Error("no recording");
    }
    client ??= new Anthropic();
    const started = Date.now();
    const response = await client.messages.create(
      {
        model: input.model,
        max_tokens: input.maxTokens,
        system: input.system,
        tools: [
          {
            name: input.tool.name,
            description: input.tool.description,
            input_schema: {
              type: "object" as const,
              properties: input.tool.input_schema.properties ?? {},
              required: input.tool.input_schema.required ? [...input.tool.input_schema.required] : undefined,
            },
          },
        ],
        tool_choice: { type: "tool" as const, name: input.tool.name },
        messages: input.messages.map((message) => ({ role: message.role, content: message.content })),
      },
      // Recording is not timed: the 2 s limit is the app's, and a slow reply is still worth keeping.
      { maxRetries: 2 },
    );
    const block = response.content.find((item) => item.type === "tool_use");
    const usage = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    };
    const ms = Date.now() - started;
    const recording: Recording = { key, model: input.model, reply: block && block.type === "tool_use" ? block.input : null, usage, ms };
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
    stats.recorded += 1;
    count(usage);
    if (ms > input.timeoutMs) {
      stats.slow += 1;
      throw new Error("slower than the limit");
    }
    return { input: recording.reply, usage };
  };
  return { call, stats };
}
