import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = join("supabase", "migrations");

/**
 * The audit actions the database accepts TODAY: the value list of the newest
 * migration that (re)defines `app_user_audit_action_check`.
 *
 * Read from the constraint's own `check (action in (...))` block, not from the
 * whole file, so other quoted strings in the same migration can never widen
 * the set. Tests compare every action the code emits against this.
 */
export function allowedAuditActions(): { file: string; actions: Set<string> } {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of [...files].reverse()) {
    const sql = readFileSync(join(MIGRATIONS, name), "utf8");
    const at = sql.lastIndexOf("add constraint app_user_audit_action_check");
    if (at === -1) continue;
    const block = sql.slice(at).match(/check\s*\(\s*action\s+in\s*\(([\s\S]*?)\)\s*\)/);
    if (!block) throw new Error(`${name}: app_user_audit_action_check has no readable value list`);
    return { file: name, actions: new Set([...block[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)) };
  }
  throw new Error("No migration defines app_user_audit_action_check");
}
