import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readId } from "./normalize";
import { classifyStatusError } from "./status";
import { EmployeeStoreError } from "./store";
import type { LocationMapStatus } from "./types";
import type { LocationMappingRow } from "./view-types";

/**
 * ============================================================================
 * THE WOVEN LOCATION → ASK SUNNY SALON CROSSWALK
 * ============================================================================
 *
 * A PERSON DECIDES EVERY MAPPING. The sync queues each Woven location it sees
 * as `unmapped`, with Woven's catalog facts (Number, district, region, closed,
 * non-location) and — when Woven's Number equals a salon number exactly — a
 * SUGGESTED salon. It never maps one, and never fails because one is unmapped.
 *
 * A suggestion is not a match. `google_review_locations` found store codes
 * that meant different salons in two systems, so the reviewer confirms by the
 * SALON NUMBER people already use, and the database resolves it.
 *
 * NOTHING HERE CHANGES ACCESS. A mapping says which salon a Woven location is;
 * it puts nobody into that salon's scope. Phase one uses it only as a label.
 */

const PAGE = 1000;

async function salonsById(): Promise<Map<string, { number: string; name: string }>> {
  const { data, error } = await getSupabaseAdmin().from("salons").select("id, salon_number, store_name");
  if (error) throw classifyStatusError(error);
  return new Map(
    ((data ?? []) as Record<string, unknown>[]).map((row) => [
      String(row.id),
      { number: String(row.salon_number), name: String(row.store_name) },
    ]),
  );
}

/**
 * Every Ask Sunny salon's number and name, for the read-only validation's
 * location-coverage comparison. A SELECT on the existing `salons` table — it
 * needs no Woven migration and writes nothing.
 */
export async function listSalonsForComparison(): Promise<{ number: string; name: string }[]> {
  return [...(await salonsById()).values()];
}

/** Active affiliations per Woven location, counted from the location access table. */
async function headcounts(): Promise<Map<string, number>> {
  const db = getSupabaseAdmin();
  const counts = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("employee_location_affiliations")
      .select("woven_location_id")
      .eq("active", true)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw classifyStatusError(error);
    const page = (data ?? []) as Record<string, unknown>[];
    for (const row of page) counts.set(String(row.woven_location_id), (counts.get(String(row.woven_location_id)) ?? 0) + 1);
    if (page.length < PAGE) break;
  }
  return counts;
}

export async function listWovenLocations(): Promise<LocationMappingRow[]> {
  const [{ data, error }, salons, counts] = await Promise.all([
    getSupabaseAdmin()
      .from("woven_location_map")
      .select(
        "woven_location_id, woven_location_name, woven_display_name, woven_location_number, woven_district_name, woven_region_name, is_closed, is_non_location, status, salon_id, suggested_salon_id, reviewed_by, reviewed_at",
      )
      .order("status", { ascending: true })
      .order("woven_location_name", { ascending: true }),
    salonsById(),
    headcounts(),
  ]);
  if (error) throw classifyStatusError(error);

  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const salon = row.salon_id ? salons.get(String(row.salon_id)) : undefined;
    const suggested = row.suggested_salon_id ? salons.get(String(row.suggested_salon_id)) : undefined;
    return {
      wovenLocationId: String(row.woven_location_id),
      name: str(row.woven_location_name),
      displayName: str(row.woven_display_name),
      number: str(row.woven_location_number),
      districtName: str(row.woven_district_name),
      regionName: str(row.woven_region_name),
      isClosed: bool(row.is_closed),
      isNonLocation: bool(row.is_non_location),
      employeeCount: counts.get(String(row.woven_location_id)) ?? 0,
      status: row.status as LocationMapStatus,
      salonNumber: salon?.number ?? null,
      salonName: salon?.name ?? null,
      suggestedSalonNumber: suggested?.number ?? null,
      suggestedSalonName: suggested?.name ?? null,
      reviewedBy: str(row.reviewed_by),
      reviewedAt: str(row.reviewed_at),
    };
  });
}

export type ReviewResult = "reviewed" | "unknown_location" | "unknown_salon" | "reviewer_required";

const SALON_NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

export class LocationReviewError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "LocationReviewError";
  }
}

/** Validates a review request. Throws `LocationReviewError` with a sentence to show. */
export function parseLocationReview(body: Partial<Record<string, unknown>>): {
  wovenLocationId: string;
  status: LocationMapStatus;
  salonNumber: string | null;
} {
  const wovenLocationId = readId(body.wovenLocationId);
  if (!wovenLocationId) throw new LocationReviewError("A Woven location id is required.");

  const status = body.status;
  if (status !== "mapped" && status !== "ignored" && status !== "unmapped") {
    throw new LocationReviewError("A location is `mapped`, `ignored` or `unmapped`.");
  }

  if (status !== "mapped") return { wovenLocationId, status, salonNumber: null };

  const salonNumber = typeof body.salonNumber === "string" ? body.salonNumber.trim() : "";
  if (!SALON_NUMBER.test(salonNumber)) {
    throw new LocationReviewError("Mapping a location needs the Ask Sunny salon number, e.g. 0306.");
  }
  return { wovenLocationId, status, salonNumber };
}

export async function reviewWovenLocation(input: {
  wovenLocationId: string;
  status: LocationMapStatus;
  salonNumber: string | null;
  reviewedBy: string;
}): Promise<ReviewResult> {
  const { data, error } = await getSupabaseAdmin().rpc("woven_location_map_review", {
    p_woven_location_id: input.wovenLocationId,
    p_status: input.status,
    p_salon_number: input.salonNumber,
    p_reviewed_by: input.reviewedBy,
  });
  if (error) {
    throw new EmployeeStoreError("store_unavailable", "The Woven location could not be updated.");
  }
  const status = (data as { status?: unknown } | null)?.status;
  return status === "reviewed" || status === "unknown_location" || status === "unknown_salon" || status === "reviewer_required"
    ? status
    : "unknown_location";
}
