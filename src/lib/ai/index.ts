import { MockAIProvider } from "./mock-provider";
import type { AIProvider } from "./types";

export * from "./types";
export { MockAIProvider } from "./mock-provider";

/**
 * WHERE THE CLAUDE IMPLEMENTATION GOES
 * ===========================================================================
 *
 * Create `src/lib/ai/claude-provider.ts` implementing the same `AIProvider`
 * interface, then extend `getAIProvider()` below. Nothing else changes — no
 * component imports an SDK, a model id, or a key.
 *
 * ---------------------------------------------------------------------------
 * class ClaudeProvider implements AIProvider {
 *   readonly name = "Claude (Anthropic)"
 *   readonly connected = true
 *
 *   async ask(request: AskRequest): Promise<AskResponse> {
 *     // 1. Retrieve grounding context through the KnowledgeProvider.
 *     //    const results = await knowledge.search({ query: request.question,
 *     //                                             scopeId: request.scopeId })
 *     //
 *     // 2. POST to an internal route handler — NEVER call Anthropic from the
 *     //    browser, and never expose ANTHROPIC_API_KEY to the client.
 *     //    `src/app/api/chat/route.ts` runs server-side, reads the key from
 *     //    process.env, and calls the Messages API with:
 *     //      - a system prompt carrying Ask Sunny's role, tone, the standing
 *     //        manager note, and the instruction to answer only from provided
 *     //        context and say so when the context does not cover it
 *     //      - the retrieved chunks as grounding context, each labelled with
 *     //        its document title and locator so citations stay precise
 *     //      - the conversation history
 *     //      - an answer-length instruction derived from request.mode
 *     //      - a tool definition for the chat-to-form handoff, so the model
 *     //        returns structured FormHandoff values rather than prose
 *     //
 *     // 3. Map the response back into AskResponse:
 *     //      content              <- the model's text
 *     //      citations            <- knowledge.toCitations(results)
 *     //      recommendedVideoIds  <- video match on equipment/keywords/tags
 *     //      formHandoff          <- the tool call result, when present
 *   }
 *
 *   titleForConversation(firstMessage: string) { ... }
 * }
 * ---------------------------------------------------------------------------
 *
 * Streaming: the interface returns a resolved AskResponse today. When
 * streaming is added, keep `ask()` and add `askStream()` alongside it so the
 * mock provider stays valid.
 */

let cached: AIProvider | null = null;

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  // FUTURE:
  //   if (process.env.ANTHROPIC_API_KEY) {
  //     cached = new ClaudeProvider()
  //     return cached
  //   }
  //
  // The key is server-only and is never read in client code. In this phase the
  // app runs entirely without it, which is why `.env.example` ships it empty.
  cached = new MockAIProvider();
  return cached;
}

/** Honest label for the UI — never claims a connection that does not exist. */
export function aiProviderStatus() {
  const provider = getAIProvider();
  return {
    name: provider.connected ? "Claude (Anthropic)" : "Demo responses",
    connected: provider.connected,
    detail: provider.connected
      ? "Answers are generated live."
      : "Answers come from a seeded demo knowledge base. Claude is not connected in this prototype.",
  };
}
