import {
  ACTIVE_STATUS_VALUES,
  DOTNET_MIN_DATE_PREFIX,
  FIELD,
  LOCATION_FIELD,
  TERMINATED_STATUS_VALUES,
} from "./contract";
import type {
  EmployeeIssue,
  EmploymentStatus,
  LocationAffiliation,
  NormalizedEmployee,
} from "./types";

/**
 * ============================================================================
 * WOVEN RECORD → ALLOWLISTED EMPLOYEE
 * ============================================================================
 *
 * A STRICT ALLOWLIST, BUILT FIELD BY FIELD. Each output field is read from its
 * named source keys (`contract.ts`) and nothing else. The Woven record is never
 * spread, copied or stored, so pay, compensation, date of birth, a personal
 * phone, a home address, emergency contacts, I-9 and background-check data,
 * notes, secure documents, banking, payroll and leave or medical data are
 * dropped here simply by never being read. `normalize.test.ts` feeds a record
 * carrying all of them and proves none reaches the output.
 *
 * A BAD FIELD NEVER FAILS THE EMPLOYEE. A missing email, position or location
 * becomes a data-quality code on the row, so one incomplete record cannot stop
 * the whole estate from syncing. Only a missing or unusable EMPLOYEE ID
 * rejects a record, because without it there is no stable identity to upsert.
 */

export interface NormalizeOptions {
  /** The status implied by the list pass that returned the record, if any. */
  impliedStatus?: EmploymentStatus;
  /** Lower-cased approved domains. Empty accepts any valid work email. */
  workEmailDomains: readonly string[];
  /** YYYY-MM-DD "today", for reading a past termination date. */
  today: string;
}

export type NormalizeResult =
  | { ok: true; employee: NormalizedEmployee }
  | { ok: false; reason: "not_an_object" | "missing_employee_id" | "invalid_employee_id" };

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const TEMPORARY_TYPE = /borrow|temp/i;

const MAX_NAME = 120;
const MAX_LABEL = 160;

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

/** An identifier: a string or an integer, within the directory's id pattern. */
export function readId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
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

function readInstant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.trim().startsWith(DOTNET_MIN_DATE_PREFIX)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "yes") return true;
    if (lowered === "false" || lowered === "no") return false;
  }
  return null;
}

function readWorkEmail(
  value: unknown,
  domains: readonly string[],
  issues: EmployeeIssue[],
): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push("missing_work_email");
    return null;
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    issues.push("invalid_work_email");
    return null;
  }
  if (domains.length > 0) {
    const domain = email.slice(email.lastIndexOf("@") + 1);
    if (!domains.includes(domain)) {
      /*
       * NOT STORED. When approved domains are configured, an address outside
       * them is treated as a personal address that happens to sit in the work
       * field, and personal addresses are outside the allowlist.
       */
      issues.push("work_email_not_approved_domain");
      return null;
    }
  }
  return email;
}

function readStatus(
  record: Record<string, unknown>,
  terminationDate: string | null,
  options: NormalizeOptions,
  issues: EmployeeIssue[],
): EmploymentStatus {
  const raw = pick(record, FIELD.status);
  if (typeof raw === "string") {
    const lowered = raw.trim().toLowerCase();
    if ((ACTIVE_STATUS_VALUES as readonly string[]).includes(lowered)) return "active";
    if ((TERMINATED_STATUS_VALUES as readonly string[]).includes(lowered)) return "terminated";
    /* A stated status we do not recognise is NOT guessed at, and never means terminated. */
    issues.push("unknown_status");
    return "unknown";
  }

  if (readBoolean(pick(record, FIELD.isTerminated)) === true) return "terminated";
  if (readBoolean(pick(record, FIELD.isActive)) === true) return "active";

  if (options.impliedStatus && options.impliedStatus !== "unknown") return options.impliedStatus;

  /* Last resort: a termination date that has already passed. */
  if (terminationDate !== null && terminationDate <= options.today) return "terminated";

  issues.push("unknown_status");
  return "unknown";
}

/** Primary first, then by location id, so the same set always hashes the same. */
function sortAffiliations(list: LocationAffiliation[]): LocationAffiliation[] {
  return [...list].sort((a, b) => {
    if (a.kind === "primary" && b.kind !== "primary") return -1;
    if (b.kind === "primary" && a.kind !== "primary") return 1;
    return a.wovenLocationId.localeCompare(b.wovenLocationId);
  });
}

function primaryOnly(employee: Pick<NormalizedEmployee, "primaryLocationId" | "primaryLocationName">): LocationAffiliation[] {
  if (employee.primaryLocationId === null) return [];
  return [
    {
      wovenLocationId: employee.primaryLocationId,
      locationName: employee.primaryLocationName,
      kind: "primary",
      startsOn: null,
      expiresOn: null,
    },
  ];
}

/**
 * The affiliation list from an employee-details response's `Locations[]`.
 *
 * Returns null when the response has no `Locations` array at all — that is
 * "not known", and must not be read as "no locations". The primary location is
 * always included, taken from the list row when the details omit it.
 */
