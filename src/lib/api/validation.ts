import "server-only";

import { AiError } from "@/lib/ai/errors";

/**
 * CENTRALIZED REQUEST VALIDATION.
 *
 * Every value that arrives from a browser is untrusted and is bounded here
 * rather than at each call site, so a new route cannot forget a check that an
 * older one remembered.
 *
 * Every helper throws `AiError("bad_request", ...)` with a message safe to show
 * a manager, and never echoes the offending value back — a rejection message
 * that quotes its input is how a reflection bug starts.
 */

/** Scope ids are internal identifiers, never free text. */
const SCOPE_ID = /^[a-z0-9-]{1,64}$/i;
/** UUIDs as Postgres generates them. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Prototype ids (`kb_abc123`) so demo records round-trip through the API too. */
const PROTOTYPE_ID = /^[a-z]{2,6}_[a-z0-9]{4,32}$/i;

export const LIMITS = {
  question: 4000,
  searchQuery: 2000,
  title: 300,
  description: 2000,
  personName: 120,
  tag: 48,
  tagCount: 24,
  historyTurns: 20,
  documentIds: 20,
} as const;

function reject(message: string): never {
  throw new AiError("bad_request", message, 400);
}

/** Parses a JSON body, or rejects. Never returns undefined. */
export async function parseJsonBody<T>(request: Request): Promise<Partial<T>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    reject("The request body could not be read.");
  }
  return body as Partial<T>;
}

export function requireString(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || !value.trim()) {
    reject(`${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    reject(`${field} is too long. The limit is ${maxLength} characters.`);
  }
  return trimmed;
}

export function optionalString(
  value: unknown,
  maxLength: number,
  fallback = "",
): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maxLength);
}

export function requireScopeId(value: unknown): string {
  if (typeof value !== "string" || !SCOPE_ID.test(value.trim())) {
    reject("A valid knowledge scope is required.");
  }
  return value.trim();
}

/**
 * Document ids come from a URL path, so they are validated against the two
 * shapes this system actually issues rather than passed through. Anything else
 * — a path fragment, an injection attempt, an id from another system — is
 * rejected before it reaches a query.
 */
export function requireDocumentId(value: unknown): string {
  if (typeof value !== "string") reject("A document id is required.");
  const trimmed = value.trim();
  if (!UUID.test(trimmed) && !PROTOTYPE_ID.test(trimmed)) {
    reject("That is not a valid document id.");
  }
  return trimmed;
}

export function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Bounded integer, clamped rather than rejected — a big number is not an attack. */
export function boundedInt(
  value: unknown,
  { min, max, fallback }: { min: number; max: number; fallback: number },
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/** Comma-separated tags: trimmed, lowercased, de-duplicated and capped. */
export function parseTags(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  for (const raw of value.split(",")) {
    const tag = raw.trim().toLowerCase().slice(0, LIMITS.tag);
    if (tag) seen.add(tag);
    if (seen.size >= LIMITS.tagCount) break;
  }
  return [...seen];
}

/** Chat history, filtered to well-formed turns and capped to the recent tail. */
export function parseHistory(
  value: unknown,
): { role: "user" | "assistant"; content: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is { role: "user" | "assistant"; content: string } =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as { content?: unknown }).content === "string" &&
        ((entry as { role?: unknown }).role === "user" ||
          (entry as { role?: unknown }).role === "assistant"),
    )
    .slice(-LIMITS.historyTurns);
}
