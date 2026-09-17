import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import { errorResponse } from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import {
  SUPABASE_URL_ENV,
  supabaseSecretKeyConfigured,
} from "@/lib/config/server-env";
import { ingestGoogleReviews, MAX_REVIEWS_PER_SYNC } from "@/lib/reviews/ingest";
import { ALLOWED_STORE_CODES } from "@/lib/reviews/store-codes";
import {
  authorizeReviewSync,
  REVIEW_SYNC_SECRET_ENV,
  reviewSyncCredentialConfigured,
  reviewSyncConfigurationProblem,
} from "@/lib/reviews/sync-credential";

/**
 * POST /api/reviews/ingest — the Brave extension files Google reviews here.
 * GET  /api/reviews/ingest — readiness, for wiring the extension up.
 *
 * ============================================================================
 * THE SHAPE OF THE WHOLE THING, SO THE BOUNDARIES ARE VISIBLE
 * ============================================================================
 *
 *   Google Business Profile Reviews page, in the manager's own signed-in Brave
 *     -> content script reads what Google has already rendered
 *     -> background service worker adds the sync token and posts here
 *     -> this route authenticates the MACHINE, validates, and calls
 *        `ingest_google_reviews` in one transaction
 *     -> Supabase
 *     -> the ASK Sunny Google Reviews dashboard
 *
 * THE EXTENSION NEVER TOUCHES SUPABASE. It holds no database URL, no
 * publishable key, no secret key — only a revocable token that can do exactly
 * one thing. That is the whole reason this route exists rather than the
 * extension writing directly.
 *
 * NO GOOGLE CREDENTIAL EXISTS ANYWHERE IN THIS PATH. The extension reads a page
 * an authorized person is already looking at. It does not log in, hold a
 * cookie, read a token, or know that Google has accounts.
 *
 * ============================================================================
 * WHY A MACHINE CREDENTIAL AND NOT `authorizeRequest`
 * ============================================================================
 *
 * The same answer `/api/reporting/intake` gives, recorded in
 * `docs/architecture-constraints.md` §2. `authorizeRequest()` asks "which
 * person is this?" — a question a background service worker has no answer to.
 * The alternative would be carrying the manager's real ASK Sunny session into a
 * document Google controls, which is strictly worse than a narrow token that
 * files reviews and can do nothing else. See `lib/reviews/sync-credential.ts`.
 *
 * ============================================================================
 * THE ORDER OF THE CHECKS IS THE SECURITY MODEL
 * ============================================================================
 *
 *   1. Supabase configured, so a runtime that cannot store anything says so
 *      rather than accepting a payload it will drop.
 *   2. The credential — configuration, then rate limit, then constant-time
 *      comparison. Before the body is read, so an unauthorized caller cannot
 *      make us parse half a megabyte of JSON.
 *   3. The payload shape, bounded.
 *   4. The store-code allowlist, here and again in the database.
 *
 * NOTHING FROM THE PAYLOAD IS LOGGED. Not a reviewer name, not review text, not
 * an owner response. The counts and the refusal codes are the whole record, and
 * `google_review_sync_runs` has no column that could hold anything else.
 *
 * ============================================================================
 * CORS, DELIBERATELY ABSENT
 * ============================================================================
 *
 * There is no `Access-Control-Allow-Origin` here and there must not be. The
 * extension calls from its background service worker under a host permission,
 * which is not subject to CORS — so the browser's own rules keep every ordinary
 * web page, including the Google page the content script runs in, from ever
 * reaching this endpoint with a token.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness, unauthenticated and value-free.
 *
 * Reports WHETHER each variable is configured, never its value and never a
 * digest of one — the same posture `/api/reporting/inbound-email` takes. The
 * store codes are not a secret: they are printed on the storefronts.
 */
export async function GET() {
  return NextResponse.json({
    endpoint: "/api/reviews/ingest",
    method: "POST",
    authorization: "Bearer <token>",
    maxReviewsPerSync: MAX_REVIEWS_PER_SYNC,
    allowedStoreCodes: ALLOWED_STORE_CODES,
    configured: {
      [REVIEW_SYNC_SECRET_ENV]: reviewSyncCredentialConfigured(),
      supabaseUrl: Boolean(process.env[SUPABASE_URL_ENV]),
      supabaseSecret: supabaseSecretKeyConfigured(),
    },
    /* Operator-facing and value-free. Null when nothing is wrong. */
    problem: reviewSyncConfigurationProblem(),
  });
}

export async function POST(request: Request) {
  try {
    if (!process.env[SUPABASE_URL_ENV] || !supabaseSecretKeyConfigured()) {
      return NextResponse.json(
        {
          status: "not_configured",
          code: "supabase_missing",
          reason:
            "Supabase is not configured in this runtime, so no review can be stored.",
        },
        { status: 503 },
      );
    }

    const auth = await authorizeReviewSync(request.headers);

    if (auth.status === "unconfigured") {
      /*
       * 503 and not 401: this is our gap rather than the caller's, and it is
       * the one refusal a retry will fix once somebody sets the variable. The
       * reason names the variable and no value.
       */
      return NextResponse.json(
        { status: "not_configured", code: "sync_token_missing", reason: auth.problem },
        { status: 503 },
      );
    }

    if (auth.status === "rate_limited") {
      return NextResponse.json(
        {
          status: "rate_limited",
          code: "too_many_attempts",
          reason: `Too many failed attempts. Try again in ${auth.retryAfterSeconds} seconds.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(auth.retryAfterSeconds) },
        },
      );
    }

    if (auth.status === "unauthorized") {
      /*
       * ONE ANSWER FOR EVERY FAILURE. A missing header, a wrong token and a
       * revoked token are indistinguishable to the caller — telling a prober
       * which half to fix is the whole of what a specific message buys them.
       */
      return NextResponse.json(
        {
          status: "unauthorized",
          code: "invalid_token",
          reason:
            "This sync token is not accepted. Check the token in the extension's Options page.",
        },
        { status: 401 },
      );
    }

    const body = await parseJsonBody<{ reviews?: unknown; parserVersion?: unknown }>(
      request,
    );

    const parserVersion =
      typeof body.parserVersion === "string" && body.parserVersion.trim().length > 0
        ? body.parserVersion.trim().slice(0, 40)
        : null;

    if (!parserVersion) {
      /*
       * REQUIRED, not defaulted. Google's markup changes, and when a field
       * starts coming back wrong the only way to find which records to re-check
       * is to know which parser read them. A default would quietly attribute a
       * broken parser's output to whatever the server happened to believe.
       */
      throw new AiError(
        "bad_request",
        "The sync must name the parser version that read the page.",
        400,
      );
    }

    const result = await ingestGoogleReviews(body.reviews ?? [], {
      parserVersion,
      credentialId: auth.credentialId,
    });

    /*
     * The credential ID is echoed because it is an audit label rather than a
     * secret, and seeing it in the extension's own results is how somebody
     * confirms which credential a laptop is using before revoking the other.
     */
    return NextResponse.json({ status: "ok", credentialId: auth.credentialId, ...result });
  } catch (error) {
    return errorResponse(error, "reviews/ingest");
  }
}
