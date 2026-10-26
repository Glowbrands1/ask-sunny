import { bareAnswerBindingEnabled } from "@/lib/config/chat-quality-flags";
import { payrollDeductReply } from "@/lib/forms/payroll-deduct";
import { extractJobTitle } from "@/lib/forms/proposal";
import { readSalonMentions } from "@/lib/forms/salon-mention";
import type { ChatFormProposal } from "@/types";

import type { AskRequest, AskResponse } from "./types";

/**
 * BARE_ANSWER_BINDING_ENABLED: a short answer fills the slot it is an answer
 * for, and nothing else.
 *
 * Live chats, 25 Oct 2026 (names invented in the tests):
 *   Ask Sunny conv_mvoehonm2pfrkng   "yes coaching for attendance", the answer
 *                                    to prior coaching, set Payroll deduct Yes.
 *   Ask Sunny conv_mvofnrm5217ss9v   two bare "yes" on the exit form set
 *                                    Payroll Yes, never asked.
 *   Ask Bubbles conv_mvofpdj12iwndws "dodge" became the Job title, "tm" the
 *                                    Employee; conv_mvofk1r32edmbmk "verbal"
 *                                    the Job title.
 *
 * On every card turn:
 *   Employee     never a stray letter ("f"), a job title, a place, a warning
 *                level, yes/no or a slot word ("tm", "dodge", "verbal", "prior"); the earlier
 *                employee stays, and a title given that way is the Job title.
 *   Job title    never a place, a warning level, yes/no or a slot word.
 *   "Yes"        to the one close name in "Woven has <name>" under the card
 *                applies that name (live: the typed name stayed).
 *   Payroll      on a short turn (six words or fewer), changes only when the
 *                turn says payroll or deduct, or is a bare yes/no and the
 *                last thing the app asked was the payroll question.
 * A one-word name ("Lisa") is still a name. Off, the response is as it is.
 *
 * The same file in Ask Bubbles; only `READERS` differs.
 */

/** This app's readers of a slot word. */
const READERS = {
  title: (text: string): string | null => extractJobTitle(text),
  place: (text: string): boolean => readSalonMentions(text).length > 0,
};

const SLOT_WORD =
  /^(?:yes|y|yeah|yep|yup|no|n|nope|nah|none|n\/a|ok|okay|sure|verbal|written|final|verbal\s+warning|written\s+warning|final\s+warning|prior|no\s+prior|previous|coaching|payroll|deduct|no\s+payroll|today|yesterday)$/i;
const BARE_YES_NO = /^(?:yes|y|yeah|yep|yup|no|n|nope|nah)[.!]?$/i;
/** A whole turn that says the question does not apply ("doesn't apply", "not applicable", "n/a"). */
const NOT_APPLICABLE = /^(?:it\s+)?(?:does\s*n[o'’]?t\s+apply|not\s+applicable|n\/a)[.!]?$/i;
const SHORT_TURN_WORDS = 6;
const SAYS_PAYROLL = /\b(?:payroll|deduct\w*|paycheck|pay\s+check)\b/i;

const PAYROLL_ASK = "**Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.";

export function withBareAnswerBinding(response: AskResponse, request: AskRequest): AskResponse {
  if (!bareAnswerBindingEnabled()) return response;
  return bindBareAnswer({ response, question: request.question, history: request.history });
}

interface Turn {
  readonly role: string;
  readonly content: string;
  readonly formProposal?: ChatFormProposal | null;
}

export function bindBareAnswer(input: {
  readonly response: AskResponse;
  readonly question: string;
  readonly history: readonly Turn[];
}): AskResponse {
  const proposal = input.response.formProposal;
  if (!proposal || proposal.subject === "team") return input.response;
  const previous = previousProposal(input.history, proposal.templateKey);
  const lastAsked = [...input.history].reverse().find((turn) => turn.role === "assistant")?.content ?? "";
  let next = proposal;
  let content = input.response.content;

  // "Yes" to the one close Woven name under the card applies it (unless the last question was another yes/no).
  const offered = wovenOffer(previous, input.question, lastAsked);
  if (offered && offered.toLowerCase() !== (proposal.employeeName ?? "").trim().toLowerCase()) {
    const typed = proposal.employeeName?.trim();
    next = { ...next, employeeName: offered, ...("wovenCloseMatch" in next ? { wovenCloseMatch: null } : {}) };
    if (typed) content = content.split(`**${typed}**`).join(`**${offered}**`);
  }

  const name = next.employeeName?.trim() ?? "";
  if (name && notAPerson(name)) {
    const kept = previous?.employeeName && !notAPerson(previous.employeeName) ? previous.employeeName : null;
    const title = READERS.title(name);
    next = {
      ...next,
      employeeName: kept,
      ...(kept ? {} : { status: "needs_employee" as const, supportsInlineDraft: false }),
      ...(title && (!next.employeeRole || notATitle(next.employeeRole)) ? { employeeRole: title } : {}),
    };
    content = content.split(`**${name}**`).join(kept ? `**${kept}**` : "the employee");
  }

  const role = next.employeeRole?.trim() ?? "";
  if (role && notATitle(role)) {
    const kept = previous?.employeeRole && !notATitle(previous.employeeRole) ? previous.employeeRole : null;
    next = { ...next, employeeRole: kept };
    content = withoutLabel(content, /^\*\*(?:Job title|Position):\*\*\s*/, role, kept);
  }

  const payroll = next.payrollDeduct ?? null;
  const before = previous?.payrollDeduct ?? null;
  if (payroll !== before && !payrollAnswered(input.question, lastAsked) && !payrollSaidEarlier(input.history)) {
    next = { ...next, payrollDeduct: before };
    content = withPayroll(content, before);
  }

  if (next === proposal) return input.response;
  return { ...input.response, content, formProposal: next };
}

function previousProposal(history: readonly Turn[], templateKey: string): ChatFormProposal | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role === "assistant" && turn.formProposal?.templateKey === templateKey) return turn.formProposal;
  }
  return null;
}

