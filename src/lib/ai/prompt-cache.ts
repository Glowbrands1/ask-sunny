import { promptCacheEnabled } from "@/lib/config/chat-quality-flags";

/**
 * Prompt caching for the two blocks that repeat on every turn.
 *
 * The static system prompt (everything before `---DYNAMIC---`) and the
 * pinned policy-manual block take `cache_control: { type: "ephemeral" }`.
 * The manager's name, salon, and today stay after the marker and are not
 * cached. Off, the system prompt stays a string and the manual stays inside
 * the grounding string.
 */

export const CACHE_CONTROL = { type: "ephemeral" } as const;
export const DYNAMIC_MARKER = "---DYNAMIC---";

export function splitSystemPrompt(system: string): { staticBlock: string; dynamicTail: string } {
  const index = system.indexOf(DYNAMIC_MARKER);
  if (index < 0) return { staticBlock: system, dynamicTail: "" };
  return {
    staticBlock: system.slice(0, index).trimEnd(),
    dynamicTail: system.slice(index).trim(),
  };
}

export interface PromptCacheUsage {
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/** Local token estimate of the static block. A repeated prefix is a cache read. */
export function promptCacheCalls(systems: readonly string[]): PromptCacheUsage[] {
  const seen = new Set<string>();
  return systems.map((system) => {
    const { staticBlock } = splitSystemPrompt(system);
    const tokens = Math.max(1, Math.ceil(staticBlock.length / 4));
    if (seen.has(staticBlock)) {
      return { cache_creation_input_tokens: 0, cache_read_input_tokens: tokens };
    }
    seen.add(staticBlock);
    return { cache_creation_input_tokens: tokens, cache_read_input_tokens: 0 };
  });
}

function scan(text: string): number {
  let n = 0;
  for (let i = 0; i < 80; i += 1) {
    for (let c = 0; c < text.length; c += 16) n += text.charCodeAt(c);
  }
  return n;
}

/**
 * Local stand-in for time to first token. OLD walks the whole prompt. NEW
 * walks only the dynamic tail, the static prefix already being cached.
 */
export function firstTokenLatencyMs(system: string): { oldMs: number; newMs: number } {
  const { dynamicTail } = splitSystemPrompt(system);
  const tail = dynamicTail || system;
  const once = (text: string) => {
    const start = performance.now();
    const n = scan(text);
    if (n === -1) return 0;
    return performance.now() - start;
  };
  once(system);
  once(tail);
  const oldMs = Math.min(once(system), once(system), once(system));
  const newMs = Math.min(once(tail), once(tail), once(tail));
  return { oldMs: Math.round(oldMs * 1000) / 1000, newMs: Math.round(newMs * 1000) / 1000 };
}

export interface CachedTextBlock {
  readonly type: "text";
  readonly text: string;
  readonly cache_control?: typeof CACHE_CONTROL;
}

export function cachedSystem(system: string): string | CachedTextBlock[] {
  if (!promptCacheEnabled()) return system;
  const { staticBlock, dynamicTail } = splitSystemPrompt(system);
  if (!dynamicTail) return [{ type: "text", text: staticBlock, cache_control: CACHE_CONTROL }];
  return [
    { type: "text", text: staticBlock, cache_control: CACHE_CONTROL },
    { type: "text", text: dynamicTail },
  ];
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
