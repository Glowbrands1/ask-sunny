/**
 * WHO MAY DELETE A FINALIZED FORM.
 *
 * Pau, 26 Nov 2026: "pls allow delete for finalized form in my account only". Until then every administrator, owner
 * and developer could (24 Nov 2026). Now only the accounts on the server-side list may; everybody else with
 * `manage_form_records`, administrators included, deletes drafts only, as before 24 Nov.
 *
 * The list is the server variable `FINALIZED_FORM_DELETE_EMAILS` (comma or whitespace separated; never NEXT_PUBLIC_,
 * never in the repository) and is compared with the VERIFIED signed-in email, ignoring case and surrounding spaces.
 * The browser receives a yes/no and nothing else.
 *
 * Fails closed: the variable unset or empty, signed out, an unverified identity (demo/preview mode) or no email all
 * answer false. The route (`DELETE /api/forms/instances/{id}`) decides again; the Forms Register only uses the answer
 * to decide whether its menu offers Delete on a finalized row.
 */
export function finalizedDeleteEmails(raw: string | undefined = process.env.FINALIZED_FORM_DELETE_EMAILS): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function mayDeleteFinalizedForm(
  identity: { email?: string | null; verified?: boolean } | null | undefined,
  allowed: readonly string[] = finalizedDeleteEmails(),
): boolean {
  if (!identity?.verified) return false;
  const email = identity.email?.trim().toLowerCase();
  return !!email && allowed.includes(email);
}
