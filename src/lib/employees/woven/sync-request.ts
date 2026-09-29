/**
 * ============================================================================
 * WHAT A MANUAL SYNC REQUEST ASKS FOR — dry run, save, or refused
 * ============================================================================
 *
 * A DRY RUN UNLESS TWO THINGS ARE BOTH EXPLICIT. A stored sync needs
 * `"dryRun": false` AND `"confirmSave": true` — both JSON booleans, not
 * strings. Anything else that does not ask to save (`{}`, `dryRun: true`, a
 * confirmation on its own, `"false"` as a string) is a dry run. A request that
 * says `dryRun: false` WITHOUT the confirmation is refused outright, not
 * downgraded, so a caller who meant to save learns it did not happen.
 *
 * This is the route's gate. `WOVEN_SYNC_WRITES_ENABLED`, enforced inside
 * `runWovenEmployeeSync`, is a separate one; a save needs both.
 *
 * No server imports, so the admin panel builds its request from the same names.
 */

export const SAVE_CONFIRMATION_FIELD = "confirmSave";

/** The one body that asks to save. */
export const STORED_SYNC_REQUEST = { dryRun: false, [SAVE_CONFIRMATION_FIELD]: true } as const;

export type SyncRequest =
  | { kind: "dry_run" }
  | { kind: "save" }
  | { kind: "confirmation_required"; reason: string };

export function parseSyncRequest(body: Readonly<Record<string, unknown>>): SyncRequest {
  if (body.dryRun !== false) return { kind: "dry_run" };
  if (body[SAVE_CONFIRMATION_FIELD] === true) return { kind: "save" };
  return {
    kind: "confirmation_required",
    reason: `A stored sync needs "dryRun": false and "${SAVE_CONFIRMATION_FIELD}": true. Nothing was read or saved.`,
  };
}
