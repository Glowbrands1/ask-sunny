/**
 * How a person resets a password, from the auth code.
 *
 * The sign-in form posts the address to `/api/auth/forgot-password`. That
 * route calls `resetPasswordForEmail` and answers the same way whether or not
 * the address has an account. The link opens `/reset-password`, once. An older
 * link that still points at `/auth/recovery` is forwarded there. An
 * administrator can also send a reset from the user directory.
 */

const RESET = /\b(?:reset|forgot|forgotten)\b[\s\S]{0,40}\bpassword\b|\bpassword\b[\s\S]{0,40}\b(?:reset|forgot|forgotten)\b|\b(?:can'?t|cannot|can not)\s+(?:log|sign)\s+in\b|\bforgot\s+my\s+(?:login|password)\b/i;

export function passwordResetHelp(question: string): string | null {
  if (!RESET.test(question)) return null;
  return `APP HELP — PASSWORD RESET

To reset a password, open the sign-in page and use Forgot password. That sends the address to /api/auth/forgot-password, which calls resetPasswordForEmail. The screen says a link is on the way whether or not that address has an account. The link opens /reset-password and can be used once. A link that still points at /auth/recovery is forwarded to /reset-password. If nothing arrives, check spam, then ask an administrator to confirm the address or send a reset from the user directory.`;
}
