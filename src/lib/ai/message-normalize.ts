import { z } from "zod";

import { detectTemplateIntent } from "@/lib/forms/template-intent";

import {
  expandGlossaryQuery,
  glossaryIntent,
  glossaryPrompt,
  type GlossaryIntent,
} from "./glossary";

/**
 * A standalone reading of one manager message.
 *
 * `answerText` is always the words they typed. Routing and retrieval may use
 * the expanded or model-written query. A model failure, a timeout, or SKIP
 * keeps the glossary expansion of the original.
 */

const modelSchema = z.object({
  query: z.string(),
  intent: z.enum(["form_command", "policy_question", "other"]),
});

export interface NormalizedMessage {
  /** The manager's words, unchanged, for the answer. */
  readonly answerText: string;
  /** Original text plus canonical house terms, for the form detectors. */
  readonly routingText: string;
  /** Standalone query for retrieval. Null when the model returned SKIP. */
  readonly modelQuery: string | null;
  readonly intent: GlossaryIntent | "form_command" | "policy_question";
}

export function glossaryReading(question: string): NormalizedMessage {
  return {
    answerText: question,
    routingText: routingText(question),
    modelQuery: null,
    intent: glossaryIntent(question),
  };
}

/**
 * The glossary expansion, unless it would change the form the manager named.
 * "Create the separation paperwork for …" names the Resignation/Exit Form, but
 * the bare "paperwork" shorthand added "corrective action form" and the turn
 * became a Corrective Action Form with "Is payroll deduct applicable?"
 * (25 Oct 2026). A form named in the manager's own words stays that form.
 */
function routingText(question: string): string {
  const expanded = expandGlossaryQuery(question);
  if (expanded === question) return expanded;
  const named = detectTemplateIntent(question);
  if (named.kind !== "explicit") return expanded;
  const routed = detectTemplateIntent(expanded);
  return routed.kind === "explicit" && routed.templateKey === named.templateKey ? expanded : question;
}

export function glossaryForPrompt(): string {
  return glossaryPrompt();
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("normalize_timeout")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function normalizeUserMessage(input: {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly callModel?: () => Promise<unknown>;
  readonly timeoutMs?: number;
}): Promise<NormalizedMessage> {
  const base = glossaryReading(input.question);
  if (!input.callModel) return base;
  try {
    const raw = await withTimeout(input.callModel(), input.timeoutMs ?? 4000);
    const parsed = modelSchema.safeParse(raw);
    if (!parsed.success) return base;
    const query = parsed.data.query.trim();
    const modelQuery = !query || query.toUpperCase() === "SKIP" ? null : query;
    const intent =
      parsed.data.intent === "form_command"
        ? "form"
        : parsed.data.intent === "policy_question"
          ? "policy"
          : base.intent;
    return { ...base, modelQuery, intent };
  } catch {
    return base;
  }
}
