import { promptCacheEnabled } from "@/lib/config/chat-quality-flags";

/**
 * Prompt caching for the two blocks that repeat on every turn.
 *
 * The static system prompt and the pinned policy-manual block take
 * `cache_control: { type: "ephemeral" }`. Off, the system prompt stays a
 * string and the manual stays inside the grounding string.
 */

export const CACHE_CONTROL = { type: "ephemeral" } as const;

export interface CachedTextBlock {
  readonly type: "text";
  readonly text: string;
  readonly cache_control?: typeof CACHE_CONTROL;
}

export function cachedSystem(system: string): string | CachedTextBlock[] {
  if (!promptCacheEnabled()) return system;
  return [{ type: "text", text: system, cache_control: CACHE_CONTROL }];
}

/** The grounding string with the manual block removed, once, when caching is on. */
export function groundingWithoutCachedManual(grounding: string, manual: string | null | undefined): string {
  if (!promptCacheEnabled() || !manual?.trim()) return grounding;
  const index = grounding.indexOf(manual);
  if (index < 0) return grounding;
  return `${grounding.slice(0, index)}${grounding.slice(index + manual.length)}`.replace(/\n{3,}/g, "\n\n").trim();
}

export function cachedUserContent(text: string, manual: string | null | undefined): string | CachedTextBlock[] {
  const block = manual?.trim() ?? "";
  if (!promptCacheEnabled() || !block) return text;
  return [
    { type: "text", text: block, cache_control: CACHE_CONTROL },
    { type: "text", text },
  ];
}
