import "server-only";

import { headers } from "next/headers";

import { cookieJarFromHeaders, getSupabaseSessionClientFor } from "@/lib/supabase/auth-clients";

/**
 * WHETHER THIS SUBJECT HAS BEEN GRANTED THE APP SWITCHER without being an
 * administrator — `app_users.can_switch_apps`, set per person by an operator.
 *
 * A SEPARATE, NARROW READ rather than a column on `APP_USER_COLUMNS`, so that
 * every sign-in does not depend on this column existing: if the migration has
 * not been applied, or the read fails for any reason, this answers false and the
 * only consequence is that the switcher is not offered. It runs on the SESSION
 * client, so row level security (`app_users_select_own`) limits it to the
 * caller's own row; the grant cannot be read for, or by, anybody else.
 *
 * The flag grants the LINK and nothing else: no role, permission or scope
 * changes with it.
 */
export async function subjectHasSwitchGrant(subjectId: string): Promise<boolean> {
  try {
    const client = getSupabaseSessionClientFor(cookieJarFromHeaders(new Headers(await headers())));
    const { data, error } = await client
      .from("app_users")
      .select("can_switch_apps")
      .eq("id", subjectId)
      .eq("status", "active")
      .maybeSingle();
    if (error || !data) return false;
    return (data as { can_switch_apps?: unknown }).can_switch_apps === true;
  } catch {
    return false;
  }
}
