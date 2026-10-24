import { payrollAmountFieldEnabled } from "@/lib/config/chat-quality-flags";

import { field } from "./catalog";
import type { FormDocument } from "./document";

/**
 * The Corrective Action Form's amount line, immediately after
 * "Is payroll deduct applicable?".
 *
 * Off, the published document is unchanged — the seed, the card and the PDF
 * stay as they are. On, the line is added when a document is read, so a form
 * already filed against an earlier version shows it without a new published
 * revision. A document that already has the key is left alone.
 *
 * The line is the manager's to fill. It is not required, and nothing here
 * reads a figure out of a policy.
 */
export const PAYROLL_AMOUNT_KEY = "payroll_deduct_amount";

export const PAYROLL_AMOUNT_LABEL = "Payroll deduction amount";

export const PAYROLL_AMOUNT_HELP =
  "The figure you give. Left blank until then — never taken from the policy.";

/**
 * Asked once, in these words, when payroll is Yes and the manager has not
 * named a figure. The same string is how a later turn knows it was already asked.
 */
export const PAYROLL_AMOUNT_QUESTION =
  "One more question: **Payroll deduction amount**? Tell me the figure here, or type it on the form — I won't take it from the policy.";

/** The one key a stated payroll amount may write. Not the Yes/No key. */
export const PAYROLL_AMOUNT_STATED_KEYS: ReadonlySet<string> = new Set([PAYROLL_AMOUNT_KEY]);

/** The Yes/No group this line follows. Same key as `PAYROLL_DEDUCT_KEY`. */
const PAYROLL_YES_NO_KEY = "payroll_deduct";

export function payrollAmountAlreadyAsked(
  history: readonly { role: string; content?: string | null }[],
): boolean {
  return history.some(
    (turn) => turn.role === "assistant" && (turn.content ?? "").includes(PAYROLL_AMOUNT_QUESTION),
  );
}

/**
 * The live Corrective Action library is already revision 7. The seed records
 * that, including this line. `ensureTemplateLibrary` still writes revision 6,
 * without the line, until Pau approves a publish.
 */
export const DPOA_UNPUBLISHED_REVISION = 7;

export const DPOA_DATABASE_REVISION = 6;

export function withoutPayrollAmountField(document: FormDocument): FormDocument {
  const present = document.blocks.some(
    (block) => block.kind === "field" && block.field.key === PAYROLL_AMOUNT_KEY,
  );
  if (!present) return document;
  return {
    ...document,
    blocks: document.blocks.filter(
      (block) => !(block.kind === "field" && block.field.key === PAYROLL_AMOUNT_KEY),
    ),
  };
}

/**
 * What a database write is allowed to store. Revision 7 is in the seed and is
 * not published. Any other revision is stored as given.
 */
export function withholdUnpublishedDpoa<T extends { key: string; revision: number; document: FormDocument }>(
  seed: T,
): T {
  if (seed.key !== "dpoa" || seed.revision !== DPOA_UNPUBLISHED_REVISION) return seed;
  return {
    ...seed,
    revision: DPOA_DATABASE_REVISION,
    document: withoutPayrollAmountField(seed.document),
  };
}

/**
 * Asked once when payroll is Yes, the line is on the form, and no figure is
 * on it yet. A second turn that already heard the question gets nothing.
 */
export function payrollAmountPrompt(input: {
  payroll: "yes" | "no" | null;
  amount: string | null;
  alreadyAsked: boolean;
  onForm: boolean;
}): string | null {
  if (!payrollAmountFieldEnabled() || !input.onForm) return null;
  if (input.payroll !== "yes" || input.amount || input.alreadyAsked) return null;
  return PAYROLL_AMOUNT_QUESTION;
}

export function withPayrollAmountField(document: FormDocument): FormDocument {
  // Off, a document is read as stored. The seed already has the line; a
  // database still on revision 6 does not, and this does not add it.
  if (!payrollAmountFieldEnabled()) return document;
  const present = document.blocks.some(
    (block) => block.kind === "field" && block.field.key === PAYROLL_AMOUNT_KEY,
  );
  if (present) return document;
  const at = document.blocks.findIndex(
    (block) => block.kind === "checkbox_group" && block.key === PAYROLL_YES_NO_KEY,
  );
  if (at < 0) return document;
  const blocks = document.blocks.slice();
  blocks.splice(at + 1, 0, {
    kind: "field",
    field: field(PAYROLL_AMOUNT_KEY, PAYROLL_AMOUNT_LABEL, "manager", "text", {
      help: PAYROLL_AMOUNT_HELP,
    }),
  });
  return { ...document, blocks };
}
