import "server-only";

import { z } from "zod";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { reportBreakdownEnabled } from "@/lib/config/chat-quality-flags";
import { hasPermission, DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import { loadSalonPerformanceSection } from "@/lib/reporting/read/salon-performance-briefing-source";
import { loadSalesTotalsSection } from "@/lib/reporting/read/sales-totals-briefing-source";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { loadReviewsOverviewBlock } from "@/lib/reviews/overview-block-read";
import { loadRatingDistribution, loadReviewsSnapshot } from "@/lib/reviews/queries";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";
import type { AccessScope, Role } from "@/types";

import { passwordResetHelp } from "./app-help";
import { planReportBreakdown, type BreakdownPlan } from "./report-breakdown";
import { readFlaggedBreakdown } from "./report-breakdown-read";
import { callClaudeTool } from "./call-claude";
import {
  formatReviewSummaries,
  planDataRead,
  questionWantsData,
  storeCodesForSalonNumbers,
  type DataChoice,
  type ReviewSummaryLine,
} from "./chat-data-plan";

/**
 * Read-only salon data for one chat turn.
 *
 * Off, this returns empty and reads nothing. Sales totals and the Comp Report
 * the report router already briefed are not loaded again. Reviews come from
 * the same snapshot the reviews page uses, limited to the caller's listings.
 * An employee, who holds neither permission, gets neither. The Comp Report
 * read is the salon-performance briefing, which carries EFT revenue and the
 * other ingested comp measures.
 */

const choiceSchema = z.object({ read: z.enum(["reviews", "sales", "comp", "none"]) });

export interface ChatDataAddition {
  readonly help: string | null;
  readonly data: string | null;
}

const EMPTY: ChatDataAddition = { help: null, data: null };

async function chooseRead(question: string): Promise<DataChoice> {
  const raw = await callClaudeTool({
    model: CLAUDE_HAIKU_MODEL,
    maxTokens: 200,
    system:
      "Decide whether the question needs Google review counts, sales totals, or the Comp Report (EFT revenue and the other comp measures). Choose none when it needs none of them. Do not answer the question.",
    tool: {
      name: "choose_salon_data",
      description: "Which read-only salon dataset the question needs.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["read"],
        properties: { read: { type: "string", enum: ["reviews", "sales", "comp", "none"] } },
      },
    },
    messages: [{ role: "user", content: question }],
  });
  const parsed = choiceSchema.safeParse(raw);
  return parsed.success ? parsed.data.read : "none";
}

async function reviewLines(storeCodes: readonly string[]): Promise<ReviewSummaryLine[]> {
  const listings = GOOGLE_REVIEW_LOCATIONS.filter((entry) => storeCodes.includes(entry.storeCode));
  const lines: ReviewSummaryLine[] = [];
  for (const listing of listings.slice(0, 8)) {
    try {
      const snapshot = await loadReviewsSnapshot({ district: null, storeCode: listing.storeCode });
      lines.push({
        label: listing.googleLabel,
        storeCode: listing.storeCode,
        qualifyingThisWeek: snapshot.summary.qualifyingThisWeek,
        unanswered: snapshot.summary.unanswered,
        averageRating: snapshot.summary.averageRating,
        empty: snapshot.empty,
      });
    } catch {
      lines.push({
        label: listing.googleLabel,
        storeCode: listing.storeCode,
        qualifyingThisWeek: 0,
        unanswered: 0,
        averageRating: null,
        empty: true,
      });
    }
  }
  return lines;
}

/** The page total, said apart from the weekly qualifying count. */
export function reviewInventoryLine(total: number, scoped: boolean): string {
  const where = scoped ? " for the salons in this account" : "";
  return `The Google Reviews page holds ${total} reviews in total${where}. That is the inventory total, not the count of reviews that qualify this week.`;
}

