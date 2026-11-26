/**
 * WHO SEES EVERY HOME ADDRESS ON THE EMPLOYEE DIRECTORY WITHOUT CLICKING.
 *
 * Pau, 26 Nov 2026: "for my access only, please show all employe adress withouth cicking 'show address'". Everyone
 * else who can open the directory keeps the per-row "Show address" button. For the accounts on the server-side list,
 * each row asks Woven for its address as the page opens; nothing is stored, exactly as with the button.
 *
 * The list is the server variable `WOVEN_ADDRESS_LIST_EMAILS` (comma or whitespace separated; never NEXT_PUBLIC_,
 * never in the repository), compared with the VERIFIED signed-in email, ignoring case and surrounding spaces. Fails
 * closed: unset or empty, signed out, unverified (demo/preview) or no email all answer false.
 */
export function addressListEmails(raw: string | undefined = process.env.WOVEN_ADDRESS_LIST_EMAILS): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function mayListAllAddresses(
  identity: { email?: string | null; verified?: boolean } | null | undefined,
  allowed: readonly string[] = addressListEmails(),
): boolean {
  if (!identity?.verified) return false;
  const email = identity.email?.trim().toLowerCase();
  return !!email && allowed.includes(email);
}
