/**
 * List prices per million tokens, the one place the spend guard reads them
 * (Pau, 27 Oct 2026: live model spend stays inside a monthly cap). Input is
 * the uncached prompt; cache reads and cache writes are priced on their own.
 * A model not listed is priced as the dearest one, so an unknown name can
 * only make the guard stricter.
 */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

const OPUS: ModelPrice = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
const SONNET: ModelPrice = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
// Haiku's cache prices follow the same 0.1x / 1.25x ratios as the others.
const HAIKU: ModelPrice = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 };

// Claude Haiku 5.5, for prompts up to 100,000 tokens (the pricing page, 27 Oct 2026): $0.10 in, $0.50 out,
// cache reads $0.01, 5-minute cache writes $0.125. Longer prompts cost more, so a call over 100K is under-counted.
const HAIKU_5_5: ModelPrice = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };

const BY_PREFIX: readonly (readonly [string, ModelPrice])[] = [
  ["claude-opus-5", OPUS],
  ["claude-sonnet-5", SONNET],
  ["claude-haiku-4-5", HAIKU],
  ["claude-haiku-5-5", HAIKU_5_5],
];

export function priceFor(model: string | null | undefined): ModelPrice {
  const name = (model ?? "").toLowerCase();
  return BY_PREFIX.find(([prefix]) => name.startsWith(prefix))?.[1] ?? OPUS;
}

export interface TokenUsage {
  readonly model: string | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
}

/** US dollars for one model call's usage. */
export function usageCostUsd(usage: TokenUsage): number {
  const price = priceFor(usage.model);
  return (
    ((usage.inputTokens ?? 0) * price.input +
      (usage.outputTokens ?? 0) * price.output +
      (usage.cacheReadTokens ?? 0) * price.cacheRead +
      (usage.cacheWriteTokens ?? 0) * price.cacheWrite) /
    1_000_000
  );
}
