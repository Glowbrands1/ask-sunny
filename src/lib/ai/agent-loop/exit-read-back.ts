import { EXIT_ROLE_LABEL } from "@/lib/forms/exit-facts";
import { EXIT_DETAIL_FIELDS, EXIT_DETAIL_LABEL, EXIT_YES_NO_QUESTIONS } from "@/lib/forms/exit-library";

import { readDates } from "./dates";

/**
 * ============================================================================
 * AN EXIT CARD'S REPLY READS BACK ONLY WHAT CREATE SAVES (port of Ask Bubbles #1034 + #1036: its QA's round 2, 22 Nov
 * 2026, U22 and B6; Pau's "as you said only for manager facts")
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. T1 "create exit for <P>. <P>'s last day worked was TBD. On 11-14-26 General Manager, <G>, messaged <P> via woven … <P>
 * messaged back stating she did not work 11-13-26 and she was quitting effective immediately." The reply read back
 * "**Date that notice was given:** 11/14/2026" (never stated, never saved) and labelled the account "**Reason for
 * Resignation:**" (it is saved to Additional Details).
 *
 *   READ BACK   the exit card's result lists the lines Create will save, each "**<the form's label>:** <value>": the
 *               dates the exit form's own reader read (`exit_dates`) and the account under the field it is saved to
 *               (Reason for Resignation on a termination, Additional Details otherwise).
 *   CHECK       a reply line labelled with one of the exit form's own date or detail labels that is not one of those
 *               lines goes back to the model once; still there, it is left out of the reply. The labels are the form's
 *               own (`EXIT_ROLE_LABEL`, `EXIT_DETAIL_LABEL`, "Additional Details"), never a list of phrasings.
 *
 * Ask Bubbles' live re-run 2 (22 Nov 2026, B6), on its production:
 *   (b) T5 "… eligible for rehire, notice will be attached …" got "Eligible for rehire … aren't fields I can set from
 *       here", while Create saved eligible_for_rehire = yes: Create's draft runs the exit form's own Details reader
 *       (`readExitDetails`) over the manager's words, and reads_back never listed what it saves. READ BACK now adds the
 *       reader's lines (How Employee Resigned, Reason for Resignation, the yes/no answers) under the form's own labels.
 *   (a) T6 "she is resigning due to second job I'm ready for the draft" called no tool (the loop's trace: steps []) and
 *       replied "Noted the reason — **Reason for Resignation:** Second job." Nothing reached the card or the draft. On a turn
 *       with no card call, an exit card on screen saves nothing new: a reply line under one of the form's Details or
 *       answer labels (anywhere in the line) is checked against nothing (`onScreenOnly`); its dates are left alone, as
 *       they cannot change without a card.
 */

export const EXIT_ACCOUNT_LABEL = { termination: EXIT_DETAIL_LABEL.resignationReason, resignation: "Additional Details" } as const;

const flat = (text: string) => text.toLowerCase().replace(/[*_]/g, "").replace(/[^a-z0-9/]+/g, " ").trim();

/* B6: the Details reader's yes/no answers, by key, under the form's own question labels (payroll is the card's own check). */
const ANSWER_LABEL = new Map(EXIT_YES_NO_QUESTIONS.filter((question) => question.key !== "payroll_deduction_applicable").map((question) => [question.key, question.label.replace(/\*/g, "").trim()]));
const DATE_LABELS: readonly string[] = Object.values(EXIT_ROLE_LABEL);
const ANSWER_LABELS: ReadonlySet<string> = new Set(ANSWER_LABEL.values());
const DETAIL_LABELS: readonly string[] = [EXIT_DETAIL_LABEL.resignationMethod, EXIT_DETAIL_LABEL.resignationReason, EXIT_DETAIL_LABEL.rehire, EXIT_ACCOUNT_LABEL.resignation, ...ANSWER_LABEL.values()];
export const EXIT_CARD_LABELS: readonly string[] = [...new Set([...DATE_LABELS, ...DETAIL_LABELS])];
/* The Details section's "Eligible for Rehire" line and the form's rehire question are one field (`exit-library.ts`). */
const SAME_FIELD = new Map<string, string>([[EXIT_DETAIL_LABEL.rehire, ANSWER_LABEL.get("eligible_for_rehire") ?? EXIT_DETAIL_LABEL.rehire]]);

/** B6: the lines the exit form's Details reader saves at Create (`exitDetailValues(readExitDetails(…))`), as the reply may read them. */
export function exitDetailLines(read: { readonly values: Readonly<Record<string, string>>; readonly checked: Readonly<Record<string, readonly string[]>> }, termination: boolean): string[] {
  const lines: string[] = [];
  const method = read.values[EXIT_DETAIL_FIELDS.resignationMethod]?.trim();
  if (method) lines.push(`**${EXIT_DETAIL_LABEL.resignationMethod}:** ${method}`);
  /* A termination's reason is its account (`EXIT_ACCOUNT_LABEL.termination`). */
  const reason = read.values[EXIT_DETAIL_FIELDS.resignationReason]?.trim();
  if (reason && !termination) lines.push(`**${EXIT_DETAIL_LABEL.resignationReason}:** ${reason}`);
  for (const [key, label] of ANSWER_LABEL) {
    const answer = read.checked[key]?.[0];
    if (answer === "yes" || answer === "no") lines.push(`**${label}** ${answer === "yes" ? "Yes" : "No"}`);
  }
  return lines;
}

