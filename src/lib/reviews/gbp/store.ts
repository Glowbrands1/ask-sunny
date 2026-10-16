import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { KnownListing } from "./locations";
import type { StoredReview } from "./reconcile";

/**
 * The database side of the sync, behind an interface so the orchestration can be
 * tested with an in-memory fake. Every write goes through a `gbp_*` function or
 * the existing `ingest_google_reviews` — nothing here updates a review row
 * directly.
 */

export interface MappedLocation {
  locationId: string;
  storeCode: string;
  label: string;
  accountName: string;
  gbpLocationName: string;
  gbpPlaceId: string | null;
  verifiedPlaceId: string | null;
}

export interface LinkInput {
  reviewId: string;
  gbpReviewId: string;
  gbpReviewName: string;
  method: "exact_id" | "auto_match" | "created_from_gbp";
  createTime: string | null;
  updateTime: string | null;
  reviewerName: string;
  rating: number;
  comment: string | null;
  replyText: string | null;
  replyUpdateTime: string | null;
}

export interface ReviewItemInput {
  locationId: string;
  gbpReviewId: string;
  reasons: string[];
  candidateReviewIds: string[];
  official: Record<string, unknown>;
}

export interface LocalTotals {
  total: number;
  averageRating: number | null;
}

export interface GbpStore {
  readListings(): Promise<(KnownListing & { locationId: string; isActive: boolean })[]>;
  readConfirmedMappings(storeCodes?: readonly string[]): Promise<MappedLocation[]>;
  readStoredReviews(locationId: string): Promise<StoredReview[]>;
  lookupIdsByExternalId(locationId: string, externalIds: string[]): Promise<Map<string, string>>;
  applyLinks(links: LinkInput[]): Promise<{ linked: number; refreshed: number; conflicts: number }>;
  recordReviewItems(items: ReviewItemInput[]): Promise<number>;
  confirmMapping(input: {
    storeCode: string;
    accountName: string;
    locationName: string;
    placeId: string | null;
    evidence: Record<string, unknown>;
    confirmedBy: string;
  }): Promise<string>;
  startRun(input: { mode: "live"; scope: string; trigger: string }): Promise<string | null>;
  finishRun(
    id: string | null,
    input: { status: "succeeded" | "partial" | "failed"; requests: number; summary: unknown; errorCode: string | null },
  ): Promise<void>;
}

function fail(operation: string, code: string | undefined): never {
  /* The message is never forwarded: a Postgres error can carry a value from a review row. */
  console.error(`[reviews/gbp/store] ${operation} failed`, code ?? "unknown");
  throw new Error(`${operation} failed`);
}

const PAGE = 1000;

