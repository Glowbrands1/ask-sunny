import "server-only";

import { AiError } from "@/lib/ai/errors";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { isAllowedStoreCode } from "./store-codes";

/**
 * SETTING A LISTING'S REPORTING ANCHOR — the manual process, mechanised.
 *
 * ============================================================================
 * WHY THIS EXISTS AT ALL
 * ============================================================================
 *
 * Nothing counts until a listing has a boundary. That is the safety property
 * the reporting fix rests on: an import lands as historical, and stays there
 * until somebody says where last week's count ended. This is how they say it,
 * and there are exactly two ways:
 *
 *   EXPLICIT — "the last review we counted at KS Manhattan was this one." The
 *   old spreadsheet records the reviewer's name; the operator finds that review
 *   in the feed and names its Google id. Everything held above it, on the page
 *   where it was seen, becomes the open period's. This is the migration path
 *   for a business that has been counting by hand.
 *
 *   BASELINE — "everything we currently hold is history; start counting from
 *   the next one." It assigns nothing at all, which makes it the safe way to
 *   start a listing whose history nobody wants to reconstruct.
 *
 * ============================================================================
 * AN EXISTING ANCHOR IS NEVER REPLACED SILENTLY
 * ============================================================================
 *
 * Moving a listing's anchor changes what the business counts. It cannot
 * un-count anything — `reporting_period_id` is write-once once set — but it can
 * promote reviews that should have stayed historical, and it moves the line the
 * next sync measures from. So a listing that already has one is REFUSED unless
 * the caller says `replace: true`, and that flag exists to be typed by a person
 * who has been shown the current anchor and warned. The refusal is here, on the
 * server, rather than only in the screen that offers the button.
 *
 * ============================================================================
 * WHY POSITION AND NOT TIME
 * ============================================================================
 *
 * Google's relative text is bucketed — "2 days ago" covers a whole Tuesday — so
 * a timestamp comparison cannot separate two reviews from the same day, and a
 * miscount in either direction is the thing this whole design is avoiding. Feed
 * position within one sync run is exact. Anything not seen in the same run as
 * the anchor is left historical and reported rather than guessed at.
 */

export interface AnchorRequest {
  storeCode: string;
  /** Google's review id. Omit with `fromNewestHeld` to take a baseline. */
  externalReviewId?: string | null;
  /** Draw the line at the newest review held and assign nothing. */
  fromNewestHeld?: boolean;
  /**
   * Move an anchor this listing already has.
   *
   * Absent or false means "only if it has none" — so a bulk baseline cannot
   * touch a listing somebody has already set up, and a second click on a stale
   * screen cannot move a line that moved while it was open.
   */
  replace?: boolean;
}

export interface AnchorOutcome {
  storeCode: string;
  status:
    | "anchor_set"
    | "baseline_set"
    | "unknown_store"
    | "review_not_held"
    | "nothing_held"
    /** Already anchored, and the caller did not ask to replace it. */
    | "anchor_exists";
  anchorReviewId?: string | null;
  anchorReviewer?: string | null;
  /** Held reviews promoted into the open period by this call. */
  assignedAbove?: number;
  /** Held reviews left historical because they were not comparable. */
  leftHistorical?: number;
}

/** Matches the database's own `google_reviews_external_id_format`. */
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

/** At most one call per listing, so one request cannot rewrite the estate. */
export const MAX_ANCHORS_PER_REQUEST = 15;

/**
 * Validates the request, or throws. Exported for the tests, which are the
 * point: each refusal is a rule somebody could otherwise loosen.
 */
