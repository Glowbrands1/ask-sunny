import "server-only";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { formFullRemapEnabled } from "@/lib/config/chat-quality-flags";
import { extractFormRemap, type FormFieldMap, type Sourced } from "@/lib/forms/form-full-remap";
import { signedDate } from "@/lib/forms/prior-actions";
import type { ChatFormProposal } from "@/types";

import { callClaudeTool } from "./call-claude";
import { updateChatTrace } from "./chat-trace-store";
import type { AskResponse } from "./types";

/**
 * Rebuilds a corrective-action card from one extraction of the conversation.
 *
 * The code read is the authority. A model value is kept only when its quote
 * is in the manager's words and the value adds none of its own. The model
 * call, when it runs, is the turn's chat_traces row.
 */

const QUESTIONS = {
  employee: "Who is this corrective action for?",
  salon: "Which salon is this for?",
  observation: "What happened?",
  warning: "Is this a verbal or a written warning?",
  prior: "Any prior coaching or corrective action, and the date it was signed?",
  payroll: "Is payroll deduct applicable? Yes or no?",
  date: "What date should go on the form?",
} as const;

const TOOL = {
  name: "record_form_fields",
  description:
    "Record corrective-action fields the manager actually said. Each value needs the exact quote. Leave a field out when they did not say it.",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      employeeName: sourcedSchema(),
      jobTitle: sourcedSchema(),
      formDate: sourcedSchema(),
      warningLevel: sourcedSchema(),
      payrollDeduct: sourcedSchema(),
      payrollAmount: sourcedSchema(),
      priorCoaching: sourcedSchema(),
      observation: sourcedSchema(),
    },
  },
};

export async function remapFormResponse(input: {
  readonly response: AskResponse;
  readonly history: readonly { readonly role: string; readonly content: string }[];
  readonly question: string;
  readonly today: string;
  readonly skipModel?: boolean;
  readonly callModel?: (conversation: string) => Promise<unknown>;
}): Promise<AskResponse> {
  if (!formFullRemapEnabled()) return input.response;
  const proposal = input.response.formProposal;
  if (!proposal || proposal.templateKey !== "dpoa") return input.response;

  const turns = userTurns(input.history, input.question);
  const coded = extractFormRemap(turns, input.today);
  const model = input.skipModel ? null : await modelFields(turns, input.callModel);
  const fields = mergeGrounded(coded, model, turns.join("\n"));
  const question = nextQuestion(fields, proposal, input.history);
  updateChatTrace({ slots: slotRecord(fields, question) });

  const { awaitingIncident: pendingIncident, ...rest } = proposal;
  const employeeName = fields.employeeName?.value ?? null;
  const next: ChatFormProposal = {
    ...rest,
    employeeName,
    employeeRole: fields.jobTitle?.value ?? null,
    formDate: fields.formDate?.value ?? null,
    warningLevel: fields.warningLevel?.value ?? null,
    payrollDeduct: fields.payrollDeduct?.value ?? null,
    payrollDeductAmount:
      fields.payrollDeduct?.value === "yes" ? (fields.payrollAmount?.value ?? null) : null,
    status: statusFor(proposal, employeeName),
    ...(fields.observation || !pendingIncident ? {} : { awaitingIncident: pendingIncident }),
  };
  return {
    ...input.response,
    content: cardContent(next, fields, question),
    formProposal: next,
  };
}

function userTurns(
  history: readonly { readonly role: string; readonly content: string }[],
  question: string,
): string[] {
  const turns = history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  if (question.trim() && turns[turns.length - 1] !== question) turns.push(question);
  return turns;
}

async function modelFields(
  turns: readonly string[],
  callModel: ((conversation: string) => Promise<unknown>) | undefined,
): Promise<unknown> {
  const conversation = turns.map((turn, index) => `${index + 1}. ${turn}`).join("\n");
  try {
    if (callModel) return await callModel(conversation);
    return await callClaudeTool({
      trace: true,
      model: CLAUDE_HAIKU_MODEL,
      maxTokens: 700,
      system:
        "Extract corrective-action fields from the manager's own words. Return a value only when they said it, with that exact quote. Do not treat write up as a Written Warning. Summarize the incident they described; do not paste their message. Omit anything they did not say.",
      messages: [{ role: "user", content: conversation }],
      tool: TOOL,
    });
  } catch {
    return null;
  }
}

