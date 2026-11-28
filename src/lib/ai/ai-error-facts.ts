/**
 * ============================================================================
 * WHAT A FAILED MODEL CALL SAYS ABOUT ITSELF (audit, 28 Nov 2026)
 * ============================================================================
 *
 * Two clients raise errors here, and they name the same facts differently:
 *
 *   - the Anthropic SDK: `status` and the body's `error.type`;
 *   - the AI SDK (the agent loop's `streamText`): `statusCode`, `isRetryable`,
 *     a readable `name` ("AI_APICallError"), the body as `data` or as the JSON
 *     string `responseBody`, and, once its retries are spent, an
 *     "AI_RetryError" whose `lastError` is the real one.
 *
 * Reading only `status` and the class name logged the agent loop's failures on
 * 23 Nov 2026 as `error=aG` (a minified class name): no status, no type, nothing
 * to act on; and an overloaded 529 never got the "busy, try again" wording.
 *
 * Only codes and type names are read. Never a message: it can echo the request.
 */

export interface AiErrorFacts {
  /** The HTTP status, from `status` or `statusCode`. */
  readonly status: number | null;
  /** The API's error type, e.g. "overloaded_error". */
  readonly type: string | null;
  /** A readable name: `name` unless it is the generic "Error", else the class name. */
  readonly name: string | null;
  /** The AI SDK's own retry verdict, when it gave one. */
  readonly retryable: boolean | null;
  /** True when the facts came from inside an AI SDK RetryError. */
  readonly afterRetries: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function typeFromBody(body: unknown): string | null {
  const parsed = typeof body === "string" ? safeJson(body) : body;
  const error = record(record(parsed)?.error);
  return typeof error?.type === "string" ? error.type : null;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function aiErrorFacts(error: unknown): AiErrorFacts {
  const outer = record(error);
  // An AI SDK RetryError wraps the last real failure.
  const afterRetries = outer?.name === "AI_RetryError" && record(outer.lastError) !== null;
  const inner = afterRetries ? record(outer!.lastError) : outer;
  if (!inner) {
    return { status: null, type: null, name: typeof error === "string" ? error : null, retryable: null, afterRetries: false };
  }
  const status =
    typeof inner.status === "number" ? inner.status : typeof inner.statusCode === "number" ? inner.statusCode : null;
  const type = typeFromBody(inner) ?? typeFromBody(inner.data) ?? typeFromBody(inner.responseBody);
  const ownName = typeof inner.name === "string" && inner.name !== "Error" ? inner.name : null;
  const ctor = inner.constructor as { name?: unknown } | undefined;
  const className = ctor && ctor !== Object && typeof ctor.name === "string" && ctor.name ? ctor.name : null;
  const name = ownName ?? className ?? (typeof inner.name === "string" ? inner.name : null);
  const retryable = typeof inner.isRetryable === "boolean" ? inner.isRetryable : null;
  return { status, type, name, retryable, afterRetries };
}

/** An overloaded API, however the client says so. */
export function isOverloadedError(error: unknown): boolean {
  const facts = aiErrorFacts(error);
  return facts.status === 529 || facts.type === "overloaded_error";
}
