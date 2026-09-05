import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { LIMITS, parseJsonBody, requireString } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import {
  analyzeSalesTotals,
  ANALYSIS_HISTORY_TURNS,
  ANALYSIS_QUESTION_LIMIT,
  ANALYSIS_TURN_LIMIT,
} from "@/lib/reporting/analysis/analyze-sales-totals";
import type {
  SalesTotalsAnalysisRequest,
  SalesTotalsAnalysisTurn,
} from "@/lib/reporting/analysis/types";

/**
 * POST /api/reporting/sales-totals/analyze
 *
 * "Ask Sunny about this report" for the Sales Totals dashboard.
 *
 * ============================================================================
 * THE GATE, AND WHY IT IS TWO PERMISSIONS AND NOT ONE
 * ============================================================================
 *
 * This endpoint requires `ask_questions` AND `view_reports`, checked
 * INDEPENDENTLY, and neither is inferred from the other.
 *
 * The reason is a specific role. Employee holds `ask_questions` — the frontline
 * team is meant to use Ask Sunny — and does NOT hold `view_reports`. A gate
 * written the obvious way, checking only "may this person use Ask Sunny", would
 * therefore have handed every Employee in the company a working endpoint that
 * returns salon-level sales figures they cannot open the dashboard to see. The
 * assistant would have become a way around the reporting permission.
 *
 * So the second check is not belt-and-braces. It is the check that matters, and
 * the first one is there because this is still Ask Sunny.
 *
 * ORDER IS PART OF THE DESIGN, same as /api/chat:
 *
 *   mode -> configuration -> ask_questions -> view_reports -> rate limit -> parse -> analyse
 *
 * Both permissions clear BEFORE the rate limiter, so an unauthorized caller
 * cannot spend an authorized colleague's budget, and both clear long before
 * `analyzeSalesTotals` — which reads the report and calls Anthropic. No
 * unauthorized request ever reaches paid model work, and none ever reaches a
 * database read of report figures either.
 *
 * WHAT COMES BACK ON FAILURE. `errorResponse` maps AuthError and AiError to
 * their own messages and anything else to a generic 500. None of the messages
 * this route can produce contains a figure, a salon name, or a report date the
 * caller did not themselves supply — see FAILURE_MESSAGES in the analyser. A
 * refused caller learns that they were refused, not what they were refused.
 *
 * ============================================================================
 * WHAT THIS GATE DOES NOT DO — STATED PLAINLY RATHER THAN IMPLIED
 * ============================================================================
 *
 * There is NO per-area row filtering here, because there is none anywhere in
 * the Sales Totals read path. `sales-totals-read.ts` runs server-side under the
 * secret key and its own header says so: "Who may OPEN a reporting screen is
 * decided by the page guard; what the screen may read is still a server-side
 * query. Per-person row filtering would be a different design and a different
 * migration."
 *
 * So `view_reports` is a DOOR, not a filter. Everyone who holds it sees the
 * same fifteen salons in the delivery, on the dashboard and through this
 * endpoint alike — this endpoint returns exactly the population the dashboard
 * already renders to the same person, and no more.
 *
 * This milestone did not invent an area mapping to close that gap. Region and
 * district assignments are not modelled against these salon numbers, and a
 * mapping guessed here would produce an authorization boundary that looked
 * enforced and was not. Narrowing reporting reads to a person's own area is
 * real work — a migration, a salon-to-area table, and a filter in the read
 * layer — and it is not claimed as done.
 *
 * WHAT THAT MEANS FOR WHO MAY BE GIVEN THIS. Preview QA runs on the global
 * Admin account, whose scope is the whole estate, so the gap changes nothing
 * for it. Employee is refused outright and stays refused: they hold
 * `ask_questions` and not `view_reports`.
 *
 * The roles in between — Salon Director, District Manager, Regional Manager —
 * DO hold `view_reports`, so enabling them against Sales Totals would today
 * give a salon-level manager every salon in the delivery rather than their own.
 * Per-area reporting scope is therefore a PREREQUISITE for those roles, not a
 * later refinement, and it is a limitation of the reporting read layer rather
 * than of this endpoint: the dashboard has exactly the same reach.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Salon numbers per request. Far above the fifteen a delivery carries. */
const MAX_SALON_IDS = 300;

/** A view fingerprint is a handful of short identifiers joined together. */
const FINGERPRINT_LIMIT = 4096;

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();

    // Two calls, not one call with two permissions, so that neither can be
    // satisfied by the other and a future edit to one leaves the other intact.
    await authorizeRequest(request, "ask_questions");
    await authorizeRequest(request, "view_reports");

    assertWithinRateLimit(request, "reportAnalysis");

    const body = await parseJsonBody<SalesTotalsAnalysisRequest>(request);
    const answer = await analyzeSalesTotals(parseAnalysisRequest(body));

    return NextResponse.json(answer);
  } catch (error) {
    return errorResponse(error, "POST /api/reporting/sales-totals/analyze");
  }
}

/**
 * Bounds everything that arrived from the browser.
 *
 * Every field is a POINTER AT DATA, never data. The salon ids are filtered to
 * strings and capped, and the resolver drops any that this snapshot does not
 * contain — so naming a salon outside the delivery cannot conjure a row for it,
 * it simply selects nothing.
 */
function parseAnalysisRequest(
  body: Partial<SalesTotalsAnalysisRequest>,
): SalesTotalsAnalysisRequest {
  return {
    question: requireString(body.question, "A question", ANALYSIS_QUESTION_LIMIT),
    reportDate: optionalToken(body.reportDate),
    window: optionalToken(body.window),
    estateSummaryKey: optionalToken(body.estateSummaryKey),
    metric: optionalToken(body.metric),
    salonIds: Array.isArray(body.salonIds)
      ? body.salonIds
          .filter((id): id is string => typeof id === "string")
          .map((id) => id.trim())
          .filter((id) => id.length > 0 && id.length <= LIMITS.tag)
          .slice(0, MAX_SALON_IDS)
      : null,
    history: parseHistory(body.history),
    /*
     * Carried through as an opaque token. It is only ever COMPARED, against a
     * fingerprint the server computes for itself from the rows it read, so a
     * caller sending a made-up value gets its history ignored rather than
     * honoured — and the value is never rendered, logged or echoed.
     */
    historyFingerprint:
      typeof body.historyFingerprint === "string" &&
      body.historyFingerprint.length <= FINGERPRINT_LIMIT
        ? body.historyFingerprint
        : null,
  };
}

/**
 * Prior turns, bounded here as well as in the analyser.
 *
 * Twice on purpose: the route is where untrusted shape is rejected, and the
 * analyser is where the rule holds for every caller including a future one that
 * does not come through this route. Neither bound relies on the other.
 */
function parseHistory(value: unknown): SalesTotalsAnalysisTurn[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (turn): turn is SalesTotalsAnalysisTurn =>
        Boolean(turn) &&
        typeof turn === "object" &&
        (turn as SalesTotalsAnalysisTurn).role !== undefined &&
        ((turn as SalesTotalsAnalysisTurn).role === "user" ||
          (turn as SalesTotalsAnalysisTurn).role === "assistant") &&
        typeof (turn as SalesTotalsAnalysisTurn).content === "string",
    )
    .slice(-ANALYSIS_HISTORY_TURNS)
    .map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, ANALYSIS_TURN_LIMIT),
    }));
}

/** A short identifier, or null. Never echoed back in any error. */
function optionalToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > LIMITS.tag) {
    throw new AiError("bad_request", "A report filter value is too long.", 400);
  }
  return trimmed;
}
