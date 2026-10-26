import { crossPersonIncidentGuardEnabled } from "@/lib/config/chat-quality-flags";
import { explicitIncidentIso } from "@/lib/forms/explicit-incident-date";
import { statedPayrollDeduct } from "@/lib/forms/payroll-deduct";
import { statedPriorActions } from "@/lib/forms/prior-actions";
import { managerStatedWarningLevel } from "@/lib/forms/warning-level";
import type { ChatFormProposal } from "@/types";

import { accountSentences, priorShorthand } from "./remap-incident";
import type { AskRequest, AskResponse } from "./types";

/**
 * CROSS_PERSON_INCIDENT_GUARD_ENABLED: a new employee on the card starts a
 * new account.
 *
 * Ask Sunny conv_mvoetxo92fraflz, 25 Oct 2026 (names invented here): turn 1
 * "create a coaching document for Marla Quince regarding On 10-16-26 … Tobin
 * Ashgrove did not complete required policy acknowledgements …", turn 3
 * "create a coaching document for Petra Linwood". The card's Employee became
 * Petra; Observation of Offense, the Date and the draft's notes still held
 * Marla's incident. Ask Bubbles had the same carry-over: request 1's payroll
 * answer, prior coaching and warning level on request 2's card.
 *
 * When the card's employee is a different person from the previous card's,
 * only the manager turns from the one that named the new person onward are
 * read: the account, prior actions, Date, warning level and payroll answer
 * are rebuilt from those turns, or asked again, and the draft's source turns
 * are cut to them. The same person, however spelled, changes nothing. Off,
 * the response is returned as it is.
 *
 * The mechanism is the same file in Ask Bubbles; only `READERS` differs.
 */

/** This app's readers of the manager's own words. */
const READERS = {
  account: (turns: readonly string[], name: string): string | null => {
    const sentences = accountSentences(turns, name);
    return sentences.length > 0 ? sentences.join(". ") : null;
  },
  prior: (text: string, today: string): string[] => statedPriorActions(priorShorthand(text), today),
  date: (text: string, today: string): string | null => explicitIncidentIso(text, today),
  warning: (turns: readonly string[]): "verbal" | "written" | null =>
    managerStatedWarningLevel(turns.map((content) => ({ role: "user", content }))) ?? null,
  payroll: (text: string): "yes" | "no" | null => statedPayrollDeduct(text),
};

const WARNING_ASK =
  "Is this new corrective action a **Verbal Warning** or a **Written Warning**? Tell me here, or tick it on the form — I won't choose it for you.";
const PAYROLL_ASK = "**Is payroll deduct applicable?** Yes or No? Tell me here, or tick it on the form — I won't answer it for you.";

/** The guard for a card turn of this request; the response as it is with the flag off. */
export function withCrossPersonGuard(response: AskResponse, request: AskRequest): AskResponse {
  if (!crossPersonIncidentGuardEnabled()) return response;
  return guardCrossPersonIncident({
    response,
    question: request.question,
    questionMessageId: request.questionMessageId,
    history: request.history,
    today: request.context.todayIso,
  });
}

interface Turn {
  readonly id?: string;
  readonly role: string;
  readonly content: string;
  readonly formProposal?: ChatFormProposal | null;
}

export function guardCrossPersonIncident(input: {
  readonly response: AskResponse;
  readonly question: string;
  readonly questionMessageId?: string;
  readonly history: readonly Turn[];
  readonly today: string;
}): AskResponse {
  const proposal = input.response.formProposal;
  const name = proposal?.employeeName?.trim();
  if (!proposal || !name || proposal.subject === "team") return input.response;
  const earlier = previousEmployee(input.history);
  if (!earlier || samePerson(earlier, name)) return input.response;

  const users: Turn[] = [
    ...input.history.filter((turn) => turn.role === "user" && turn.content.trim()),
    { id: input.questionMessageId, role: "user", content: input.question },
  ];
  const since = users.slice(switchIndex(users, name));
  const texts = since.map((turn) => turn.content);

  const account = READERS.account(texts, name);
  const prior = READERS.prior(texts.join("\n"), input.today);
  const formDate = latest(texts, (text) => READERS.date(text, input.today));
  const warningLevel = READERS.warning(texts);
  const payrollDeduct = latest(texts, READERS.payroll);

  const allowed = new Set(since.map((turn) => turn.id).filter((id): id is string => Boolean(id)));
  const kept = proposal.sourceMessageIds.filter((id) => allowed.has(id));

  const next: ChatFormProposal = {
    ...proposal,
    formDate,
    warningLevel,
    payrollDeduct,
    payrollDeductAmount: payrollDeduct === "yes" ? (proposal.payrollDeductAmount ?? null) : null,
    priorActions: prior.length > 0 ? prior.join("; ") : null,
    ...(proposal.issue !== undefined ? { issue: account } : {}),
    sourceMessageIds: kept.length > 0 ? kept : proposal.sourceMessageIds,
  };

  const content = rewriteLines(input.response.content, {
    earlier,
    said: texts.join("\n"),
    account,
    prior: prior.length > 0 ? prior.join("; ") : null,
    date: formDate,
    warning: Boolean(warningLevel),
    payroll: Boolean(payrollDeduct),
  });
  return { ...input.response, content, formProposal: next };
}

