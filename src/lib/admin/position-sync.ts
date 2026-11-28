import { PRODUCTION_SALONS } from "@/data/salons";
import type { PlannedRow } from "@/lib/employees/woven/access/types";
import type { Role, ScopeLevel } from "@/types";

/**
 * ============================================================================
 * WHEN WOVEN CHANGES SOMEONE'S POSITION OR SALON, THEIR ACCESS FOLLOWS
 * ============================================================================
 *
 * Pau, 28 Nov 2026: "we need to add District manager also, just not corporate,
 * also add a sync where there is a position change it should detect it and
 * give the correct link to the person with correct position and location.
 * sometimes they make new hire DM as tanning employee but change it within the
 * dayy to DM so we need to catch that too, for new positions existing, make
 * sure their access refreshes too depends on the access we have in the
 * intergration both app". Chosen: "All within manager tiers".
 *
 * After each successful Woven sync (and the account lifecycle), every account
 * LINKED to a Woven employee is compared with Woven's approved position mapping
 * and primary salon:
 *
 *   - Assistant Salon Director, Salon Director and District Manager (the TIER)
 *     move between each other both ways: a promotion, a demotion, a move to
 *     another salon. Tanning Consultants have no accounts; a manager Woven now
 *     shows as one is left to an admin. Role and scope follow the mapping:
 *     the salon roles at their Woven primary salon, a District Manager at that
 *     salon's district.
 *   - Admin, owner, developer, a role override, regional and anything outside
 *     the tier are NEVER changed: a change there is left to an admin (the
 *     Access Preview already flags it).
 *   - Same role, same kind of scope, different primary area: moved. Same role
 *     with a different KIND of scope (a District Manager an admin gave every
 *     salon) is not a Woven change and is left alone — except for an account
 *     Woven itself created, which always matches the mapping (a new District
 *     Manager is created at their salon and widened to the district here).
 *   - Extra salons an admin granted (`also covers`) are kept as they are.
 *
 * Only while the access guards allow changes, only for Woven-Active people,
 * and at most MAX_CHANGES_PER_RUN a run (more: nothing, and the run says so).
 * Each change is made by `patchUser` in the name of WOVEN_POSITION_SYNC_ACTOR,
 * an active admin with every salon, exactly as if they had edited the account
 * (audited `role_changed` / `scope_changed`). Admins get a bell for each one.
 *
 *   WOVEN_POSITION_SYNC_ENABLED  the switch. Off (default): nothing changes, and
 *                                District Managers are not created.
 *   WOVEN_POSITION_SYNC_ACTOR    the admin's email the changes are made by.
 *
 * Pure. `position-sync.server.ts` runs it.
 */

export const WOVEN_POSITION_SYNC_ENABLED_ENV = "WOVEN_POSITION_SYNC_ENABLED";
export const WOVEN_POSITION_SYNC_ACTOR_ENV = "WOVEN_POSITION_SYNC_ACTOR";
export const MAX_CHANGES_PER_RUN = 10;

/** The roles Woven may move people between, and the scope each one has. */
/*
 * No Tanning Consultants (Pau, 28 Nov 2026: "we dont add tanning consultants and employee in both apps"): a manager
 * Woven now shows as a Tanning Consultant is left to an admin, never turned into an employee account.
 */
export const TIER: Readonly<Partial<Record<Role, ScopeLevel>>> = {
  assistant_salon_director: "salon",
  salon_director: "salon",
  district_manager: "district",
};

export interface PositionSyncConfig {
  enabled: boolean;
  actorEmail: string | null;
}

const on = (raw: string | undefined) => ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());

export function readPositionSyncConfig(env: Record<string, string | undefined> = process.env): PositionSyncConfig {
  const actor = (env[WOVEN_POSITION_SYNC_ACTOR_ENV] ?? "").trim().toLowerCase();
  return { enabled: on(env[WOVEN_POSITION_SYNC_ENABLED_ENV]), actorEmail: actor.includes("@") ? actor : null };
}

/** The district a salon area (`loc-0307`) belongs to, or null. */
export function districtOfSalon(salonAreaId: string | null): string | null {
  if (!salonAreaId) return null;
  return PRODUCTION_SALONS.find((salon) => salon.id === salonAreaId)?.districtId ?? null;
}

export interface Scope {
  level: ScopeLevel;
  primaryAreaId: string | null;
  alsoCoversAreaIds: string[];
}

