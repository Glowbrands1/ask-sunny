import "server-only";

import { DEMO_REVIEW_METRICS } from "@/data/demo/reviews";
import { PRODUCTION_SALONS } from "@/data/salons";
import { businessToday, shiftDays } from "@/lib/business-date";
import type { AnchorCandidate, AnchorSetupRow } from "@/lib/reviews/anchor-admin";
import type { SourceReconciliationRow } from "@/lib/reviews/apify/status";
import type {
  ApifyLocationMapping,
  ApifyRunSummary,
  ApifySourceStatusReport,
} from "@/lib/reviews/apify/types";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";

/**
 * ============================================================================
 * THE GOOGLE REVIEW ADMIN SCREENS IN A DEMO DEPLOYMENT
 * ============================================================================
 *
 * `/reviews/setup` (Review Baselines) and `/admin/integrations/google-reviews`
 * (the Apify source) read Supabase and said "Supabase is not configured" in a
 * demo. In demo mode their loaders read this module instead.
 *
 * THE FIGURES COME FROM THE SEEDED `/reviews` SCREEN. Held, historical and
 * counted reviews per listing, and which listing has no baseline, are read off
 * `DEMO_REVIEW_METRICS` — the same rows the demo Google Reviews page draws — so
 * the three screens agree with each other. The store codes and listing states
 * are the verified mapping in `store-codes.ts`. Reviewers, street addresses,
 * Place IDs and run history are invented.
 */

const METRICS = new Map(DEMO_REVIEW_METRICS.map((row) => [row.salonNumber, row] as const));

/* Invented reviewer display names, Google-style (first name, last initial). */
const ANCHOR_REVIEWERS = [
  "Brianna T.", "Marcus L.", "Elena V.", "Jacob R.", "Tasha W.", "Grant H.", "Mia C.",
  "Derrick S.", "Lauren P.", "Owen B.", "Keisha N.", "Caleb F.", "Rosa M.", "Tyler J.", "Hana K.",
];

const RELATIVE = ["3 months ago", "2 months ago", "3 months ago", "4 months ago", "2 months ago"];

/* Invented street addresses — demo content, not the salons' real addresses. */
const STREETS: Record<string, string> = {
  "0306": "8120 Wornall Rd",
  "0307": "3415 W State St",
  "0309": "2210 2nd Ave",
  "0310": "1745 N 27th St",
  "0311": "4630 O St",
  "0312": "5701 Pine Lake Rd",
  "0313": "13250 Maple Rd",
  "0314": "14410 W Center Rd",
  "0394": "1820 W Kansas St",
  "0410": "7710 Pacific St",
  "0462": "1306 Westloop Pl",
  "0463": "6215 Shawnee Mission Pkwy",
  "0468": "3110 Iowa St",
  "0476": "11945 Metcalf Ave",
  "0495": "3702 Frederick Ave",
};

function salonFor(salonNumber: string) {
  return PRODUCTION_SALONS.find((salon) => salon.salonNumber === salonNumber) ?? null;
}

/** "MO Kansas City Wornall" → { state: "MO", city: "Kansas City" }, from the roster's own naming. */
function cityOf(name: string): { state: string; city: string } {
  const state = name.slice(0, 2);
  const rest = name.slice(3);
  for (const city of ["Kansas City", "Grand Island", "Overland Park", "St Joseph", "Shawnee"]) {
    if (rest.startsWith(city)) return { state, city: city === "Shawnee" ? "Shawnee" : city };
  }
  return { state, city: rest.split(" ")[0] };
}

/* ------------------------------------------------------- baselines ---- */

export function demoAnchorSetupRows(): AnchorSetupRow[] {
  return GOOGLE_REVIEW_LOCATIONS.map((listing, index) => {
    const salon = salonFor(listing.salonNumber);
    const figures = METRICS.get(listing.salonNumber);
    const counting = figures?.counting ?? false;
    const held = figures?.held ?? 0;
    const historical = figures?.historical ?? held;
    return {
      storeCode: listing.storeCode,
      locationName: salon?.name ?? listing.googleLabel,
      salonNumber: listing.salonNumber,
      district: salon?.districtName ?? null,
      listingState: listing.verificationRequired ? "verification_required" : "verified",
      trackingActive: counting,
      anchorReviewer: counting ? ANCHOR_REVIEWERS[index % ANCHOR_REVIEWERS.length] : null,
      anchorRelativeDate: counting ? RELATIVE[index % RELATIVE.length] : null,
      anchorSetAt: counting ? "2026-08-04T15:30:00.000Z" : null,
      historicalReviews: historical,
      heldReviews: held,
      countedReviews: held - historical,
    };
  });
}

