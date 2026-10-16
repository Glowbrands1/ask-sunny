import type { RunSummary } from "./summary";

/**
 * WHAT THE GOOGLE BUSINESS PROFILE SECTION SHOWS, as plain data.
 *
 * Client-safe: nothing here imports a server module, so the screen can type
 * against it. Everything is MEASURED — from the environment (by NAME, never a
 * value), the database and the run ledger — and nothing is a secret: the
 * connection is described by who connected and when, never by its token.
 */

export type GbpMode = "off" | "dry_run" | "live";

/** The September–October 2026 historical window, as the screen's default. */
export const SEPT_OCT_2026_WINDOW = { from: "2026-09-01", to: "2026-11-01" } as const;

export type MappingState = "unmapped" | "proposed" | "confirmed" | "rejected";

export interface OverviewListing {
  storeCode: string;
  label: string;
  salonName: string | null;
  district: string | null;
  isActive: boolean;
  apifySourceStatus: string | null;
  hasVerifiedPlaceId: boolean;
  expectedAddress: { street: string | null; city: string | null; state: string | null; postalCode: string | null };
  mappingStatus: MappingState;
  gbpAccountName: string | null;
  gbpLocationName: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  reviewsHeld: number;
  reviewsLinked: number;
  openReviewItems: number;
}

export interface OverviewRun {
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

export type ConnectionState = "none" | "active" | "expired" | "revoked" | "error";

export interface OverviewConnection {
  state: ConnectionState;
  connectedBy: string | null;
  connectedAt: string | null;
  lastUsedAt: string | null;
  lastErrorCode: string | null;
}

export interface ReadinessCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "info";
  detail: string;
}

export interface CutoverReadiness {
  checks: ReadinessCheck[];
  /** Every blocking check passes. Cutover itself still needs the owner's approval. */
  ready: boolean;
}

export type PrimarySource = "apify" | "google" | "none";

export interface GbpOverview {
  mode: GbpMode;
  productionRuntime: boolean;
  /** Variable NAMES that are missing. Never values. */
  missingEnv: string[];
  oauthConfigured: boolean;
  creation: { allowed: boolean; reason: string | null };
  liveBackfillAllowed: boolean;
  primarySource: PrimarySource;
  apify: { enabled: boolean; scheduleEnabled: boolean; lastRunAt: string | null; lastRunStatus: string | null; lastSuccessAt: string | null };
  connection: OverviewConnection;
  listings: OverviewListing[];
  totals: { listings: number; confirmed: number; reviewsHeld: number; reviewsLinked: number; openReviewItems: number };
  runs: OverviewRun[];
  lastLiveSuccess: OverviewRun | null;
  lastDryRun: OverviewRun | null;
  lastBackfillDryRun: OverviewRun | null;
  cutover: CutoverReadiness;
}
