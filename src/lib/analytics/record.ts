import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope, Role } from "@/types";
import { logTurnEvent } from "./telemetry";
import type {
  ActivityCategory,
  ActivityFeature,
  ActivitySurface,
  ActivityTurnKind,
} from "./taxonomy";

/**
 * RECORDING AN ACT THAT WOULD OTHERWISE LEAVE NO TRACE.
 *
 * Called from the handlers whose work vanishes when the response is sent: a
 * chat answer, a knowledge search, a video play, a report analysis. NOT called
 * for filing a form, uploading a document or ingesting a workbook — each of
 * those already writes a durable, attributed row, and `activity_unified` counts
 * it where it lives. Recording those here too would be two counts of one act.
 *
 * NOTHING HERE CAN CARRY A QUESTION. `ActivityRecord` has no field for prompt,
 * answer or excerpt text, and the table has no column for one. That is the
 * guarantee, and it is structural rather than a convention callers have to
 * remember.
 */

export interface ActivityRecord {
  feature: ActivityFeature;
  category: ActivityCategory;
  actorId: string | null;
  actorRole: Role | null;
  /** The actor's own scope, which is where the salon attribution comes from. */
  scope?: AccessScope | null;
  succeeded?: boolean;
  latencyMs?: number | null;
  /**
   * WHERE IN THE APPLICATION THIS HAPPENED.
   *
   * Optional on the type so the recorders that predate surface tracking still
   * compile, and written as null rather than as a guess when it is absent — a
   * null reads as "not recorded" on the dashboard, which is true, where
   * defaulting to `main_chat` would file the Overview band's history under the
   * chat tab and make the first "where is Ask Sunny used?" chart confidently
   * wrong.
   */
  surface?: ActivitySurface | null;
  /**
   * Whether the turn carried a question or only an acknowledgement.
   *
   * Classified by the caller from text it holds in memory for the duration of
   * one request. THE TEXT NEVER ARRIVES HERE: this field is the classification,
   * and there is still no field on this type, and no column on the table, that
   * a question could be put in.
   */
  turnKind?: ActivityTurnKind | null;
}

/**
 * THE SALON, FROM THE ACCOUNT AND NOWHERE ELSE.
 *
 * `scope.primaryAreaId` is `loc-<salon_number>` — the application's own
 * authoritative account-to-location relationship. The raw value is stored and
 * the salon row is resolved from it at write time, so an event stays
 * attributable even for a location reporting has never seen.
 *
 * It is never derived from anything the person typed. A manager asking about
 * "the Wornall situation" is not evidence that they work at Wornall, and an
 * adoption dashboard built on that kind of inference reports fiction.
 */
function locationRefOf(scope: AccessScope | null | undefined): string | null {
  if (!scope || scope.level === "global") return null;
  const primary = scope.primaryAreaId?.trim();
  return primary && primary.length > 0 ? primary : null;
}

function salonNumberOf(locationRef: string | null): string | null {
  if (!locationRef) return null;
  const number = locationRef.replace(/^loc-/, "").trim();
  return number.length > 0 ? number : null;
}

/**
 * Write one event and return the id it was written under, or null if it was not
 * written. Never throws.
 *
 * AWAITED OR FLOATED IS THE CALLER'S DECISION, and it now genuinely differs.
 * A caller that needs to hand the turn's id back to the browser — every Ask
 * Sunny answer, so that its feedback has something to attach to — must await
 * this and accept one insert's latency. A caller that does not, floats it
 * through `recordActivityAsync` below and keeps the old trade.
 *
 * ANALYTICS MUST NOT BE ABLE TO BREAK THE PRODUCT. A failed insert here — a
 * network blip, a migration not yet applied on a given environment — would
 * otherwise turn "we could not record that you asked a question" into "your
 * question failed", which is an absurd trade for a dashboard. So the promise is
 * swallowed and logged, and the handler carries on.
 *
 * The corollary is stated rather than hidden: these counts are best-effort. An
 * event that fails to insert is an undercount, not a stalled request. For an
 * adoption dashboard that is the right side to err on; for anything anybody
 * bills against, it would not be, and nothing here should become that.
 */
