import "server-only";

import { after } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AuthenticatedIdentity } from "@/lib/auth/types";

/**
 * A DAY OF USE OF ONE AREA OF THE APP (Pau, 28 Nov 2026: "add usage for the L10 all meetings and the form monitoring",
 * "also add ai training", "add google reviews too and calendar").
 *
 * Opening one of these pages left no trace, so the Analytics page could not say who used them. Each page now calls
 * this once it has let the person in: one row per person, area (and L10 meeting) and Central day in
 * `app_usage_days`, so refreshing a page is not more use. `activity_unified` counts each row as one event.
 *
 * What the areas already record (a follow-up in Form Monitoring, a submitted AI Training assignment, a saved
 * Calendar reminder) is counted from those rows, with its history; this adds the days somebody opened the page.
 *
 * Never throws and never blocks the page for long: analytics must not be able to break the product. Only a verified
 * person with a real account id is recorded (never demo mode).
 */

export type AppUsageArea = "l10" | "form_monitoring" | "ai_training" | "google_reviews" | "calendar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordAppUsage(
  identity: Pick<AuthenticatedIdentity, "subject" | "role" | "verified"> | null | undefined,
  area: AppUsageArea,
  detail = "",
): Promise<void> {
  if (!identity?.verified || !UUID.test(identity.subject)) return;
  try {
    const { error } = await getSupabaseAdmin().rpc("record_app_usage", {
      p_user: identity.subject,
      p_role: identity.role,
      p_area: area,
      p_detail: detail.slice(0, 80),
    });
    if (error) console.warn("[analytics] app usage not recorded", error.message);
  } catch (error) {
    console.warn("[analytics] app usage not recorded", error instanceof Error ? error.message : error);
  }
}

/**
 * The same, after the page has been sent (`after` from next/server), so recording never delays it. For pages; a
 * caller outside a request (a test) records nothing rather than throwing.
 */
export function noteAppUsage(
  identity: Pick<AuthenticatedIdentity, "subject" | "role" | "verified"> | null | undefined,
  area: AppUsageArea,
  detail = "",
): void {
  if (!identity?.verified) return;
  try {
    after(() => recordAppUsage(identity, area, detail));
  } catch {
    /* Outside a request scope: nothing to record against. */
  }
}
