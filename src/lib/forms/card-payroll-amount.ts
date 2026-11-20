/**
 * ============================================================================
 * A LOOP CARD'S PAYROLL AMOUNT IS THE CARD'S OWN
 * ============================================================================
 *
 * QA's code audit (20 Nov 2026, item 20): Create re-read the whole chat for the amount (the latest figure wins), so a later
 * turn's figure replaced the card's, and a bare "25" answering the loop's own question was never read. For a loop card,
 * the saved Yes/No and amount are the card's: the amount the card carries (`payrollDeductAmount`, which the loop kept only
 * when the manager typed that figure), and in the draft step the card's own line "Payroll deduct amount: $25"
 * (`draftNotesFromCard`). These read the card's record, not the manager's messages. Pure.
 */

const FIGURE = /^\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)$/;

/** The card's amount as the form writes it ("20" → "$20"), or null. */
export function cardPayrollAmount(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const figure = FIGURE.exec(String(raw).trim())?.[1];
  return figure && Number(figure.replace(/,/g, "")) > 0 ? `$${figure}` : null;
}

/** The amount on the card's own draft line ("Payroll deduct amount: $25"), or null. */
export function cardNotesPayrollAmount(notes: string): string | null {
  const line = /^Payroll deduct amount:\s*(.+)$/im.exec(notes ?? "")?.[1];
  return line ? cardPayrollAmount(line) : null;
}