const CANDIDATE_TEXT = [
  "Demo content. Friendly front desk and the beds were spotless.",
  "Demo content. Quick in and out on my lunch break, exactly what I needed.",
  "Demo content. The new spray tan booth is great — very even result.",
  null,
  "Demo content. Staff explained the membership options clearly.",
  "Demo content. A little busy on Saturday but worth the wait.",
  null,
  "Demo content. Always clean, always welcoming.",
  "Demo content. Booked online and everything was ready when I arrived.",
  "Demo content. Great lotion recommendation from the consultant.",
  "Demo content. Parking was easy and the salon smelled fresh.",
  null,
];
const CANDIDATE_NAMES = [
  "Ashley G.", "Ben O.", "Carmen D.", "Darius P.", "Erin Q.", "Felix Y.",
  "Gina A.", "Hector Z.", "Ivy L.", "Jonah E.", "Kara U.", "Leo I.",
];
const CANDIDATE_AGES = [
  "a week ago", "a week ago", "2 weeks ago", "2 weeks ago", "3 weeks ago", "a month ago",
  "a month ago", "a month ago", "2 months ago", "2 months ago", "3 months ago", "3 months ago",
];

/** The newest held, not-yet-counted reviews for one listing, newest first. */
export function demoAnchorCandidates(storeCode: string): AnchorCandidate[] {
  const listing = GOOGLE_REVIEW_LOCATIONS.find((entry) => entry.storeCode === storeCode);
  if (!listing) return [];
  const seed = Number(listing.salonNumber);
  return CANDIDATE_NAMES.map((_, index) => {
    const pick = (index + seed) % CANDIDATE_NAMES.length;
    const inLatestFeed = index < 8;
    return {
      externalReviewId: `DEMOCAND${listing.salonNumber}${String(index).padStart(2, "0")}`,
      reviewerName: CANDIDATE_NAMES[pick],
      rating: [5, 5, 4, 5, 3, 5, 4, 5, 5, 2, 5, 4][pick],
      commentPreview: CANDIDATE_TEXT[pick],
      relativeDateText: CANDIDATE_AGES[index],
      hasOwnerResponse: pick % 3 !== 1,
      inLatestFeed,
      promotesAbove: inLatestFeed ? index : 0,
    };
  });
}

export const DEMO_ANCHOR_REFUSAL =
  "This is a demo deployment, so review baselines are fixed — they decide what the Google Reviews page counts, and its figures are seeded to match. Nothing was changed.";

/* --------------------------------------------------- the Apify source -- */

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function mapping(index: number): ApifyLocationMapping {
  const listing = GOOGLE_REVIEW_LOCATIONS[index];
  const salon = salonFor(listing.salonNumber);
  const figures = METRICS.get(listing.salonNumber);
  const { city, state } = cityOf(salon?.name ?? "");
  const street = STREETS[listing.salonNumber] ?? null;
  const placeId = `ChIJDEMO${listing.storeCode.padStart(4, "0")}stc${listing.salonNumber}`;
  const held = figures?.held ?? 0;
  const fromApify = Math.round(held * 0.38);
  return {
    storeCode: listing.storeCode,
    salonNumber: listing.salonNumber,
    locationName: salon?.name ?? listing.googleLabel,
    district: salon?.districtName ?? null,
    googleLocationLabel: listing.googleLabel,
    listingState: listing.verificationRequired ? "verification_required" : "verified",
    isActive: true,
    googlePlaceId: placeId,
    googleCid: null,
    googleMapsUrl: `https://www.google.com/maps/place/?q=place_id:${placeId}`,
    canonicalGoogleName: listing.googleLabel,
    canonicalGoogleAddress: street ? `${street}, ${city}, ${state}` : null,
    expectedStreetAddress: street,
    expectedCity: city,
    expectedState: state,
    expectedPostalCode: null,
    expectedCountry: "US",
    expectedStreetHint: null,
    sourceStatus: "verified",
    lastVerifiedAt: "2026-09-15T16:20:00.000Z",
    verificationNote: "Demo content. Matched by street address and confirmed by an administrator.",
    discoveryStatus: "candidate_found",
    discoveredPlaceId: placeId,
    discoveredName: listing.googleLabel,
    discoveredAddress: street ? `${street}, ${city}, ${state}` : null,
    discoveredMapsUrl: null,
    discoveredCid: null,
    discoveryCandidateCount: 1,
    discoveredAt: "2026-09-15T16:02:00.000Z",
    discoveryNote: null,
    discoveryQuery: `${listing.googleLabel}`,
    countingActive: figures?.counting ?? false,
    reviewsTotal: held,
    reviewsFromApify: fromApify,
    reviewsFromBrave: held - fromApify + Math.round(fromApify * 0.7),
    latestPublishedAt: hoursAgo(20 + index * 7),
    latestSeenAt: hoursAgo(6),
  };
}

