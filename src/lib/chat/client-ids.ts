/**
 * ============================================================================
 * THE BROWSER'S OWN IDS — WHAT THEY ARE, AND WHAT THEY ARE NOT
 * ============================================================================
 *
 * `createId("conv")` and `createId("msg")` mint the ids a conversation and its
 * turns have always been keyed by inside IndexedDB. They travel to the server
 * now, as CORRELATION KEYS: they are what makes a re-sent thread converge on
 * the row it already created instead of adding another, and what lets an import
 * that was interrupted pick up exactly where it stopped.
 *
 * THEY ARE NOT OWNERSHIP. The browser chose them, so a caller presenting one
 * has proved nothing. Every statement that uses one is scoped by the session's
 * own user id, and the uniqueness in Postgres is `(user_id, client_*_id)` —
 * two people may hold the same local id and neither can reach the other's row.
 * That rule is enforced in `lib/chat/store.ts`; this module only says whether a
 * string is the shape of an id this application mints.
 *
 * ============================================================================
 * WHY THE VALIDATION IS STRUCTURAL RATHER THAN A PREFIX TEST
 * ============================================================================
 *
 * Every production browser's IndexedDB holds six SEEDED DEMO CONVERSATIONS. The
 * store's initial state is `DEMO_CONVERSATIONS` in both modes, and the
 * `chat_conversations` persist effect is the only one with no demo-mode guard,
 * so `conv-seed-1 … conv-seed-6` and their `msg-s*` turns were written to the
 * browser of every real person who has ever opened Ask Sunny.
 *
 * They are fabricated. A manager never asked them and Sunny never answered
 * them. Importing them would put invented history into a real person's account,
 * where it would be indistinguishable from the real thing.
 *
 * So the test is not "does it start with conv_". It is:
 *
 *   1. the id matches the exact shape `createId` produces — a prefix, an
 *      underscore, and lowercase base36 only, so anything carrying a hyphen is
 *      out on the first rule and every seed id carries hyphens
 *   2. its leading eight characters decode as a millisecond timestamp inside a
 *      plausible window, which is what `Date.now().toString(36)` actually is
 *      for every date between 1972 and 2059
 *   3. it is not one of the six seed ids by exact match
 *
 * Rule 3 is redundant against rules 1 and 2 — `conv-seed-1` fails both — and it
 * is here anyway, named, so that the regression test proving the seeds stay out
 * asserts against the seeds themselves rather than against a regex that
 * happened to exclude them. If someone ever loosens the pattern, rule 3 still
 * holds and the test says which rule caught it.
 */

/**
 * The six seeded conversations `DEMO_CONVERSATIONS` writes into every browser.
 *
 * Listed exhaustively rather than matched by pattern: this is the population
 * the rule exists for, and naming it is what makes "none of these ever reaches
 * Supabase" a claim a test can check directly.
 */
export const DEMO_SEED_CONVERSATION_IDS = [
  "conv-seed-1",
  "conv-seed-2",
  "conv-seed-3",
  "conv-seed-4",
  "conv-seed-5",
  "conv-seed-6",
] as const;

/** Column bound in `chat_conversations` / `chat_messages`. */
export const CLIENT_ID_MAX_LENGTH = 128;

/**
 * Lowercase base36 after the prefix, and nothing else.
 *
 * `Date.now().toString(36)`, `counter.toString(36)` and
 * `Math.random().toString(36).slice(2, 8)` are all lowercase base36, so an
 * uppercase letter, a hyphen, a dot or a slash is not something this
 * application ever produced.
 *
 * The length floor is 9: eight characters of timestamp plus at least one of
 * counter. The ceiling is generous — the counter grows with a long session —
 * and well inside the column bound.
 */
const CLIENT_ID = /^(conv|msg)_([0-9a-z]{9,32})$/;

/** `Date.now().toString(36)` is exactly eight characters from 1972 to 2059. */
const TIMESTAMP_CHARS = 8;

/**
 * The earliest minting time treated as real.
 *
 * Ask Sunny did not exist before this, so an id claiming to predate it was not
 * minted by `createId` on a correctly-set clock. Rejecting is the safe reading:
 * the cost is that a browser with a badly wrong clock has its history declined
 * and SAID SO in the import result, rather than quietly filed under a date
 * that would sort its history into the wrong decade.
 */
const EARLIEST_MS = Date.UTC(2024, 0, 1);

/** How far ahead of this server's clock a browser's is allowed to be. */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function isSeedConversationId(value: string): boolean {
  return (DEMO_SEED_CONVERSATION_IDS as readonly string[]).includes(value);
}

function wellFormed(value: unknown, prefix: "conv" | "msg", now: number): boolean {
  if (typeof value !== "string") return false;
  if (value.length > CLIENT_ID_MAX_LENGTH) return false;

  const match = CLIENT_ID.exec(value);
  if (!match || match[1] !== prefix) return false;

  const minted = Number.parseInt(match[2].slice(0, TIMESTAMP_CHARS), 36);
  if (!Number.isFinite(minted)) return false;

  return minted >= EARLIEST_MS && minted <= now + CLOCK_SKEW_MS;
}

/**
 * True when this is an id `createId("conv")` could have produced, and is not
 * one of the seeded demo threads.
 *
 * `now` is injectable so the timestamp window can be tested without waiting for
 * the clock; callers pass nothing.
 */
export function isClientConversationId(
  value: unknown,
  now: number = Date.now(),
): value is string {
  if (typeof value === "string" && isSeedConversationId(value)) return false;
  return wellFormed(value, "conv", now);
}

/** The same rule for a turn's id. */
export function isClientMessageId(
  value: unknown,
  now: number = Date.now(),
): value is string {
  return wellFormed(value, "msg", now);
}

/**
 * Why a local conversation was not eligible, for an import result a person can
 * read. Never an error: a browser holding a seeded thread is the normal case,
 * not a fault.
 */
export type IneligibleReason =
  /** One of the six fabricated threads seeded into every browser. */
  | "demo_seed"
  /** The conversation's own id is not the shape `createId` produces. */
  | "malformed_conversation_id"
  /** A turn's id is not, so the whole thread is declined rather than part of it. */
  | "malformed_message_id"
  /** No turns, so there is nothing to bring over. */
  | "empty"
  /** A field is missing, the wrong type, or past a bound the column enforces. */
  | "malformed_record"
  /**
   * The person deleted it — a tombstone for this conversation, or a Clear
   * History boundary it sits behind.
   *
   * Reported rather than silently skipped, because "four of these were ones you
   * deleted" is a sentence somebody can act on, and a shorter history than they
   * were shown with no explanation is not.
   */
  | "deleted";