/** The one name in "Woven has <name>" under the previous card, when a bare yes answers it. */
function wovenOffer(previous: ChatFormProposal | null, question: string, lastAsked: string): string | null {
  if (!/^(?:yes|y|yeah|yep|yup|yes it is|that'?s (?:her|him|them|right|it)|correct)[.!]?$/i.test(question.trim())) return null;
  // Under the card (the proposal's note) or as its own line in the reply.
  const shown = (previous as { readonly wovenCloseMatch?: string | null } | null)?.wovenCloseMatch?.trim();
  const note = /^Woven has \**([^*\n]+?)\**\.?$/m.exec(shown || lastAsked);
  if (!note || /,| or /.test(note[1]!)) return null;
  if (/payroll\s+deduct|verbal warning|written warning/i.test(lastQuestion(lastAsked))) return null;
  return note[1]!.trim();
}

function notAPerson(name: string): boolean {
  const said = name.trim();
  // A stray letter ("f") is a typo, never a person.
  if (said.replace(/[^A-Za-z]/g, "").length <= 1) return true;
  if (SLOT_WORD.test(said)) return true;
  if (said.split(/\s+/).length <= 2 && READERS.title(said) && titleIsWhole(said)) return true;
  return READERS.place(said) && said.split(/\s+/).length <= 3;
}

/** "tm" and "team member" are titles; a name that only contains a title's letters is not. */
function titleIsWhole(said: string): boolean {
  const words = said.toLowerCase().split(/\s+/);
  return words.every((word) => READERS.title(word) !== null) || READERS.title(said)?.toLowerCase() === said.toLowerCase();
}

function notATitle(role: string): boolean {
  const said = role.trim();
  if (SLOT_WORD.test(said)) return true;
  return READERS.place(said) && !READERS.title(said);
}

/** The turn answers payroll: it says so, or it is a bare yes/no to the payroll question asked last. */
function payrollAnswered(question: string, lastAsked: string): boolean {
  // Only a short turn is read this way; a numbered intake or an account is the readers' as before.
  if (SAYS_PAYROLL.test(question) || question.trim().split(/\s+/).length > SHORT_TURN_WORDS) return true;
  if (!BARE_YES_NO.test(question.trim()) && !NOT_APPLICABLE.test(question.trim())) return false;
  // Payroll is the question: the last one asked, or the payroll reader finds it (a numbered intake, or asked alone).
  return /payroll\s+deduct/i.test(lastQuestion(lastAsked)) || payrollDeductReply(question, lastAsked) !== null;
}

/** An earlier manager turn already answered payroll ("no payroll deduct", or "no" to the payroll question). */
function payrollSaidEarlier(history: readonly Turn[]): boolean {
  return history.some((turn, index) => {
    if (turn.role !== "user" || typeof turn.content !== "string") return false;
    const asked = [...history.slice(0, index)].reverse().find((before) => before.role === "assistant")?.content ?? "";
    return payrollAnswered(turn.content, asked) && (SAYS_PAYROLL.test(turn.content) || /payroll\s+deduct/i.test(lastQuestion(asked)));
  });
}

function lastQuestion(reply: string): string {
  const lines = reply.split("\n").filter((line) => /\?/.test(line));
  return lines[lines.length - 1] ?? "";
}

function withoutLabel(content: string, label: RegExp, value: string, kept: string | null): string {
  const lines: string[] = [];
  for (const line of content.split("\n")) {
    const segments = line.split(" · ").flatMap((segment) => {
      const trimmed = segment.trim();
      if (!label.test(trimmed) || !trimmed.replace(label, "").toLowerCase().startsWith(value.toLowerCase())) return [segment];
      return kept ? [segment.replace(value, kept)] : [];
    });
    if (segments.length === 0 && line.trim()) continue;
    lines.push(segments.join(" · "));
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function withPayroll(content: string, answer: "yes" | "no" | null): string {
  const lines: string[] = [];
  let removed = false;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const shown = /^Is payroll deduct applicable\? \*\*(Yes|No)\*\*/.exec(trimmed);
    if (shown) {
      if (answer) lines.push(line.replace(`**${shown[1]}**`, answer === "yes" ? "**Yes**" : "**No**"));
      else removed = true;
      continue;
    }
    if (/^\*\*Payroll deduction:\*\*/.test(trimmed) || /^One more question: \*\*Payroll deduction amount\*\*/.test(trimmed)) {
      if (answer === "yes") lines.push(line);
      continue;
    }
    lines.push(line);
  }
  if (removed && !lines.some((line) => /Is payroll deduct applicable\?/.test(line))) lines.push("", PAYROLL_ASK);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
