import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { KnownListing } from "./locations";
import type { StoredReview } from "./reconcile";
import type { RunSummary } from "./summary";

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

export interface StoredConnection {
  id: string;
  refreshTokenSealed: string;
  scopes: string[];
  connectedBy: string;
  connectedAt: string;
}

export interface GbpStore {
  getActiveConnection(): Promise<StoredConnection | null>;
  saveConnection(sealed: string, scopes: readonly string[], actor: string): Promise<string>;
  endConnection(status: "revoked" | "expired" | "error", errorCode: string | null, actor: string): Promise<void>;
  touchConnection(id: string): Promise<void>;
  readListings(): Promise<(KnownListing & { locationId: string; isActive: boolean })[]>;
  readConfirmedMappings(storeCodes?: readonly string[]): Promise<MappedLocation[]>;
  readStoredReviews(locationId: string): Promise<StoredReview[]>;
  /** The listing's current anchor (`counted_through_external_review_id`), read-only. */
  readAnchor(storeCode: string): Promise<string | null>;
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
  /** Takes the single live-run lock. Null means another run holds it. */
  claimRun(input: { scope: string; trigger: string }): Promise<string | null>;
  finishRun(
    id: string | null,
    input: { status: "succeeded" | "partial" | "failed"; requests: number; summary: RunSummary; errorCode: string | null },
  ): Promise<void>;
  /** A completed run recorded in one step (dry runs). Counts only. */
  recordRun(input: {
    mode: "dry_run" | "live";
    scope: string;
    trigger: string;
    status: "succeeded" | "partial" | "failed";
    requests: number;
    summary: RunSummary;
    errorCode: string | null;
  }): Promise<void>;
  /** Stops a listing taking part in a sync. Refused while any of its reviews is linked. */
  clearMapping(storeCode: string, actor: string): Promise<"cleared" | "unknown_store_code" | "has_linked_reviews" | "not_confirmed">;
  readOverviewRows(): Promise<OverviewRows>;
}

export interface OverviewListingRow {
  locationId: string;
  storeCode: string;
  label: string;
  salonName: string | null;
  district: string | null;
  isActive: boolean;
  listingState: string;
  apifySourceStatus: string | null;
  hasVerifiedPlaceId: boolean;
  expectedAddress: { street: string | null; city: string | null; state: string | null; postalCode: string | null };
  mappingStatus: string;
  gbpAccountName: string | null;
  gbpLocationName: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  reviewsHeld: number;
  reviewsLinked: number;
  openReviewItems: number;
}

export interface OverviewRunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  mode: "dry_run" | "live";
  scope: string;
  trigger: string;
  status: string;
  requests: number;
  errorCode: string | null;
  summary: RunSummary | null;
}

export interface OverviewConnectionRow {
  status: "active" | "revoked" | "expired" | "error";
  connectedBy: string;
  connectedAt: string;
  lastUsedAt: string | null;
  lastErrorCode: string | null;
  scopes: string[];
}

export interface OverviewRows {
  listings: OverviewListingRow[];
  runs: OverviewRunRow[];
  connection: OverviewConnectionRow | null;
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
    async getActiveConnection() {
      const { data, error } = await db()
        .from("google_review_gbp_connections")
        .select("id,refresh_token_sealed,scopes,connected_by,connected_at")
        .eq("status", "active")
        .maybeSingle();
      if (error) fail("read the connection", error.code);
      if (!data) return null;
      const row = data as Record<string, unknown>;
      return {
        id: String(row.id),
        refreshTokenSealed: String(row.refresh_token_sealed),
        scopes: Array.isArray(row.scopes) ? (row.scopes as string[]) : [],
        connectedBy: String(row.connected_by),
        connectedAt: String(row.connected_at),
      };
    },

    async saveConnection(sealed, scopes, actor) {
      const { data, error } = await db().rpc("gbp_set_connection", { p_sealed: sealed, p_scopes: [...scopes], p_actor: actor });
      if (error) fail("save the connection", error.code);
      return String(data);
    },

    async endConnection(status, errorCode, actor) {
      const { error } = await db().rpc("gbp_end_connection", { p_status: status, p_error_code: errorCode, p_actor: actor });
      if (error) fail("end the connection", error.code);
    },

    async touchConnection(id) {
      const { error } = await db()
        .from("google_review_gbp_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", id);
      if (error) fail("record connection use", error.code);
    },

