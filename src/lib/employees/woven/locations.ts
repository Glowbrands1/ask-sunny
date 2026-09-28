import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { readId } from "./normalize";
import { EmployeeStoreError } from "./store";
import type { LocationMapStatus } from "./types";

/**
 * ============================================================================
 * THE WOVEN LOCATION → ASK SUNNY SALON CROSSWALK
 * ============================================================================
 *
 * A PERSON DECIDES EVERY MAPPING. The sync queues each Woven location it sees
 * as `unmapped`; it never maps one, never guesses from a name, and never fails
 * because one is unmapped — the employees at an unmapped location are still
 * synced, carrying an `unmapped_location` issue until somebody reviews it.
 *
 * A Woven location id is not a salon number. `google_review_locations` found
 * that three store codes meant three different salons in two systems, and
 * the same caution applies here: the reviewer maps by the SALON NUMBER people
 * already use in Ask Sunny, and the database resolves it to the salon row.
 *
 * NOTHING HERE CHANGES ACCESS. A mapping says which salon a Woven location is;
 * it does not put anybody into that salon's scope.
 */

export interface WovenLocationView {
  wovenLocationId: string;
  wovenLocationName: string | null;
  status: LocationMapStatus;
  salonNumber: string | null;
  storeName: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export async function listWovenLocations(): Promise<WovenLocationView[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("woven_location_map")
    .select(
      "woven_location_id, woven_location_name, status, first_seen_at, last_seen_at, reviewed_by, reviewed_at, salons(salon_number, store_name)",
    )
    .order("status", { ascending: true })
    .order("woven_location_name", { ascending: true });
  if (error) {
    throw new EmployeeStoreError("store_unavailable", "The Woven location map could not be read.");
  }

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const salon = (Array.isArray(row.salons) ? row.salons[0] : row.salons) as
      | { salon_number?: string; store_name?: string }
      | null
      | undefined;
    return {
      wovenLocationId: String(row.woven_location_id),
      wovenLocationName: typeof row.woven_location_name === "string" ? row.woven_location_name : null,
      status: row.status as LocationMapStatus,
      salonNumber: salon?.salon_number ?? null,
      storeName: salon?.store_name ?? null,
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
      reviewedBy: typeof row.reviewed_by === "string" ? row.reviewed_by : null,
      reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
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