function run(
  n: number,
  kind: ApifyRunSummary["kind"],
  startedHoursAgo: number,
  fetched: number,
  created: number,
  counted: number,
): ApifyRunSummary {
  const total = GOOGLE_REVIEW_LOCATIONS.length;
  return {
    id: `a9000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    apifyRunId: `DEMO${String(n).padStart(4, "0")}run`,
    apifyActorId: "compass~google-maps-reviews-scraper",
    kind,
    status: "succeeded",
    requestedBy: kind === "backfill" ? "Priya Raghunathan" : "schedule",
    locationsRequested: total,
    locationsReturned: total,
    reviewsLimitPerLocation: kind === "backfill" ? 400 : 25,
    reviewsSince: kind === "backfill" ? null : shiftDays(businessToday(), -3),
    reviewsFetched: fetched,
    reviewsCreated: created,
    reviewsUpdated: Math.round(fetched * 0.08),
    reviewsDuplicate: fetched - created - Math.round(fetched * 0.08),
    reviewsInvalid: 0,
    reviewsUnmapped: 0,
    countedIntoPeriod: counted,
    storedAsHistorical: created - counted,
    usageTotalUsd: Math.round(fetched * 0.0006 * 100) / 100,
    missingStoreCodes: [],
    problems: [],
    startedAt: hoursAgo(startedHoursAgo),
    finishedAt: hoursAgo(startedHoursAgo - 0.1),
  };
}

export function demoApifySource(): ApifySourceStatusReport {
  const locations = GOOGLE_REVIEW_LOCATIONS.map((_, index) => mapping(index));
  const weekCounted = DEMO_REVIEW_METRICS.reduce((sum, row) => sum + row.qualifyingThisWeek, 0);
  const recentRuns = [
    run(9, "incremental", 6, 214, Math.max(4, Math.round(weekCounted / 2)), Math.round(weekCounted / 2)),
    run(8, "incremental", 30, 198, 9, 8),
    run(7, "incremental", 54, 205, 11, 10),
    run(6, "incremental", 78, 187, 7, 7),
    run(5, "incremental", 102, 192, 8, 8),
    run(4, "backfill", 24 * 57, 2_340, 2_118, 0),
  ];
  return {
    enabled: true,
    scheduleEnabled: true,
    problems: [],
    actorId: "compass~google-maps-reviews-scraper",
    tokenConfigured: true,
    webhookConfigured: true,
    scheduleDescription: "Daily at 6:00 AM Central",
    backfillLimitPerLocation: 400,
    incrementalLimitPerLocation: 25,
    maxRunsPerDay: 4,
    runsStartedInLastDay: 1,
    locationsConfigured: locations.length,
    locationsTotal: locations.length,
    locations,
    lastRun: recentRuns[0],
    lastSuccessfulRun: recentRuns[0],
    recentRuns,
    liveRun: null,
  };
}

export function demoSourceReconciliation(): SourceReconciliationRow[] {
  return GOOGLE_REVIEW_LOCATIONS.map((_, index) => {
    const row = mapping(index);
    const both = Math.round(row.reviewsFromApify * 0.7);
    return {
      storeCode: row.storeCode,
      reviewsTotal: row.reviewsTotal,
      discoveredByApify: row.reviewsFromApify,
      discoveredByBrave: row.reviewsFromBrave,
      seenByBothSources: both,
      withPublicationTime: row.reviewsFromApify,
      suspectedDuplicates: 0,
    };
  }).sort((a, b) => a.storeCode.localeCompare(b.storeCode));
}

export const DEMO_SYNC_MESSAGE =
  "Demo deployment: in a live deployment this would start an Apify run for all fifteen listings now. No run was started and nothing was charged.";

export const DEMO_LOCATION_REFUSAL =
  "This is a demo deployment, so the fifteen location mappings are fixed. Nothing was changed and Apify was not contacted.";
