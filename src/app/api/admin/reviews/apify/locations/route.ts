import { NextResponse } from "next/server";

import { AiError } from "@/lib/ai/errors";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import { parseJsonBody } from "@/lib/api/validation";
import { authorizeRequest } from "@/lib/auth/server";
import { safeMatches } from "@/lib/reviews/apify/discovery";
import {
  assignPlaces,
  promoteDiscoveredMatches,
  readLocationMappings,
  readPlaceIdFromInput,
  type PlaceAssignment,
} from "@/lib/reviews/apify/locations";
import { readSourceReconciliation } from "@/lib/reviews/apify/status";
import { startApifySync } from "@/lib/reviews/apify/sync";
import {
  resolveCallbackBaseUrl,
  webhookSecretForOutboundUse,
} from "@/lib/reviews/apify/webhook-credential";

/**
 * /api/admin/reviews/apify/locations — mapping the fifteen listings to Google.
 *
 * ============================================================================
 * THE OPERATOR SUPPLIES THE IDENTIFIER; THE SYSTEM CHECKS IT
 * ============================================================================
 *
 * That order is the whole safety property, and reversing it is the one design
 * that could quietly attach somebody else's business to a salon. A system that
 * searched "Sun Tan City Omaha" and took the best hit would be right most of
 * the time and silently wrong occasionally, and the occasion would surface as a
 * stranger's one-star review in a district manager's weekly number.
 *
 * So:
 *
 *   POST  saves what a person pasted — a Place ID, or a Maps URL containing
 *         one — as `pending_verification`. Pending listings take part in NO
 *         review run. Nothing has been trusted yet.
 *
 *   PUT   starts one cheap Apify run (one review per pending listing) that
 *         fetches Google's own name and address for each identifier, compares
 *         them against the roster's expected city and state, and writes
 *         `verified` or `rejected`. It imports no review.
 *
 *   GET   reports all fifteen, their state, and the Brave-versus-Apify
 *         reconciliation figures.
 *
 * Only `verified` listings are ever scraped. A listing that is unconfigured,
 * pending or rejected is skipped and REPORTED as skipped, so the status area
 * can say "13 / 15 configured" rather than a run silently covering thirteen
 * salons with everybody believing it covered fifteen.
 *
 * ============================================================================
 * THE GATE IS `manage_integrations`
 * ============================================================================
 *
 * Administration only — admin, owner, developer — the same gate the anchor
 * setup screen and the Integrations page use. `view_google_reviews`, which most
 * of the org chart holds, reads the dashboard and gets nowhere near this route:
 * changing which Google listing a salon IS changes every number that salon has.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Fifteen listings; a request naming more than that is not a mapping request. */
const MAX_ASSIGNMENTS = 20;

export async function GET(request: Request) {
  try {
    assertLiveMode();
    await authorizeRequest(request, "manage_integrations");

    const [locations, reconciliation] = await Promise.all([
      readLocationMappings(),
      readSourceReconciliation(),
    ]);

    return NextResponse.json({ status: "ok", locations, reconciliation });
  } catch (error) {
    return errorResponse(error, "admin/reviews/apify/locations");
  }
}

export async function POST(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ locations?: unknown }>(request);
    const raw = Array.isArray(body.locations) ? body.locations : null;

    if (!raw) {
      throw new AiError("bad_request", "The request must carry a list of locations.", 400);
    }
    if (raw.length > MAX_ASSIGNMENTS) {
      throw new AiError(
        "bad_request",
        `At most ${MAX_ASSIGNMENTS} listings may be mapped in one request.`,
        400,
      );
    }

    const assignments: PlaceAssignment[] = [];
    const unreadable: string[] = [];

    for (const entry of raw) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;

      const storeCode = typeof record.storeCode === "string" ? record.storeCode.trim() : "";
      const pasted = typeof record.place === "string" ? record.place.trim() : "";
      if (storeCode.length === 0 || pasted.length === 0) continue;

      const placeId = readPlaceIdFromInput(pasted);
      if (!placeId) {
        /*
         * NAMED, NOT SILENTLY DROPPED. A `/maps/place/…` URL without a
         * `place_id` in it carries a different kind of identifier, and an
         * operator who pastes one and is told nothing will reasonably conclude
         * it worked.
         */
        unreadable.push(storeCode);
        continue;
      }

      assignments.push({
        storeCode,
        placeId,
        /*
         * ALWAYS PENDING, WHATEVER THE REQUEST SAYS. There is no body field
         * that can write `verified`: that status means "Google's own answer was
         * checked against the roster", and a form post is not that. The only
         * path to `verified` is a verification run.
         */
        status: "pending_verification",
        mapsUrl: pasted.startsWith("https://") ? pasted.slice(0, 500) : null,
        note: `Entered by ${context.identity.email || context.identity.subject}; not yet checked against Google.`,
      });
    }

    const outcomes = await assignPlaces(assignments);

    return NextResponse.json({
      status: "ok",
      outcomes,
      unreadable,
      locations: await readLocationMappings(),
    });
  } catch (error) {
    return errorResponse(error, "admin/reviews/apify/locations");
  }
}

