/**
 * ============================================================================
 * A CARD COMES ONLY FROM propose_form (port of Ask Bubbles #1038: its QA's live re-run 2, 22 Nov 2026, "saved ≠ card")
 * ============================================================================
 *
 * Found in Ask Bubbles, the same code in Sunny. On the turns that stated a fact ("payroll is not deductable", "verbal
 * warning", "previous coaching: …", more examples for the Observation) the model called no tool and wrote the reply in card
 * form ("**Is payroll deduct applicable?** No, as you said.", "**Observation of Offense:** … Multiple times …"). The card
 * under it never changed, so Create saved the card without them. Some of those replies ended with the loop's own history
 * note ("[app note: this reply showed a card built with propose_form]"), copied from the earlier card replies the model is
 * shown, and the manager saw it.
 *
 *   CARD LINES   a line under one of the card's own labels, the ones the rules book tells the model to write, anywhere in
 *                the line. Labels of the app's own card, not a list of the manager's phrasings.
 *   HISTORY      the model's history shows an earlier card reply's card lines as one "[card shown under this reply: …]"
 *                line, so it has no card reply to imitate; the card itself is on the manager's screen, unchanged.
 *   CHECK        (`run.ts`) on a turn with no card call, a card line goes back once; if it comes back it is left out.
 *   APP NOTES    "[app note: …]" is the app's, never the manager's: it is never shown.
 */

import { EXIT_CARD_LABELS } from "./exit-read-back";

export const CARD_LINE_LABELS: readonly string[] = [
  "Observation of Offense",
  "Prior actions",
  "Policy",
  "Type of Warning",
  "Is payroll deduct applicable?",
  "Payroll deduction amount",
  "Job title",
  "Action Plan",
  /* The exit form's own labels (`exit-read-back.ts`), as Ask Bubbles lists them: an exit card line on a turn with no card call is a card nobody proposed too. */
  ...EXIT_CARD_LABELS,
];

const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const KNOWN = new Map(CARD_LINE_LABELS.map((label) => [flat(label), label]));

export interface CardLine {
  readonly label: string;
  readonly line: string;
}

/**
 * The reply's lines that carry a card label as a line's label ("**<label>:** …" or "**<label>**: …"; a question label such
 * as "**Is payroll deduct applicable?** No" needs no colon), anywhere in the line. A bold label word in a sentence ("the
 * **Policy** it cites") is no card line.
 */
export function cardLines(reply: string): CardLine[] {
  const out: CardLine[] = [];
  for (const line of reply.split("\n")) {
    for (const match of line.matchAll(/\*\*([^*]+?)\*\*(:?)/g)) {
      const inner = match[1]!.trim();
      const label = KNOWN.get(flat(inner.replace(/:$/, "")));
      if (label && (inner.endsWith(":") || match[2] === ":" || label.endsWith("?"))) {
        out.push({ label, line });
        break;
      }
    }
  }
  return out;
}

/** The reply without its card lines. */
export function withoutCardLines(reply: string): string {
  const drop = new Set(cardLines(reply).map((line) => line.line));
  return reply.split("\n").filter((line) => !drop.has(line)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The text without the app's own notes ("[app note: …]"): never the manager's to see. */
export function withoutAppNotes(text: string): string {
  return text.replace(/[ \t]*\[app note:[^\]\n]*\]/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** An earlier reply as the model's history shows it: no app notes, and a card reply's card lines as one stand-in line. */
export function historyReply(content: string, cardForm: string | null): string {
  const bare = withoutAppNotes(content);
  if (!cardForm) return withoutCardLines(bare);
  return `${withoutCardLines(bare)}\n\n[card shown under this reply: ${cardForm}, made by propose_form; the card itself is on the manager's screen]`;
}
