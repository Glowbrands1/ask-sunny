import { ROLES } from "@/lib/permissions";
import type { Role } from "@/types";

/**
 * ============================================================================
 * NEW HIRES GET THEIR ACCESS LINK ON THEIR OWN — ONE AT A TIME
 * ============================================================================
 *
 * Pau, 28 Oct 2026 (same switches in both apps): a person who joins in Woven
 * after a set date gets an Ask Sunny account and the invitation email without
 * an admin, but never in a batch — the mailer allows two emails an hour. Built
 * and off:
 *
 *   NEW_HIRE_INVITES_ENABLED   the master switch. Off (default): nothing below
 *                              is read and nothing changes.
 *   NEW_HIRE_INVITE_SINCE      a date (YYYY-MM-DD). Only people whose Woven
 *                              hire date is on or after it, and not after
 *                              today, are new hires. Unset: nobody is.
 *   NEW_HIRE_INVITE_ROLES      the roles a new hire may be given an account
 *                              for, beyond the lifecycle's own
 *                              (`AUTO_PROVISION_ROLES`) — e.g. `employee` for
 *                              Tanning Consultants. Empty (default): no others.
 *   NEW_HIRE_INVITES_PER_HOUR  invitations sent per hourly run: 1 (default)
 *                              or 2. Anything else is 1.
 *
 * With the switch on, the daily lifecycle creates the accounts and sends no
 * invitation itself; the hourly run (`new-hire-invites.ts`) sends them, oldest
 * hire first, at most NEW_HIRE_INVITES_PER_HOUR each hour, and stops at the
 * first rate-limit answer. Everybody already on the team is left to an admin.
 * The lifecycle's own switches (WOVEN_ACCESS_MODE=apply with CREATE_USER and
 * SEND_INVITE) must also be on for anything to be created or sent.
 */

export const NEW_HIRE_INVITES_ENABLED_ENV = "NEW_HIRE_INVITES_ENABLED";
export const NEW_HIRE_INVITE_SINCE_ENV = "NEW_HIRE_INVITE_SINCE";
export const NEW_HIRE_INVITE_ROLES_ENV = "NEW_HIRE_INVITE_ROLES";
export const NEW_HIRE_INVITES_PER_HOUR_ENV = "NEW_HIRE_INVITES_PER_HOUR";

export interface NewHireRule {
  /** The first hire date that counts (YYYY-MM-DD). */
  since: string;
  /** Roles beyond the lifecycle's own that a new hire may be given an account for. */
  extraRoles: readonly Role[];
  /** Today, YYYY-MM-DD (UTC): a hire date after it has not started yet. */
  today: string;
}

export interface NewHireConfig {
  enabled: boolean;
  rule: NewHireRule | null;
  perHour: 1 | 2;
  problem: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const on = (raw: string | undefined) => ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());

export function readNewHireConfig(env: Record<string, string | undefined> = process.env, now: Date = new Date()): NewHireConfig {
  const off = (problem: string | null): NewHireConfig => ({ enabled: false, rule: null, perHour: 1, problem });
  if (!on(env[NEW_HIRE_INVITES_ENABLED_ENV])) return off(null);
  const since = (env[NEW_HIRE_INVITE_SINCE_ENV] ?? "").trim();
  if (!ISO_DATE.test(since) || Number.isNaN(Date.parse(`${since}T00:00:00Z`))) {
    return off(`${NEW_HIRE_INVITE_SINCE_ENV} must be a date (YYYY-MM-DD). New-hire invitations were treated as off.`);
  }
  const named = (env[NEW_HIRE_INVITE_ROLES_ENV] ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  const unknown = named.filter((role) => !(ROLES as readonly string[]).includes(role));
  if (unknown.length > 0) {
    return off(`${NEW_HIRE_INVITE_ROLES_ENV} names ${unknown.join(", ")}, which is not a role. New-hire invitations were treated as off.`);
  }
  const perHour = (env[NEW_HIRE_INVITES_PER_HOUR_ENV] ?? "").trim() === "2" ? 2 : 1;
  return {
    enabled: true,
    rule: { since, extraRoles: [...new Set(named)] as Role[], today: now.toISOString().slice(0, 10) },
    perHour,
    problem: null,
  };
}

/** Hired on or after the set date, and not after today. A missing or unreadable date is not a new hire. */
export function isNewHire(hireDate: string | null | undefined, rule: NewHireRule): boolean {
  const day = (hireDate ?? "").slice(0, 10);
  return ISO_DATE.test(day) && day >= rule.since && day <= rule.today;
}
