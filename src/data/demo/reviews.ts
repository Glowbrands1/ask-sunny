import type { CustomerReview, ReviewMetric } from "@/types";
import { isoDaysFromAnchor } from "@/lib/utils/date";

/**
 * Google review demo data.
 *
 * The workload this screen removes: today someone opens every location's Google
 * listing once a week, writes down the total review count, and subtracts last
 * week's number to get "reviews gained." `reviewsGainedThisWeek` is that exact
 * figure — computed here instead of counted by hand.
 *
 * DEMO CONTENT. Nothing is scraped and no Google API is called in this phase.
 * The SALON NAMES AND NUMBERS ARE REAL — all fifteen of them, the same roster
 * Reporting ingests — because a leaderboard of stores nobody recognises cannot
 * be read for sense. Every figure attached to them is invented.
 */

export const DEMO_REVIEW_METRICS: ReviewMetric[] = [
  {
    locationId: "loc-0306",
    locationName: "MO Kansas City Wornall",
    districtName: "District 3 — Kansas & Kansas City",
    totalReviews: 1284,
    reviewsGainedThisWeek: 19,
    reviewsGainedLastWeek: 14,
    averageRating: 4.8,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0394",
    locationName: "MO Kansas City Liberty",
    districtName: "District 3 — Kansas & Kansas City",
    totalReviews: 946,
    reviewsGainedThisWeek: 11,
    reviewsGainedLastWeek: 12,
    averageRating: 4.7,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0462",
    locationName: "KS Manhattan",
    districtName: "District 3 — Kansas & Kansas City",
    totalReviews: 712,
    reviewsGainedThisWeek: 4,
    reviewsGainedLastWeek: 9,
    averageRating: 4.4,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0463",
    locationName: "KS Shawnee Mission Pkwy",
    districtName: "District 3 — Kansas & Kansas City",
    totalReviews: 1103,
    reviewsGainedThisWeek: 16,
    reviewsGainedLastWeek: 15,
    averageRating: 4.8,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0468",
    locationName: "KS Lawrence",
    districtName: "District 3 — Kansas & Kansas City",
    totalReviews: 838,
    reviewsGainedThisWeek: 7,
    reviewsGainedLastWeek: 10,
    averageRating: 4.5,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0476",
    locationName: "KS Overland Park",
    districtName: "District 3 — Kansas & Kansas City",
    totalReviews: 604,
    reviewsGainedThisWeek: 3,
    reviewsGainedLastWeek: 8,
    averageRating: 4.2,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0313",
    locationName: "NE Omaha 132nd and Maple",
    districtName: "District 1 — Omaha & St Joseph",
    totalReviews: 1421,
    reviewsGainedThisWeek: 22,
    reviewsGainedLastWeek: 18,
    averageRating: 4.9,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0314",
    locationName: "NE Omaha 144th and Center",
    districtName: "District 1 — Omaha & St Joseph",
    totalReviews: 1657,
    reviewsGainedThisWeek: 24,
    reviewsGainedLastWeek: 21,
    averageRating: 4.8,
    weeklyGoal: 20,
  },
  {
    locationId: "loc-0410",
    locationName: "NE Omaha Pacific",
    districtName: "District 1 — Omaha & St Joseph",
    totalReviews: 889,
    reviewsGainedThisWeek: 9,
    reviewsGainedLastWeek: 11,
    averageRating: 4.6,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0495",
    locationName: "MO St Joseph",
    districtName: "District 1 — Omaha & St Joseph",
    totalReviews: 1146,
    reviewsGainedThisWeek: 15,
    reviewsGainedLastWeek: 16,
    averageRating: 4.8,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0307",
    locationName: "NE Grand Island",
    districtName: "District 2 — Lincoln & Central Nebraska",
    totalReviews: 1192,
    reviewsGainedThisWeek: 14,
    reviewsGainedLastWeek: 13,
    averageRating: 4.7,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0309",
    locationName: "NE Kearney",
    districtName: "District 2 — Lincoln & Central Nebraska",
    totalReviews: 763,
    reviewsGainedThisWeek: 6,
    reviewsGainedLastWeek: 7,
    averageRating: 4.3,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0310",
    locationName: "NE Lincoln 27th Street",
    districtName: "District 2 — Lincoln & Central Nebraska",
    totalReviews: 1035,
    reviewsGainedThisWeek: 13,
    reviewsGainedLastWeek: 12,
    averageRating: 4.6,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0311",
    locationName: "NE Lincoln O Street",
    districtName: "District 2 — Lincoln & Central Nebraska",
    totalReviews: 874,
    reviewsGainedThisWeek: 12,
    reviewsGainedLastWeek: 13,
    averageRating: 4.7,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-0312",
    locationName: "NE Lincoln Pine Lake",
    districtName: "District 2 — Lincoln & Central Nebraska",
    totalReviews: 731,
    reviewsGainedThisWeek: 14,
    reviewsGainedLastWeek: 12,
    averageRating: 4.6,
    weeklyGoal: 15,
  },
];

