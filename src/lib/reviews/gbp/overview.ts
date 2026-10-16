import "server-only";

import {
  isProductionRuntime,
  liveBackfillAllowed,
  missingCredentialNames,
  newReviewCreation,
  readOAuthSettings,
  readSyncMode,
} from "./config";
import type {
  CutoverReadiness,
  GbpOverview,
  OverviewConnection,
  OverviewListing,
  OverviewRun,
  PrimarySource,
  ReadinessCheck,
} from "./overview-types";
import { SEPT_OCT_2026_WINDOW } from "./overview-types";
import type { OverviewRows } from "./store";

/**
 * THE OVERVIEW: everything the screen needs about the Business Profile
 * integration, assembled from MEASURED sources only.
 *
 * WHICH PROVIDER IS PRIMARY is derived, not stored: Google is primary only when
 * its sync mode is `live` AND it is allowed to create reviews (which itself
 * requires Apify to be off). Until then Apify is the source and Google is a
 * verifier. Because it is derived from the same switches that govern behaviour,
 * the screen cannot claim a cutover that has not happened — and when the owner
 * approves the cutover and those switches are set, the screen reflects it with
 * no code change.
 */

export interface ApifyGlance {
  enabled: boolean;
  scheduleEnabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastSuccessAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toRun(row: OverviewRows["runs"][number]): OverviewRun {
  return { ...row };
}

function describeConnection(row: OverviewRows["connection"]): OverviewConnection {
  if (!row) return { state: "none", connectedBy: null, connectedAt: null, lastUsedAt: null, lastErrorCode: null };
  return {
    state: row.status,
    connectedBy: row.connectedBy,
    connectedAt: row.connectedAt,
    lastUsedAt: row.lastUsedAt,
    lastErrorCode: row.lastErrorCode,
  };
}

/** True when a run's window fully covers the required window. */
function covers(window: { from: string; to: string } | null | undefined, need: { from: string; to: string }): boolean {
  return !!window && window.from <= need.from && window.to >= need.to;
}

export function evaluateCutover(input: {
  connection: OverviewConnection;
  listings: OverviewListing[];
  lastDryRun: OverviewRun | null;
  lastBackfillDryRun: OverviewRun | null;
  openReviewItems: number;
  apify: ApifyGlance;
  mode: ReturnType<typeof readSyncMode>;
  now: number;
}): CutoverReadiness {
  const active = input.listings.filter((l) => l.isActive);
  const confirmed = active.filter((l) => l.mappingStatus === "confirmed");
  const checks: ReadinessCheck[] = [];

  checks.push({
    id: "connected",
    label: "Google account connected",
    status: input.connection.state === "active" ? "pass" : "fail",
    detail: input.connection.state === "active" ? "An active connection is saved." : "Connect a Google account first.",
  });

  checks.push({
    id: "mapped",
    label: "Every Sun Tan City location is mapped and verified",
    status: active.length > 0 && confirmed.length === active.length ? "pass" : "fail",
    detail: `${confirmed.length} of ${active.length} locations confirmed.`,
  });

  const fresh = input.lastDryRun && input.now - Date.parse(input.lastDryRun.startedAt) <= DAY_MS;
  const summary = input.lastDryRun?.summary;
  const allRead = !!summary && active.length > 0 && summary.locations.length >= active.length && summary.locations.every((l) => l.status === "ok" && l.complete);
  checks.push({
    id: "dry_run",
    label: "A complete dry-run check in the last 24 hours",
    status: fresh && allRead ? "pass" : "fail",
    detail: !input.lastDryRun
      ? "No dry run has been recorded yet."
      : !fresh
        ? "The last dry run is more than 24 hours old."
        : allRead
          ? "Every mapped location was read completely."
          : "At least one location was not read completely.",
  });

  const backfill = input.lastBackfillDryRun?.summary;
  const backfillDone =
    !!backfill &&
    covers(backfill.window, SEPT_OCT_2026_WINDOW) &&
    active.length > 0 &&
    backfill.locations.length >= active.length &&
    backfill.locations.every((l) => l.status === "ok" && l.complete);
  checks.push({
    id: "backfill_measured",
    label: "September–October 2026 backfill measured for all locations",
    status: backfillDone ? "pass" : "fail",
    detail: backfillDone
      ? `Google holds ${sum(backfill, (l) => l.inWindow?.google ?? 0)} reviews in the window; ${sum(backfill, (l) => l.inWindow?.missing ?? 0)} are not in Ask Sunny yet.`
      : "Run the dry-run reconciliation over 1 Sep – 31 Oct 2026 and read it for every location.",
  });

  checks.push({
    id: "no_open_items",
    label: "No review is waiting for a person to match it",
    status: input.openReviewItems === 0 ? "pass" : "fail",
    detail: input.openReviewItems === 0 ? "The manual-review queue is empty." : `${input.openReviewItems} review(s) need a person.`,
  });

  const projected = backfill ? backfill.locations.reduce((n, l) => n + (l.projectedIfFull?.counted ?? 0), 0) : null;
  checks.push({
    id: "projected_count",
    label: "Reviews that would start counting toward weekly totals",
    status: "info",
    detail:
      projected === null
        ? "Shown after the backfill dry run."
        : projected === 0
          ? "None — switching on review creation would not change any counted figure."
          : `${projected} review(s) above a location's anchor would be counted. Review these before approving.`,
  });

  checks.push({
    id: "apify_rollback",
    label: "Apify still available as a rollback",
    status: "info",
    detail: input.apify.enabled ? "Apify is enabled and unchanged." : "Apify is switched off.",
  });

  const blocking = checks.filter((c) => c.status !== "info");
  return { checks, ready: input.mode !== "off" && blocking.every((c) => c.status === "pass") };
}

function sum(summary: NonNullable<OverviewRun["summary"]>, pick: (l: NonNullable<OverviewRun["summary"]>["locations"][number]) => number): number {
  return summary.locations.reduce((n, l) => n + pick(l), 0);
}

export function derivePrimary(mode: ReturnType<typeof readSyncMode>, creationAllowed: boolean, apifyEnabled: boolean): PrimarySource {
  if (mode === "live" && creationAllowed) return "google";
  return apifyEnabled ? "apify" : "none";
}

export function buildOverview(
  rows: OverviewRows,
  apify: ApifyGlance,
  options: { env?: NodeJS.ProcessEnv; now?: number } = {},
): GbpOverview {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now();
  const mode = readSyncMode(env);
  const creation = newReviewCreation(env);
  const connection = describeConnection(rows.connection);
  const runs = rows.runs.map(toRun);

  const listings: OverviewListing[] = rows.listings.map((l) => ({
    storeCode: l.storeCode,
    label: l.label,
    salonName: l.salonName,
    district: l.district,
    isActive: l.isActive,
    apifySourceStatus: l.apifySourceStatus,
    hasVerifiedPlaceId: l.hasVerifiedPlaceId,
    expectedAddress: l.expectedAddress,
    mappingStatus: (["unmapped", "proposed", "confirmed", "rejected"].includes(l.mappingStatus) ? l.mappingStatus : "unmapped") as OverviewListing["mappingStatus"],
    gbpAccountName: l.gbpAccountName,
    gbpLocationName: l.gbpLocationName,
    confirmedAt: l.confirmedAt,
    confirmedBy: l.confirmedBy,
    reviewsHeld: l.reviewsHeld,
    reviewsLinked: l.reviewsLinked,
    openReviewItems: l.openReviewItems,
  }));

  const lastLiveSuccess = runs.find((r) => r.mode === "live" && r.status === "succeeded") ?? null;
  const lastDryRun = runs.find((r) => r.mode === "dry_run" && r.status !== "failed") ?? null;
  const lastBackfillDryRun = runs.find((r) => r.mode === "dry_run" && r.scope === "backfill" && r.status !== "failed") ?? null;
  const openReviewItems = listings.reduce((n, l) => n + l.openReviewItems, 0);

  const oauth = readOAuthSettings(env);
  const missing = missingCredentialNames(env);

  return {
    mode,
    productionRuntime: isProductionRuntime(env),
    missingEnv: missing,
    oauthConfigured: missing.length === 0 && oauth !== null,
    creation: { allowed: creation.allowed, reason: creation.allowed ? null : creation.reason },
    liveBackfillAllowed: liveBackfillAllowed(env),
    primarySource: derivePrimary(mode, creation.allowed, apify.enabled),
    apify,
    connection,
    listings,
    totals: {
      listings: listings.length,
      confirmed: listings.filter((l) => l.mappingStatus === "confirmed").length,
      reviewsHeld: listings.reduce((n, l) => n + l.reviewsHeld, 0),
      reviewsLinked: listings.reduce((n, l) => n + l.reviewsLinked, 0),
      openReviewItems,
    },
    runs,
    lastLiveSuccess,
    lastDryRun,
    lastBackfillDryRun,
    cutover: evaluateCutover({ connection, listings, lastDryRun, lastBackfillDryRun, openReviewItems, apify, mode, now }),
  };
}