export function createSupabaseStore(): GbpStore {
  const db = () => getSupabaseAdmin();

  return {
    async readListings() {
      const { data, error } = await db()
        .from("google_review_locations")
        .select("id,store_code,google_location_label,google_place_id,gbp_location_name,gbp_mapping_status,is_active");
      if (error) fail("read listings", error.code);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        locationId: row.id as string,
        storeCode: row.store_code as string,
        googleLocationLabel: row.google_location_label as string,
        verifiedPlaceId: (row.google_place_id as string | null) ?? null,
        confirmedLocationName:
          row.gbp_mapping_status === "confirmed" ? ((row.gbp_location_name as string | null) ?? null) : null,
        isActive: row.is_active === true,
      }));
    },

    async readConfirmedMappings(storeCodes) {
      let query = db()
        .from("google_review_locations")
        .select("id,store_code,google_location_label,google_place_id,gbp_account_name,gbp_location_name,gbp_place_id")
        .eq("gbp_mapping_status", "confirmed")
        .eq("is_active", true);
      if (storeCodes && storeCodes.length > 0) query = query.in("store_code", [...storeCodes]);
      const { data, error } = await query;
      if (error) fail("read mappings", error.code);
      return ((data ?? []) as Record<string, unknown>[])
        .filter((row) => row.gbp_account_name && row.gbp_location_name)
        .map((row) => ({
          locationId: row.id as string,
          storeCode: row.store_code as string,
          label: row.google_location_label as string,
          accountName: row.gbp_account_name as string,
          gbpLocationName: row.gbp_location_name as string,
          gbpPlaceId: (row.gbp_place_id as string | null) ?? null,
          verifiedPlaceId: (row.google_place_id as string | null) ?? null,
        }));
    },

    async readStoredReviews(locationId) {
      const out: StoredReview[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await db()
          .from("google_reviews")
          .select(
            "id,external_review_id,gbp_review_id,reviewer_name,rating,review_text,google_absolute_date,has_owner_response,owner_response_text",
          )
          .eq("location_id", locationId)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) fail("read stored reviews", error.code);
        const rows = (data ?? []) as Record<string, unknown>[];
        for (const row of rows) {
          out.push({
            id: row.id as string,
            externalReviewId: row.external_review_id as string,
            gbpReviewId: (row.gbp_review_id as string | null) ?? null,
            reviewerName: row.reviewer_name as string,
            rating: row.rating as number,
            reviewText: (row.review_text as string | null) ?? null,
            googleAbsoluteDate: (row.google_absolute_date as string | null) ?? null,
            hasOwnerResponse: row.has_owner_response === true,
            ownerResponseText: (row.owner_response_text as string | null) ?? null,
          });
        }
        if (rows.length < PAGE) return out;
      }
    },

    async lookupIdsByExternalId(locationId, externalIds) {
      const map = new Map<string, string>();
      if (externalIds.length === 0) return map;
      const { data, error } = await db()
        .from("google_reviews")
        .select("id,external_review_id")
        .eq("location_id", locationId)
        .in("external_review_id", externalIds);
      if (error) fail("look up filed reviews", error.code);
      for (const row of (data ?? []) as { id: string; external_review_id: string }[]) {
        map.set(row.external_review_id, row.id);
      }
      return map;
    },

    async applyLinks(links) {
      if (links.length === 0) return { linked: 0, refreshed: 0, conflicts: 0 };
      const { data, error } = await db().rpc("gbp_apply_links", { p_links: links });
      if (error) fail("apply links", error.code);
      const result = (data ?? {}) as Record<string, number>;
      return {
        linked: result.linked ?? 0,
        refreshed: result.refreshed ?? 0,
        conflicts: result.conflicts ?? 0,
      };
    },

    async recordReviewItems(items) {
      if (items.length === 0) return 0;
      const { data, error } = await db().rpc("gbp_record_review_items", { p_items: items });
      if (error) fail("record review items", error.code);
      return typeof data === "number" ? data : 0;
    },

    async confirmMapping(input) {
      const { data, error } = await db().rpc("gbp_confirm_location_mapping", {
        p_store_code: input.storeCode,
        p_account_name: input.accountName,
        p_location_name: input.locationName,
        p_place_id: input.placeId,
        p_evidence: input.evidence,
        p_confirmed_by: input.confirmedBy,
      });
      if (error) fail("confirm mapping", error.code);
      return ((data ?? {}) as { status?: string }).status ?? "unknown";
    },

    async startRun(input) {
      const { data, error } = await db()
        .from("google_review_gbp_sync_runs")
        .insert({ mode: input.mode, scope: input.scope, trigger: input.trigger })
        .select("id")
        .single();
      if (error) {
        console.error("[reviews/gbp/store] could not open a run row", error.code ?? "unknown");
        return null;
      }
      return (data as { id: string }).id;
    },

    async finishRun(id, input) {
      if (!id) return;
      const { error } = await db()
        .from("google_review_gbp_sync_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: input.status,
          requests: input.requests,
          summary: input.summary,
          error_code: input.errorCode,
        })
        .eq("id", id);
      if (error) console.error("[reviews/gbp/store] could not close a run row", error.code ?? "unknown");
    },
  };
}
