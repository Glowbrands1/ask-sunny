import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";

/**
 * Which read a data turn may perform.
 *
 * Sales totals and the Comp Report already reach chat through the report
 * briefing when the question routes to those families. This plan does not
 * load a family a second time. Google reviews are a separate table. A role
 * without the matching permission gets neither.
 */

const REVIEW = /\b(?:google\s+)?reviews?\b|\bstar ratings?\b|\breviewer\b/i;
const SALES = /\b(?:sales totals|revenue|grand total|ppta|per person|new customers?|sunless|efts?)\b/i;
/** Comp Report questions, including EFT revenue stated as part of that report. */
const COMP = /\bcomp report\b|\beft revenue\b|\befts?\b[\s\S]{0,40}\bcomp\b|\bcomp\b[\s\S]{0,40}\befts?\b/i;

export type DataChoice = "reviews" | "sales" | "comp" | "none";

export function questionWantsData(question: string): { reviews: boolean; sales: boolean; comp: boolean } {
  return { reviews: REVIEW.test(question), sales: SALES.test(question), comp: COMP.test(question) };
}

export function planDataRead(input: {
  readonly choice: DataChoice;
  readonly canViewReviews: boolean;
  readonly canViewReports: boolean;
  readonly salesAlreadyBriefed: boolean;
  readonly compAlreadyBriefed: boolean;
}): DataChoice {
  if (input.choice === "reviews" && input.canViewReviews) return "reviews";
  if (input.choice === "comp" && input.canViewReports && !input.compAlreadyBriefed) return "comp";
  if (input.choice === "sales" && input.canViewReports && !input.salesAlreadyBriefed) return "sales";
  return "none";
}

/** Google store codes for salon numbers. The two numbering systems are not the same. */
export function storeCodesForSalonNumbers(salonNumbers: readonly string[]): string[] {
  const wanted = new Set(salonNumbers);
  return GOOGLE_REVIEW_LOCATIONS.filter((entry) => wanted.has(entry.salonNumber)).map(
    (entry) => entry.storeCode,
  );
}

export interface ReviewSummaryLine {
  readonly label: string;
  readonly storeCode: string;
  readonly qualifyingThisWeek: number;
  readonly unanswered: number;
  readonly averageRating: number | null;
  readonly empty: boolean;
}

export function formatReviewSummaries(rows: readonly ReviewSummaryLine[]): string {
  if (rows.length === 0) {
    return "GOOGLE REVIEWS\n\nNo Google listing is assigned to this account.";
  }
  const lines = rows.map((row) => {
    if (row.empty) return `- ${row.label} (store ${row.storeCode}): no Google reviews are loaded.`;
    const average = row.averageRating === null ? "no average yet" : `average ${row.averageRating}`;
    return `- ${row.label} (store ${row.storeCode}): ${row.qualifyingThisWeek} qualifying this week, ${row.unanswered} unanswered, ${average}.`;
  });
  return `GOOGLE REVIEWS\n\nThese are the dashboard's weekly counts for listings this account may see.\n${lines.join("\n")}`;
}
