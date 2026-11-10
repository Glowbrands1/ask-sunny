import { humanRepliesEnabled } from "@/lib/config/chat-quality-flags";
import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormProposal } from "@/types";

/**
 * HUMAN_REPLIES_ENABLED: a form chat says the long opener once.
 *
 * The owner's rule, 26 Oct 2026: "humanize it". In a ten-turn Corrective
 * Action chat the manager read "I'll draft a Corrective Action Form for … from
 * what you've described, and check the applicable company policy …" ten
 * times, and the policy line, the warning read-back and the "nothing is saved
 * to anyone's file" notice with it.
 *
 * The first card turn for a form and employee is returned as built. On a later
 * turn for the same form and employee:
 *
 *   the opener becomes one line on what this turn changed, read from the
 *   card's own fields ("Got it — the date's 10/14."), never from guesswork;
 *
 *   a paragraph or "**Label:**" line already shown in this chat is left out;
 *
 *   the long save notice becomes SHORT_SAVE_NOTICE, on every card turn.
 *
 * Questions are never removed or reworded: the payroll, salon, policy and
 * question-not-form readers read the last assistant turn's text. Neither is
 * "**Nothing has been created**" or "You haven't told me what happened yet".
 * The card (`formProposal`) is returned exactly as built. Off, the answer is
 * returned unchanged.
 */

export const SHORT_SAVE_NOTICE = "Nothing's saved until you tap **Create draft**.";

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

/** The long notice in every variant: global, one salon, team. */
const SAVE_NOTICE = /nothing is saved to anyone's file until you do\.$/;

/** Never left out, even when the manager has read it before. */
const ALWAYS_KEEP: readonly RegExp[] = [/^\*\*Nothing has been created/, /You haven't told me what happened yet/];

const PAYROLL_READBACK = /^Is payroll deduct applicable\? \*\*(?:Yes|No)\*\* — tell me if that should change\.$/;

const LIST_ITEM = /^(?:\d+\.|[-*])\s/;

/** Read-backs set side by side on one line. */
const SEGMENT = " · ";

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

  const seen = new Set(
    earlier
      .flatMap((turn) => turn.content.split("\n"))
      .flatMap((line) => [line, ...line.split(SEGMENT)])
      .map((part) => part.trim())
      .filter(Boolean),
  );
  const lastAssistant = earlier[earlier.length - 1]!.content;
  const facts = factsOf(proposal, input.question, lastAssistant, input.today);
  const changes = facts.filter((fact) => fact.named);
  // A fact said this turn, or already said the same way by an earlier "Got it", is not read back again.
  const earlierText = earlier.map((turn) => turn.content).join("\n");
  const replaced = facts
    .filter((fact) => fact.named || earlierText.includes(fact.says))
    .flatMap((fact) => fact.replaces);

  const paragraphs = answer.content.split(/\n{2,}/);
  const kept: string[] = [];
  let noticed = false;
  paragraphs.forEach((paragraph, index) => {
    const out: string[] = [];
    paragraph.split("\n").forEach((raw, lineIndex) => {
      const line = raw.trim();
      if (!line) return;
      if (index === 0 && lineIndex === 0) return; // the opener
      if (AFTER_OPENER.test(line)) return;
      if (SAVE_NOTICE.test(line)) {
        if (!noticed) out.push(SHORT_SAVE_NOTICE);
        noticed = true;
        return;
      }
      if (ALWAYS_KEEP.some((pattern) => pattern.test(line))) {
        out.push(raw);
        return;
      }
      if (replaced.some((pattern) => pattern.test(line))) return;
      const readBack = PAYROLL_READBACK.test(line);
      if (!readBack && (line.includes("?") || LIST_ITEM.test(line))) {
        out.push(raw);
        return;
      }
      if (seen.has(line)) return;
      // "**Issue:** … · **Type of warning:** … · …": only the parts not said before.
      const parts = line.split(SEGMENT);
      if (parts.length > 1) {
        const fresh = parts.filter(
          (part) => !seen.has(part.trim()) && !replaced.some((pattern) => pattern.test(part.trim())),
        );
        if (fresh.length > 0) out.push(fresh.join(" · "));
        return;
      }
      out.push(raw);
    });
    if (out.length > 0) kept.push(out.join("\n"));
  });

  const content = [acknowledgement(changes), ...kept].join("\n\n");
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