export function readAffiliations(
  details: unknown,
  primary: Pick<NormalizedEmployee, "primaryLocationId" | "primaryLocationName">,
): LocationAffiliation[] | null {
  let body = details;
  if (isRecord(body) && !Object.hasOwn(body, "Locations") && !Object.hasOwn(body, "locations")) {
    const wrapped = pick(body, ["Data", "data", "Employee", "employee", "Result", "result"]);
    if (isRecord(wrapped)) body = wrapped;
  }
  if (!isRecord(body)) return null;

  const locations = pick(body, FIELD.locations);
  if (!Array.isArray(locations)) return null;

  const byId = new Map<string, LocationAffiliation>();
  let primaryTaken = false;
  for (const entry of locations) {
    if (!isRecord(entry)) continue;
    const wovenLocationId = readId(pick(entry, LOCATION_FIELD.locationId));
    if (wovenLocationId === null || byId.has(wovenLocationId)) continue;

    const expiresOn = readDate(pick(entry, LOCATION_FIELD.expiresOn));
    const type = pick(entry, LOCATION_FIELD.affiliationType);
    /*
     * EXACTLY ONE PRIMARY. `PrimaryLocationID` on the employee decides it; an
     * entry's own primary flag is used only when the employee states none.
     */
    const isPrimary =
      primary.primaryLocationId !== null
        ? wovenLocationId === primary.primaryLocationId
        : !primaryTaken && readBoolean(pick(entry, LOCATION_FIELD.isPrimary)) === true;
    if (isPrimary) primaryTaken = true;
    /*
     * TEMPORARY when Woven says so (a borrowing flag or type) OR when the
     * affiliation carries an expiry: a standing affiliation has no end date.
     */
    const isTemporary =
      readBoolean(pick(entry, LOCATION_FIELD.isTemporary)) === true ||
      (typeof type === "string" && TEMPORARY_TYPE.test(type)) ||
      expiresOn !== null;

    byId.set(wovenLocationId, {
      wovenLocationId,
      locationName: text(pick(entry, LOCATION_FIELD.locationName), MAX_LABEL),
      kind: isPrimary ? "primary" : isTemporary ? "temporary" : "additional",
      startsOn: readDate(pick(entry, LOCATION_FIELD.startsOn)),
      expiresOn,
    });
  }

  if (primary.primaryLocationId !== null && !byId.has(primary.primaryLocationId)) {
    for (const entry of primaryOnly(primary)) byId.set(entry.wovenLocationId, entry);
  }

  return sortAffiliations([...byId.values()]);
}

export function normalizeEmployee(record: unknown, options: NormalizeOptions): NormalizeResult {
  if (!isRecord(record)) return { ok: false, reason: "not_an_object" };

  const rawId = pick(record, FIELD.employeeId);
  if (rawId === undefined) return { ok: false, reason: "missing_employee_id" };
  const externalEmployeeId = readId(rawId);
  if (externalEmployeeId === null) return { ok: false, reason: "invalid_employee_id" };

  const issues: EmployeeIssue[] = [];

  const terminationDate = readDate(pick(record, FIELD.terminationDate));
  const employmentStatus = readStatus(record, terminationDate, options, issues);

  const positionId = readId(pick(record, FIELD.positionId));
  if (positionId === null) issues.push("missing_position_id");

  const primaryLocationId = readId(pick(record, FIELD.primaryLocationId));
  if (primaryLocationId === null) issues.push("missing_primary_location");
  const primaryLocationName = text(pick(record, FIELD.primaryLocationName), MAX_LABEL);

  const hasMultipleLocations = readBoolean(pick(record, FIELD.hasMultipleLocations));

  const workEmail = readWorkEmail(pick(record, FIELD.workEmail), options.workEmailDomains, issues);

  /*
   * THE LIST ROW CAN SETTLE AFFILIATIONS IN ONE CASE ONLY: when it says there
   * are NOT multiple locations, the primary is the whole list. When it says
   * there are, or says nothing, a details read is needed; until then the
   * affiliations are unknown, and the list row's own `Locations`, if it has
   * one, is used.
   */
  const primary = { primaryLocationId, primaryLocationName };
  let affiliations: LocationAffiliation[] | null = readAffiliations(record, primary);
  if (affiliations === null && hasMultipleLocations === false) affiliations = primaryOnly(primary);

  return {
    ok: true,
    employee: {
      externalEmployeeId,
      firstName: text(pick(record, FIELD.firstName), MAX_NAME),
      lastName: text(pick(record, FIELD.lastName), MAX_NAME),
      preferredName: text(pick(record, FIELD.preferredName), MAX_NAME),
      workEmail,
      employmentStatus,
      hireDate: readDate(pick(record, FIELD.hireDate)),
      terminationDate,
      positionId,
      positionName: text(pick(record, FIELD.positionName), MAX_LABEL),
      primaryLocationId,
      primaryLocationName,
      affiliations,
      hasMultipleLocations,
      sourceUpdatedAt: readInstant(pick(record, FIELD.updatedAt)),
      issues,
    },
  };
}

/** True when this employee's affiliations can only be learned from a details read. */
export function needsDetails(employee: NormalizedEmployee): boolean {
  return employee.affiliations === null;
}

/** Folds a details response into an employee. Only the affiliation list is taken. */
export function withDetails(employee: NormalizedEmployee, details: unknown): NormalizedEmployee {
  const affiliations = readAffiliations(details, employee);
  return affiliations === null ? employee : { ...employee, affiliations };
}
