import { DOTNET_MIN_DATE_PREFIX, EMPTY_GUID, FIELD, LOCATION_FIELD } from "./contract";
import type { StatusResolver } from "./enums";
import type {
  AccessType,
  EmployeeIssue,
  EmploymentStatus,
  LocationAffiliation,
  LocationCatalogEntry,
  NormalizedEmployee,
} from "./types";

/**
 * ============================================================================
 * WOVEN RECORD → ALLOWLISTED EMPLOYEE
 * ============================================================================
 *
 * A STRICT ALLOWLIST, BUILT FIELD BY FIELD. Each output field is read from the
 * one spec key `contract.ts` names and nothing else. The Woven record is never
 * spread, copied or stored, so the CellPhone and DateOfBirth the list endpoint
 * returns, and the pay, address, emergency contacts, demographics, notes,
 * termination reason and rehire flag the details endpoint returns, are dropped
 * here simply by never being read. `normalize.test.ts` proves it.
 *
 * A BAD FIELD NEVER FAILS THE EMPLOYEE. A missing email, position or location
 * becomes a data-quality code on the row. Only a missing or unusable EMPLOYEE
 * ID rejects a record, because without it there is no stable identity.
 *
 * STATUS IS NEVER INFERRED. It comes only from the `Status` integer, resolved
 * through Woven's own `/lists/enums`. A past termination date on an employee
 * Woven calls active is flagged (`status_termination_conflict`), not acted on.
 */

export interface NormalizeOptions {
  statuses: StatusResolver;
  /** YYYY-MM-DD "today", for reading a past termination date. */
  today: string;
}

export type NormalizeResult =
  | { ok: true; employee: NormalizedEmployee }
  | { ok: false; reason: "not_an_object" | "missing_employee_id" | "invalid_employee_id" };

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

const MAX_NAME = 120;
const MAX_LABEL = 160;
const MAX_NUMBER = 50;
const MAX_HRIS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      const value = record[key];
      if (value !== null && value !== undefined && value !== "") return value;
    }
  }
  return undefined;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, max);
}

/** An identifier within the directory's id pattern. The all-zero GUID is "no value". */
export function readId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === EMPTY_GUID) return null;
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

/** YYYY-MM-DD from an ISO date or date-time. The .NET "unset" date is null. */
export function readDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.startsWith(DOTNET_MIN_DATE_PREFIX)) return null;
  const match = DATE_PREFIX.exec(trimmed);
  if (!match) return null;

  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  /* Rejects 2026-02-31 and similar, which Date would otherwise roll forward. */
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(m) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/**
 * Woven `EmailAddress`, TRIMMED AND OTHERWISE AS PROVIDED. It is not
 * lower-cased and not filtered by domain: whether an address may ever be used
 * to sign in is a separate, configurable rule (`WOVEN_LOGIN_EMAIL_DOMAINS`),
 * applied only where eligibility is decided. Only an address that is not an
 * address at all is dropped, because it could never identify anybody.
 */
function readEmail(value: unknown, issues: EmployeeIssue[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push("missing_email");
    return null;
  }
  const email = value.trim();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    issues.push("invalid_email");
    return null;
  }
  return email;
}

function readStatus(record: Record<string, unknown>, options: NormalizeOptions, issues: EmployeeIssue[]) {
  const code = readInteger(pick(record, FIELD.status));
  const status: EmploymentStatus = options.statuses.resolve(code);
  if (status === "unknown") issues.push("unknown_status");
  return { status, code };
}

/** Primary first, then by location id, so the same set always hashes the same. */
function sortAffiliations(list: LocationAffiliation[]): LocationAffiliation[] {
  return [...list].sort((a, b) => {
    if (a.accessType === "primary" && b.accessType !== "primary") return -1;
    if (b.accessType === "primary" && a.accessType !== "primary") return 1;
    return a.wovenLocationId.localeCompare(b.wovenLocationId);
  });
}