function mergeGrounded(coded: FormFieldMap, model: unknown, userText: string): FormFieldMap {
  if (!model || typeof model !== "object") return coded;
  const record = model as Record<string, unknown>;
  return {
    employeeName: coded.employeeName ?? acceptText(record.employeeName, userText),
    jobTitle: coded.jobTitle ?? acceptText(record.jobTitle, userText),
    formDate: coded.formDate ?? acceptDate(record.formDate, userText),
    warningLevel: coded.warningLevel ?? acceptLevel(record.warningLevel, userText),
    payrollDeduct: coded.payrollDeduct ?? acceptPayroll(record.payrollDeduct, userText),
    payrollAmount: coded.payrollAmount ?? acceptAmount(record.payrollAmount, userText),
    priorCoaching: coded.priorCoaching ?? acceptText(record.priorCoaching, userText),
    observation: coded.observation ?? acceptObservation(record.observation, userText),
  };
}

function acceptText(raw: unknown, userText: string): Sourced<string> | null {
  const sourced = asSourced(raw);
  if (!sourced || !quoteIn(sourced.quote, userText) || !wordsWithin(sourced.value, sourced.quote)) return null;
  return sourced;
}

function acceptObservation(raw: unknown, userText: string): Sourced<string> | null {
  const sourced = acceptText(raw, userText);
  if (!sourced) return null;
  if (sourced.value.trim().toLowerCase() === userText.trim().toLowerCase()) return null;
  return { value: /[.!?]$/.test(sourced.value.trim()) ? sourced.value.trim() : `${sourced.value.trim()}.`, quote: sourced.quote };
}

function acceptDate(raw: unknown, userText: string): Sourced<string> | null {
  const sourced = asSourced(raw);
  if (!sourced || !quoteIn(sourced.quote, userText)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourced.value)) return null;
  if (!quoteIn(sourced.quote, userText)) return null;
  return sourced;
}

function acceptLevel(raw: unknown, userText: string): Sourced<"verbal" | "written"> | null {
  const sourced = asSourced(raw);
  if (!sourced || (sourced.value !== "verbal" && sourced.value !== "written")) return null;
  if (!quoteIn(sourced.quote, userText)) return null;
  const stripped = sourced.quote.replace(/\bwritten\s+up\b/gi, " ").replace(/\bwrite[- ]?ups?\b/gi, " ");
  if (!new RegExp(`\\b${sourced.value}\\b`, "i").test(stripped)) return null;
  return { value: sourced.value, quote: sourced.quote };
}

function acceptPayroll(raw: unknown, userText: string): Sourced<"yes" | "no"> | null {
  const sourced = asSourced(raw);
  if (!sourced || (sourced.value !== "yes" && sourced.value !== "no")) return null;
  if (!quoteIn(sourced.quote, userText)) return null;
  if (/\bwhen applicable\b/i.test(sourced.quote)) return null;
  return { value: sourced.value, quote: sourced.quote };
}

function acceptAmount(raw: unknown, userText: string): Sourced<string> | null {
  const sourced = asSourced(raw);
  if (!sourced || !quoteIn(sourced.quote, userText)) return null;
  if (!quoteIn(sourced.value, userText)) return null;
  return sourced;
}

function asSourced(raw: unknown): { value: string; quote: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as { value?: unknown }).value;
  const quote = (raw as { quote?: unknown }).quote;
  if (typeof value !== "string" || typeof quote !== "string") return null;
  if (!value.trim() || !quote.trim()) return null;
  return { value: value.trim(), quote: quote.trim() };
}

function quoteIn(quote: string, userText: string): boolean {
  return userText.toLowerCase().includes(quote.trim().toLowerCase());
}

