import "server-only";

import { withoutAppLines } from "@/lib/ai/app-sentences";
import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";

import { callClaudeToolTimed } from "../call-claude";
import { checkReading, type CheckContext, type CheckedReading } from "./check";
import { parseFormReading, READER_TOOL_DESCRIPTION, READER_TOOL_INPUT_SCHEMA, READER_TOOL_NAME } from "./schema";

/**
 * ============================================================================
 * AI_READS_CODE_CHECKS_ENABLED — ONE CALL, THEN THE CHECKS
 * ============================================================================
 *
 * The model reads the manager's request once per form turn and quotes the
 * words of theirs behind each field. `check.ts` keeps what the quote, the
 * roster, the date readers and the manual agree with. A call that fails, takes
 * longer than READER_TIMEOUT_MS, or returns something unusable is null, and
 * the turn runs on today's readers exactly as with the flag off.
 *
 * No roster is sent: the model copies the name as typed and the code finds
 * the one person in the manager's scope it fits. The prompt and the user block
 * are the same text in the sibling app.
 */

export const READER_TIMEOUT_MS = 2_000;

const SYSTEM = `You read a manager's request for an HR form and call record_form_reading once.

For each field, give the value and the evidence: the manager's own words the value came from, copied exactly as they typed them (same spelling, typos included). Only the manager's lines are given. Leave a field null when the manager did not state it. Never invent a value.

employee: the name exactly as the manager typed it ("quinn", "Marlowe, Quinn", "quin marlowe").
incidentDate: the day the incident happened, as YYYY-MM-DD. Read any shape: 10/15, 10-15-26, 10.15, oct 15, october 15th, the 15th. A date without a year is the latest such day that is not after today. When several incident days are given, it is the latest one unless the manager picked one.
priorSteps: earlier coaching, verbal or written warnings, or manual acknowledgements, each with its date. otherDates: follow-up, meeting, notice or other dates that are not the incident. A prior step's date is never the incidentDate.
warningLevel: verbal or written, the level of this form only, not of an earlier step.
payroll: yes or no, only when the manager said whether payroll deduct applies. payrollAmount: digits only.
policyHeading: copy one heading from the manual list exactly, only when the incident is clearly about it.
Do not answer the manager. Return only the tool call.`;

export interface ReaderTurn {
  readonly role: string;
  readonly content: string;
}

export interface ReaderResult {
  readonly checked: CheckedReading;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens: number; readonly cacheWriteTokens: number };
  readonly ms: number;
}

export async function readFormRequest(input: {
  readonly turns: readonly ReaderTurn[];
  readonly context: CheckContext;
}): Promise<ReaderResult | { readonly fallback: string }> {
  // performance.now, not Date.now: the variation report freezes Date, which made every recorded latency 0 ms.
  const started = performance.now();
  try {
    const reply = await callClaudeToolTimed({
      model: CLAUDE_HAIKU_MODEL,
      system: SYSTEM,
      maxTokens: 600,
      timeoutMs: READER_TIMEOUT_MS,
      tool: { name: READER_TOOL_NAME, description: READER_TOOL_DESCRIPTION, input_schema: READER_TOOL_INPUT_SCHEMA },
      messages: [{ role: "user", content: userBlock(input.turns, input.context) }],
    });
    const reading = parseFormReading(reply.input);
    if (!reading) return { fallback: "unusable" };
    return { checked: checkReading(reading, input.context), usage: reply.usage, ms: performance.now() - started };
  } catch {
    return { fallback: performance.now() - started >= READER_TIMEOUT_MS ? "timeout" : "error" };
  }
}

/**
 * QA (27 Oct 2026): the model gets the manager's own turns and the manual
 * headings only. No roster, no location list, no assistant turn and none of
 * the app's own lines: the roster, location and title checks stay in code.
 */
function userBlock(turns: readonly ReaderTurn[], context: CheckContext): string {
  const lines = turns
    .filter((turn) => turn.role === "user")
    .map((turn) => withoutAppLines(turn.content).trim())
    .filter((content) => content !== "")
    .slice(-12)
    .map((content) => `Manager: ${content.slice(0, 1500)}`);
  const manual = context.headings.length > 0 ? `Manual headings:\n${context.headings.map((heading) => `- ${heading}`).join("\n")}\n\n` : "";
  return `${manual}Today is ${context.today}.\n\n${lines.join("\n\n")}`;
}