/** The lines Create saves for this exit card, as the reply may read them back. */
export function exitReadBack(input: { readonly dateLines: readonly string[]; readonly account: string | null; readonly termination: boolean; readonly detailLines?: readonly string[] }): string[] {
  const label = input.termination ? EXIT_ACCOUNT_LABEL.termination : EXIT_ACCOUNT_LABEL.resignation;
  return [...input.dateLines, ...(input.account?.trim() ? [`**${label}:** ${input.account.trim()}`] : []), ...(input.detailLines ?? [])];
}

interface LabelledLine {
  readonly label: string;
  readonly value: string;
  readonly line: string;
  /** Where the label and its value sit in the line (U22 twice: only that sentence leaves, never the line's others). */
  readonly start: number;
  readonly end: number;
}

/* B6: a label anywhere in the line ("Noted the reason — **Reason for Resignation:** Second job."), its value up to the next bold label. */
function labelledLines(reply: string): LabelledLine[] {
  const out: LabelledLine[] = [];
  for (const line of reply.split("\n")) {
    for (const match of line.matchAll(/\*\*([^*]+?)\*\*:?\s*([^*]*)/g)) {
      const said = flat(match[1]!.replace(/:\s*$/, ""));
      const label = EXIT_CARD_LABELS.find((known) => flat(known) === said);
      if (label) out.push({ label: SAME_FIELD.get(label) ?? label, value: match[2]!.trim(), line, start: match.index, end: match.index + match[0].length });
    }
  }
  return out;
}

/**
 * A reply line under one of the exit form's labels the card does not save that way ("<label> (<value>)"). `onScreenOnly`
 * (B6): no card was proposed this turn, so nothing new is saved; its date lines are the card's own and are not checked.
 */
function unsaved(reply: string, readBack: readonly string[], onScreenOnly = false): LabelledLine[] {
  const saved = readBack.map((line) => labelledLines(line)[0]).filter((line): line is LabelledLine => Boolean(line));
  const dateLabels = new Set<string>(DATE_LABELS);
  return labelledLines(reply).filter((said) => {
    if (onScreenOnly && dateLabels.has(said.label)) return false;
    /* A date line that states no date ("**Last Day Worked:** not set — you said TBD") claims nothing. */
    if (dateLabels.has(said.label) && readDates(said.value).length === 0) return false;
    const same = saved.find((line) => line.label === said.label);
    if (!same) return true;
    /* The value may be cut short in the reply ("…"), never another value. */
    const value = flat(said.value).replace(/\s*$/, "");
    /* A yes/no answer may be said with more words ("Yes, as you said"): its first word is the answer. */
    if (ANSWER_LABELS.has(said.label)) return value.split(" ")[0] !== flat(same.value).split(" ")[0];
    return value !== "" && !flat(same.value).startsWith(value.slice(0, Math.max(1, Math.min(value.length, 40))));
  });
}

export function exitReadBackMismatch(reply: string, readBack: readonly string[] | null | undefined, onScreenOnly = false): string[] {
  if (!readBack) return [];
  return unsaved(reply, readBack, onScreenOnly).map((line) => `exit field "${line.label}" (${line.value.slice(0, 80)})`);
}

/**
 * The reply without what the card does not save. QA (23 Nov 2026, nov22-u22-exit-unsaved-lines-twice-left-out): the live
 * reply wrote its opening and an unsaved line on one line ("Here's the Resignation/Exit Form for **<P>**. **Date that notice
 * was given:** 11/14/2026"); the whole line left, so the reply opened on "<P> shows as no longer active …" with no form
 * named. Only the sentence holding the unsaved label leaves, from that sentence's start to the end of its value; the
 * line's other sentences stay, and a line with nothing else left goes.
 */
export function withoutUnsavedExitLines(reply: string, readBack: readonly string[] | null | undefined, onScreenOnly = false): string {
  if (!readBack) return reply;
  const cuts = new Map<string, LabelledLine[]>();
  for (const said of unsaved(reply, readBack, onScreenOnly)) cuts.set(said.line, [...(cuts.get(said.line) ?? []), said]);
  const kept = reply.split("\n").flatMap((line) => {
    const here = cuts.get(line);
    if (!here) return [line];
    let rest = line;
    for (const said of [...here].sort((a, b) => b.start - a.start)) {
      const before = rest.slice(0, said.start);
      const sentence = before.search(/(?:^|[.!?]\s+)[^.!?]*$/);
      const from = sentence <= 0 ? (/^\s*(?:[-*•]|\d+[.)])\s+/.exec(before)?.[0].length ?? 0) : sentence + (/^[.!?]\s+/.exec(before.slice(sentence))?.[0].length ?? 0);
      rest = rest.slice(0, from) + rest.slice(said.end);
    }
    rest = rest.replace(/[ \t]{2,}/g, " ").trimEnd();
    return /[\p{L}\p{N}]/u.test(rest.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")) ? [rest] : [];
  });
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