function wordsWithin(value: string, quote: string): boolean {
  const words = value.toLowerCase().replace(/[^a-z0-9$]+/g, " ").split(/\s+/).filter(Boolean);
  return words.every((word) => new RegExp(`\\b${escapeReg(word)}\\b`, "i").test(quote));
}

function nextQuestion(
  fields: FormFieldMap,
  proposal: ChatFormProposal,
  history: readonly { readonly role: string; readonly content: string }[],
): string | null {
  const asked = (question: string) =>
    history.some((turn) => turn.role === "assistant" && turn.content.includes(question));
  const pending: { ask: string; blank: boolean }[] = [
    { ask: QUESTIONS.employee, blank: !fields.employeeName },
    {
      ask: QUESTIONS.salon,
      blank: !proposal.locationId && proposal.locationResolution === "needs_selection",
    },
    { ask: QUESTIONS.observation, blank: !fields.observation },
    { ask: QUESTIONS.warning, blank: !fields.warningLevel },
    { ask: QUESTIONS.prior, blank: !fields.priorCoaching },
    { ask: QUESTIONS.payroll, blank: !fields.payrollDeduct },
    { ask: QUESTIONS.date, blank: !fields.formDate },
  ];
  for (const item of pending) {
    if (!item.blank || asked(item.ask)) continue;
    return item.ask;
  }
  return null;
}

function statusFor(proposal: ChatFormProposal, employeeName: string | null): ChatFormProposal["status"] {
  if (!employeeName) return "needs_employee";
  if (!proposal.locationId && proposal.locationResolution === "needs_selection") return "needs_location";
  return "ready";
}

function cardContent(proposal: ChatFormProposal, fields: FormFieldMap, question: string | null): string {
  const lines: string[] = [];
  lines.push(
    proposal.employeeName
      ? `I'll draft a **${proposal.templateName}** for **${proposal.employeeName}**.`
      : `I'll draft a **${proposal.templateName}** once I know who it's for.`,
  );
  if (fields.observation) lines.push("", `**Observation of Offense:** ${fields.observation.value}`);
  if (fields.warningLevel) {
    const label = fields.warningLevel.value === "verbal" ? "Verbal Warning" : "Written Warning";
    lines.push("", `**Type of Warning:** ${label}`);
  }
  if (fields.priorCoaching) lines.push("", `**Prior actions:** ${fields.priorCoaching.value}`);
  if (fields.jobTitle) lines.push("", `**Job title:** ${fields.jobTitle.value}`);
  if (fields.formDate) lines.push("", `**Date:** ${signedDate(fields.formDate.value)}`);
  if (fields.payrollDeduct) {
    const answer = fields.payrollDeduct.value === "yes" ? "Yes" : "No";
    const amount = fields.payrollAmount?.value;
    lines.push("", `**Payroll deduct:** ${answer}${amount ? ` ${amount}` : ""}`);
  }
  if (question) lines.push("", question);
  lines.push("", "Tell me if anything should change, and I'll create the draft.");
  return lines.join("\n");
}

function slotRecord(fields: FormFieldMap, question: string | null): Record<string, unknown> {
  const slot = <T>(sourced: Sourced<T> | null) => (sourced ? { value: sourced.value, quote: sourced.quote } : null);
  return {
    employeeName: slot(fields.employeeName),
    jobTitle: slot(fields.jobTitle),
    formDate: slot(fields.formDate),
    warningLevel: slot(fields.warningLevel),
    payrollDeduct: slot(fields.payrollDeduct),
    payrollAmount: slot(fields.payrollAmount),
    priorCoaching: slot(fields.priorCoaching),
    observation: slot(fields.observation),
    question,
  };
}

function sourcedSchema(): { type: "object"; properties: Record<string, { type: "string" }>; required: string[] } {
  return {
    type: "object",
    properties: { value: { type: "string" }, quote: { type: "string" } },
    required: ["value", "quote"],
  };
}

function escapeReg(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
