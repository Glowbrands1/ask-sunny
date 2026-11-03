/**
 * ============================================================================
 * FLAGS THAT ARE ON UNLESS PRODUCTION SAYS OFF — "(E) BATCH 1"
 * ============================================================================
 *
 * Pau, 3 Nov 2026: the fixes that have been on in production long enough are
 * on by default in the code, so a new environment, a preview or a test without
 * the variable behaves as production does. QA validated each from Vercel: "1"
 * in BOTH apps' production env, set three days ago or more, no rollback.
 *
 * CA_SHORTCUT_WORDS is not in this batch: one of its readers is in a
 * protected file (payroll-deduct-answer.ts) that reads the variable itself.
 *
 * The environment stays the emergency off switch: "0", "false", "off" or "no"
 * still turns any of these off. Nothing else changes — every flag not listed
 * here is still off unless its variable says on. Imports nothing.
 */
export const DEFAULT_ON: ReadonlySet<string> = new Set([
  "ANGLE_PLACEHOLDER_GUARD_ENABLED",
  "EXIT_SHORTCUT_WORDS_ENABLED",
  "FORM_EDIT_HONEST_REPLY_ENABLED",
  "FORM_EDIT_PLAIN_WORDS_ENABLED",
  "LEVEL_REQUEST_DATE_ENABLED",
  "STREET_ADDRESS_NOT_A_NAME_ENABLED",
]);

const ON = new Set(["1", "true", "on", "yes"]);
const OFF = new Set(["0", "false", "off", "no"]);

/** Whether a flag is on, from its variable's raw value (undefined when it is not set). */
export function flagFromEnv(name: string, raw: string | undefined): boolean {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (ON.has(value)) return true;
  if (OFF.has(value)) return false;
  return DEFAULT_ON.has(name);
}
