import { PRODUCTION_DISTRICTS, PRODUCTION_REGIONS, type ProductionArea } from "@/data/salons";
import type { AccessScope, Role } from "@/types";

/**
 * ============================================================================
 * THE DISTRICT (OR REGION) THE ROSTER SAYS THIS MANAGER RUNS
 * ============================================================================
 *
 * Pau, 26 Nov 2026, on District Managers whose account is left on "whole
 * company": "she should though" (see her salons' forms) — "rachel and sarah all
 * district her salon and other salon and her managers forms".
 *
 * The roster names every district and region after the person who runs it
 * (`"Last, First"`, `src/data/salons.ts`). So a District Manager whose stored
 * scope is `global` — which grants no salon for Forms, because every account
 * carries it — is matched to the district the roster names them on, and a
 * Regional Manager to their region. No one has to set anything in User
 * Management, and Reporting (which reads the stored scope) is untouched.
 *
 * The match is strict: the account's email name or display name must contain
 * BOTH the first and the last name, and exactly one area may match. Anything
 * else names no area: fails closed, never to all salons.
 */

const letters = (value: string | null | undefined): string => (value ?? "").toLowerCase().replace(/[^a-z]/g, "");

function personNames(area: ProductionArea): { first: string; last: string } | null {
  const [last, first] = area.name.split(",").map((part) => letters(part));
  return first && last ? { first, last } : null;
}

function names(area: ProductionArea, email: string | null, displayName: string | null): boolean {
  const person = personNames(area);
  if (!person) return false;
  const candidates = [letters(email?.split("@")[0]), letters(displayName)];
  return candidates.some((text) => text.includes(person.first) && text.includes(person.last));
}

/** The district or region scope the roster gives this manager, or null. */
export function rosterScopeForManager(
  role: Role,
  email: string | null,
  displayName: string | null,
): AccessScope | null {
  const [level, areas] =
    role === "district_manager"
      ? (["district", PRODUCTION_DISTRICTS] as const)
      : role === "regional_manager"
        ? (["region", PRODUCTION_REGIONS] as const)
        : [null, [] as readonly ProductionArea[]];
  if (!level) return null;
  const matches = areas.filter((area) => names(area, email, displayName));
  if (matches.length !== 1) return null;
  return { level, primaryAreaId: matches[0]!.id, alsoCoversAreaIds: [] };
}
