import "server-only";

import { NextResponse } from "next/server";

import { AiError, type AiErrorCode } from "@/lib/ai/errors";
import { TurnUnavailableError } from "@/lib/analytics/record";
import { AuthError } from "@/lib/auth/types";
import { ChatStoreError } from "@/lib/chat/errors";
import { isDemoMode } from "@/lib/config/runtime";
import { configurationProblems, MissingConfigurationError } from "@/lib/config/server-env";
import { EmbeddingError } from "@/lib/embeddings/types";
import { IngestionError } from "@/lib/ingestion/errors";
import { ReportValidationError } from "@/lib/reporting/ingest";
import { logRouteError, redact } from "./redact";
import {
  getRateLimiter,
  rateLimitKey,
  RATE_LIMITS,
  type RateLimitedRoute,
} from "./rate-limit";

/**
 * ONE ERROR-TO-RESPONSE MAPPING FOR EVERY ROUTE.
 *
 * Two rules this module exists to enforce, both of which are easy to break one
 * route at a time and impossible to break when there is a single door:
 *
 *   LOGGING — never a question, an answer, a grounding prompt, document text or
 *   any credential. Everything written passes through `redact()` first.
 *
 *   RESPONSES — a recognised error type carries a message written to be shown
 *   to a manager. Anything unrecognised becomes a generic 500, because an
 *   unexpected error's message can carry request content and must not be
 *   reflected back.
 */
export function errorResponse(error: unknown, route = "route"): NextResponse {
  /*
   * THE TURN COULD NOT BE OPENED, SO NOTHING WAS ASKED.
   *
   * Translated here rather than at each call site so every Ask Sunny route
   * reports it identically. It is a 503 because the cause is a dependency that
   * is momentarily unavailable rather than anything wrong with the request —
   * which is also why the client is told it is worth retrying. The `reason` is
   * logged and never returned: it names a connection, not a person, and an
   * error body is not where operational detail belongs.
   */
  if (error instanceof TurnUnavailableError) {
    console.warn(`[${route}] turn unavailable: ${error.reason}`);
    return NextResponse.json(
      { error: error.message, code: "turn_unavailable" satisfies AiErrorCode },
      { status: 503 },
    );
  }

  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message, code: error.code, missing: error.missing },
      { status: error.status },
    );
  }

  if (error instanceof AiError) {
    /*
     * A 429 SAYS WHEN, NOT JUST NO.
     *
     * The seconds were only ever in the message text, which meant a client that
     * wanted to wait had to parse English out of a sentence. They travel as a
     * real `Retry-After` header and as a field now — which is what lets a bulk
     * upload pause for the rest of the window and continue, instead of dropping
     * the files it had not reached yet.
     *
     * The BUDGET IS UNCHANGED. It caps spend at the embeddings vendor and it
     * should: the fix is a client that respects the limit, not a bigger limit.
     */
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        missing: error.missing,
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      },
      {
        status: error.status,
        headers:
          error.retryAfterSeconds === undefined
            ? undefined
            : { "Retry-After": String(error.retryAfterSeconds) },
      },
    );
  }

  if (error instanceof ChatStoreError) {
    /*
     * HISTORY COULD NOT BE READ OR WRITTEN, AND NOTHING WAS LOST. The
     * conversation is still in the person's own browser, which is what they are
     * reading; this says the account-wide copy is momentarily out of reach so
     * the sync layer backs off and tries again.
     *
     * The message is written for a manager and carries no row content — see
     * `lib/chat/store.ts`, which never surfaces or logs a Postgres message
     * because rows there hold what somebody asked about a named employee.
     */
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof MissingConfigurationError) {
    return NextResponse.json(
      { error: error.message, code: "not_configured", missing: error.missing },
      { status: 503 },
    );
  }

  if (error instanceof IngestionError) {
    // An ingestion message can quote an upstream database error, which for the
    // chunks table can include a fragment of a company document. Redacted on
    // the way out as well as on the way to the log.
    return NextResponse.json(
      { error: redact(error.message), code: error.code },
      { status: error.status },
    );
  }

  if (error instanceof ReportValidationError) {
    // A VALIDATION REFUSAL IS NOT AN INTERNAL ERROR, and letting it fall through
    // to the generic 500 is how one became undiagnosable: the route reported
    // "Something went wrong" for a gate that knew exactly what was wrong and had
    // a list of reasons ready. The problems are structural findings about the
    // report — metric codes, period shape, key collisions — and carry no figure
    // from the workbook, so they are safe to return.
    return NextResponse.json(
      {
        error: redact(error.message),
        code: "report_invalid",
        problems: error.problems.map((problem) => ({
          code: problem.code,
          message: redact(problem.message),
        })),
      },
      { status: error.status },
    );
  }

  if (error instanceof EmbeddingError) {
    return NextResponse.json(
      { error: redact(error.message), code: "embedding_failed" },
      { status: error.status },
    );
  }

  logRouteError(route, error);

  return NextResponse.json(
    { error: "Something went wrong. Nothing was answered or saved.", code: "internal" },
    { status: 500 },
  );
}

/**
 * Guard every live route runs first. Demo mode has no server dependencies, so a
 * live route firing while the app is in demo mode is a configuration mistake
 * worth naming rather than a request to serve a mock.
 *
 * Asks `isDemoMode()` rather than reading NEXT_PUBLIC_DEMO_MODE again. The
 * second reading was a real hazard, not a style point: it carried its own
 * comparison, so when the shared one learned to accept "False" this route guard
 * would have kept refusing the very deployments the app had just decided were
 * live — every live route 409ing while the UI rendered in live mode.
 */
export function assertLiveMode(): void {
  if (isDemoMode()) {
    throw new AiError(
      "not_configured",
      "Ask Sunny is running in demo mode. Set NEXT_PUBLIC_DEMO_MODE=false and configure the live services to use this endpoint.",
      409,
    );
  }
}

/**
 * Refuses to serve a request while a configuration problem stands.
 *
 * These are worse than a missing variable: the app would start and behave
 * strangely rather than obviously fail. Checked per request so a fix takes
 * effect on redeploy without a code change.
 */
export function assertNoConfigurationProblems(): void {
  const problems = configurationProblems();
  if (problems.length > 0) {
    throw new AiError("not_configured", problems.join(" "), 503);
  }
}

/**
 * Applies the route's rate limit, or throws.
 *
 * Deliberately before the expensive work and after the cheap guards, so a
 * client stuck in a retry loop stops burning Anthropic credits and Supabase
 * Edge Function invocations.
 */
export function assertWithinRateLimit(
  request: Request,
  route: RateLimitedRoute,
): void {
  const rule = RATE_LIMITS[route];
  const decision = getRateLimiter().check(rateLimitKey(request, route), rule);

  if (!decision.allowed) {
    throw new AiError(
      "bad_request",
      `Too many requests. Try again in ${decision.retryAfterSeconds} seconds.`,
      429,
      [],
      decision.retryAfterSeconds,
    );
  }
}
