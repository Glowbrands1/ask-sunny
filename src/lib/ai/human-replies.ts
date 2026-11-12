import { humanRepliesEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

/**
 * HUMAN_REPLIES_ENABLED: a form chat says the long opener once.
 *
 * The owner's rule, 26 Oct 2026: "humanize it". In a ten-turn Corrective
 * Action chat the manager read "I'll draft a Corrective Action Form for … from
 * what you've described, and check the applicable company policy …" ten
 * times.
 *
 * The first card turn for a form and employee is returned as built. On a later
 * turn for the same form and employee the opener (and the coaching opener's
 * "Everything I need is here …" line) becomes one line on what this turn
 * changed — on a Corrective Action card after the card's lead, "I'll draft a
 * **<form>** for **<name>** — got it, …", which the turn readers need — read from the card's own fields ("Got it — the date's 10/14."),
 * never from guesswork. NOTHING ELSE CHANGES (QA's ruling (b), 12 Nov 2026):
 * the Policy line, the warning read-back, the payroll question or read-back,
 * the save notice and every card line stay on every turn, word for word — the
 * replay pack's multi-turn cases read them, and so do the readers of the last
 * assistant turn (payroll, salon, policy, question-not-form). The card
 * (`formProposal`) is returned exactly as built. Off, the answer is returned
 * unchanged.
 */

interface Turn {
  readonly role: string;
  readonly content: string;
  readonly error?: unknown;
}

interface Opener {
  readonly form: string;
  readonly employee: string | null;
}

/** The first line of a card turn: the form, then the employee where it names one. Both apps build the same ones. */
const OPENERS: readonly RegExp[] = [
  /^I'll draft a \*\*([^*]+)\*\* for \*\*([^*]+)\*\* from what you've described, and check the applicable .+ before anything policy-related goes on it\.$/,
  /^Here is what I would put on a \*\*([^*]+)\*\*\.$/,
  /^Here is the ([^*.]+)\.$/,
];

/** Said under the coaching opener. Leaves with it. */
const AFTER_OPENER = /^Everything I need is here, drawn from your messages? above\.$/;

const PAYROLL_READBACK = /^Is payroll deduct applicable\? \*\*(?:Yes|No)\*\* — tell me if that should change\.$/;

const DATE_WORDS =
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:today|yesterday|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/i;
const WARNING_WORDS = /\b(?:verbal|written)\b/i;
const PAYROLL_WORDS = /\b(?:deduct\w*|payroll)\b/i;
const BARE_ANSWER = /^\s*(?:yes|yep|yeah|no|nope|n\/a|not applicable)\b[\s.!]*$/i;
const MONEY = /\$\s?\d|\b\d+(?:\.\d{2})?\s*(?:dollars|bucks)\b/i;

/** One fact on the card: how the acknowledgement says it, the read-back lines it stands for, and whether this turn named it. */
interface Fact {
  readonly says: string;
  readonly replaces: readonly RegExp[];
  readonly named: boolean;
}

export function humanizeFormReply(
  answer: AskResponse,
  input: { readonly history: readonly Turn[]; readonly question: string; readonly today: string },
): AskResponse {
  if (!humanRepliesEnabled()) return answer;
  const proposal = answer.formProposal;
  if (!proposal || proposal.status === "needs_employee") return answer;
  if (!proposal.employeeName && proposal.subject !== "team") return answer;

  const lines = answer.content.split("\n");
  const opener = openerOf(lines[0] ?? "");
  if (!opener || !sameForm(opener.form, proposal.templateName)) return answer;

  const earlier = earlierCardTurns(input.history, proposal);
  if (earlier.length === 0) return answer;

  const lastAssistant = earlier[earlier.length - 1]!.content;
  const changes = factsOf(proposal, input.question, lastAssistant, input.today).filter((fact) => fact.named);

  // Only the opener goes (and the line said under the coaching opener); every other line is the card as built.
  const rest = lines.slice(1);
  while (rest.length > 0 && (rest[0]!.trim() === "" || AFTER_OPENER.test(rest[0]!.trim()))) rest.shift();
  const kept = rest.length > 0 ? [rest.join("\n")] : [];
  const content = [withCardLead(acknowledgement(changes), lines[0] ?? ""), ...kept].join("\n\n");
  return { ...answer, content };
}

function openerOf(line: string): Opener | null {
  for (const pattern of OPENERS) {
    const match = pattern.exec(line.trim());
    if (match?.[1]) return { form: match[1], employee: match[2] ?? null };
  }
  return null;
}

function sameForm(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * The assistant turns of this card so far, oldest first: from the most recent
 * opener on, when that opener is this form for this employee. A card for
 * another form or another person starts again with the full explanation.
 */
function earlierCardTurns(history: readonly Turn[], proposal: ChatFormProposal): Turn[] {
  const replies = history.filter((turn) => turn.role === "assistant" && !turn.error && typeof turn.content === "string");
  for (let index = replies.length - 1; index >= 0; index -= 1) {
    const opener = openerOf(replies[index]!.content.split("\n")[0] ?? "");
    if (!opener) continue;
    if (!sameForm(opener.form, proposal.templateName)) return [];
    if (opener.employee && proposal.employeeName && !sameForm(opener.employee, proposal.employeeName)) return [];
    return replies.slice(index);
  }
  return [];
}

/** The card's own fields, each marked with whether the manager's turn names its topic. */
function factsOf(proposal: ChatFormProposal, question: string, lastAssistant: string, today: string): Fact[] {
  const said = question.toLowerCase();
  const facts: Fact[] = [];
  if (proposal.employeeName) {
    facts.push({
      says: `it's for **${proposal.employeeName}**`,
      replaces: [/^\*\*Employee:\*\*/],
      named: said.includes(proposal.employeeName.toLowerCase()),
    });
  }
  const date = proposal.formDate ? shortDate(proposal.formDate, today) : null;
  if (date) facts.push({ says: `the date's ${date}`, replaces: [/^\*\*Date:\*\*/], named: DATE_WORDS.test(question) });
  if (proposal.warningLevel) {
    facts.push({
      says: `it's a ${proposal.warningLevel} warning`,
      replaces: [/^\*\*Type of warning:\*\*/i],
      named: WARNING_WORDS.test(question),
    });
  }
  if (proposal.payrollDeduct === "yes" || proposal.payrollDeduct === "no") {
    const payrollAsked = lastAssistant.includes("Is payroll deduct applicable?");
    facts.push({
      says: proposal.payrollDeduct === "yes" ? "payroll deduct is a yes" : "no payroll deduct",
      replaces: [PAYROLL_READBACK, /^\*\*Payroll deduct:\*\*/],
      named: PAYROLL_WORDS.test(question) || (payrollAsked && BARE_ANSWER.test(question)),
    });
  }
  if (proposal.payrollDeductAmount) {
    facts.push({
      says: `the deduction's ${proposal.payrollDeductAmount}`,
      replaces: [/^\*\*Payroll deduction amount:?\*\*/],
      named: MONEY.test(question),
    });
  }
  if (proposal.locationName && proposal.locationResolution === "resolved") {
    facts.push({
      says: `it's at **${proposal.locationName}**`,
      replaces: [/^\*\*Salon:\*\*/],
      named: namesPlace(said, proposal.locationName),
    });
  }
  return facts;
}

/*
 * THE CARD'S LEAD STAYS (QA's ruling (b), 12 Nov 2026): the readers of the last assistant turn find the card's form and
 * employee in "I'll draft a **<form>** for **<name>**" (name correction, near-miss rules, roster names, card slots). A
 * later turn keeps that lead and drops only the opener's long tail ("from what you've described, and check the
 * applicable … before anything policy-related goes on it."): "I'll draft a **<form>** for **<name>** — got it, the
 * date's 10/14."
 */
const CARD_LEAD = /^(I'll draft an? \*\*[^*]+\*\* for \*\*[^*]+\*\*) from what you've described\b/;

function withCardLead(ack: string, opener: string): string {
  const lead = CARD_LEAD.exec(opener.trim())?.[1];
  if (!lead) return ack;
  return `${lead} — ${ack.replace(/^Got it — /, "got it, ")}`;
}

function acknowledgement(changes: readonly Fact[]): string {
  if (changes.length === 0) return "Got it — here's the card.";
  const parts = changes.map((change) => change.says);
  const joined = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Got it — ${joined}.`;
}

/** "2026-10-14" → "10/14" this year, "10/14/2025" another. */
function shortDate(iso: string, today: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const [, year, month, day] = match;
  const short = `${Number(month)}/${Number(day)}`;
  return today.startsWith(`${year}-`) ? short : `${short}/${year}`;
}

/** A word of the location's name (four letters or more) in the manager's turn. */
function namesPlace(said: string, name: string): boolean {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4)
    .some((word) => new RegExp(`\\b${word}\\b`).test(said));
}