    async readListings() {
      const { data, error } = await db()
        .from("google_review_locations")
        .select(
          "id,store_code,google_location_label,google_place_id,gbp_location_name,gbp_mapping_status,is_active,expected_street_address,expected_city,expected_state,expected_postal_code",
        );
      if (error) fail("read listings", error.code);
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        locationId: row.id as string,
        storeCode: row.store_code as string,
        googleLocationLabel: row.google_location_label as string,
        verifiedPlaceId: (row.google_place_id as string | null) ?? null,
        confirmedLocationName:
          row.gbp_mapping_status === "confirmed" ? ((row.gbp_location_name as string | null) ?? null) : null,
        isActive: row.is_active === true,
        expectedAddress:
          row.expected_street_address && row.expected_city && row.expected_state && row.expected_postal_code
            ? {
                street: row.expected_street_address as string,
                city: row.expected_city as string,
                state: row.expected_state as string,
                postalCode: row.expected_postal_code as string,
              }
            : null,
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

    async readAnchor(storeCode) {
      const { data, error } = await db()
        .from("google_review_locations")
        .select("counted_through_external_review_id")
        .eq("store_code", storeCode)
        .maybeSingle();
      if (error) fail("read anchor", error.code);
      return ((data as { counted_through_external_review_id: string | null } | null)?.counted_through_external_review_id) ?? null;
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

    async claimRun(input) {
      const { data, error } = await db().rpc("gbp_claim_run", { p_trigger: input.trigger, p_scope: input.scope });
      if (error) fail("claim the run lock", error.code);
      return typeof data === "string" ? data : null;
    },

    async recordRun(input) {
      const now = new Date().toISOString();
      const { error } = await db().from("google_review_gbp_sync_runs").insert({
        mode: input.mode,
        scope: input.scope,
        trigger: input.trigger,
        status: input.status,
        requests: input.requests,
        summary: input.summary,
        error_code: input.errorCode,
        started_at: now,
        finished_at: now,
      });
      if (error) fail("record the run", error.code);
    },

    async clearMapping(storeCode, actor) {
      const { data: loc, error } = await db()
        .from("google_review_locations")
        .select("id,gbp_mapping_status")
        .eq("store_code", storeCode)
        .maybeSingle();
      if (error) fail("read the listing", error.code);
      if (!loc) return "unknown_store_code";
      const row = loc as { id: string; gbp_mapping_status: string };
      if (row.gbp_mapping_status !== "confirmed") return "not_confirmed";
      const { count, error: countError } = await db()
        .from("google_reviews")
        .select("id", { count: "exact", head: true })
        .eq("location_id", row.id)
        .not("gbp_review_id", "is", null);
      if (countError) fail("count linked reviews", countError.code);
      if ((count ?? 0) > 0) return "has_linked_reviews";
      const { error: updateError } = await db()
        .from("google_review_locations")
        .update({
          gbp_mapping_status: "unmapped",
          gbp_account_name: null,
          gbp_location_name: null,
          gbp_place_id: null,
          gbp_mapping_evidence: { clearedBy: actor.slice(0, 200), clearedAt: new Date().toISOString() },
          gbp_mapping_confirmed_at: null,
          gbp_mapping_confirmed_by: null,
        })
        .eq("id", row.id);
      if (updateError) fail("clear the mapping", updateError.code);
      return "cleared";
    },

    async readOverviewRows() {
      const database = db();
      const [locations, connection, runs, items, reviews] = await Promise.all([
        database
          .from("google_review_locations")
          .select(
            "id,store_code,google_location_label,salon_id,is_active,listing_state,apify_source_status,google_place_id,expected_street_address,expected_city,expected_state,expected_postal_code,gbp_mapping_status,gbp_account_name,gbp_location_name,gbp_mapping_confirmed_at,gbp_mapping_confirmed_by",
          )
          .order("store_code", { ascending: true }),
        database
          .from("google_review_gbp_connections")
          .select("status,scopes,connected_by,connected_at,last_used_at,last_error_code")
          .order("created_at", { ascending: false })
          .limit(1),
        database
          .from("google_review_gbp_sync_runs")
          .select("id,started_at,finished_at,mode,scope,trigger,status,requests,error_code,summary")
          .order("started_at", { ascending: false })
          .limit(25),
        database.from("google_review_reconciliation_items").select("location_id").eq("status", "needs_review"),
        readReviewCounts(database),
      ]);
      for (const r of [locations, connection, runs, items]) if (r.error) fail("read the overview", r.error.code);

      const locationRows = (locations.data ?? []) as Record<string, unknown>[];
      const salonIds = locationRows.map((l) => l.salon_id as string);
      const directory = await database
        .from("salon_directory")
        .select("salon_id,store_name,district_label")
        .in("salon_id", salonIds);
      if (directory.error) fail("read the salon directory", directory.error.code);
      const salonById = new Map(
        ((directory.data ?? []) as { salon_id: string; store_name: string | null; district_label: string | null }[]).map((d) => [d.salon_id, d]),
      );
      const openByLocation = new Map<string, number>();
      for (const i of (items.data ?? []) as { location_id: string }[]) {
        openByLocation.set(i.location_id, (openByLocation.get(i.location_id) ?? 0) + 1);
      }

      const listings: OverviewListingRow[] = locationRows.map((l) => {
        const salon = salonById.get(l.salon_id as string);
        const counts = reviews.get(l.id as string) ?? { held: 0, linked: 0 };
        return {
          locationId: l.id as string,
          storeCode: l.store_code as string,
          label: l.google_location_label as string,
          salonName: salon?.store_name ?? null,
          district: salon?.district_label ?? null,
          isActive: l.is_active === true,
          listingState: String(l.listing_state ?? ""),
          apifySourceStatus: (l.apify_source_status as string | null) ?? null,
          hasVerifiedPlaceId: Boolean(l.google_place_id),
          expectedAddress: {
            street: (l.expected_street_address as string | null) ?? null,
            city: (l.expected_city as string | null) ?? null,
            state: (l.expected_state as string | null) ?? null,
            postalCode: (l.expected_postal_code as string | null) ?? null,
          },
          mappingStatus: String(l.gbp_mapping_status ?? "unmapped"),
          gbpAccountName: (l.gbp_account_name as string | null) ?? null,
          gbpLocationName: (l.gbp_location_name as string | null) ?? null,
          confirmedAt: (l.gbp_mapping_confirmed_at as string | null) ?? null,
          confirmedBy: (l.gbp_mapping_confirmed_by as string | null) ?? null,
          reviewsHeld: counts.held,
          reviewsLinked: counts.linked,
          openReviewItems: openByLocation.get(l.id as string) ?? 0,
        };
      });

      const c = ((connection.data ?? []) as Record<string, unknown>[])[0];
      return {
        listings,
        connection: c
          ? {
              status: c.status as OverviewConnectionRow["status"],
              connectedBy: String(c.connected_by),
              connectedAt: String(c.connected_at),
              lastUsedAt: (c.last_used_at as string | null) ?? null,
              lastErrorCode: (c.last_error_code as string | null) ?? null,
              scopes: Array.isArray(c.scopes) ? (c.scopes as string[]) : [],
            }
          : null,
        runs: ((runs.data ?? []) as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          startedAt: String(r.started_at),
          finishedAt: (r.finished_at as string | null) ?? null,
          mode: r.mode as "dry_run" | "live",
          scope: String(r.scope),
          trigger: String(r.trigger),
          status: String(r.status),
          requests: Number(r.requests ?? 0),
          errorCode: (r.error_code as string | null) ?? null,
          summary: isRunSummary(r.summary) ? r.summary : null,
        })),
      };
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

/** One paged pass over (location, linked?) for every review: counts, not rows, leave the server. */
async function readReviewCounts(database: ReturnType<typeof getSupabaseAdmin>): Promise<Map<string, { held: number; linked: number }>> {
  const counts = new Map<string, { held: number; linked: number }>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await database
      .from("google_reviews")
      .select("location_id,gbp_review_id")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) fail("count reviews", error.code);
    const rows = (data ?? []) as { location_id: string; gbp_review_id: string | null }[];
    for (const row of rows) {
      const c = counts.get(row.location_id) ?? { held: 0, linked: 0 };
      c.held += 1;
      if (row.gbp_review_id) c.linked += 1;
      counts.set(row.location_id, c);
    }
    if (rows.length < PAGE) return counts;
  }
}

function isRunSummary(value: unknown): value is RunSummary {
  return !!value && typeof value === "object" && Array.isArray((value as { locations?: unknown }).locations);
}
