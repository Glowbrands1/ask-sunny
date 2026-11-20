/**
 * ============================================================================
 * THE CARD'S CREATE EVENTS, AS THE SERVER LOG SEES THEM (QA, f073, 20 Nov 2026)
 * ============================================================================
 *
 * A "Create draft" press did nothing in production and nothing reached any log: the card's own events were written
 * to the browser console only. These four events are sent to `POST /api/telemetry/client-form`, which writes one
 * server log line per event, so the next press that does nothing shows whether it reached the handler, whether the
 * create request left, and which deploy the page came from.
 *
 * WHAT AN EVENT MAY CARRY, AND NOTHING ELSE: a name from the allow-list below, the card's proposal id (an opaque
 * generated id), the page's build deployment id, a whole number of milliseconds, and closed lists of reasons. No free
 * text, no names, no form content: a body with any other key, or a value outside these shapes, is refused whole.
 */

export const CLIENT_FORM_EVENTS = ["form.create.clicked", "form.create.sent", "form.create.answered", "form.create.failed"] as const;
export type ClientFormEventName = (typeof CLIENT_FORM_EVENTS)[number];

/** Why a click started nothing: a create already running (the button reads "Creating…"), or a replaced card. */
export const CLICK_IGNORED_REASONS = ["in_flight", "superseded"] as const;
/** How a create failed: no answer in time, the network lost it, the route refused it, or anything else. */
export const CREATE_FAILURE_KINDS = ["no_answer", "network", "refused", "other"] as const;

export interface ClientFormEvent {
  event: ClientFormEventName;
  proposalId: string;
  /** The deployment the page's code was built for; null outside Vercel. */
  deploymentId: string | null;
  /** Milliseconds since the click, for sent / answered / failed. */
  elapsedMs?: number;
  ignored?: (typeof CLICK_IGNORED_REASONS)[number];
  failure?: (typeof CREATE_FAILURE_KINDS)[number];
}

/** The largest body the route reads. A real event is under 250 bytes. */
export const CLIENT_FORM_EVENT_MAX_BYTES = 1_024;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KEYS = new Set(["event", "proposalId", "deploymentId", "elapsedMs", "ignored", "failure"]);

function oneOf<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** The event, when `body` is exactly one of the shapes above; null otherwise. */
export function parseClientFormEvent(body: unknown): ClientFormEvent | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !KEYS.has(key))) return null;
  if (!oneOf(CLIENT_FORM_EVENTS, record.event)) return null;
  if (typeof record.proposalId !== "string" || !ID.test(record.proposalId)) return null;
  const deploymentId = record.deploymentId ?? null;
  if (deploymentId !== null && (typeof deploymentId !== "string" || !ID.test(deploymentId))) return null;
  const event: ClientFormEvent = { event: record.event, proposalId: record.proposalId, deploymentId };
  if (record.elapsedMs !== undefined) {
    if (typeof record.elapsedMs !== "number" || !Number.isInteger(record.elapsedMs) || record.elapsedMs < 0 || record.elapsedMs > 600_000) return null;
    event.elapsedMs = record.elapsedMs;
  }
  if (record.ignored !== undefined) {
    if (!oneOf(CLICK_IGNORED_REASONS, record.ignored)) return null;
    event.ignored = record.ignored;
  }
  if (record.failure !== undefined) {
    if (!oneOf(CREATE_FAILURE_KINDS, record.failure)) return null;
    event.failure = record.failure;
  }
  return event;
}

/** A create error, as one of the closed failure kinds (never its words). */
export function createFailureKind(error: unknown): (typeof CREATE_FAILURE_KINDS)[number] {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === "CreateNoAnswerError" || name === "AbortError") return "no_answer";
  if (error instanceof TypeError || name === "TypeError") return "network";
  if (name === "FormsFetchError") return "refused";
  return "other";
}
