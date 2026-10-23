import "server-only";

import { z } from "zod";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";

import { callClaudeTool } from "./call-claude";
import { queryAfterRewrite, shouldRewriteFollowUp } from "./query-rewrite";

/**
 * Rewrite a short follow-up into a standalone search query.
 *
 * Failure keeps the query the existing retrieval path already built. A form
 * confirmation is SKIP so this does not turn "yes" into a knowledge search
 * when the form tools did not claim the turn.
 */

const rewriteSchema = z.object({ query: z.string() });

const SYSTEM = `Rewrite the manager's latest turn into one standalone knowledge-base search query.
If the turn is a form confirmation or command (yes, go ahead, create the form, do the paperwork), set query to SKIP.
Otherwise name the policy or topic the follow-up refers to, using the earlier turn for words the follow-up leaves out.
Return only the tool call. Do not answer the question.`;

export async function rewriteFollowUpQuery(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly fallback: string;
}): Promise<string> {
  if (!shouldRewriteFollowUp(input.question, input.history)) return input.fallback;
  const prior = [...input.history]
    .reverse()
    .find((turn) => turn.role === "user" && turn.content.trim() !== "");
  try {
    const raw = await callClaudeTool({
      model: CLAUDE_HAIKU_MODEL,
      system: SYSTEM,
      maxTokens: 200,
      tool: {
        name: "rewrite_search_query",
        description: "A standalone search query, or SKIP when the turn is a form command.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: {
            query: { type: "string" },
          },
        },
      },
      messages: [
        {
          role: "user",
          content: `Earlier manager turn:\n${prior?.content.slice(0, 800) ?? ""}\n\nLatest turn:\n${input.question}`,
        },
      ],
    });
    const parsed = rewriteSchema.safeParse(raw);
    if (!parsed.success) return input.fallback;
    return queryAfterRewrite(input.fallback, parsed.data.query);
  } catch {
    return input.fallback;
  }
}