async function reviewInventorySentence(storeCodes: readonly string[], unrestricted: boolean): Promise<string | null> {
  try {
    if (unrestricted) {
      const block = await loadReviewsOverviewBlock();
      if (block.status !== "ready") return null;
      return reviewInventoryLine(block.totalReviews, false);
    }
    let total = 0;
    for (const storeCode of storeCodes.slice(0, 8)) {
      const distribution = await loadRatingDistribution({ district: null, storeCode });
      total += distribution.total;
    }
    return reviewInventoryLine(total, true);
  } catch {
    return null;
  }
}

export async function loadChatDataBlock(input: {
  readonly enabled: boolean;
  readonly question: string;
  readonly role: Role | null;
  readonly scope: AccessScope | null;
  readonly briefedFamilies: readonly string[];
  /** GOOGLE_REVIEWS_IN_CHAT_ENABLED already attached the review block. */
  readonly reviewsHandled?: boolean;
  readonly choose?: () => Promise<DataChoice>;
  readonly readReviews?: (storeCodes: readonly string[]) => Promise<string | null>;
  readonly readSales?: () => Promise<string | null>;
  readonly readComp?: () => Promise<string | null>;
  readonly readBreakdown?: (plan: BreakdownPlan) => Promise<string>;
}): Promise<ChatDataAddition> {
  if (!input.enabled) return EMPTY;
  const help = passwordResetHelp(input.question);
  if (reportBreakdownEnabled()) {
    const plan = planReportBreakdown(input.question);
    if (plan.kind !== "none") {
      try {
        const data = input.readBreakdown
          ? await input.readBreakdown(plan)
          : await readFlaggedBreakdown({ plan, role: input.role, scope: input.scope });
        return { help, data };
      } catch {
        return { help, data: "The breakdown could not be read. No figures were estimated." };
      }
    }
  }
  const asked = questionWantsData(input.question);
  const wants = input.reviewsHandled ? { ...asked, reviews: false } : asked;
  if (!wants.reviews && !wants.sales && !wants.comp) return { help, data: null };

  let choice: DataChoice = "none";
  try {
    choice = input.choose ? await input.choose() : await chooseRead(input.question);
  } catch {
    choice = wants.reviews ? "reviews" : wants.comp ? "comp" : wants.sales ? "sales" : "none";
  }
  if (wants.comp && choice !== "reviews") choice = "comp";
  if (input.reviewsHandled && choice === "reviews") choice = wants.comp ? "comp" : wants.sales ? "sales" : "none";
  const planned = planDataRead({
    choice,
    canViewReviews:
      input.role !== null && hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_google_reviews"),
    canViewReports:
      input.role !== null && hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_reports"),
    salesAlreadyBriefed: input.briefedFamilies.includes("sales-totals"),
    compAlreadyBriefed: input.briefedFamilies.includes("salon-performance"),
  });
  if (planned === "none") return { help, data: null };

  if (planned === "comp") {
    try {
      const text = input.readComp
        ? await input.readComp()
        : (await loadSalonPerformanceSection(null, null, reportingScopeOf(input.scope)))?.text ?? null;
      return { help, data: text };
    } catch {
      return { help, data: null };
    }
  }

  if (planned === "reviews") {
    const scope = reportingScopeOf(input.scope);
    const storeCodes = scope.unrestricted
      ? GOOGLE_REVIEW_LOCATIONS.map((entry) => entry.storeCode)
      : storeCodesForSalonNumbers(scope.salonNumbers);
    if (storeCodes.length === 0) return { help, data: formatReviewSummaries([]) };
    try {
      const text = input.readReviews
        ? await input.readReviews(storeCodes)
        : formatReviewSummaries(await reviewLines(storeCodes));
      if (input.readReviews || !text) return { help, data: text };
      const inventory = await reviewInventorySentence(storeCodes, scope.unrestricted);
      return { help, data: inventory ? `${text}\n\n${inventory}` : text };
    } catch {
      return { help, data: null };
    }
  }

  try {
    const text = input.readSales
      ? await input.readSales()
      : (await loadSalesTotalsSection(null, null, reportingScopeOf(input.scope)))?.text ?? null;
    return { help, data: text };
  } catch {
    return { help, data: null };
  }
}