/**
 * PUT — start ONE setup run: discovery, or a check of pasted identifiers.
 *
 * ============================================================================
 * `discover` IS THE ONE THAT REPLACES FIFTEEN MANUAL PASTES
 * ============================================================================
 *
 * It searches Google Maps once per salon, from the roster ASK Sunny already
 * holds, and writes a PROPOSAL per listing. It attaches nothing: a proposal
 * lands in the `discovered_*` columns, and only `PATCH` — with a person behind
 * it — turns an unambiguous one into a mapping.
 *
 * `verify` is the older, narrower run: it takes identifiers somebody pasted by
 * hand and fetches Google's name and address for them. That path is kept as the
 * fallback for whatever discovery cannot resolve.
 *
 * Both go through the same single-run lock and the same daily budget, because
 * both are Actor runs and both cost. They use DIFFERENT Actors — discovery
 * searches and is priced per place; verification reads reviews and is priced
 * per review — which is why the Actor is chosen per run rather than globally.
 */
export async function PUT(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ mode?: unknown }>(request);
    const mode = typeof body.mode === "string" ? body.mode.trim() : "verify";

    if (mode !== "discover" && mode !== "verify") {
      throw new AiError(
        "bad_request",
        "A setup run is either `discover` or `verify`.",
        400,
      );
    }

    const baseUrl = resolveCallbackBaseUrl();
    if (!baseUrl) {
      throw new AiError(
        "bad_request",
        "NEXT_PUBLIC_SITE_URL is not set for this deployment, so Apify would have nowhere to report the finished run. Nothing has been started.",
        503,
      );
    }

    const result = await startApifySync({
      kind: mode === "discover" ? "location_discovery" : "location_resolution",
      requestedBy: `admin:${context.identity.email || context.identity.subject}`.slice(0, 120),
      baseUrl,
      webhookSecret: webhookSecretForOutboundUse(),
    });

    return NextResponse.json({ status: "ok", run: result });
  } catch (error) {
    return errorResponse(error, "admin/reviews/apify/locations");
  }
}

/**
 * PATCH — accept the discoveries that were unambiguous.
 *
 * ============================================================================
 * NO APIFY CALL, AND NO WAY TO ACCEPT AN UNSAFE ONE
 * ============================================================================
 *
 * The evidence was captured when the candidate was found, so confirming
 * fourteen locations is one database write rather than fourteen Actor runs.
 * That is what makes "Verify All Safe Matches" free to press.
 *
 * With no `storeCodes`, it accepts exactly the listings whose search concluded
 * `candidate_found` — one candidate, matching this salon's brand, city, state
 * and street hint, and matching no other salon. A store code sent by hand that
 * is not in that state is refused by the database function, not merely absent
 * from the button, so this cannot be widened by the caller.
 */
export async function PATCH(request: Request) {
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "manage_integrations");
    assertWithinRateLimit(request, "mutate");

    const body = await parseJsonBody<{ storeCodes?: unknown }>(request);
    const requested = Array.isArray(body.storeCodes)
      ? body.storeCodes.filter((code): code is string => typeof code === "string")
      : null;

    if (requested && requested.length > MAX_ASSIGNMENTS) {
      throw new AiError(
        "bad_request",
        `At most ${MAX_ASSIGNMENTS} listings may be confirmed in one request.`,
        400,
      );
    }

    const locations = await readLocationMappings();
    const safe = safeMatches(locations);
    const target = requested ?? safe;

    const outcomes = await promoteDiscoveredMatches(
      target,
      context.identity.email || context.identity.subject,
    );

    return NextResponse.json({
      status: "ok",
      outcomes,
      safeMatchCount: safe.length,
      locations: await readLocationMappings(),
    });
  } catch (error) {
    return errorResponse(error, "admin/reviews/apify/locations");
  }
}