export interface PositionChange {
  appUserId: string;
  externalEmployeeId: string;
  employeeName: string;
  from: { role: Role; scope: Scope };
  to: { role: Role; scope: Scope };
  reason: "position_changed" | "location_changed" | "created_by_woven_widened";
}

export interface Skipped {
  appUserId: string;
  reason: string;
}

/** The scope a tier role has at this Woven salon. Null when it cannot be worked out (no salon, no district). */
export function targetScope(role: Role, salonAreaId: string | null, keepAlso: readonly string[]): Scope | null {
  const level = TIER[role];
  if (!level || !salonAreaId) return null;
  if (level === "salon") return { level, primaryAreaId: salonAreaId, alsoCoversAreaIds: [...keepAlso] };
  if (level === "district") {
    const district = districtOfSalon(salonAreaId);
    return district ? { level, primaryAreaId: district, alsoCoversAreaIds: [...keepAlso] } : null;
  }
  if (level === "global") return { level, primaryAreaId: null, alsoCoversAreaIds: [] };
  return null;
}

/** What the sync would change, from the access plan's rows (each row already carries the account and Woven's view). */
export function decidePositionChanges(rows: readonly PlannedRow[], accounts: ReadonlyMap<string, { alsoCoversAreaIds: string[] }>): { changes: PositionChange[]; skipped: Skipped[] } {
  const changes: PositionChange[] = [];
  const skipped: Skipped[] = [];
  for (const row of rows) {
    const account = row.account;
    if (!account || account.via !== "link" || account.management !== "woven_linked" || !row.externalEmployeeId) continue;
    const skip = (reason: string) => skipped.push({ appUserId: account.appUserId, reason });
    if (account.isProtected) continue;
    if (row.wovenStatus !== "active") continue;
    if (account.status !== "active" && account.status !== "invited") continue;
    if (!TIER[account.role]) {
      // Outside the tier (regional, corporate…): never changed here.
      if (row.proposedRole && row.proposedRole !== account.role) skip("outside_the_tier");
      continue;
    }
    const role = row.proposedRole;
    if (!role || !TIER[role]) {
      if (role !== account.role) skip(role ? "new_position_outside_the_tier" : "position_not_mapped");
      continue;
    }
    const also = accounts.get(account.appUserId)?.alsoCoversAreaIds ?? [];
    const target = targetScope(role, row.proposedPrimaryAreaId, also);
    if (!target) {
      skip(row.proposedPrimaryAreaId ? "district_unknown_for_salon" : "woven_primary_location_not_a_salon");
      continue;
    }
    const from = { role: account.role, scope: { level: account.scopeLevel, primaryAreaId: account.primaryAreaId, alsoCoversAreaIds: [...also] } };
    const createdByWoven = account.linkMethod === "provisioned";
    let reason: PositionChange["reason"] | null = null;
    if (role !== account.role) reason = "position_changed";
    else if (account.scopeLevel === target.level && account.primaryAreaId !== target.primaryAreaId) reason = "location_changed";
    else if (account.scopeLevel !== target.level && createdByWoven) reason = "created_by_woven_widened";
    if (!reason) continue;
    changes.push({ appUserId: account.appUserId, externalEmployeeId: row.externalEmployeeId, employeeName: row.employeeName, from, to: { role, scope: target }, reason });
  }
  return { changes, skipped };
}

const ROLE_WORDS: Partial<Record<Role, string>> = {
  employee: "Tanning Consultant",
  assistant_salon_director: "Assistant Salon Director",
  salon_director: "Salon Director",
  district_manager: "District Manager",
};

function scopeWords(scope: Scope): string {
  if (scope.level === "global") return "every salon";
  return scope.primaryAreaId ?? scope.level;
}

/** The admins' bell line for one change. */
export function changeNoticeText(change: PositionChange): { title: string; body: string } {
  const from = `${ROLE_WORDS[change.from.role] ?? change.from.role} (${scopeWords(change.from.scope)})`;
  const to = `${ROLE_WORDS[change.to.role] ?? change.to.role} (${scopeWords(change.to.scope)})`;
  return {
    title: `Access updated from Woven: ${change.employeeName}`,
    body: `${change.employeeName}'s Ask Sunny access now follows Woven: ${from} → ${to}.`,
  };
}
