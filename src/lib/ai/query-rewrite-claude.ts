import "server-only";

import { z } from "zod";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";

import { manualSectionHeadings } from "@/lib/forms/official-policy-manual";
import { SupabaseKnowledgeProvider } from "@/lib/knowledge/providers/supabase";

import { callClaudeTool } from "./call-claude";
import { manualTermsQuery, queryAfterRewrite, shouldRewriteFollowUp } from "./query-rewrite";

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

/**
 * The retrieval query, in the manual's own terms.
 *
 * A heading the account already resolves is used and the model is not called.
 * Otherwise one tool call may name a heading, and only a heading that was
 * retrieved is kept. Anything else leaves the query the caller already built.
 */
export async function rewriteToManualTerms(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly fallback: string;
  readonly scopeId: string;
  readonly loadHeadings?: () => Promise<readonly string[]>;
  readonly callModel?: (headings: readonly string[]) => Promise<unknown>;
}): Promise<string> {
  try {
    const headings = input.loadHeadings ? await input.loadHeadings() : await defaultHeadings(input.scopeId);
    const known = manualTermsQuery({ question: input.question, headings, modelHeading: null });
    if (known) return known;
    const raw = input.callModel
      ? await input.callModel(headings)
      : await defaultHeadingCall(input.question, input.history, headings);
    const heading = raw && typeof raw === "object" && "heading" in raw ? String((raw as { heading: unknown }).heading) : "";
    return manualTermsQuery({ question: input.question, headings, modelHeading: heading || null }) ?? input.fallback;
  } catch {
    return input.fallback;
  }
}

async function defaultHeadings(scopeId: string): Promise<string[]> {
  const manual = await new SupabaseKnowledgeProvider().fetchOfficialPolicyManual(scopeId);
  return manual.ok ? manualSectionHeadings(manual.chunks) : [];
}

async function defaultHeadingCall(
  question: string,
  history: readonly { role: string; content: string }[],
  headings: readonly string[],
): Promise<unknown> {
  if (headings.length === 0) return { heading: "" };
  const prior = [...history].reverse().find((turn) => turn.role === "user" && turn.content.trim() !== "");
  return callClaudeTool({
    model: CLAUDE_HAIKU_MODEL,
    system: `Pick the one manual heading that the manager's question is about. Use only a heading from the list. If none fits, set heading to an empty string. A person who arrived late is not the heading about the salon opening late. Return only the tool call.`,
    maxTokens: 120,
    tool: {
      name: "choose_manual_heading",
      description: "The manual heading to search, or empty when none of the headings fit.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["heading"],
        properties: { heading: { type: "string" } },
      },
    },
    messages: [
      {
        role: "user",
        content: `Headings:\n${headings.slice(0, 80).join("\n")}\n\nEarlier turn:\n${prior?.content.slice(0, 400) ?? ""}\n\nQuestion:\n${question}`,
      },
    ],
  });
}
