import "server-only";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";

import { callClaudeTool } from "./call-claude";
import { glossaryForPrompt, normalizeUserMessage, type NormalizedMessage } from "./message-normalize";

/**
 * Haiku reads any manager message into a standalone query and an intent.
 * The original text stays on the answer. Timeout or failure keeps the
 * glossary reading of the original.
 */

const SYSTEM = `Rewrite the manager's latest message into one standalone query and an intent.
Use the house glossary for slang, typos, abbreviations, and shorthand.
Use earlier turns for vague references such as "the cell one" or "that policy".
Keep names, dates, salon names, and amounts that were stated.
intent is form_command when they are asking to create or continue a form, including confirmations.
intent is policy_question when they are asking what a policy says.
intent is other otherwise.
Set query to SKIP only when the turn is only a confirmation and names no topic.
Do not answer the question.

House glossary:
`;

export async function normalizeForChat(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
}): Promise<NormalizedMessage> {
  const prior = input.history
    .filter((turn) => turn.content.trim() !== "")
    .slice(-6)
    .map((turn) => `${turn.role}: ${turn.content.trim().slice(0, 500)}`)
    .join("\n");
  return normalizeUserMessage({
    question: input.question,
    history: input.history,
    callModel: async () =>
      callClaudeTool({
        model: CLAUDE_HAIKU_MODEL,
        system: `${SYSTEM}${glossaryForPrompt()}`,
        maxTokens: 300,
        tool: {
          name: "normalize_message",
          description: "A standalone query and an intent. SKIP when there is nothing to search.",
          input_schema: {
            type: "object",
            additionalProperties: false,
            required: ["query", "intent"],
            properties: {
              query: { type: "string" },
              intent: { type: "string", enum: ["form_command", "policy_question", "other"] },
            },
          },
        },
        messages: [
          {
            role: "user",
            content: `Earlier turns:\n${prior || "(none)"}\n\nLatest message:\n${input.question}`,
          },
        ],
      }),
  });
}
