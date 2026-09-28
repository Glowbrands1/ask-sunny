/**
 * ============================================================================
 * THE WOVEN OPERATIONS API CONTRACT — every name this integration assumes
 * ============================================================================
 *
 * Live access to the Operations API is pending Woven's approval of the
 * "Ask Sunny employee sync" subscription. Until a real response has been read,
 * some of what follows is taken from the portal documentation and some is an
 * informed guess at a field's exact spelling. They are kept in THIS FILE ONLY,
 * each labelled, so that live validation is a matter of correcting one list
 * rather than hunting through the client, the normaliser and the sync.
 *
 *   CONFIRMED  — stated by the Woven API portal documentation.
 *   ASSUMED    — the concept is confirmed, the exact key or value is not.
 *                Check it against the first live response
 *                (docs/woven-employee-sync.md §7 walks through how).
 *
 * Aliases are listed in preference order. The first key present on a record
 * wins; the rest are fallbacks for a spelling the documentation did not settle.
 */

/* ------------------------------------------------------------ transport -- */

/** CONFIRMED. The documented production gateway. */
export const DEFAULT_WOVEN_API_BASE_URL = "https://gateway-api.woven.team/api";

/** CONFIRMED. Sent on every call. */
export const WOVEN_API_VERSION = "1.0";

/** CONFIRMED. Header names. */
export const HEADER_SUBSCRIPTION_KEY = "Subscription-Key";
export const HEADER_API_VERSION = "ApiVersion";
export const HEADER_ACCESS_TOKEN = "AccessToken";

/** CONFIRMED. The one non-GET call this integration makes — authentication, not a write. */
export const TOKEN_PATH = "/tokens/v2";

/** CONFIRMED. The two employee reads. */
export const EMPLOYEES_PATH = "/employees";
export function employeeDetailsPath(employeeId: string): string {
  return `${EMPLOYEES_PATH}/${encodeURIComponent(employeeId)}/details`;
}

/**
 * ASSUMED: the token request body's key names. The documentation names a
 * "Woven application user"; whether the keys are `UserName`/`Password`,
 * `Username`/`Password` or `Email`/`Password` is the FIRST thing to confirm,
 * because nothing else can be tested until it is right.
 */
export function tokenRequestBody(username: string, password: string): Record<string, string> {
  return { UserName: username, Password: password };
}

/** CONFIRMED key name `AccessToken`; the lower-case form is a fallback. */
export const TOKEN_RESPONSE_TOKEN_KEYS = ["AccessToken", "accessToken", "access_token"] as const;

/** ASSUMED. Seconds until expiry, when the response states it that way. */
export const TOKEN_RESPONSE_EXPIRES_IN_KEYS = ["ExpiresIn", "expiresIn", "expires_in"] as const;

/** ASSUMED. An absolute expiry instant, when the response states it that way. */
export const TOKEN_RESPONSE_EXPIRES_AT_KEYS = [
  "ExpiresAt",
  "expiresAt",
  "Expiration",
  "ExpirationDate",
  "AccessTokenExpiration",
  "Expires",
] as const;

/**
 * The lifetime assumed when the token response states none. Deliberately
 * short: a token treated as expired too early costs one extra token call; one
 * treated as valid too long costs a 401 and a retry.
 */
export const DEFAULT_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------ pagination -- */

/** CONFIRMED. */
export const QUERY_SKIP = "queryskip";
export const QUERY_TAKE = "querytake";

/**
 * ASSUMED: filter parameter names. The documentation confirms status,
 * location and position filters exist; these spellings are not yet checked.
 */
export const QUERY_STATUS = "status";
export const QUERY_LOCATION = "locationid";
export const QUERY_POSITION = "positionid";

/**
 * ASSUMED: the status filter's values. The sync reads EACH pass in full and
 * merges them, because the team app files Active and Terminated separately and
 * there is no confirmed guarantee that an unfiltered read includes terminated
 * employees. `impliedStatus` is used only when a record states no status of
 * its own.
 */
export const EMPLOYEE_LIST_PASSES = [
  { label: "active", status: "Active", impliedStatus: "active" },
  { label: "terminated", status: "Terminated", impliedStatus: "terminated" },
] as const;

/** ASSUMED: where a paged response keeps its records, when it is not a bare array. */
export const PAGE_ITEM_KEYS = [
  "Items",
  "items",
  "Data",
  "data",
  "Results",
  "results",
  "Employees",
  "employees",
  "Records",
  "records",
  "Value",
  "value",
] as const;

