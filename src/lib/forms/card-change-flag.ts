/**
 * NEXT_PUBLIC_CARD_CHANGE_ENABLED (owner and QA, 27 Oct 2026; same flag in
 * both apps): the form card offers "Change something", which sends the
 * manager's choices as one chat turn (`card-change-sentence.ts`). Read at
 * build time, so turning it on needs a redeploy that rebuilds; default off.
 */
export function cardChangeEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_CARD_CHANGE_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED (Pau and QA, 28 Oct 2026; same
 * flag in both apps): a finalized form offers "Change something" beside "Edit
 * as new draft" — set the date, the type of warning or payroll deduct, and they
 * are written straight onto a new revision draft. Read at build time; default
 * off.
 */
export function cardChangeFinalizedEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_CARD_CHANGE_FINALIZED_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * NEXT_PUBLIC_FINALIZED_CHANGE_EVERY_WARNING_ENABLED (QA, 15 Nov 2026; same flag in both apps). A salon manager: "under
 * the type of warning drop down box I can't select Termination." The finalized form's "Change something" listed only
 * Verbal and Written. With this flag its Type of warning lists the template's own options (Termination and Demotion
 * too), so a manager acting on a leadership decision picks it by hand, as the form page already lets them. The
 * assistant still never picks one (`escalation-guard.ts`). Read at build time; default off.
 */
export function finalizedChangeEveryWarningEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_FINALIZED_CHANGE_EVERY_WARNING_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
