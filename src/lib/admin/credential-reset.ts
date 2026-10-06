import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { audit, DirectoryError, sendRecovery, type DirectoryActor } from "./user-directory";

/**
 * ============================================================================
 * CREDENTIAL RESET — the account's owner chooses their own password
 * ============================================================================
 *
 * For an account whose password was set by somebody other than its owner (for
 * example accounts provisioned by hand before invitations existed). In order:
 *
 *   1. CLEAR the password and END every session, in one database transaction
 *      (`auth_clear_user_credentials`, server-only). Nobody — including
 *      whoever set the old password — can sign in with any password after
 *      this, and every device is signed out.
 *   2. SEND the recovery email (or an invitation, if the address was never
 *      confirmed) through the existing path, so the person sets their own
 *      password. Supabase mails the link; this code never sees it.
 *   3. AUDIT `credentials_reset`.
 *
 * It never SETS, generates, shows or emails a password. Step 1 is idempotent;
 * if the email in step 2 fails, the account stays safely locked and "Send
 * sign-in link" (or this action again) completes it.
 *
 * Refused for a disabled account (re-enable it first) and for your own
 * account (use Forgot Password).
 */

export interface CredentialResetResult {
  email: string;
  sessionsEnded: number;
  sent: "invitation" | "password_reset" | null;
}

export async function resetCredentials(
  id: string,
  redirectTo: string,
  actor: DirectoryActor,
): Promise<CredentialResetResult> {
  const admin = getSupabaseAdmin();

  const { data: user, error } = await admin.from("app_users").select("id, email, status").eq("id", id).maybeSingle();
  if (error) throw new DirectoryError("provider_failed", "The account could not be read. Try again in a moment.", 502);
  if (!user) throw new DirectoryError("not_found", "There is no such account.", 404);
  const account = user as { id: string; email: string; status: string };

  if (account.id === actor.id) {
    throw new DirectoryError("self_change", "Use Forgot Password to change your own password.", 403);
  }
  if (account.status === "disabled") {
    throw new DirectoryError("invalid_input", "This account is disabled. Re-enable it before resetting its credentials.", 409);
  }

  const cleared = await admin.rpc("auth_clear_user_credentials", { p_user_id: account.id });
  if (cleared.error) {
    throw new DirectoryError("provider_failed", "The password and sessions could not be cleared. Nothing was sent.", 502);
  }
  const sessionsEnded = Number((cleared.data as { sessions?: unknown } | null)?.sessions ?? 0);

  try {
    const sent = await sendRecovery(account.id, redirectTo, actor);
    await audit({
      targetUserId: account.id,
      targetEmail: account.email,
      actor,
      action: "credentials_reset",
      from: "password_and_sessions",
      to: `cleared;${sent.kind}_sent`,
    });
    return { email: account.email, sessionsEnded, sent: sent.kind };
  } catch (sendError) {
    await audit({
      targetUserId: account.id,
      targetEmail: account.email,
      actor,
      action: "credentials_reset",
      from: "password_and_sessions",
      to: "cleared;email_not_sent",
    });
    if (sendError instanceof DirectoryError) {
      throw new DirectoryError(
        sendError.code,
        `The password was cleared and every session ended, but the email was not sent: ${sendError.message} Use "Send sign-in link" to finish.`,
        sendError.status,
      );
    }
    throw sendError;
  }
}
