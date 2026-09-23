import "server-only";

import { ADMIN_CONSOLE_ROLES } from "@/lib/permissions";
import { readRecoveryStart } from "@/lib/auth/recovery-token";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  DirectoryError,
  audit,
  readUser,
  type DirectoryActor,
} from "@/lib/admin/user-directory";

/**
 * ============================================================================
 * ADMINISTRATOR-GENERATED RESET LINK. An interim path that sends no email.
 * ============================================================================
 *
 * Supabase's built-in mailer allows only a handful of emails an hour, so until
 * custom SMTP is configured an administrator can generate a reset link and
 * send it to the person privately (Teams, or another direct channel).
 *
 * THIS IS THE ONE MODULE THAT HOLDS A RECOVERY CREDENTIAL. `user-directory.ts`
 * is tested never to call `generateLink`, and that guard stays: everything that
 * returns a link to a browser lives here, where it can be reviewed on its own.
 *
 *   - `auth.admin.generateLink({ type: "recovery", email })` creates the
 *     recovery token WITHOUT sending an email. Nothing here calls
 *     `resetPasswordForEmail` or `inviteUserByEmail`.
 *   - Supabase's `action_link` is NOT used. It points at `/auth/v1/verify`,
 *     which spends the token on GET — the exact failure PR #33 fixed. Only
 *     `properties.hashed_token` is read, and it is wrapped in Ask Sunny's own
 *     scanner-safe `/auth/recovery-start` URL, so the person goes through the
 *     same flow as an emailed link: Continue → verifyOtp → /reset-password →
 *     updateUser({ password }). No password is created or set here.
 *   - The email comes from the directory row, never from the browser.
 *
 * WHO MAY RECEIVE ONE
 *
 *   - Active accounts only. A disabled account is refused. An invited one is
 *     refused too: it has not accepted yet, and "Send sign-in link" re-sends
 *     the invitation, which is what it needs.
 *   - NOT an administrative account (admin, owner, developer). This link hands
 *     a working credential for the target account to the administrator who
 *     generated it — so without this rule, any holder of `manage_users` could
 *     take over another administrator's account. Administrators keep using
 *     "Send sign-in link", which goes to their own inbox.
 *
 * THE LINK IS RETURNED, AND NOTHING ELSE KEEPS IT. It is not logged, not
 * stored, and not put in the audit row. The audit row records only that a link
 * was generated, by whom, for whom.
 *
 * Generating a new link replaces any recovery link issued before it, so an
 * older emailed link stops working. That is Supabase's behaviour, and it is the
 * safe direction.
 */

/** Recorded in `app_user_audit.to_value` to tell this apart from an emailed reset. */
export const RESET_LINK_AUDIT_LABEL = "admin_generated_link";

export async function generateResetLink(
  id: string,
  toUrl: (tokenHash: string) => string,
  actor: DirectoryActor,
): Promise<{ url: string; email: string }> {
  const user = await readUser(id);

  if (user.status === "disabled") {
    throw new DirectoryError(
      "invalid_input",
      "This account is disabled. Re-enable it before generating a reset link.",
      409,
    );
  }
  if (user.status !== "active") {
    throw new DirectoryError(
      "invalid_input",
      "This person has not accepted their invitation yet. Use Send sign-in link to resend it.",
      409,
    );
  }
  if ((ADMIN_CONSOLE_ROLES as readonly string[]).includes(user.role)) {
    throw new DirectoryError(
      "protected_account",
      "Reset links cannot be generated for administrator accounts. Use Send sign-in link instead.",
      403,
    );
  }

  const { data, error } = await getSupabaseAdmin().auth.admin.generateLink({
    type: "recovery",
    email: user.email,
  });

  if (error) {
    // The provider's text is not passed on; it can name the account.
    throw new DirectoryError(
      "provider_failed",
      error.status === 429
        ? "Too many reset links were requested just now. Wait a minute and try again."
        : "The reset link could not be generated. Try again in a moment.",
      error.status === 429 ? 429 : 502,
    );
  }

  const properties = data?.properties;
  const tokenHash = properties?.hashed_token;
  const generatedFor = data?.user?.id;

  /*
   * Checked, not assumed. A link for any other account or of any other type is
   * never handed to the administrator.
   */
  if (
    !tokenHash ||
    properties?.verification_type !== "recovery" ||
    generatedFor !== user.id
  ) {
    throw new DirectoryError(
      "provider_failed",
      "The reset link could not be generated. Try again in a moment.",
      502,
    );
  }

  const url = toUrl(tokenHash);

  /*
   * The URL must be one `/auth/recovery-start` will actually accept, or the
   * person would be sent a link that does nothing.
   */
  if (readRecoveryStart(new URL(url)) !== tokenHash) {
    throw new DirectoryError(
      "provider_failed",
      "The reset link could not be generated. Try again in a moment.",
      502,
    );
  }

  // An already-valid action. No token, no link — the table has no column for one.
  await audit({
    targetUserId: user.id,
    targetEmail: user.email,
    actor,
    action: "reset_requested",
    to: RESET_LINK_AUDIT_LABEL,
  });

  return { url, email: user.email };
}
