import "server-only";

import { escapeLike } from "@/lib/supabase/like";
import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * ============================================================================
 * MAY A RECOVERY EMAIL BE SENT FOR THIS ADDRESS?
 * ============================================================================
 *
 * Only for an Ask Sunny account that is `active` or `invited`. NOT for a
 * DISABLED one — a reset link is a fresh sign-in, and a revoked person must
 * not be able to mint one — and not for an address with no profile at all.
 *
 * The caller never tells the requester which case applied: the public route
 * answers identically either way, so this cannot become an enumeration oracle.
 * It is a server-side read with the secret key (the browser roles cannot read
 * other people's profiles), and it FAILS CLOSED: if the profile cannot be read,
 * no email is sent.
 *
 * Supabase's ban, applied on revocation (`revocation.ts`), refuses recovery
 * links for a banned user as well; this check means the email is never sent
 * in the first place.
 */

export type RecoveryEligibility = "allowed" | "no_account" | "not_allowed" | "lookup_failed";

export async function recoveryEligibility(normalizedEmail: string): Promise<RecoveryEligibility> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("app_users")
      .select("status")
      .ilike("email", escapeLike(normalizedEmail))
      .limit(2);
    if (error || !Array.isArray(data)) return "lookup_failed";
    if (data.length === 0) return "no_account";
    /* `app_users_email_key` is unique on lower(email); two rows would be a broken database — refuse. */
    if (data.length > 1) return "not_allowed";
    const status = (data[0] as { status?: unknown }).status;
    return status === "active" || status === "invited" ? "allowed" : "not_allowed";
  } catch {
    return "lookup_failed";
  }
}
