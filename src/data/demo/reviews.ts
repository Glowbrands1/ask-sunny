import type { CustomerReview } from "@/types";
import { isoDaysFromAnchor } from "@/lib/utils/date";

/**
 * Google review demo data.
 *
 * Drawn by the LIVE Google Reviews screen in a demo deployment, which never
 * reads the database (see `reviews-demo-screen.tsx`): qualifying reviews this
 * week and month to date, against the goal of ten a month.
 *
 * DEMO CONTENT. Nothing is scraped and no Google API is called in this phase.
 * The SALON NAMES AND NUMBERS ARE REAL — all fifteen of them, the same roster
 * Reporting ingests — because a leaderboard of stores nobody recognises cannot
 * be read for sense. Every figure attached to them is invented.
 */

/**
 * ONE SALON'S MONTHLY GOAL FIGURES, AS THE DEMO PRESENTS THEM.
 *
 * The same quantities the live `/reviews` page reads off its rollups —
 * qualifying reviews this week, last week and month to date — so the seeded
 * screen can be drawn by the live screen itself. Keyed by salon number; the
 * name, district and Google store code come from the production roster.
 */
export interface DemoReviewGoalRow {
  salonNumber: string;
  qualifyingThisWeek: number;
  qualifyingLastWeek: number;
  qualifyingMonthToDate: number;
  averageRating: number;
  /** Reviews held in total, counted and historical alike. */
  held: number;
  /** Held and counted nowhere. */
  historical: number;
  /** False for a listing with no review baseline: it is "Not counting". */
  counting: boolean;
}

/*
 * The figures from the approved design artifact (October 2026): one salon over
 * the goal, one exactly on it, one at zero and one with no baseline, so every
 * state the leaderboard draws is on screen. Invented, every one of them.
 */
export const DEMO_REVIEW_METRICS: DemoReviewGoalRow[] = [
  { salonNumber: "0306", qualifyingThisWeek: 4, qualifyingLastWeek: 3, qualifyingMonthToDate: 10, averageRating: 4.71, held: 241, historical: 212, counting: true },
  { salonNumber: "0307", qualifyingThisWeek: 3, qualifyingLastWeek: 5, qualifyingMonthToDate: 12, averageRating: 4.82, held: 214, historical: 188, counting: true },
  { salonNumber: "0309", qualifyingThisWeek: 2, qualifyingLastWeek: 4, qualifyingMonthToDate: 8, averageRating: 4.66, held: 171, historical: 154, counting: true },
  { salonNumber: "0310", qualifyingThisWeek: 1, qualifyingLastWeek: 2, qualifyingMonthToDate: 5, averageRating: 4.58, held: 109, historical: 97, counting: true },
  { salonNumber: "0311", qualifyingThisWeek: 2, qualifyingLastWeek: 3, qualifyingMonthToDate: 7, averageRating: 4.74, held: 146, historical: 131, counting: true },
  { salonNumber: "0312", qualifyingThisWeek: 0, qualifyingLastWeek: 2, qualifyingMonthToDate: 3, averageRating: 4.49, held: 95, historical: 88, counting: true },
  { salonNumber: "0313", qualifyingThisWeek: 3, qualifyingLastWeek: 3, qualifyingMonthToDate: 8, averageRating: 4.77, held: 190, historical: 176, counting: true },
  { salonNumber: "0314", qualifyingThisWeek: 1, qualifyingLastWeek: 1, qualifyingMonthToDate: 2, averageRating: 4.31, held: 148, historical: 143, counting: true },
  { salonNumber: "0394", qualifyingThisWeek: 2, qualifyingLastWeek: 2, qualifyingMonthToDate: 5, averageRating: 4.69, held: 130, historical: 119, counting: true },
  { salonNumber: "0410", qualifyingThisWeek: 0, qualifyingLastWeek: 0, qualifyingMonthToDate: 0, averageRating: 4.52, held: 66, historical: 64, counting: true },
  { salonNumber: "0462", qualifyingThisWeek: 5, qualifyingLastWeek: 4, qualifyingMonthToDate: 11, averageRating: 4.88, held: 226, historical: 201, counting: true },
  { salonNumber: "0463", qualifyingThisWeek: 2, qualifyingLastWeek: 3, qualifyingMonthToDate: 6, averageRating: 4.61, held: 122, historical: 110, counting: true },
  { salonNumber: "0468", qualifyingThisWeek: 3, qualifyingLastWeek: 4, qualifyingMonthToDate: 9, averageRating: 4.79, held: 181, historical: 165, counting: true },
  { salonNumber: "0476", qualifyingThisWeek: 1, qualifyingLastWeek: 2, qualifyingMonthToDate: 4, averageRating: 4.55, held: 99, historical: 92, counting: true },
  { salonNumber: "0495", qualifyingThisWeek: 0, qualifyingLastWeek: 0, qualifyingMonthToDate: 0, averageRating: 4.63, held: 77, historical: 77, counting: false },
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