export function normaliseAnchorRequests(raw: unknown): AnchorRequest[] {
  if (!Array.isArray(raw)) {
    throw new AiError("bad_request", "The request must carry a list of anchors.", 400);
  }
  if (raw.length === 0) {
    throw new AiError("bad_request", "Name at least one store code.", 400);
  }
  if (raw.length > MAX_ANCHORS_PER_REQUEST) {
    throw new AiError(
      "bad_request",
      `At most ${MAX_ANCHORS_PER_REQUEST} listings may be anchored in one request.`,
      400,
    );
  }

  const seen = new Set<string>();
  return raw.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new AiError("bad_request", "Each anchor must be an object.", 400);
    }
    const record = entry as Record<string, unknown>;

    const storeCode = typeof record.storeCode === "string" ? record.storeCode.trim() : "";
    if (!isAllowedStoreCode(storeCode)) {
      /*
       * REFUSED RATHER THAN IGNORED, unlike an unknown store in a review batch.
       * A sync carrying Buff City Soap is a normal Tuesday; a person typing a
       * store code that is not one of the fifteen has made a mistake, and
       * silently accepting it would leave them believing a salon was anchored.
       */
      throw new AiError("bad_request", "That is not one of the fifteen store codes.", 400);
    }
    if (seen.has(storeCode)) {
      throw new AiError("bad_request", "A listing may appear only once per request.", 400);
    }
    seen.add(storeCode);

    const fromNewestHeld = record.fromNewestHeld === true;
    const externalReviewId =
      typeof record.externalReviewId === "string" ? record.externalReviewId.trim() : "";

    const replace = record.replace === true;

    if (fromNewestHeld) return { storeCode, fromNewestHeld: true, replace };

    if (!EXTERNAL_ID_PATTERN.test(externalReviewId)) {
      throw new AiError(
        "bad_request",
        "Give a Google review id, or ask for a baseline from the newest review held.",
        400,
      );
    }
    return { storeCode, externalReviewId, replace };
  });
}

/**
 * Applies the anchors.
 *
 * One database call per listing, because each is a separate decision with a
 * separate outcome and a partial success is a real and useful answer: anchoring
 * fourteen listings and reporting that the fifteenth named a review we do not
 * hold is better than refusing all fifteen.
 */
export async function applyAnchors(
  requests: AnchorRequest[],
  options: { credentialId: string | null },
): Promise<AnchorOutcome[]> {
  const supabase = getSupabaseAdmin();
  const outcomes: AnchorOutcome[] = [];

  /*
   * WHICH LISTINGS ALREADY HAVE ONE, read once before anything is written. A
   * request that would move an existing anchor without saying so is refused
   * here rather than in the database, because the answer the caller needs is
   * "this one already has an anchor, here it is" — not a constraint violation.
   */
  const existing = new Map<string, string | null>();
  const { data: current, error: currentError } = await supabase
    .from("google_review_locations")
    .select("store_code,counted_through_external_review_id")
    .in(
      "store_code",
      requests.map((request) => request.storeCode),
    );

  if (currentError) {
    console.error("[reviews/anchor] could not read the anchors", currentError.code ?? "unknown");
    throw new AiError(
      "bad_request",
      "The anchors could not be set. Nothing partial has been stored.",
      502,
    );
  }

  for (const row of (current ?? []) as {
    store_code: string;
    counted_through_external_review_id: string | null;
  }[]) {
    existing.set(row.store_code, row.counted_through_external_review_id);
  }

  for (const request of requests) {
    const alreadyAnchored = existing.get(request.storeCode) ?? null;
    if (alreadyAnchored !== null && request.replace !== true) {
      outcomes.push({
        storeCode: request.storeCode,
        status: "anchor_exists",
        anchorReviewId: alreadyAnchored,
        assignedAbove: 0,
        leftHistorical: 0,
      });
      continue;
    }

    const { data, error } = request.fromNewestHeld
      ? await supabase.rpc("google_review_baseline_anchor", {
          p_store_code: request.storeCode,
          p_credential_id: options.credentialId,
        })
      : await supabase.rpc("google_review_set_anchor", {
          p_store_code: request.storeCode,
          p_external_review_id: request.externalReviewId,
          p_credential_id: options.credentialId,
        });

    if (error) {
      /*
       * Not reflected back. A Postgres message can carry a constraint name and
       * occasionally a value from the offending row, and the offending row here
       * holds somebody's review.
       */
      console.error("[reviews/anchor] database refused an anchor", error.code ?? "unknown");
      throw new AiError(
        "bad_request",
        "The anchors could not be set. Nothing partial has been stored.",
        502,
      );
    }

    const result = (data ?? {}) as Record<string, unknown>;
    outcomes.push({
      storeCode: request.storeCode,
      status: (result.status as AnchorOutcome["status"]) ?? "unknown_store",
      anchorReviewId:
        typeof result.anchorReviewId === "string" ? result.anchorReviewId : null,
      anchorReviewer:
        typeof result.anchorReviewer === "string" ? result.anchorReviewer : null,
      assignedAbove: typeof result.assignedAbove === "number" ? result.assignedAbove : 0,
      leftHistorical:
        typeof result.leftHistorical === "number" ? result.leftHistorical : 0,
    });
  }

  return outcomes;
}
