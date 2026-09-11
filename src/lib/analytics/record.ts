import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope, Role } from "@/types";
import type { ActivityCategory, ActivityFeature } from "./taxonomy";

/**
 * RECORDING AN ACT THAT WOULD OTHERWISE LEAVE NO TRACE.
 *
 * Called from the handlers whose work vanishes when the response is sent: a
 * chat answer, a knowledge search, a video play, a report analysis. NOT called
 * for filing a form, uploading a document or ingesting a workbook — each of
 * those already writes a durable, attributed row, and `activity_unified` counts
 * it where it lives. Recording those here too would be two counts of one act.
 *
 * NOTHING HERE CAN CARRY A QUESTION. `ActivityRecord` has no field for prompt,
 * answer or excerpt text, and the table has no column for one. That is the
 * guarantee, and it is structural rather than a convention callers have to
 * remember.
 */

export interface ActivityRecord {
  feature: ActivityFeature;
  category: ActivityCategory;
  actorId: string | null;
  actorRole: Role | null;
  /** The actor's own scope, which is where the salon attribution comes from. */
  scope?: AccessScope | null;
  succeeded?: boolean;
  latencyMs?: number | null;
}

/**
 * THE SALON, FROM THE ACCOUNT AND NOWHERE ELSE.
 *
 * `scope.primaryAreaId` is `loc-<salon_number>` — the application's own
 * authoritative account-to-location relationship. The raw value is stored and
 * the salon row is resolved from it at write time, so an event stays
 * attributable even for a location reporting has never seen.
 *
 * It is never derived from anything the person typed. A manager asking about
 * "the Wornall situation" is not evidence that they work at Wornall, and an
 * adoption dashboard built on that kind of inference reports fiction.
 */
function locationRefOf(scope: AccessScope | null | undefined): string | null {
  if (!scope || scope.level === "global") return null;
  const primary = scope.primaryAreaId?.trim();
  return primary && primary.length > 0 ? primary : null;
}

function salonNumberOf(locationRef: string | null): string | null {
  if (!locationRef) return null;
  const number = locationRef.replace(/^loc-/, "").trim();
  return number.length > 0 ? number : null;
}

/**
 * Write one event. Never throws, and never delays the caller's own response.
 *
 * ANALYTICS MUST NOT BE ABLE TO BREAK THE PRODUCT. A failed insert here — a
 * network blip, a migration not yet applied on a given environment — would
 * otherwise turn "we could not record that you asked a question" into "your
 * question failed", which is an absurd trade for a dashboard. So the promise is
 * swallowed and logged, and the handler carries on.
 *
 * The corollary is stated rather than hidden: these counts are best-effort. An
 * event that fails to insert is an undercount, not a stalled request. For an
 * adoption dashboard that is the right side to err on; for anything anybody
 * bills against, it would not be, and nothing here should become that.
 */
export async function recordActivity(record: ActivityRecord): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const locationRef = locationRefOf(record.scope);
    const salonNumber = salonNumberOf(locationRef);

    let salonId: string | null = null;
    if (salonNumber) {
      const { data } = await supabase
        .from("salons")
        .select("id")
        .eq("salon_number", salonNumber)
        .maybeSingle();
      salonId = (data?.id as string | undefined) ?? null;
    }

    await supabase.from("activity_events").insert({
      actor_user_id: record.actorId,
      actor_role: record.actorRole,
      feature: record.feature,
      category: record.category,
      salon_id: salonId,
      location_ref: locationRef,
      succeeded: record.succeeded ?? true,
      latency_ms: record.latencyMs ?? null,
    });
  } catch (error) {
    /*
     * Logged rather than rethrown, and deliberately not surfaced to the caller.
     * `console.warn` is what the rest of this codebase's non-fatal server paths
     * use; a dedicated alerting channel would be a decision, not a detail.
     */
    console.warn(
      "[analytics] activity event not recorded",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Fire-and-forget, for handlers that must not wait on a second round trip.
 *
 * `/api/chat` already spends real time at Anthropic; adding a Supabase insert to
 * the critical path would make every answer measurably slower so a dashboard
 * can be written to. The promise is deliberately floated — `recordActivity`
 * cannot reject, so there is no unhandled rejection to leak.
 *
 * ON SERVERLESS THIS IS A REAL TRADE, and worth naming: a function instance may
 * be frozen once the response is returned, so an insert still in flight can be
 * lost. That is the undercount described above, accepted knowingly, and it is
 * why anything that must not be lost writes its own row instead.
 */
export function recordActivityAsync(record: ActivityRecord): void {
  void recordActivity(record);
}
