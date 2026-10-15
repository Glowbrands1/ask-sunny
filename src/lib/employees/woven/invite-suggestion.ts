import { salonById } from "@/data/salons";
import { ADMIN_CONSOLE_ROLES, ROLES } from "@/lib/permissions";
import type { Role, ScopeLevel } from "@/types";

import { observedStatus } from "./status-evidence";
import type { DirectoryRow, LocationMappingRow, PositionMappingRow } from "./view-types";
import { employeeName } from "./views";

/**
 * ============================================================================
 * WHAT WOVEN CAN SUGGEST FOR AN INVITATION — and what it deliberately cannot
 * ============================================================================
 *
 * Pure: a directory row plus the two person-reviewed mappings in, a suggestion
 * out. It reads nothing and writes nothing, and the result is ONLY a
 * suggestion — the form shows it, the administrator presses "Apply" (nothing is
 * filled in on its own), and everything stays editable before the invitation
 * is sent. The server validates the final request exactly as it would one typed
 * by hand; nothing here is trusted by it.
 *
 * EVERY VALUE IS SUGGESTED ONLY WHEN IT IS RELIABLE, otherwise it is left out
 * with a plain-language note saying why. Nothing is guessed:
 *
 *   NAME      Woven's own first and last name.
 *   ROLE      Only from a position a PERSON confirmed (`isConfirmed`, mapped).
 *             Never an administrative role — admin, owner and developer are
 *             never suggested from Woven, whatever the mapping says.
 *   SCOPE     The role's natural reach (salon tier -> one salon, district
 *             manager -> a district, regional manager -> a region), narrowed
 *             further when the position mapping says so, NEVER widened by it.
 *             Global is never suggested.
 *   PRIMARY   Only for a salon scope, and only from the person-reviewed
 *             location map (Woven location id -> salon), and only for a salon
 *             on the roster. For a district or region, Woven names a salon, not
 *             an area, and deriving the area from it would be a guess, so the
 *             administrator chooses.
 *   ADDITIONAL Woven's `additional` affiliations, each through the same
 *             reviewed location map by STABLE WOVEN LOCATION ID — never by name
 *             or by Woven's raw location number, which is not a salon number.
 *             Temporary or expiring access is excluded: it is a borrow, not an
 *             assignment. Unmapped locations are named in a note, not guessed.
 *
 * NOTHING IS SUGGESTED FOR SOMEBODY WHO IS NOT ACTIVE IN WOVEN'S LATEST READ —
 * terminated, or not observed this run. A suggestion would read as approval.
 */

export interface InviteSuggestionValues {
  displayName: string | null;
  role: Role | null;
  scopeLevel: Exclude<ScopeLevel, "global"> | null;
  primaryAreaId: string | null;
  additionalAreaIds: string[];
}

export type InviteSuggestion =
  | { status: "not_found" }
  | { status: "ambiguous"; reason: string }
  | {
      status: "found";
      employee: {
        name: string;
        positionName: string | null;
        primaryLocationName: string | null;
        employmentStatus: string;
      };
      /** Null when nothing may be suggested (not active). */
      suggestion: InviteSuggestionValues | null;
      /** Why a value was left out, for the administrator. Never contains an id or an email. */
      notes: string[];
    };

/** Narrowest first. Used to make sure a mapping can only NARROW a role's natural reach. */
const BREADTH: Record<Exclude<ScopeLevel, "global">, number> = { salon: 0, district: 1, region: 2 };

/** The reach each suggestible role naturally has. Roles not listed here are never suggested. */
const NATURAL_LEVEL: Partial<Record<Role, Exclude<ScopeLevel, "global">>> = {
  employee: "salon",
  assistant_salon_director: "salon",
  salon_director: "salon",
  district_manager: "district",
  regional_manager: "region",
};

