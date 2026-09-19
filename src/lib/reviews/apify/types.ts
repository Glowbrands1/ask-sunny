/**
 * THE APIFY SOURCE'S SHAPES, shared by the routes, the sync layer and the
 * admin status screen.
 *
 * Client-safe. No database client, no secret, no `server-only` import — the
 * status panel renders these and the routes validate into them.
 */

import type { GoogleListingState } from "../types";

/**
 * WHICH TRANSPORT FOUND A REVIEW. Never part of its identity — see the
 * migration's header for why `google_review_source` was left alone.
 */
export type ReviewIngestionSource = "brave_extension" | "apify";

/** Whether a listing may take part in an Apify run at all. */
export type ApifySourceStatus =
  | "unconfigured"
  | "pending_verification"
  | "verified"
  | "rejected";

export type ApifyRunKind =
  | "backfill"
  | "incremental"
  | "location_resolution"
  | "location_discovery";

/**
 * WHAT A GOOGLE MAPS SEARCH CONCLUDED FOR A LISTING.
 *
 * Deliberately a different axis from `ApifySourceStatus`, which decides whether
 * a listing may be SCRAPED. Discovery proposes and a person disposes: no value
 * here can make a listing runnable on its own.
 */
export type DiscoveryStatus =
  | "not_searched"
  | "searching"
  | "candidate_found"
  | "ambiguous"
  | "not_found"
  | "profile_issue";

/** One place as a Google Maps places Actor reports it. Untrusted throughout. */
export interface ApifyPlaceCandidate {
  placeId: string;
  title: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  cid: string | null;
  mapsUrl: string | null;
  permanentlyClosed: boolean;
  temporarilyClosed: boolean;
  /** The query that produced it, when the Actor says. Never used to match. */
  searchString: string | null;
}

export type ApifyRunStatus = "running" | "succeeded" | "partial" | "failed";

/**
 * ONE REVIEW AS THE APIFY DATASET CARRIES IT.
 *
 * ============================================================================
 * EVERY FIELD IS OPTIONAL AND EVERY FIELD IS UNTRUSTED
 * ============================================================================
 *
 * This is not a contract the Actor signed. It is a description of what the
 * chosen Actor was observed to return, and Actors are third-party code that
 * changes without telling us. So the type is permissive, the NORMALISER is
 * strict, and the strictness is where the rules live:
 *
 *   A record without a stable review id is REFUSED, not filed under a
 *   substitute. There is no field this system would rather key on — not the
 *   reviewer's name, not a hash of the text, not the row's position in the
 *   dataset — because every one of those makes an edited review a second
 *   review and two people called "Sarah M." one.
 *
 *   A record whose place id is not one of the fifteen VERIFIED mappings is
 *   ignored and counted, never guessed at by name.
 *
 * ============================================================================
 * WHY SEVERAL SPELLINGS PER FIELD
 * ============================================================================
 *
 * The aliases below are not defensive clutter; they are what makes the Actor
 * swappable. `APIFY_ACTOR_ID` is configuration precisely so a maintainer who
 * finds a better or cheaper Actor can change one variable — and the reviews
 * marketplace has settled on two or three spellings for the same fact
 * (`reviewId`/`review_id`, `stars`/`rating`, `publishedAtDate`/`publishedAt`).
 * Accepting those costs nothing and is checked by tests. Accepting a MISSING
 * id would cost everything, so that is where the tolerance stops.
 */
export interface ApifyReviewRecord {
  /** Google's own review id. THE key. No alias for its absence. */
  reviewId?: unknown;
  review_id?: unknown;

  reviewerName?: unknown;
  reviewer_name?: unknown;
  name?: unknown;

  /** 1-5. `stars` is what the chosen Actor calls it. */
  stars?: unknown;
  rating?: unknown;

  text?: unknown;
  reviewText?: unknown;
  /** Google's own machine translation. Never stored in place of `text`. */
  textTranslated?: unknown;

  /** An absolute ISO instant — the reason this source is worth having. */
  publishedAtDate?: unknown;
  published_at?: unknown;
  /** Google's relative wording, when the Actor passes it through. */
  publishedAt?: unknown;

  responseFromOwnerText?: unknown;
  responseFromOwnerDate?: unknown;

  /** The place this review belongs to, as the Actor reports it. */
  placeId?: unknown;
  place_id?: unknown;
  cid?: unknown;
  /** The listing's name and address, for the verification step only. */
  title?: unknown;
  address?: unknown;

  [key: string]: unknown;
}