export function primaryOnly(
  employee: Pick<NormalizedEmployee, "primaryLocationId" | "primaryLocationName">,
): LocationAffiliation[] {
  if (employee.primaryLocationId === null) return [];
  return [
    {
      wovenLocationId: employee.primaryLocationId,
      locationName: employee.primaryLocationName,
      locationNumber: null,
      accessType: "primary",
      expiresOn: null,
    },
  ];
}

/**
 * The affiliation list from an employee-details response's `Locations[]`.
 *
 * Returns null when there is no `Locations` array — "not known", never "no
 * locations". Also null when an ALL-LOCATION employee's list is empty: what
 * Woven lists for them is unconfirmed, and an empty list must not end every
 * affiliation on file. The primary is always included.
 */
export function readAffiliations(
  details: unknown,
  primary: Pick<NormalizedEmployee, "primaryLocationId" | "primaryLocationName">,
  options: { allLocationAccess?: boolean | null } = {},
): LocationAffiliation[] | null {
  if (!isRecord(details)) return null;
  const locations = pick(details, FIELD.locations);
  if (!Array.isArray(locations)) return null;
  if (locations.length === 0 && options.allLocationAccess === true) return null;

  const byId = new Map<string, LocationAffiliation>();
  for (const entry of locations) {
    if (!isRecord(entry)) continue;
    const wovenLocationId = readId(pick(entry, LOCATION_FIELD.locationId));
    if (wovenLocationId === null || byId.has(wovenLocationId)) continue;

    const expiresOn = readDate(pick(entry, LOCATION_FIELD.expiresOn));
    const isPrimary = primary.primaryLocationId !== null && wovenLocationId === primary.primaryLocationId;
    /*
     * An ExpiresOn marks TEMPORARY OR EXPIRING access — deliberately not
     * "borrowed" until live data shows the two are the same thing.
     */
    const accessType: AccessType = isPrimary ? "primary" : expiresOn !== null ? "temporary_or_expiring_access" : "additional";

    byId.set(wovenLocationId, {
      wovenLocationId,
      locationName:
        text(pick(entry, LOCATION_FIELD.name), MAX_LABEL) ?? text(pick(entry, LOCATION_FIELD.displayName), MAX_LABEL),
      locationNumber: text(pick(entry, LOCATION_FIELD.number), MAX_NUMBER),
      accessType,
      expiresOn: isPrimary ? null : expiresOn,
    });
  }

  if (primary.primaryLocationId !== null && !byId.has(primary.primaryLocationId)) {
    for (const entry of primaryOnly(primary)) byId.set(entry.wovenLocationId, entry);
  }

  return sortAffiliations([...byId.values()]);
}

/** One `GET /locations` entry for the location map's catalog columns. Null when it has no id. */
export function readCatalogLocation(record: unknown): LocationCatalogEntry | null {
  if (!isRecord(record)) return null;
  const wovenLocationId = readId(pick(record, LOCATION_FIELD.locationId));
  if (wovenLocationId === null) return null;
  return {
    wovenLocationId,
    name: text(pick(record, LOCATION_FIELD.name), MAX_LABEL),
    displayName: text(pick(record, LOCATION_FIELD.displayName), MAX_LABEL),
    number: text(pick(record, LOCATION_FIELD.number), MAX_NUMBER),
    districtId: readId(pick(record, LOCATION_FIELD.districtId)),
    districtName: text(pick(record, LOCATION_FIELD.districtName), MAX_LABEL),
    regionId: readId(pick(record, LOCATION_FIELD.regionId)),
    regionName: text(pick(record, LOCATION_FIELD.regionName), MAX_LABEL),
    isClosed: readBoolean(pick(record, LOCATION_FIELD.isClosed)),
    isNonLocation: readBoolean(pick(record, LOCATION_FIELD.isNonLocation)),
  };
}