export async function recordActivity(
  record: ActivityRecord,
): Promise<string | null> {
  /*
   * THE ID IS MINTED HERE, BEFORE THE INSERT, AND THAT IS WHAT MAKES FEEDBACK
   * POSSIBLE.
   *
   * A turn needs a name the server chose and the browser merely received —
   * otherwise "is this your answer to rate?" has no answer, because the only
   * other identifiers in play are the conversation and message ids the browser
   * minted for itself. Generating it up front means the caller can return it
   * with the answer and a later feedback write can be checked against the row
   * it names.
   *
   * `crypto.randomUUID` rather than letting Postgres default it: the value has
   * to exist before the round trip, not after.
   */
  const id = crypto.randomUUID();

  try {
    const supabase = getSupabaseAdmin();
    const locationRef = locationRefOf(record.scope);
    const salonNumber = salonNumberOf(locationRef);

    let salonId: string | null = null;
    if (salonNumber) {
      const { data } = await supabase
        .from("salons")
        .select("id")
        .eq("salon_number", salonNumber)
        .maybeSingle();
      salonId = (data?.id as string | undefined) ?? null;
    }

    const { error } = await supabase.from("activity_events").insert({
      id,
      actor_user_id: record.actorId,
      actor_role: record.actorRole,
      feature: record.feature,
      category: record.category,
      salon_id: salonId,
      location_ref: locationRef,
      succeeded: record.succeeded ?? true,
      latency_ms: record.latencyMs ?? null,
      surface: record.surface ?? null,
      turn_kind: record.turnKind ?? null,
    });

    /*
     * A REFUSED INSERT RETURNS NULL RATHER THAN THE ID IT WOULD HAVE HAD.
     *
     * supabase-js reports a constraint violation in `error` instead of
     * throwing, so without this check the happy path below would hand back an
     * id for a row that does not exist — and the feedback panel would render
     * against it, take a rating, and fail on save with nothing the user could
     * do about it. Better to return null and have the panel not appear.
     */
    if (error) {
      console.warn("[analytics] activity event not recorded", error.message);
      return null;
    }

    return id;
  } catch (error) {
    /*
     * Logged rather than rethrown, and deliberately not surfaced to the caller.
     * `console.warn` is what the rest of this codebase's non-fatal server paths
     * use; a dedicated alerting channel would be a decision, not a detail.
     */
    console.warn(
      "[analytics] activity event not recorded",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Fire-and-forget, for handlers whose event nobody needs to refer back to.
 *
 * NO LONGER THE CHAT ROUTE'S PATH, and the reason it changed is worth keeping.
 * Floating the insert was right while the event was write-only: the answer had
 * spent seconds at Anthropic and had nothing to gain from waiting on Supabase.
 * Feedback changed what the row is for. An answer now comes back carrying the
 * id of its own event, and a floated insert can be lost when the function
 * instance freezes — which would hand the browser an id for a row that never
 * landed, and the feedback panel would take a rating it could not save.
 *
 * So the turn-recording paths await. One insert against an indexed table, next
 * to a multi-second model call, is a cost worth paying for a feedback write
 * that either works or does not appear.
 *
 * ON SERVERLESS THE OLD TRADE STILL APPLIES TO THIS FUNCTION, and it is still
 * the right one for its callers: a function instance may be frozen once the
 * response is returned, so an insert still in flight can be lost. These counts
 * are best-effort and undercount rather than stall.
 */
export function recordActivityAsync(record: ActivityRecord): void {
  void recordActivity(record);
}

/* ==========================================================================
 * THE TURN LIFECYCLE — OPEN BEFORE THE ANSWER, CLOSE AFTER IT
 * ==========================================================================
 *
 * WHAT THIS REPLACES, AND THE PRODUCTION DEFECT THAT FORCED IT.
 *
 * The first version recorded the turn AFTER the model answered, bounded at
 * 1500ms so a slow Supabase could never delay an answer. Losing that race was
 * designed to cost only the feedback panel.
 *
 * It cost more than that, and the report says so exactly: the first Bed Usage
 * question of a session was answered with no feedback control and no gate, and
 * the second behaved perfectly. The reason is in `getSupabaseAdmin` — the
 * client is memoised per process, so the FIRST Supabase call on a cold
 * serverless instance pays client construction, DNS and a TLS handshake before
 * its insert, and every later call on that warm instance reuses the pooled
 * connection. A cold first write past 1500ms, a warm second write in single
 * digits. "Only the first answer" was never a coincidence.
 *
 * And the cost was not "no panel". It was an answer that could not be rated AND
 * was not gated — `feedbackDueOn` releases on a turn-less answer, because
 * trapping somebody in a conversation they have no way to rate is worse. So one
 * slow insert silently produced a fully functional, entirely untracked
 * conversation.
 *
 * THE FIX IS THE ORDERING, not a longer timeout. The row is now written BEFORE
 * the model is called:
 *
 *   - Its latency lands in the "thinking" phase, ahead of a multi-second model
 *     call, where one cold round trip is invisible.
 *   - If it cannot be written, the request is refused BEFORE any money is spent
 *     at Anthropic — and nothing is lost, because no answer was made.
 *   - Once an answer exists, its turn already exists. "Successful answer with
 *     no rateable turn" stops being a state the system can reach, rather than
 *     one it tries to avoid.
 *
 * `closeTurn` then refines the row with what only the answer knows. Losing that
 * costs precision — a coarser category — and never the turn.
 */

/**
 * How long the opening write may take before the request is refused.
 *
 * GENEROUS ON PURPOSE, AND THE OLD BUDGET IS WHY. 1500ms was chosen against a
 * warm insert and was beaten by a cold start on the first request to every new
 * instance. This has to clear DNS, TLS and client construction on a cold
 * instance without complaint, so it is set well above what that costs — the
 * bound exists to stop a HUNG connection hanging the request, not to police a
 * slow one.
 *
 * Exceeding it is now a refusal the caller can retry rather than a silent gap,
 * which is what makes a generous number safe.
 */
export const TURN_OPEN_TIMEOUT_MS = 8000;

/** Raised when the turn could not be opened. The route turns it into a refusal. */
export class TurnUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(
      "Ask Sunny could not start a recorded session, so nothing was asked. Please try again.",
    );
    this.name = "TurnUnavailableError";
    this.reason = reason;
  }
}

/**
 * Open a turn and return its id, or throw `TurnUnavailableError`.
 *
 * THE ONE FUNCTION IN THIS FILE THAT IS ALLOWED TO FAIL ITS CALLER, and it is
 * the reason the guarantee holds. Everything else here swallows and logs,
 * because analytics must never break the product; this one runs before the
 * product has done anything, so refusing costs a retry rather than an answer.
 *
 * The category it is given is PROVISIONAL — classified from the request alone,
 * because the answer does not exist yet. `closeTurn` refines it.
 */
export async function openTurn(record: ActivityRecord): Promise<string> {
  const startedAt = Date.now();
  logTurnEvent("turn.open.started", { surface: record.surface, where: record.feature });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new TurnUnavailableError("timeout")),
      TURN_OPEN_TIMEOUT_MS,
    );
  });

  try {
    const id = await Promise.race([recordActivity(record), deadline]);

    if (id === null) {
      logTurnEvent("turn.open.error", {
        surface: record.surface,
        durationMs: Date.now() - startedAt,
        reason: "insert refused",
      });
      throw new TurnUnavailableError("insert refused");
    }

    logTurnEvent("turn.open.succeeded", {
      turnId: id,
      surface: record.surface,
      durationMs: Date.now() - startedAt,
    });
    return id;
  } catch (error) {
    if (error instanceof TurnUnavailableError) {
      if (error.reason === "timeout") {
        logTurnEvent("turn.open.timeout", {
          surface: record.surface,
          durationMs: Date.now() - startedAt,
          budgetMs: TURN_OPEN_TIMEOUT_MS,
        });
      }
      throw error;
    }
    logTurnEvent("turn.open.error", {
      surface: record.surface,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new TurnUnavailableError("unexpected");
  } finally {
    /*
     * Cleared however this settles. A pending timer keeps a serverless instance
     * alive for its full duration, which would hold every fast request open for
     * eight seconds after it had already answered.
     */
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface TurnOutcome {
  /** The category the ANSWER revealed, which the request alone could not. */
  category: ActivityCategory;
  succeeded: boolean;
  latencyMs: number;
}

/**
 * Refine an open turn with what the answer revealed.
 *
 * BEST-EFFORT AND AWAITED-BUT-HARMLESS. The turn already exists and is already
 * rateable, so this failing costs a coarser category on one row — never the
 * answer, and never the feedback control. It is awaited rather than floated
 * only because the caller is about to return anyway and a floated write on
 * serverless is a write that may never happen.
 */
export async function closeTurn(
  turnId: string,
  outcome: TurnOutcome,
): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("activity_events")
      .update({
        category: outcome.category,
        succeeded: outcome.succeeded,
        latency_ms: outcome.latencyMs,
      })
      .eq("id", turnId);

    if (error) {
      logTurnEvent("turn.close.failed", { turnId, reason: error.message });
      return;
    }
    logTurnEvent("turn.close.succeeded", { turnId, durationMs: outcome.latencyMs });
  } catch (error) {
    logTurnEvent("turn.close.failed", {
      turnId,
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}