/**
 * Twelve weeks of aggregate "reviews gained" — the trend nobody can see today.
 *
 * SCALED UP WITH THE ROSTER. These are fifteen salons' weekly totals now, not
 * twelve, so the old series would have drawn a chart whose last point disagreed
 * with the figure printed directly above it. Weeks 11 and 12 are the estate's
 * real last-week and this-week sums, which is what makes "two fewer than last
 * week" readable off the chart as well as the tile.
 */
export const DEMO_REVIEW_TREND = [
  { label: "Wk 1", gained: 151, rating: 4.54 },
  { label: "Wk 2", gained: 161, rating: 4.56 },
  { label: "Wk 3", gained: 139, rating: 4.55 },
  { label: "Wk 4", gained: 170, rating: 4.58 },
  { label: "Wk 5", gained: 180, rating: 4.59 },
  { label: "Wk 6", gained: 162, rating: 4.57 },
  { label: "Wk 7", gained: 176, rating: 4.6 },
  { label: "Wk 8", gained: 185, rating: 4.61 },
  { label: "Wk 9", gained: 169, rating: 4.6 },
  { label: "Wk 10", gained: 190, rating: 4.62 },
  { label: "Wk 11", gained: 191, rating: 4.63 },
  { label: "Wk 12", gained: 189, rating: 4.63 },
];

export const DEMO_CUSTOMER_REVIEWS: CustomerReview[] = [
  {
    id: "rev-01",
    locationId: "loc-0314",
    locationName: "NE Omaha 144th and Center",
    authorName: "Kelsey M.",
    rating: 5,
    text: "Demo content. The team knew exactly what I needed and had me in and out in ten minutes. Spotless as always.",
    postedAt: isoDaysFromAnchor(-1),
    responded: true,
  },
  {
    id: "rev-02",
    locationId: "loc-0313",
    locationName: "NE Omaha 132nd and Maple",
    authorName: "Andre P.",
    rating: 5,
    text: "Demo content. Front desk walked me through the membership levels without any pressure. Really appreciated that.",
    postedAt: isoDaysFromAnchor(-1),
    responded: true,
  },
  {
    id: "rev-03",
    locationId: "loc-0476",
    locationName: "KS Overland Park",
    authorName: "Danielle R.",
    rating: 3,
    text: "Demo content. Waited a while at the desk during the evening rush. Staff were friendly once I was helped.",
    postedAt: isoDaysFromAnchor(-2),
    responded: false,
  },
  {
    id: "rev-04",
    locationId: "loc-0306",
    locationName: "MO Kansas City Wornall",
    authorName: "Micah T.",
    rating: 5,
    text: "Demo content. Been coming here for two years. Consistently clean and the staff remember my name.",
    postedAt: isoDaysFromAnchor(-2),
    responded: true,
  },
  {
    id: "rev-05",
    locationId: "loc-0462",
    locationName: "KS Manhattan",
    authorName: "Sonia W.",
    rating: 2,
    text: "Demo content. One of the rooms was not ready when I arrived for my appointment time.",
    postedAt: isoDaysFromAnchor(-3),
    responded: false,
  },
  {
    id: "rev-06",
    locationId: "loc-0463",
    locationName: "KS Shawnee Mission Pkwy",
    authorName: "Brett H.",
    rating: 5,
    text: "Demo content. Great recommendation on the lotion — exactly what I was looking for.",
    postedAt: isoDaysFromAnchor(-3),
    responded: true,
  },
  {
    id: "rev-07",
    locationId: "loc-0310",
    locationName: "NE Lincoln 27th Street",
    authorName: "Yvonne C.",
    rating: 4,
    text: "Demo content. Nice location and helpful staff. Would like slightly longer evening hours.",
    postedAt: isoDaysFromAnchor(-4),
    responded: false,
  },
  {
    id: "rev-08",
    locationId: "loc-0307",
    locationName: "NE Grand Island",
    authorName: "Ramon G.",
    rating: 5,
    text: "Demo content. Easiest membership upgrade I have ever done. Took two minutes.",
    postedAt: isoDaysFromAnchor(-5),
    responded: true,
  },
];

export function reviewGoalProgress(metric: ReviewMetric): number {
  return Math.min(
    100,
    Math.round((metric.reviewsGainedThisWeek / metric.weeklyGoal) * 100),
  );
}