/** ASSUMED: a total the response may report, used to prove a read was complete. */
export const PAGE_TOTAL_KEYS = [
  "TotalCount",
  "totalCount",
  "Total",
  "total",
  "TotalRecords",
  "totalRecords",
] as const;

/* ---------------------------------------------------------- employee fields -- */

/*
 * CONFIRMED concepts; the key spellings for PositionID, PositionName,
 * PrimaryLocationID, PrimaryLocationName and Locations[] are the documented
 * ones. The rest are ASSUMED spellings of confirmed concepts.
 */
export const FIELD = {
  employeeId: ["EmployeeID", "EmployeeId", "employeeId", "Id", "ID", "id"],
  firstName: ["FirstName", "firstName"],
  lastName: ["LastName", "lastName"],
  preferredName: ["PreferredName", "preferredName", "NickName", "Nickname", "nickname"],
  /**
   * WORK email only. A plain `Email` key is deliberately NOT an alias: in an HR
   * record it is as likely to be a personal address as a work one, and a
   * personal address is outside the allowlist. If the live response turns out
   * to carry the work address under `Email`, add it here knowingly.
   */
  workEmail: ["WorkEmail", "workEmail", "WorkEmailAddress", "workEmailAddress"],
  status: ["Status", "status", "EmploymentStatus", "employmentStatus", "EmployeeStatus", "employeeStatus"],
  isActive: ["IsActive", "isActive", "Active", "active"],
  isTerminated: ["IsTerminated", "isTerminated", "Terminated", "terminated"],
  hireDate: ["HireDate", "hireDate", "StartDate", "startDate", "DateOfHire", "dateOfHire"],
  terminationDate: ["TerminationDate", "terminationDate", "TermDate", "termDate", "DateOfTermination"],
  positionId: ["PositionID", "PositionId", "positionId"],
  positionName: ["PositionName", "positionName", "Position", "position"],
  primaryLocationId: ["PrimaryLocationID", "PrimaryLocationId", "primaryLocationId"],
  primaryLocationName: ["PrimaryLocationName", "primaryLocationName"],
  hasMultipleLocations: [
    "HasMultipleLocations",
    "hasMultipleLocations",
    "MultipleLocations",
    "multipleLocations",
    "IsMultiLocation",
    "isMultiLocation",
  ],
  locations: ["Locations", "locations"],
  updatedAt: ["ModifiedDate", "modifiedDate", "UpdatedAt", "updatedAt", "LastModified", "lastModified", "DateModified"],
} as const;

/** Fields of one entry of the details response's `Locations[]`. */
export const LOCATION_FIELD = {
  locationId: ["LocationID", "LocationId", "locationId", "Id", "ID", "id"],
  locationName: ["LocationName", "locationName", "Name", "name"],
  isPrimary: ["IsPrimary", "isPrimary", "Primary", "primary"],
  /** ASSUMED. Any of these being true marks a borrowed / temporary affiliation. */
  isTemporary: ["IsTemporary", "isTemporary", "IsBorrowed", "isBorrowed", "Borrowed", "borrowed", "IsBorrowing", "isBorrowing"],
  /** ASSUMED. A free-text type; a value matching /borrow|temp/i marks it temporary. */
  affiliationType: ["AffiliationType", "affiliationType", "Type", "type"],
  startsOn: ["StartDate", "startDate", "EffectiveDate", "effectiveDate"],
  expiresOn: ["ExpirationDate", "expirationDate", "ExpiresOn", "expiresOn", "EndDate", "endDate", "ExpiryDate", "expiryDate"],
} as const;

/**
 * Status values, compared case-insensitively after trimming.
 *
 * ONLY THESE mean terminated. `Inactive` is deliberately absent: in a workforce
 * system it can mean a leave or a seasonal pause, and reading it as a
 * termination would be the most consequential wrong guess this file could make.
 * An unrecognised value becomes `unknown`.
 */
export const ACTIVE_STATUS_VALUES = ["active", "employed", "current"] as const;
export const TERMINATED_STATUS_VALUES = ["terminated", "termed", "separated"] as const;

/**
 * The .NET default date. A gateway written in .NET serialises an unset date as
 * this rather than null, and it must never be read as somebody hired in year 1.
 */
export const DOTNET_MIN_DATE_PREFIX = "0001-01-01";