export function normalizeEmployee(record: unknown, options: NormalizeOptions): NormalizeResult {
  if (!isRecord(record)) return { ok: false, reason: "not_an_object" };

  const rawId = pick(record, FIELD.employeeId);
  if (rawId === undefined) return { ok: false, reason: "missing_employee_id" };
  const externalEmployeeId = readId(rawId);
  if (externalEmployeeId === null) return { ok: false, reason: "invalid_employee_id" };

  const issues: EmployeeIssue[] = [];

  const { status: employmentStatus, code: employmentStatusCode } = readStatus(record, options, issues);
  const terminationDate = readDate(pick(record, FIELD.terminationDate));
  if (employmentStatus === "active" && terminationDate !== null && terminationDate <= options.today) {
    issues.push("status_termination_conflict");
  }

  const positionId = readId(pick(record, FIELD.positionId));
  if (positionId === null) issues.push("missing_position_id");

  const primaryLocationId = readId(pick(record, FIELD.primaryLocationId));
  if (primaryLocationId === null) issues.push("missing_primary_location");
  const primaryLocationName = text(pick(record, FIELD.primaryLocationName), MAX_LABEL);

  const hasMultipleLocationAccess = readBoolean(pick(record, FIELD.hasMultipleLocationAccess));
  const hasAllLocationAccess = readBoolean(pick(record, FIELD.allLocationAccess));

  if (readId(pick(record, FIELD.vendorId)) !== null) issues.push("vendor_employee");

  const emailAddress = readEmail(pick(record, FIELD.emailAddress), issues);

  /*
   * THE LIST ROW SETTLES AFFILIATIONS IN ONE CASE ONLY: it says the employee
   * does NOT have multiple-location or all-location access, so the primary is
   * the whole list. Otherwise a details read is needed, and until then the
   * affiliations are unknown.
   */
  const primary = { primaryLocationId, primaryLocationName };
  let affiliations: LocationAffiliation[] | null = null;
  let affiliationSource: NormalizedEmployee["affiliationSource"] = null;
  if (hasMultipleLocationAccess === false && hasAllLocationAccess !== true) {
    affiliations = primaryOnly(primary);
    affiliationSource = "list_flag";
  }

  return {
    ok: true,
    employee: {
      externalEmployeeId,
      employeeLoginId: readId(pick(record, FIELD.employeeLoginId)),
      externalHrisId: text(pick(record, FIELD.externalHrisId), MAX_HRIS),
      firstName: text(pick(record, FIELD.firstName), MAX_NAME),
      lastName: text(pick(record, FIELD.lastName), MAX_NAME),
      preferredFirstName: text(pick(record, FIELD.preferredFirstName), MAX_NAME),
      emailAddress,
      employmentStatus,
      employmentStatusCode,
      hireDate: readDate(pick(record, FIELD.hireDate)),
      startDate: readDate(pick(record, FIELD.startDate)),
      terminationDate,
      terminationLastDayWorked: readDate(pick(record, FIELD.terminationLastDayWorked)),
      terminationTypeCode: readInteger(pick(record, FIELD.terminationType)),
      positionId,
      positionName: text(pick(record, FIELD.positionName), MAX_LABEL),
      primaryLocationId,
      primaryLocationName,
      hasMultipleLocationAccess,
      hasAllLocationAccess,
      wovenLoginAllowed: readBoolean(pick(record, FIELD.isLoginAllowed)),
      affiliations,
      affiliationSource,
      issues,
    },
  };
}

/** Folds a details response into an employee. Only the affiliation list is taken. */
/** The `Status` integer on any Woven employee body (a list row or details), or null. */
export function readStatusCode(body: unknown): number | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return readInteger(pick(body as Record<string, unknown>, FIELD.status));
}

export function withDetails(employee: NormalizedEmployee, details: unknown): NormalizedEmployee {
  const affiliations = readAffiliations(details, employee, { allLocationAccess: employee.hasAllLocationAccess });
  return affiliations === null ? employee : { ...employee, affiliations, affiliationSource: "details" };
}
