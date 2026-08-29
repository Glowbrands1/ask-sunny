import "server-only";

import { CLAUDE_EFFORT, CLAUDE_MAX_TOKENS, CLAUDE_MODEL, RETRIEVAL } from "@/lib/config/models";
import { MissingConfigurationError, liveReadiness } from "@/lib/config/server-env";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  buildFormCollection,
  buildFormDraft,
  findPendingFormTurn,
  isFormIntent,
} from "@/lib/forms/chat-flow";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";
import { rowToCitation, type MatchedChunkRow } from "@/lib/knowledge/mappers";
import type { SourceCitation } from "@/types";
import { getAnthropicClient } from "./anthropic";
import { AiError } from "./errors";
import {
  buildGroundingBlock,
  buildSystemPrompt,
  extractUsedMarkers,
  stripMarkers,
  type GroundingChunk,
} from "./prompts";
import type { AskRequest, AskResponse } from "./types";

/**
 * THE GROUNDED ANSWER PATH — server-side, and only server-side.
 *
 *   question
 *     -> embed the question            (VoyageEmbeddingProvider)
 *     -> retrieve top-k chunks         (match_knowledge_chunks / pgvector)
 *     -> build grounding context       (buildGroundingBlock)
 *     -> Claude                        (Anthropic SDK, server-side)
 *     -> AskResponse + SourceCitation[]
 *
 * Two properties this function is written to guarantee:
 *
 *   1. Citations are built from RETRIEVED ROWS, never from model output. The
 *      model chooses which of the numbered sources it used; the server decides
 *      what those numbers mean. A fabricated title or page number has no path
 *      into a SourceCitation.
 *
 *   2. Nothing here falls back to MockAIProvider. If configuration is missing
 *      or a service fails, this throws AiError and the route says so.
 */
export async function answerQuestion(request: AskRequest): Promise<AskResponse> {
  const readiness = liveReadiness();

  // Missing variables first: that is the ordinary "not set up yet" case, and it
  // is checked on `missing` rather than on `ready`, because `ready` is also
  // false when a value is present but wrong — which needs the other message.
  if (readiness.missing.length > 0) {
    throw new AiError(
      "not_configured",
      `Ask Sunny is running in live mode but is not fully configured. Missing: ${readiness.missing.join(", ")}.`,
      503,
      readiness.missing,
    );
  }

  // Then misconfigurations, which would otherwise let the app start and
  // misbehave: a privileged key in a NEXT_PUBLIC_ variable, a publishable key
  // where the secret key belongs, or an embedding width the column cannot hold.
  if (readiness.problems.length > 0) {
    throw new AiError("not_configured", readiness.problems.join(" "), 503);
  }

  /* --------------------------------------------------- chat-to-form flow -- */
  // Which template applies and which fields exist stay deterministic. Claude
  // is not asked to decide the shape of an employment document.
  const pending = findPendingFormTurn(request.history);
  if (pending) {
    const citations = await safeRetrieveCitations(
      `${pending.values.topic ?? ""} coaching documentation policy`,
      request.scopeId,
    );
    return buildFormDraft({
      reply: request.question,
      pending,
      context: request.context,
      citations,
    });
  }

  if (isFormIntent(request.question)) {
    return buildFormCollection(request.question, request.context);
  }

  /* ------------------------------------------------------------ retrieve -- */
  const knowledge = new SupabaseKnowledgeProvider();

  let rows: MatchedChunkRow[];
  try {
    rows = await knowledge.match({
      query: request.question,
      scopeId: request.scopeId,
      limit: RETRIEVAL.topK,
    });
  } catch (error) {
    if (error instanceof MissingConfigurationError) {
      throw new AiError("not_configured", error.message, 503, error.missing);
    }
    throw new AiError(
      "retrieval_failed",
      "The company knowledge base could not be searched, so no answer was produced. Nothing was answered from memory.",
      502,
    );
  }

  const used = rows.slice(0, RETRIEVAL.contextChunks);

  const grounding: GroundingChunk[] = used.map((row, index) => ({
    marker: index + 1,
    documentTitle: row.document_title,
    locator: row.locator,
    content: row.content,
  }));

  /* --------------------------------------------------------------- model -- */
  const system = buildSystemPrompt({
    assistantName: ACTIVE_BRAND.assistantName,
    brandName: ACTIVE_BRAND.brandName,
    salonNoun: ACTIVE_BRAND.vocabulary.salonNoun,
    context: request.context,
    mode: request.mode,
    hasContext: grounding.length > 0,
  });

  const answer = await callClaude({
    system,
    grounding: buildGroundingBlock(grounding),
    history: request.history,
    question: request.question,
    maxTokens: CLAUDE_MAX_TOKENS[request.mode],
  });

  /* ----------------------------------------------------------- citations -- */
  // Only the markers the model actually used become source cards, and each one
  // resolves to the row at that position — retrieved data, not model output.
  const markers = extractUsedMarkers(answer, grounding.map((chunk) => chunk.marker));
  const citations: SourceCitation[] = markers
    .map((marker) => used[marker - 1])
    .filter((row): row is MatchedChunkRow => Boolean(row))
    .map(rowToCitation);

  return {
    content: stripMarkers(answer),
    citations,
    // Video matching is a separate concern and still runs on the client's
    // seeded catalogue; it is not part of the grounded answer path.
    recommendedVideoIds: [],
  };
}

/* ----------------------------------------------------------------- Claude -- */

async function callClaude(input: {
  system: string;
  grounding: string;
  history: AskRequest["history"];
  question: string;
  maxTokens: number;
}): Promise<string> {
  const client = getAnthropicClient();

  // Prior turns, trimmed. The grounding block is rebuilt per question, so it is
  // appended to the current turn rather than carried in history.
  const history = input.history
    .filter((message) => message.content.trim().length > 0)
    .slice(-10)
    .map((message) => ({
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    }));

  // The API requires the first message to be a user turn.
  while (history.length > 0 && history[0]!.role === "assistant") history.shift();

  try {
    const response = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: input.maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: CLAUDE_EFFORT },
      system: input.system,
      messages: [
        ...history,
        {
          role: "user",
          content: `${input.grounding}\n\nQUESTION\n\n${input.question}`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new AiError(
        "refused",
        "Sunny could not answer that question. Try rephrasing it, or ask a manager directly.",
        422,
      );
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) {
      throw new AiError("model_failed", "Sunny returned an empty answer.", 502);
    }

    return text;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (error instanceof MissingConfigurationError) {
      throw new AiError("not_configured", error.message, 503, error.missing);
    }
    // The SDK error can echo the request, which carries confidential grounding
    // text. Only the class name is kept — never the body.
    throw new AiError(
      "model_failed",
      "Sunny could not reach the language model. No answer was generated.",
      502,
    );
  }
}

/**
 * Retrieval for the form flow, where an empty result is fine: a coaching draft
 * with no cited policy is still a usable draft, and a failure here must not
 * take down the form path.
 */
async function safeRetrieveCitations(
  query: string,
  scopeId: string,
): Promise<SourceCitation[]> {
  try {
    const knowledge = new SupabaseKnowledgeProvider();
    const rows = await knowledge.match({ query, scopeId, limit: 3 });
    return rows.map(rowToCitation);
  } catch {
    return [];
  }
}
