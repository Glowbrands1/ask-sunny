import "server-only";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";

import { callClaudeTool } from "./call-claude";
import {
  FORM_TOOL_DESCRIPTION,
  FORM_TOOL_INPUT_SCHEMA,
  FORM_TOOL_NAME,
  parseFormToolTurn,
  type FormToolTurn,
} from "./form-tool-schema";

/**
 * Read the conversation with a Claude tool call and return a typed intent.
 *
 * A model failure, a refusal, or a payload that does not match the schema
 * returns null. The caller then uses the existing chat path, so a Haiku
 * outage cannot take the turn down.
 */

const SYSTEM = `You read one salon manager's conversation and call record_form_turn once.

Do not invent an employee name, job title, salon, date, payroll amount, warning level, policy section, or deadline. Leave a field null when the manager did not say it.
useToday is true only when they said to use today's date, including "todays date".
incidentDateIso is a calendar date they stated, as YYYY-MM-DD, or null. "Use today's date" is useToday, not a made-up calendar date.
payrollAmount is a dollar amount they stated, or null.
A salon name is never the employee name.
intent is policy_question when they ask what a policy says, even if a form is open.
intent is create_form, continue_form, confirm, provide_fields, correct_fields, or form_command when they are doing a form. That includes "create the ca", "go ahead", "yes", "do the paperwork", "write her up", "write up", and other slang for a corrective action.
templateKey is dpoa for a corrective action, CA, or write-up; coaching for a coaching form; stc-exit for an exit form; null when no form is settled.
confirmsOpenForm is true for yes, go ahead, ok make it, yep, and similar confirmations.
Return every field the conversation has already established, not only this turn.`;

export interface UnderstandFormTurnInput {
  readonly question: string;
  readonly history: readonly { role: string; content: string }[];
  readonly today: string;
  readonly openTemplateKey?: string | null;
}

export type FormToolCaller = (input: {
  readonly model: string;
  readonly system: string;
  readonly user: string;
}) => Promise<unknown>;

function conversationText(input: UnderstandFormTurnInput): string {
  const turns = [...input.history, { role: "user", content: input.question }]
    .filter((turn) => turn.content.trim() !== "")
    .slice(-12)
    .map((turn) => {
      const who = turn.role === "assistant" ? "Sunny" : "Manager";
      return `${who}: ${turn.content.trim().slice(0, 1500)}`;
    });
  const open = input.openTemplateKey ? `Open form template key: ${input.openTemplateKey}\n` : "";
  return `${open}Today is ${input.today}.\n\n${turns.join("\n\n")}`;
}

async function defaultToolCall(input: { model: string; system: string; user: string }): Promise<unknown> {
  return callClaudeTool({
    model: input.model,
    system: input.system,
    maxTokens: 800,
    tool: {
      name: FORM_TOOL_NAME,
      description: FORM_TOOL_DESCRIPTION,
      input_schema: FORM_TOOL_INPUT_SCHEMA,
    },
    messages: [{ role: "user", content: input.user }],
  });
}

export async function understandFormTurn(
  input: UnderstandFormTurnInput,
  callTool: FormToolCaller = defaultToolCall,
): Promise<FormToolTurn | null> {
  try {
    const raw = await callTool({
      model: CLAUDE_HAIKU_MODEL,
      system: SYSTEM,
      user: conversationText(input),
    });
    return parseFormToolTurn(raw);
  } catch {
    return null;
  }
}
