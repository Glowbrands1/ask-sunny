import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { requireEnv } from "@/lib/config/server-env";

import { meteredClient } from "./spend-meter";

/**
 * The Anthropic client. Server-only, constructed once.
 *
 * `import "server-only"` is what guarantees ANTHROPIC_API_KEY cannot reach the
 * browser: a client component importing this file fails the build.
 */
let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  client ??= new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  // SPEND_GUARD_ALL_CALLS_ENABLED: every call's usage into the request's meter. Off, the client itself.
  return meteredClient(client);
}

/** Test seam. */
export function __setAnthropicClient(next: Anthropic | null): void {
  client = next;
}

export { Anthropic };
