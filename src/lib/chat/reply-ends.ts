import { formOpportunityLead } from "@/lib/forms/form-opportunity";

/**
 * ============================================================================
 * A REPLY ENDS AS A SENTENCE (REPLY_CUT_CHECK_ENABLED)
 * ============================================================================
 *
 * sf-b6 (the sibling app, QA, 5 Nov 2026; this app has the same code): a reply ended "Based on what you've described, I
 * can prepare:". The trace for that turn says `stop_reason: end_turn`; the
 * model had finished. The line was the form picker's heading
 * (`formOpportunityLead`), which `answerQuestion` adds after the model's text
 * whenever it offers a form selection — and it offered one while a Corrective
 * Action was already in progress on a proposal card. The rule that drops the
 * picker with a form open (OPEN_FORM_NO_SELECTION_ENABLED) looks only for a
 * created form, so it did not apply.
 *
 * Two rules, applied after every other rewrite of the reply:
 *
 *   1. WHILE A FORM IS IN PROGRESS — a proposal card being filled in, or a
 *      form open — the reply carries no form picker, and the picker's own
 *      heading line is taken out wherever it stands.
 *   2. A REPLY NEVER ENDS ON A HEADING WITH NOTHING UNDER IT: a last line
 *      ending in ":" with no cards coming with the reply is taken out.
 *
 * Both only remove a line code or a cut left behind; neither rewrites a
 * word. A reply that would be left empty is returned as it was.
 */

export interface ReplyWithCards {
  readonly content: string;
  readonly formSelection?: unknown;
  readonly formProposal?: unknown;
  readonly formProposals?: readonly unknown[];
}

export interface ReplyEndCheck<T extends ReplyWithCards> {
  readonly answer: T;
  /** The lines taken out, for the log. Empty when nothing changed. */
  readonly removed: readonly string[];
}

function hasCards(answer: ReplyWithCards): boolean {
  return Boolean(answer.formSelection || answer.formProposal || answer.formProposals?.length);
}

function tidy(lines: readonly string[]): string {
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function checkedReplyEnd<T extends ReplyWithCards>(answer: T, input: { readonly formInProgress: boolean }): ReplyEndCheck<T> {
  const removed: string[] = [];
  let next: T = answer;

  // 1. No picker, and no picker heading, while a form is in progress.
  if (input.formInProgress) {
    const lead = formOpportunityLead();
    const lines = next.content.split("\n");
    const kept = lines.filter((line) => line.trim() !== lead);
    const { formSelection, ...rest } = next;
    if (kept.length !== lines.length || formSelection !== undefined) {
      if (kept.length !== lines.length) removed.push(lead);
      const content = tidy(kept);
      next = { ...(rest as T), content: content || next.content };
    }
  }

  // 2. Never a heading with nothing under it.
  if (!hasCards(next)) {
    const lines = next.content.trimEnd().split("\n");
    const last = lines[lines.length - 1] ?? "";
    if (/:\s*$/.test(last) && lines.length > 1) {
      const content = tidy(lines.slice(0, -1));
      if (content) {
        removed.push(last.trim());
        next = { ...next, content };
      }
    }
  }

  return { answer: next, removed };
}