function latest<T>(texts: readonly string[], read: (text: string) => T | null): T | null {
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    const found = read(texts[index]!);
    if (found) return found;
  }
  return null;
}

function previousEmployee(history: readonly Turn[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const turn = history[index]!;
    if (turn.role !== "assistant" || !turn.formProposal) continue;
    if (turn.formProposal.subject === "team") return null;
    const name = turn.formProposal.employeeName?.trim();
    if (name) return name;
  }
  return null;
}

function words(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z'’-]+/)
    .filter((word) => word.length >= 2);
}

/** Within one edit: "quill" and "quil", "nelson" and "nelsen". */
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 3) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** One person when a word of one name is a word of the other, spelled within one letter. */
/**
 * Two names are one person when the first names AND the last names each match
 * within one letter ("Marla Quince" / "Marla Quinse", "Mara Quil" / "Mara
 * Quill"); a first name alone matches a full name only when no surname was
 * given ("Rowan" / "Rowan Pell"). QA-6, 26 Oct 2026: one shared word made
 * "Marla Quince" / "Marla Voss" and "Rowan Pell" / "Avery Pell" one person.
 */
export function samePerson(a: string, b: string): boolean {
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return true;
  if (!close(left[0]!, right[0]!)) return false;
  if (left.length === 1 || right.length === 1) return true;
  return close(left[left.length - 1]!, right[right.length - 1]!);
}

/** The turn names the person: every word of the name, each within one letter ("Marla" alone is not "Marla Voss"). */
function names(text: string, name: readonly string[]): boolean {
  const said = words(text);
  return name.length > 0 && name.every((word) => said.some((other) => close(word, other)));
}

/** The first of the latest run of manager turns that name the new person; the current turn when none does. */
function switchIndex(users: readonly Turn[], name: string): number {
  const nameWords = words(name).filter((word) => word.length >= 3);
  for (let index = users.length - 1; index >= 0; index -= 1) {
    if (!names(users[index]!.content, nameWords)) continue;
    let start = index;
    while (start > 0 && names(users[start - 1]!.content, nameWords)) start -= 1;
    return start;
  }
  return users.length - 1;
}

const ACCOUNT_LABEL = /^\*\*(?:Observation of Offense|Issue|What happened):\*\*/;
const PRIOR_LABEL = /^\*\*Prior actions:\*\*/;
const DATE_LABEL = /^\*\*Date:\*\*\s*(\S+)/;
const WARNING_LABEL = /^\*\*Type of [Ww]arning:\*\*/;
const PAYROLL_LINE = /^(?:\*\*Payroll deduction(?: amount)?:?\*\*|Is payroll deduct applicable\? \*\*(?:Yes|No)\*\*)/;

function rewriteLines(
  content: string,
  facts: {
    readonly earlier: string;
    readonly said: string;
    readonly account: string | null;
    readonly prior: string | null;
    readonly date: string | null;
    readonly warning: boolean;
    readonly payroll: boolean;
  },
): string {
  const earlierName = new RegExp(`\\b${escape(facts.earlier)}\\b`, "i");
  const earlierFirst = words(facts.earlier)[0] ?? "";
  const earlierFirstName = earlierFirst ? new RegExp(`\\b${escape(earlierFirst)}\\b`, "i") : null;
  let askWarning = false;
  let askPayroll = false;
  const kept: string[] = [];
  for (const line of content.split("\n")) {
    const segments: string[] = [];
    for (const raw of line.split(" · ")) {
      const segment = raw.trim();
      const label = /^\*\*[^*]+:\*\*/.exec(segment)?.[0];
      if (ACCOUNT_LABEL.test(segment)) {
        // An account already in the new person's turns stays as the app wrote it.
        const shown = segment.slice(label!.length).trim().replace(/[.\s]+$/, "").toLowerCase();
        if (shown && facts.said.toLowerCase().includes(shown)) segments.push(raw);
        else if (facts.account) segments.push(`${label} ${facts.account}`);
      } else if (PRIOR_LABEL.test(segment)) {
        if (facts.prior) segments.push(`**Prior actions:** ${facts.prior}`);
      } else if (DATE_LABEL.test(segment)) {
        const shown = DATE_LABEL.exec(segment)![1]!;
        if (facts.date) segments.push(`**Date:** ${/^\d{4}-/.test(shown) ? facts.date : usDate(facts.date)}`);
      } else if (WARNING_LABEL.test(segment) && !facts.warning) {
        askWarning = true;
      } else if (PAYROLL_LINE.test(segment) && !facts.payroll) {
        askPayroll = /^Is payroll/.test(segment) || askPayroll;
      } else if (/^You mentioned more than one date\b/.test(segment)) {
        // The dates it lists are the earlier incident's.
      } else if (earlierName.test(segment)) {
        // "Possibly on file … If it is Marla Quince's, …": the earlier employee's.
      } else if (/^\*\*Action Plan:\*\*/.test(segment) && earlierFirstName?.test(segment)) {
        // "Management will review … with Marla."
      } else {
        segments.push(raw);
      }
    }
    if (segments.length === 0 && line.trim()) continue;
    kept.push(segments.join(" · "));
  }
  if (askWarning && !kept.some((line) => line.includes("**Verbal Warning** or a **Written Warning**"))) kept.push("", WARNING_ASK);
  if (askPayroll && !kept.some((line) => /Is payroll deduct applicable\?/.test(line))) kept.push("", PAYROLL_ASK);
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}