/** One of the fifteen listings, as the Apify source sees it. */
export interface ApifyLocationMapping {
  storeCode: string;
  salonNumber: string | null;
  locationName: string;
  district: string | null;
  googleLocationLabel: string;
  listingState: GoogleListingState;
  isActive: boolean;
  googlePlaceId: string | null;
  googleCid: string | null;
  googleMapsUrl: string | null;
  canonicalGoogleName: string | null;
  canonicalGoogleAddress: string | null;
  /**
   * THE ADDRESS ASK SUNNY EXPECTS GOOGLE TO REPORT, as a person typed it.
   *
   * This is the strongest thing discovery has: it turns "find a Sun Tan City
   * near Lawrence" into "find the one at 2624 Iowa St". Null means nobody has
   * entered one yet, and the search falls back to the city, the state and the
   * street hint below — which is where every listing started.
   */
  expectedStreetAddress: string | null;
  expectedCity: string | null;
  expectedState: string | null;
  /** Optional, and decisive where both sides have one: they must agree. */
  expectedPostalCode: string | null;
  expectedCountry: string | null;
  /**
   * Street or landmark tokens that separate this salon from another in the
   * same city, taken from the roster's own salon names. THE OLDER, WEAKER
   * MECHANISM, kept because it still resolves six salons with nothing typed:
   * where a full street address exists it is used instead, and this is ignored.
   */
  expectedStreetHint: string[] | null;
  sourceStatus: ApifySourceStatus;
  lastVerifiedAt: string | null;
  verificationNote: string | null;

  /**
   * WHAT A SEARCH PROPOSED, kept apart from what was accepted above. A
   * proposal is not an acceptance: only the promotion step copies these into
   * `googlePlaceId` and the canonical fields, and only from a safe match.
   */
  discoveryStatus: DiscoveryStatus;
  discoveredPlaceId: string | null;
  discoveredName: string | null;
  discoveredAddress: string | null;
  discoveredMapsUrl: string | null;
  discoveredCid: string | null;
  discoveryCandidateCount: number;
  discoveredAt: string | null;
  discoveryNote: string | null;
  discoveryQuery: string | null;
  countingActive: boolean;
  reviewsTotal: number;
  reviewsFromApify: number;
  reviewsFromBrave: number;
  latestPublishedAt: string | null;
  latestSeenAt: string | null;
}

/** One Apify run, as the status panel reads it. */
export interface ApifyRunSummary {
  id: string;
  apifyRunId: string | null;
  apifyActorId: string | null;
  kind: ApifyRunKind;
  status: ApifyRunStatus;
  requestedBy: string;
  locationsRequested: number;
  locationsReturned: number;
  reviewsLimitPerLocation: number | null;
  reviewsSince: string | null;
  reviewsFetched: number;
  reviewsCreated: number;
  reviewsUpdated: number;
  reviewsDuplicate: number;
  reviewsInvalid: number;
  /** Records whose place id matched no verified listing. Not an error. */
  reviewsUnmapped: number;
  countedIntoPeriod: number;
  storedAsHistorical: number;
  /** What Apify says it cost. Null until Apify has been asked. */
  usageTotalUsd: number | null;
  /**
   * CONFIGURED LISTINGS THAT DID NOT COME BACK. Never conflated with "had no
   * new reviews" — a salon with a quiet week returns zero reviews and is not
   * on this list.
   */
  missingStoreCodes: string[];
  problems: { code: string; storeCode?: string }[];
  startedAt: string;
  finishedAt: string | null;
}

/** The whole integration status area, in one object. */
export interface ApifySourceStatusReport {
  /** Whether the server-side source is switched on at all. */
  enabled: boolean;
  /**
   * Whether the twice-daily cron may start a run. Separate from `enabled` so
   * QA can use the manual buttons without arming an unattended one.
   */
  scheduleEnabled: boolean;
  /** Configuration faults, by variable name. Never a value. */
  problems: string[];
  actorId: string | null;
  tokenConfigured: boolean;
  webhookConfigured: boolean;
  scheduleDescription: string | null;
  backfillLimitPerLocation: number;
  incrementalLimitPerLocation: number;
  maxRunsPerDay: number;
  runsStartedInLastDay: number;
  locationsConfigured: number;
  locationsTotal: number;
  locations: ApifyLocationMapping[];
  lastRun: ApifyRunSummary | null;
  lastSuccessfulRun: ApifyRunSummary | null;
  recentRuns: ApifyRunSummary[];
  liveRun: ApifyRunSummary | null;
}

/** What a manual trigger answers, for the button that started it. */
export interface ApifyTriggerResult {
  status: "started" | "already_running" | "over_budget" | "disabled" | "not_configured";
  /** Filled in when a trigger did work without starting a run. */
  promoted?: { storeCode: string; status: string; conflictsWith?: string }[];
  runId: string | null;
  apifyRunId: string | null;
  kind: ApifyRunKind | null;
  locationsRequested: number;
  reviewsLimitPerLocation: number | null;
  /** A sentence for the operator. Never a token, never a URL with one in it. */
  message: string;
}
