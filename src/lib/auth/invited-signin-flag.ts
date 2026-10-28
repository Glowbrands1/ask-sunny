/**
 * NEXT_PUBLIC_INVITED_SIGNIN_ACCEPTS_ENABLED (QA and Pau, 28 Oct 2026; same
 * flag in both apps). Read at build time; default off.
 *
 * Somebody who signs in with a password has set one, which is what accepting
 * an invitation means — but an invitation link a mail scanner opened first
 * never reached the set-password screen that accepts it, so the account stayed
 * `invited` and every sign-in was refused ("not active"). With the flag on, a
 * successful sign-in also asks `/api/auth/accept-invitation`: the database
 * moves the caller's own row from invited to active (`accept_invitation`,
 * idempotent, `auth.uid()` only), and refuses a disabled account or an
 * unconfirmed email as it always has.
 */
export function invitedSignInAcceptsEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_INVITED_SIGNIN_ACCEPTS_ENABLED;
  return typeof raw === "string" && ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}
