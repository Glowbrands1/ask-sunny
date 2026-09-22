import type { ActivitySurface } from "./taxonomy";

/**
 * TURN LIFECYCLE TELEMETRY.
 *
 * ============================================================================
 * WHY IT EXISTS
 * ============================================================================
 *
 * The first production defect in this feature was invisible from the outside: a
 * question was answered, no feedback panel appeared, and nothing anywhere said
 * why. The row eventually landed in `activity_events`, so the database looked
 * healthy; the browser had simply been handed an answer with no turn on it. The
 * only way to tell that state from "the user did not scroll down" was to
 * reproduce it.
 *
 * These events make the lifecycle legible: every turn says when it was opened,
 * whether it landed, how long it took, and — from the browser — whether the
 * thing that renders the feedback control actually got something to render.
 *
 * ============================================================================
 * IT CANNOT CARRY A QUESTION OR AN ANSWER
 * ============================================================================
 *
 * `TurnTelemetry` has no field for text and this module never accepts a free
 * string from a caller: every field below is an id, an enum, a boolean or a
 * duration. That is the same structural guarantee `ActivityRecord` makes, and
 * it is made the same way — by there being nowhere to put one.
 *
 * A LOG LINE IS NOT AN ANALYTICS TABLE. These go to the platform log, which is
 * operational and short-lived. Nothing here is read back by the dashboard;
 * `activity_events` remains the only record anything is counted from.
 *
 * Client-safe: no database client, no secret, no server-only import. The
 * browser emits the mount events and the server emits the rest.
 */

export type TurnEvent =
  /** A turn row is about to be written, before the model is called. */
  | "turn.open.started"
  /** The row landed. From here an answer is guaranteed to be rateable. */
  | "turn.open.succeeded"
  /** The write did not finish inside its budget. */
  | "turn.open.timeout"
  /** The write was refused or threw. */
  | "turn.open.error"
  /** The row was refined with the answer's category and outcome. */
  | "turn.close.succeeded"
  /** The refinement was lost. The turn survives; its category may be coarse. */
  | "turn.close.failed"
  /**
   * A successful answer left the server with no turn on it.
   *
   * THE DEFECT ITSELF, kept as an event so that if it ever happens again it is
   * one search rather than one reproduction. Under the current lifecycle it is
   * unreachable — the route refuses before answering — and an event here means
   * the guarantee has been broken by a later change.
   */
  | "turn.answer.missing_turn"
  /** The feedback control mounted and had a turn to attach to. */
  | "feedback.host.rateable"
  /** The feedback control mounted with nothing to attach to. */
  | "feedback.host.unrateable"
  /**
   * A proposal card tried to create a real form and the CREATE was refused.
   *
   * NOTHING EXISTS when this is emitted, which is what distinguishes it from
   * the event below. The manager sees the refusal on the card; this is so the
   * same refusal can be found without a reproduction — the Teams rollout
   * reported "create a form from this conversation" failing with nothing in any
   * log to say which half of the path gave way.
   */
  | "form.create.failed"
  /**
   * The row EXISTS and Sunny could not prefill it.
   *
   * A warning, never an error: the form is real, it is in Form Monitoring, and
   * the manager completes it by hand. Recorded separately because the operational
   * response is completely different — one is a broken create, the other is a
   * degraded draft.
   */
  | "form.draft.failed";

export interface TurnTelemetry {
  /** The server-minted turn id. An opaque uuid; never a conversation's content. */
  turnId?: string | null;
  /**
   * Which template a form event was about, as a LIBRARY KEY.
   *
   * A key names a published document — "coaching", "dpoa" — and is the same
   * value in every deployment. It is not an employee, not a salon and not
   * anything the manager typed, so it carries no more than the template list
   * already public to everyone who can open Forms.
   */
  templateKey?: string | null;
  surface?: ActivitySurface | null;
  /** Which route or host emitted this. */
  where?: string;
  durationMs?: number;
  budgetMs?: number;
  /**
   * A failure reason from the database driver.
   *
   * BOUNDED AND NEVER THE REQUEST. Supabase error messages describe the
   * connection or the constraint, not the row — and the row here carries no
   * text anyway. Truncated so a stack trace cannot turn one log line into a
   * page of them.
   */
  reason?: string;
}

const REASON_MAX = 200;

/**
 * Emit one structured line.
 *
 * JSON ON A SINGLE LINE because the destination is a platform log aggregator,
 * where a multi-line object becomes several unrelated entries and a
 * human-readable sentence becomes something nobody can filter on.
 *
 * `console.warn` for the failures and `console.info` for the rest, so the
 * default log level shows the problems without the traffic.
 */
export function logTurnEvent(event: TurnEvent, fields: TurnTelemetry = {}): void {
  const line = JSON.stringify({
    event,
    ...fields,
    reason: fields.reason ? fields.reason.slice(0, REASON_MAX) : undefined,
  });

  const isFailure =
    event === "turn.open.timeout" ||
    event === "turn.open.error" ||
    event === "turn.close.failed" ||
    event === "turn.answer.missing_turn" ||
    event === "feedback.host.unrateable" ||
    event === "form.create.failed" ||
    event === "form.draft.failed";

  if (isFailure) console.warn(line);
  else console.info(line);
}
