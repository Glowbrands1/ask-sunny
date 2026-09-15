import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope, Role } from "@/types";
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

/**
 * How long an answer may wait for its own event to be written.
 *
 * GENEROUS FOR AN INSERT, NEGLIGIBLE AGAINST A MODEL CALL. A single insert into
 * an indexed table is single-digit milliseconds; the answer it follows has just
 * spent seconds at Anthropic. Anything approaching this number means Supabase
 * is in trouble, and in that case the right behaviour is to ship the answer.
 */
const TURN_RECORD_TIMEOUT_MS = 1500;

/**
 * Record a turn and return its id, or give up and return null.
 *
 * ============================================================================
 * WHY THE DEADLINE EXISTS, AND WHAT IT IS PROTECTING
 * ============================================================================
 *
 * Awaiting the insert is what makes feedback possible — the browser needs the
 * turn's id — but it also put Supabase on the critical path of every Ask Sunny
 * answer for the first time. `recordActivity` swallows ERRORS, which is not the
 * same as bounding LATENCY: a connection that hangs rather than fails is not an
 * error, and without this the answer would wait on it.
 *
 * That trade is unacceptable in the one direction that matters. A manager must
 * never wait on an analytics write to read advice they are about to act on, and
 * they must never lose an answer because a dashboard could not be updated. So
 * the wait is bounded, and losing the race costs exactly one thing: the feedback
 * panel on that answer, because there is no id to attach a rating to.
 *
 * THE INSERT IS NOT CANCELLED WHEN THE DEADLINE WINS. It is still in flight and
 * will probably still land, which is the outcome we want — the event is counted
 * in the usage figures even though nobody was given the chance to rate it. An
 * unrated turn is an honest record; a lost one is an undercount.
 */
export async function recordTurn(record: ActivityRecord): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        `[analytics] turn not recorded within ${TURN_RECORD_TIMEOUT_MS}ms; answering without a feedback id`,
      );
      resolve(null);
    }, TURN_RECORD_TIMEOUT_MS);
  });

  try {
    /*
     * `recordActivity` cannot reject — it swallows and logs — so this race
     * settles either with an id, with null from a failed insert, or with null
     * from the deadline. There is no rejection path to leak.
     */
    return await Promise.race([recordActivity(record), deadline]);
  } finally {
    /*
     * CLEARED ON THE WAY OUT, including when the insert won. A pending timer
     * keeps a serverless instance alive for its full duration, which would make
     * every fast answer hold the function open for a second and a half.
     */
    if (timer !== undefined) clearTimeout(timer);
  }
}