const lower = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export function suggestionForEmail(
  email: string,
  directory: readonly DirectoryRow[],
  positions: readonly PositionMappingRow[],
  locations: readonly LocationMappingRow[],
): InviteSuggestion {
  const wanted = lower(email);
  if (!wanted) return { status: "not_found" };

  const matches = directory.filter((row) => lower(row.emailAddress) === wanted);
  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      reason: "More than one Woven employee has this email address, so nothing is suggested. Choose the values yourself.",
    };
  }

  const row = matches[0]!;
  const name = employeeName(row);
  const employee = {
    name,
    positionName: row.positionName,
    primaryLocationName: row.primaryLocationName,
    employmentStatus: observedStatus(row),
  };

  if (observedStatus(row) !== "active") {
    return {
      status: "found",
      employee,
      suggestion: null,
      notes: [
        observedStatus(row) === "terminated"
          ? "Woven shows this person as terminated, so nothing is suggested."
          : "Woven did not confirm this person as active in its latest read, so nothing is suggested.",
      ],
    };
  }

  const notes: string[] = [];
  const values: InviteSuggestionValues = {
    displayName: name === "(no name in Woven)" ? null : name,
    role: null,
    scopeLevel: null,
    primaryAreaId: null,
    additionalAreaIds: [],
  };
  if (!values.displayName) notes.push("Woven has no name for this person.");

  /* ------------------------------------------------------------ role ---- */
  const position = row.positionId ? positions.find((p) => p.wovenPositionId === row.positionId) : undefined;
  const mappedRole = position && position.isConfirmed && position.status === "mapped" ? position.role : null;
  if (!position || !mappedRole) {
    notes.push(
      row.positionName
        ? `Woven position "${row.positionName}" has not been confirmed for an Ask Sunny role, so no role is suggested.`
        : "Woven has no position for this person, so no role is suggested.",
    );
  } else if (!(ROLES as readonly string[]).includes(mappedRole)) {
    notes.push("The role mapped to this position is not one Ask Sunny recognises, so no role is suggested.");
  } else if ((ADMIN_CONSOLE_ROLES as readonly string[]).includes(mappedRole) || !NATURAL_LEVEL[mappedRole as Role]) {
    notes.push("Woven never suggests an administrative or corporate role. Choose the role yourself if one is intended.");
  } else {
    values.role = mappedRole as Role;
  }

  /* ----------------------------------------------------------- scope ---- */
  if (values.role) {
    const natural = NATURAL_LEVEL[values.role]!;
    const mapped = position?.scopeLevel;
    const narrower =
      mapped && mapped !== "global" && mapped in BREADTH && BREADTH[mapped as keyof typeof BREADTH] < BREADTH[natural]
        ? (mapped as Exclude<ScopeLevel, "global">)
        : null;
    values.scopeLevel = narrower ?? natural;
  }

  /* ------------------------------------------------- location lookups ---- */
  const byWovenId = new Map(locations.map((l) => [l.wovenLocationId, l]));
  const salonIdFor = (wovenLocationId: string | null): { id: string | null; problem: string | null } => {
    if (!wovenLocationId) return { id: null, problem: "missing" };
    const location = byWovenId.get(wovenLocationId);
    if (!location || location.status === "unmapped") return { id: null, problem: "unmapped" };
    if (location.status === "ignored" || !location.salonNumber) return { id: null, problem: "not_a_salon" };
    const salon = salonById(`loc-${location.salonNumber}`);
    return salon ? { id: salon.id, problem: null } : { id: null, problem: "not_on_roster" };
  };

  /* --------------------------------------------------------- primary ---- */
  if (values.scopeLevel === "salon") {
    const primary = salonIdFor(row.primaryLocationId);
    if (primary.id) values.primaryAreaId = primary.id;
    else
      notes.push(
        primary.problem === "missing"
          ? "Woven has no primary location for this person, so no primary area is suggested."
          : `Woven's primary location${row.primaryLocationName ? ` "${row.primaryLocationName}"` : ""} has not been matched to an Ask Sunny salon, so no primary area is suggested.`,
      );
  } else if (values.scopeLevel) {
    notes.push(
      `Woven names a salon, not a ${values.scopeLevel}, so choose the ${values.scopeLevel} yourself.`,
    );
  }

  /* ------------------------------------------------------ additional ---- */
  const additional = new Set<string>();
  const unmatched: string[] = [];
  for (const location of row.additionalLocations) {
    const resolved = salonIdFor(location.wovenLocationId);
    if (resolved.id) {
      if (resolved.id !== values.primaryAreaId) additional.add(resolved.id);
    } else if (resolved.problem === "unmapped" || resolved.problem === "not_on_roster") {
      unmatched.push(location.name ?? "an unnamed location");
    }
    /* `not_a_salon` (an office, a test location) is skipped without comment. */
  }
  values.additionalAreaIds = [...additional];
  if (unmatched.length > 0) {
    notes.push(
      `Not suggested, because they are not matched to an Ask Sunny salon: ${unmatched.join(", ")}.`,
    );
  }
  if (row.temporaryOrExpiringLocations.length > 0) {
    notes.push("Temporary or expiring locations in Woven are never suggested.");
  }

  return { status: "found", employee, suggestion: values, notes };
}
