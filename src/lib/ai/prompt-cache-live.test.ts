import { readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";

import { CLAUDE_EFFORT, CLAUDE_MODEL } from "@/lib/config/models";

import { cachedSystem, splitSystemPrompt, type CachedTextBlock } from "./prompt-cache";
import { buildSystemPrompt } from "./prompts";

/**
 * Real Claude calls. Skipped unless ANTHROPIC_API_KEY is set. CI does not
 * set it, and the previews have no key. The local stand-in in prompt-cache.ts
 * is not a bill and is not what this file measures.
 *
 * A warm cache is a hit: cache_read_input_tokens > 0 counts even when
 * cache_creation_input_tokens stays 0. First-token time is the median of
 * three or more cache-read samples, compared with the median of three
 * uncached samples.
 */

const KEY = process.env.ANTHROPIC_API_KEY;
const SAMPLES = 3;
const CONTEXT = {
  userName: "Dana Reyes",
  locationName: "MO Kansas City Wornall",
  todayIso: "2026-08-29",
};

interface UsageTiming {
  cacheCreation: number;
  cacheRead: number;
  firstTokenMs: number;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Samples that read the prompt cache. A warm prefix has no creation token. */
export function cacheReadSamples(samples: readonly UsageTiming[]): UsageTiming[] {
  return samples.filter((sample) => sample.cacheRead > 0);
}

function promptPair(): { legacy: string; current: string } {
  const current = buildSystemPrompt({
    assistantName: "Sunny",
    brandName: "Sun Tan City",
    salonNoun: "salon",
    context: CONTEXT,
    mode: "standard",
    hasContext: true,
  });
  const parts = splitSystemPrompt(current);
  if (!parts.dynamicTail) throw new Error("the system prompt has no dynamic tail");
  const breakAt = parts.staticBlock.indexOf("\n");
  const legacy = `${parts.staticBlock.slice(0, breakAt)} ${parts.dynamicTail}${parts.staticBlock.slice(breakAt)}`;
  return { legacy, current };
}

async function measure(
  client: Anthropic,
  system: string | CachedTextBlock[],
  question: string,
): Promise<UsageTiming> {
  const started = Date.now();
  let firstTokenMs: number | null = null;
  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 256,
    thinking: { type: "adaptive" },
    output_config: { effort: CLAUDE_EFFORT },
    system,
    messages: [{ role: "user", content: `QUESTION\n\n${question}` }],
  });
  stream.on("text", () => {
    if (firstTokenMs === null) firstTokenMs = Date.now() - started;
  });
  const message = await stream.finalMessage();
  const usage = message.usage;
  return {
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    firstTokenMs: firstTokenMs ?? Date.now() - started,
  };
}

describe("prompt cache sample", () => {
  it("treats a warm cache as a hit and uses the median of at least three reads", () => {
    const warm: UsageTiming[] = [
      { cacheCreation: 0, cacheRead: 100, firstTokenMs: 900 },
      { cacheCreation: 0, cacheRead: 100, firstTokenMs: 100 },
      { cacheCreation: 0, cacheRead: 100, firstTokenMs: 200 },
      { cacheCreation: 0, cacheRead: 100, firstTokenMs: 300 },
    ];
    const warmHits = cacheReadSamples(warm);
    expect(warmHits.length).toBeGreaterThanOrEqual(SAMPLES);
    expect(median(warmHits.map((hit) => hit.firstTokenMs))).toBe(250);

    const coldThenWarm: UsageTiming[] = [
      { cacheCreation: 50, cacheRead: 0, firstTokenMs: 800 },
      { cacheCreation: 0, cacheRead: 50, firstTokenMs: 110 },
      { cacheCreation: 0, cacheRead: 50, firstTokenMs: 90 },
      { cacheCreation: 0, cacheRead: 50, firstTokenMs: 100 },
    ];
    const reads = cacheReadSamples(coldThenWarm);
    expect(reads).toHaveLength(SAMPLES);
    expect(median(reads.map((hit) => hit.firstTokenMs))).toBe(100);
    expect(coldThenWarm.some((sample) => sample.cacheCreation > 0 && sample.cacheRead === 0)).toBe(true);
  });
});

describe.skipIf(!KEY)("prompt cache, live Claude", () => {
  afterEach(() => {
    delete process.env.PROMPT_CACHE_ENABLED;
  });

  it("accepts a warm cache and compares median first-token time", async () => {
    const replay = JSON.parse(readFileSync("src/lib/ai/__fixtures__/replay_set.json", "utf8")) as {
      id: string;
      turns: string[];
    }[];
    const client = new Anthropic({ apiKey: KEY });
    const { legacy, current } = promptPair();
    const rows: { caseId: string; oldMedian: number; readMedian: number; reads: number }[] = [];

    for (const item of replay) {
      const question = item.turns[0]!;
      delete process.env.PROMPT_CACHE_ENABLED;
      const oldSamples: UsageTiming[] = [];
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        oldSamples.push(await measure(client, legacy, question));
      }
      process.env.PROMPT_CACHE_ENABLED = "1";
      const warmup = await measure(client, cachedSystem(current), question);
      const readSamples: UsageTiming[] = [];
      for (let sample = 0; sample < SAMPLES; sample += 1) {
        readSamples.push(await measure(client, cachedSystem(current), question));
      }
      const hits = cacheReadSamples([warmup, ...readSamples]);
      expect(
        hits.length,
        `${item.id}: cache_read stayed 0. A warm cache still has to report cache_read_input_tokens > 0.`,
      ).toBeGreaterThanOrEqual(SAMPLES);
      const measuredReads = cacheReadSamples(readSamples);
      expect(measuredReads.length, `${item.id}: fewer than ${SAMPLES} cache-read samples`).toBeGreaterThanOrEqual(
        SAMPLES,
      );
      const oldMedian = median(oldSamples.map((sample) => sample.firstTokenMs));
      const readMedian = median(measuredReads.map((sample) => sample.firstTokenMs));
      rows.push({ caseId: item.id, oldMedian, readMedian, reads: measuredReads.length });
      expect(
        readMedian,
        `${item.id}: median cache-read first token ${readMedian}ms vs OLD median ${oldMedian}ms`,
      ).toBeLessThanOrEqual(oldMedian * 1.25);
    }

    console.log(JSON.stringify({ model: CLAUDE_MODEL, rows }));
    expect(rows.length).toBeGreaterThan(0);
  }, 600_000);
});
