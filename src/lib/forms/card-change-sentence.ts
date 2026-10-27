/**
 * ============================================================================
 * "CHANGE SOMETHING" ON THE CARD IS ONE PLAIN MANAGER TURN
 * ============================================================================
 *
 * NEXT_PUBLIC_CARD_CHANGE_ENABLED (owner and QA, 27 Oct 2026; same file in
 * both apps): the card's Change something panel does not edit the card in the
 * browser. It sends the manager's choices as one ordinary chat turn, which the
 * chat reads like anything they type — so the server's own checks (the date,
 * the store or salon the manager may file for, the levels the form offers, the
 * title list) still decide, the change is saved with the conversation, and a
 * later turn does not undo it.
 *
 * The sentences are the ones the readers already read:
 *
 *   date           "Change the date to 10/19/2026."
 *   warning        "Written warning."
 *   payroll        "Payroll deduct no."
 *   store / salon  "<Label>: <name>."
 *   job title      "Job title: Salon Director."
 *
 * Only the fields that differ from the card are said. Nothing changed, or a
 * date that is not a real calendar day, is null: nothing is sent.
 */
export interface CardFields {
  readonly formDate?: string | null;
  readonly warningLevel?: string | null;
  readonly payrollDeduct?: string | null;
  readonly locationName?: string | null;
  readonly employeeRole?: string | null;
}

export interface CardChange {
  /** `YYYY-MM-DD`, from a date input. */
  readonly formDate?: string | null;
  readonly warningLevel?: "verbal" | "written" | null;
  readonly payrollDeduct?: "yes" | "no" | null;
  /** The store or salon's display name, as the card lists it. */
  readonly locationName?: string | null;
  readonly employeeRole?: string | null;
}

/** "2026-10-19" → "10/19/2026", or null when it is not a real calendar day. */
export function managerDate(iso: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${month}/${day}/${year}`;
}

function changed(next: string | null | undefined, current: string | null | undefined): next is string {
  return Boolean(next && next.trim()) && next!.trim().toLowerCase() !== (current ?? "").trim().toLowerCase();
}

/** The one turn that says what changed, or null when there is nothing to send. */
export function cardChangeSentence(change: CardChange, card: CardFields, placeLabel: string): string | null {
  const parts: string[] = [];
  if (changed(change.formDate, card.formDate)) {
    const date = managerDate(change.formDate);
    if (!date) return null;
    parts.push(`Change the date to ${date}.`);
  }
  if (changed(change.warningLevel, card.warningLevel)) parts.push(`${change.warningLevel === "verbal" ? "Verbal" : "Written"} warning.`);
  if (changed(change.payrollDeduct, card.payrollDeduct)) parts.push(`Payroll deduct ${change.payrollDeduct}.`);
  if (changed(change.locationName, card.locationName)) parts.push(`${placeLabel}: ${change.locationName!.trim()}.`);
  if (changed(change.employeeRole, card.employeeRole)) parts.push(`Job title: ${change.employeeRole!.trim()}.`);
  if (parts.length === 0) return null;
  return parts[0]!.startsWith("Change the date") ? parts.join(" ") : `Change: ${parts.join(" ")}`;
}
