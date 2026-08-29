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
 */

export const DEMO_REVIEW_METRICS: ReviewMetric[] = [
  {
    locationId: "loc-101",
    locationName: "Riverbend Commons",
    districtName: "District 1 — South Central",
    totalReviews: 1284,
    reviewsGainedThisWeek: 19,
    reviewsGainedLastWeek: 14,
    averageRating: 4.8,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-102",
    locationName: "Maple Crossing",
    districtName: "District 1 — South Central",
    totalReviews: 946,
    reviewsGainedThisWeek: 11,
    reviewsGainedLastWeek: 12,
    averageRating: 4.7,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-103",
    locationName: "Hillcrest Station",
    districtName: "District 1 — South Central",
    totalReviews: 712,
    reviewsGainedThisWeek: 4,
    reviewsGainedLastWeek: 9,
    averageRating: 4.4,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-104",
    locationName: "Cedar Point Plaza",
    districtName: "District 2 — Western",
    totalReviews: 1103,
    reviewsGainedThisWeek: 16,
    reviewsGainedLastWeek: 15,
    averageRating: 4.8,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-105",
    locationName: "Northgate Square",
    districtName: "District 2 — Western",
    totalReviews: 838,
    reviewsGainedThisWeek: 7,
    reviewsGainedLastWeek: 10,
    averageRating: 4.5,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-106",
    locationName: "Willow Park",
    districtName: "District 2 — Western",
    totalReviews: 604,
    reviewsGainedThisWeek: 3,
    reviewsGainedLastWeek: 8,
    averageRating: 4.2,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-107",
    locationName: "Stonebridge Market",
    districtName: "District 3 — Mid-South",
    totalReviews: 1421,
    reviewsGainedThisWeek: 22,
    reviewsGainedLastWeek: 18,
    averageRating: 4.9,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-108",
    locationName: "Harborview Landing",
    districtName: "District 3 — Mid-South",
    totalReviews: 1657,
    reviewsGainedThisWeek: 24,
    reviewsGainedLastWeek: 21,
    averageRating: 4.8,
    weeklyGoal: 20,
  },
  {
    locationId: "loc-109",
    locationName: "Sandalwood Corner",
    districtName: "District 3 — Mid-South",
    totalReviews: 889,
    reviewsGainedThisWeek: 9,
    reviewsGainedLastWeek: 11,
    averageRating: 4.6,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-110",
    locationName: "Lakeshore Terrace",
    districtName: "District 4 — Northern",
    totalReviews: 1192,
    reviewsGainedThisWeek: 14,
    reviewsGainedLastWeek: 13,
    averageRating: 4.7,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-111",
    locationName: "Brookside Village",
    districtName: "District 4 — Northern",
    totalReviews: 763,
    reviewsGainedThisWeek: 6,
    reviewsGainedLastWeek: 7,
    averageRating: 4.3,
    weeklyGoal: 15,
  },
  {
    locationId: "loc-112",
    locationName: "Summit Row",
    districtName: "District 4 — Northern",
    totalReviews: 1035,
    reviewsGainedThisWeek: 13,
    reviewsGainedLastWeek: 12,
    averageRating: 4.6,
    weeklyGoal: 15,
  },
];

/** Twelve weeks of aggregate "reviews gained" — the trend nobody can see today. */
export const DEMO_REVIEW_TREND = [
  { label: "Wk 1", gained: 118, rating: 4.55 },
  { label: "Wk 2", gained: 126, rating: 4.57 },
  { label: "Wk 3", gained: 109, rating: 4.56 },
  { label: "Wk 4", gained: 133, rating: 4.59 },
  { label: "Wk 5", gained: 141, rating: 4.6 },
  { label: "Wk 6", gained: 127, rating: 4.58 },
  { label: "Wk 7", gained: 138, rating: 4.61 },
  { label: "Wk 8", gained: 145, rating: 4.62 },
  { label: "Wk 9", gained: 132, rating: 4.61 },
  { label: "Wk 10", gained: 149, rating: 4.63 },
  { label: "Wk 11", gained: 150, rating: 4.64 },
  { label: "Wk 12", gained: 148, rating: 4.64 },
];

export const DEMO_CUSTOMER_REVIEWS: CustomerReview[] = [
  {
    id: "rev-01",
    locationId: "loc-108",
    locationName: "Harborview Landing",
    authorName: "Kelsey M.",
    rating: 5,
    text: "Demo content. The team knew exactly what I needed and had me in and out in ten minutes. Spotless as always.",
    postedAt: isoDaysFromAnchor(-1),
    responded: true,
  },
  {
    id: "rev-02",
    locationId: "loc-107",
    locationName: "Stonebridge Market",
    authorName: "Andre P.",
    rating: 5,
    text: "Demo content. Front desk walked me through the membership levels without any pressure. Really appreciated that.",
    postedAt: isoDaysFromAnchor(-1),
    responded: true,
  },
  {
    id: "rev-03",
    locationId: "loc-106",
    locationName: "Willow Park",
    authorName: "Danielle R.",
    rating: 3,
    text: "Demo content. Waited a while at the desk during the evening rush. Staff were friendly once I was helped.",
    postedAt: isoDaysFromAnchor(-2),
    responded: false,
  },
  {
    id: "rev-04",
    locationId: "loc-101",
    locationName: "Riverbend Commons",
    authorName: "Micah T.",
    rating: 5,
    text: "Demo content. Been coming here for two years. Consistently clean and the staff remember my name.",
    postedAt: isoDaysFromAnchor(-2),
    responded: true,
  },
  {
    id: "rev-05",
    locationId: "loc-103",
    locationName: "Hillcrest Station",
    authorName: "Sonia W.",
    rating: 2,
    text: "Demo content. One of the rooms was not ready when I arrived for my appointment time.",
    postedAt: isoDaysFromAnchor(-3),
    responded: false,
  },
  {
    id: "rev-06",
    locationId: "loc-104",
    locationName: "Cedar Point Plaza",
    authorName: "Brett H.",
    rating: 5,
    text: "Demo content. Great recommendation on the lotion — exactly what I was looking for.",
    postedAt: isoDaysFromAnchor(-3),
    responded: true,
  },
  {
    id: "rev-07",
    locationId: "loc-112",
    locationName: "Summit Row",
    authorName: "Yvonne C.",
    rating: 4,
    text: "Demo content. Nice location and helpful staff. Would like slightly longer evening hours.",
    postedAt: isoDaysFromAnchor(-4),
    responded: false,
  },
  {
    id: "rev-08",
    locationId: "loc-110",
    locationName: "Lakeshore Terrace",
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
