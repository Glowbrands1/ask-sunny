import "server-only";

import { z } from "zod";

import { CLAUDE_HAIKU_MODEL } from "@/lib/config/models";
import { hasPermission, DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import { loadSalesTotalsSection } from "@/lib/reporting/read/sales-totals-briefing-source";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { loadReviewsSnapshot } from "@/lib/reviews/queries";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";
import type { AccessScope, Role } from "@/types";

import { passwordResetHelp } from "./app-help";
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
 * Off, this returns empty and reads nothing. Sales figures the report router
 * already briefed are not loaded again. Reviews come from the same snapshot
 * the reviews page uses, limited to the caller's listings. An employee, who
 * holds neither permission, gets neither.
 */

const choiceSchema = z.object({ read: z.enum(["reviews", "sales", "none"]) });

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
      "Decide whether the question needs Google review counts or sales totals. Choose none when it needs neither. Do not answer the question.",
    tool: {
      name: "choose_salon_data",
      description: "Which read-only salon dataset the question needs.",
      input_schema: {
        type: "object",
        additionalProperties: false,
        required: ["read"],
        properties: { read: { type: "string", enum: ["reviews", "sales", "none"] } },
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

export async function loadChatDataBlock(input: {
  readonly enabled: boolean;
  readonly question: string;
  readonly role: Role | null;
  readonly scope: AccessScope | null;
  readonly briefedFamilies: readonly string[];
  readonly choose?: () => Promise<DataChoice>;
  readonly readReviews?: (storeCodes: readonly string[]) => Promise<string | null>;
  readonly readSales?: () => Promise<string | null>;
}): Promise<ChatDataAddition> {
  if (!input.enabled) return EMPTY;
  const help = passwordResetHelp(input.question);
  const wants = questionWantsData(input.question);
  if (!wants.reviews && !wants.sales) return { help, data: null };

  let choice: DataChoice = "none";
  try {
    choice = input.choose ? await input.choose() : await chooseRead(input.question);
  } catch {
    choice = wants.reviews ? "reviews" : wants.sales ? "sales" : "none";
  }
  const planned = planDataRead({
    choice,
    canViewReviews:
      input.role !== null && hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_google_reviews"),
    canViewReports:
      input.role !== null && hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_reports"),
    salesAlreadyBriefed: input.briefedFamilies.includes("sales-totals"),
  });
  if (planned === "none") return { help, data: null };

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
      return { help, data: text };
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
