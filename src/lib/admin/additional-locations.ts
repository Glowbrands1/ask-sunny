import {
  PRODUCTION_DISTRICTS,
  PRODUCTION_REGIONS,
  PRODUCTION_SALONS,
  salonById,
} from "@/data/salons";
import type { ScopeLevel } from "@/types";

/**
 * ============================================================================
 * ADDITIONAL LOCATIONS — the salons somebody may access BEYOND their primary
 * ============================================================================
 *
 * NO NEW COLUMN. `app_users.scope_also_covers_area_ids` already holds them, the
 * profile mapper already reads them, and the reporting resolvers already union
 * them with the primary. What was missing was any way to SET one on a real
 * account: the invitation form sent an empty list.
 *
 * A LOCATION IS ITS STABLE ID (`loc-0306`), never its display name. The id is
 * what is stored and what authorization reads; the name is a label.
 *
 * Pure and free of `server-only`, because the invitation form (browser) and
 * the directory module (server) must agree on these rules: the browser's
 * version stops an administrator choosing something the server would refuse,
 * and the server's version is the one that actually holds.
 */

/** The most additional locations one account may carry. */
export const MAX_ADDITIONAL_LOCATIONS = 60;

export interface AdditionalLocationOption {
  readonly id: string;
  readonly name: string;
}

/** Every salon that can be granted explicitly, in roster order. */
export const ADDITIONAL_LOCATION_OPTIONS: readonly AdditionalLocationOption[] =
  PRODUCTION_SALONS.map((salon) => ({ id: salon.id, name: salon.name }));

/** A salon id, as opposed to a district or region id. */
export const isSalonAreaId = (id: string): boolean => id.startsWith("loc-");

/**
 * What an administrator may pick as an additional location, given the primary.
 *
 * The primary salon is excluded: it is already granted, and listing it would
 * let the same salon appear twice on one account. For a district or region the
 * primary is an AREA, so every salon stays selectable — whether a salon already
 * falls inside that area is reporting's answer, not this static file's, and a
 * redundant grant is a union rather than an error.
 */
export function additionalLocationOptions(
  primaryAreaId: string | null,
): AdditionalLocationOption[] {
  return ADDITIONAL_LOCATION_OPTIONS.filter((option) => option.id !== primaryAreaId);
}

/**
 * Cleans a list the way the server will: de-duplicated, order kept, the
 * primary removed, nothing at all for a global scope (which covers everything
 * and cannot be widened), and capped.
 *
 * It neither truncates nor judges whether an id is KNOWN — see
 * `MAX_ADDITIONAL_LOCATIONS` and `unknownAdditionalAreaIds`; the caller refuses
 * rather than silently dropping part of an assignment.
 */
export function cleanAdditionalLocations(
  ids: readonly string[],
  scope: { level: ScopeLevel; primaryAreaId: string | null },
): string[] {
  if (scope.level === "global") return [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || id === scope.primaryAreaId || seen.has(id)) continue;
    seen.add(id);
  }
  return [...seen];
}

/**
 * The ids that are not something this level may carry.
 *
 *   salon id            -> must be on the roster, at any level
 *   district / region id -> only meaningful on a district or region scope,
 *                          where the resolvers read it as another area of the
 *                          same kind; on a salon scope it would be stored and
 *                          then silently ignored, which is worse than refusing
 *   anything else        -> unknown
 *
 * Refusing rather than storing keeps the column honest: every id in it does
 * something.
 */
export function unknownAdditionalAreaIds(
  ids: readonly string[],
  level: ScopeLevel,
): string[] {
  return ids.filter((id) => {
    if (isSalonAreaId(id)) return !salonById(id);
    if (level === "district") return !PRODUCTION_DISTRICTS.some((d) => d.id === id);
    if (level === "region") return !PRODUCTION_REGIONS.some((r) => r.id === id);
    return true;
  });
}
