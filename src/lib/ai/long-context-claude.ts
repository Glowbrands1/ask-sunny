import "server-only";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";

import { callClaudeTool } from "./call-claude";
import { selectLongContext } from "./long-context";
import { loadContextSummary, saveContextSummary, type StoredContextSummary } from "./long-context-store";

/**
 * Summary of the turns that fall outside the token budget.
 *
 * A stored summary is reused when it already covers those turns. Haiku runs
 * only when the stored summary is behind. A timeout or a failure leaves the
 * previous summary, or none, and the recent window is still sent.
 */

const SUMMARY_TIMEOUT_MS = 3500;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("summary_timeout")), ms);
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

async function summarizeWithHaiku(older: string, previous: string | null): Promise<string> {
  const raw = await callClaudeTool({
    model: CLAUDE_HAIKU_MODEL,
    maxTokens: 300,
    system:
      "Summarize the older conversation turns in under 120 words. Keep names, dates, amounts, the salon, and decisions that were stated. Do not add facts.",
    tool: {
      name: "store_summary",
      description: "A short summary of the older turns.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["summary"],
        properties: { summary: { type: "string" } },
      },
    },
    messages: [
      {
        role: "user",
        content: `Previous summary:\n${previous ?? "(none)"}\n\nOlder turns:\n${older.slice(0, 8000)}`,
      },
    ],
  });
  const summary =
    typeof raw === "object" && raw !== null && "summary" in raw && typeof raw.summary === "string"
      ? raw.summary.trim()
      : "";
  if (!summary) throw new Error("empty summary");
  return summary;
}

export async function prepareLongContext(input: {
  readonly history: readonly { id: string; role: string; content: string }[];
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly load?: () => Promise<StoredContextSummary | null>;
  readonly save?: (summary: StoredContextSummary) => Promise<void>;
  readonly summarize?: (older: string, previous: string | null) => Promise<string>;
}): Promise<{ summary: string | null }> {
  const { older } = selectLongContext(input.history);
  if (older.length === 0) return { summary: null };
  const throughMessageId = older[older.length - 1]?.id ?? null;
  const canStore = Boolean(input.userId && input.conversationId);
  let stored: StoredContextSummary | null = null;
  if (canStore) {
    try {
      stored = input.load
        ? await input.load()
        : await loadContextSummary({ userId: input.userId!, conversationId: input.conversationId! });
    } catch {
      stored = null;
    }
  }
  if (stored && stored.throughMessageId === throughMessageId) return { summary: stored.summary };

  const olderText = older.map((turn) => `${turn.role}: ${turn.content.trim().slice(0, 500)}`).join("\n");
  let summary: string | null = stored?.summary ?? null;
  try {
    const next = input.summarize
      ? await withTimeout(input.summarize(olderText, summary), SUMMARY_TIMEOUT_MS)
      : await withTimeout(summarizeWithHaiku(olderText, summary), SUMMARY_TIMEOUT_MS);
    if (next.trim()) summary = next.trim();
  } catch {
    return { summary };
  }
  if (summary && canStore && summary !== stored?.summary) {
    const save = input.save
      ? input.save({ summary, throughMessageId })
      : saveContextSummary({
          userId: input.userId!,
          conversationId: input.conversationId!,
          summary,
          throughMessageId,
        });
    void save.then(
      () => undefined,
      () => undefined,
    );
  }
  return { summary };
}
