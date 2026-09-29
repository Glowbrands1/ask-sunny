/**
 * ============================================================================
 * THE WOVEN OPERATIONS API CONTRACT — every Woven name this integration uses
 * ============================================================================
 *
 * Taken from the official Woven OpenAPI 3 export (`WovenTeam.Common.Models.*`),
 * not guessed. Each name is labelled:
 *
 *   SPEC      — stated by the OpenAPI export: a path, parameter, header or
 *               schema property with that exact spelling.
 *   VALIDATE  — the spec names the field but not what its VALUES mean
 *               (integer enums, the semantics of ExpiresOn). The read-only live
 *               check (docs/woven-employee-sync.md §7) settles these.
 *
 * Everything the client may call is listed here, and nothing else: the token
 * exchange (the only POST) and four GETs. Woven's write endpoints — employee
 * updates, borrow, primary-location changes, webhook registration — are not
 * named anywhere in this integration, and `client.ts` refuses any path this
 * file does not list.
 */

/* ------------------------------------------------------------ transport -- */

/** SPEC `servers[0].url`. */
export const DEFAULT_WOVEN_API_BASE_URL = "https://gateway-api.woven.team/api";

/** SPEC. The `ApiVersion` header's only enum value. */
export const WOVEN_API_VERSION = "1.0";

/** SPEC. `securitySchemes.apiKeyHeader`, and the per-operation headers. */
export const HEADER_SUBSCRIPTION_KEY = "Subscription-Key";
export const HEADER_API_VERSION = "ApiVersion";
export const HEADER_ACCESS_TOKEN = "AccessToken";

/** SPEC `POST /tokens/v2` (Token_Get_JwtToken). The one non-GET call — authentication, not a write. */
export const TOKEN_PATH = "/tokens/v2";

/** SPEC `GET /employees` (Employee_Get_Employees) and `GET /employees/{id}/details`. */
export const EMPLOYEES_PATH = "/employees";
export function employeeDetailsPath(employeeId: string): string {
  return `${EMPLOYEES_PATH}/${encodeURIComponent(employeeId)}/details`;
}
const EMPLOYEE_DETAILS_PATTERN = /^\/employees\/[^/]+\/details$/;

/** SPEC `GET /locations` — the requesting user's locations, so the integration user needs all of them. */
export const LOCATIONS_PATH = "/locations";

/** SPEC `GET /lists/enums` — `EnumerationType[]`: the names behind Woven's integer enums. */
export const ENUMS_PATH = "/lists/enums";

/** Every GET the client may send. Anything else is refused before it leaves the process. */
export function isAllowedReadPath(path: string): boolean {
  return path === EMPLOYEES_PATH || path === LOCATIONS_PATH || path === ENUMS_PATH || EMPLOYEE_DETAILS_PATTERN.test(path);
}

/* ---------------------------------------------------------- the token -- */

/**
 * SPEC `AuthenticationRequest`: `{CompanyID, Username, Password, Platform}`,
 * of which ONLY `Username` and `Password` are required. `CompanyID` is sent
 * when configured; without it Woven answers with the company it chose and the
 * companies the user may choose from, which is how the live check discovers it.
 * `Platform` is an unnamed integer (1–4) and is sent only when configured.
 */
export function tokenRequestBody(input: {
  username: string;
  password: string;
  companyId?: string | null;
  platform?: number | null;
}): Record<string, string | number> {
  const body: Record<string, string | number> = { Username: input.username, Password: input.password };
  if (input.companyId) body.CompanyID = input.companyId;
  if (input.platform) body.Platform = input.platform;
  return body;
}

/** SPEC `AuthenticationJwtResponse.AccessToken`. */
export const TOKEN_RESPONSE_TOKEN_KEYS = ["AccessToken"] as const;
/** SPEC `AuthenticationJwtResponse` states no relative lifetime. Kept empty so the client reads only what exists. */
export const TOKEN_RESPONSE_EXPIRES_IN_KEYS = [] as const satisfies readonly string[];
/** SPEC `AuthenticationJwtResponse.TokenExpirationDate`. */
export const TOKEN_RESPONSE_EXPIRES_AT_KEYS = ["TokenExpirationDate"] as const;
/** SPEC. The company the token was issued for, and the choices the user has. Identifiers, not secrets. */
export const TOKEN_RESPONSE_COMPANY_ID_KEY = "CompanyID";
export const TOKEN_RESPONSE_COMPANY_NAME_KEY = "CompanyName";
export const TOKEN_RESPONSE_MULTI_COMPANY_KEY = "HasMultipleCompanyAccess";
export const TOKEN_RESPONSE_COMPANY_OPTIONS_KEY = "CompanyLoginOptions";

/**
 * The lifetime assumed when the token response states none. Deliberately
 * short: a token treated as expired too early costs one extra token call.
 */
export const DEFAULT_TOKEN_LIFETIME_MS = 15 * 60 * 1000;

/* ---------------------------------------------------------- the list -- */

/** SPEC `GET /employees` query parameters. */
export const QUERY_SKIP = "queryskip";
export const QUERY_TAKE = "querytake";
export const QUERY_EMPLOYEE_STATUS = "employeestatus";
export const QUERY_LOCATION_IDS = "locationids";
export const QUERY_POSITION_IDS = "positionids";
export const QUERY_EMAIL_ADDRESS = "emailaddress";
export const QUERY_INCLUDE_TERMINATED = "includeterminatedemployee";
export const QUERY_TERMINATED_WITHIN_DAYS = "terminatedWithinLastNumberDays";

/**
 * THE TWO READS OF A RUN. The default list, then the list with
 * `includeterminatedemployee=true`. The second should be a superset of the
 * first; the sync merges them by EmployeeID and counts any employee the second
 * read left out, so a filter that behaves differently from the spec is visible
 * rather than silent. Neither pass implies a status: status comes only from
 * the employee's own `Status` integer, resolved through `/lists/enums`.
 */
export const EMPLOYEE_LIST_PASSES = [
  { label: "current", query: {} },
  { label: "with_terminated", query: { [QUERY_INCLUDE_TERMINATED]: "true" } },
] as const;

/** SPEC: `EmployeeArray` — a bare JSON array. No envelope and no total count. */
export const PAGE_ITEM_KEYS = [] as const satisfies readonly string[];
export const PAGE_TOTAL_KEYS = [] as const satisfies readonly string[];

/* -------------------------------------------------- employee fields -- */

/**
 * SPEC `WovenTeam.Common.Models.Employee` property names, exactly. One key per
 * field: the export is authoritative, so no alternative spellings are read.
 *
 * DELIBERATELY ABSENT, although the list and details responses carry them:
 * CellPhone, DateOfBirth, Username, RoleID/RoleName/RoleAuthorityLevel,
 * POSEmployeeID, ExternalZenotiID, TerminationReason, TerminatedAllowRehire,
 * RateOfPay*, Address, emergency contacts, Gender, Ethnicity, MaritalStatus,
 * Notes, PTO, images and two-factor settings. None is read, so none can be kept.
 */
export const FIELD = {
  employeeId: ["EmployeeID"],
  employeeLoginId: ["EmployeeLoginID"],
  externalHrisId: ["ExternalHRISID"],
  firstName: ["FirstName"],
  lastName: ["LastName"],
  preferredFirstName: ["PreferredFirstName"],
  /** Woven's only email field. There is no separate work-email field in the spec. */
  emailAddress: ["EmailAddress"],
  /** VALIDATE: an int32 whose meaning comes from `/lists/enums`. */
  status: ["Status"],
  hireDate: ["HireDate"],
  startDate: ["StartDate"],
  terminationDate: ["TerminationDate"],
  terminationLastDayWorked: ["TerminatedLastDayWorked"],
  /** VALIDATE: an int32 whose meaning comes from `/lists/enums`. */
  terminationType: ["TerminationType"],
  positionId: ["PositionID"],
  positionName: ["PositionName"],
  primaryLocationId: ["PrimaryLocationID"],
  primaryLocationName: ["PrimaryLocationName"],
  hasMultipleLocationAccess: ["HasMultipleLocationAccess"],
  allLocationAccess: ["AllLocationAccess"],
  isLoginAllowed: ["IsLoginAllowed"],
  vendorId: ["VendorID"],
  /** Details only: `EmployeeLocationAccess[]`. */
  locations: ["Locations"],
} as const;

/** SPEC `EmployeeLocationAccess` (details `Locations[]`) and `Location` (`GET /locations`). */
export const LOCATION_FIELD = {
  locationId: ["LocationID"],
  name: ["Name"],
  displayName: ["DisplayName"],
  number: ["Number"],
  /**
   * VALIDATE. Present on `EmployeeLocationAccess` only. Woven's borrow feature
   * sets one, but the spec does not say every ExpiresOn is a borrow, so an
   * entry carrying one is `temporary_or_expiring_access` and never "borrowed".
   */
  expiresOn: ["ExpiresOn"],
  districtId: ["DistrictID"],
  districtName: ["DistrictName"],
  regionId: ["RegionID"],
  regionName: ["RegionName"],
  isClosed: ["IsClosed"],
  isNonLocation: ["IsNonLocation"],
} as const;

/** SPEC `EnumerationType`. */
export const ENUM_FIELD = {
  enumerationName: "EnumerationName",
  propertyName: "PropertyName",
  propertyDisplayName: "PropertyDisplayName",
  propertyValue: "PropertyValue",
} as const;

/**
 * VALIDATE: which `EnumerationName` describes an employee's `Status`. The spec
 * names the enumeration list but not its entries, so these are candidates,
 * matched case-insensitively; the live check reports every name it sees.
 */
export const EMPLOYEE_STATUS_ENUM_NAMES = ["EmployeeStatus", "EmployeeStatusType", "TeamMemberStatus"] as const;
export const TERMINATION_TYPE_ENUM_NAMES = ["TerminationType", "EmployeeTerminationType"] as const;
/** Any enumeration name matching this is reported as a webhook-trigger vocabulary. */
export const WEBHOOK_TRIGGER_ENUM_PATTERN = /webhook|notificationtrigger/i;

/**
 * Status LABELS, compared case-insensitively after trimming. ONLY these mean
 * active or terminated. `Inactive`, a leave, a suspension or any label nobody
 * has seen yet resolves to `unknown`, which is never read as terminated.
 */
export const ACTIVE_STATUS_LABELS = ["active"] as const;
export const TERMINATED_STATUS_LABELS = ["terminated"] as const;

/**
 * The .NET default date. A .NET gateway serialises an unset date as this
 * rather than null, and it must never be read as somebody hired in year 1.
 */
export const DOTNET_MIN_DATE_PREFIX = "0001-01-01";

/** The all-zero GUID the spec uses as its example "no value" uuid. Read as null. */
export const EMPTY_GUID = "00000000-0000-0000-0000-000000000000";

/* ------------------------------------------------------ live validation -- */

/**
 * KEY NAMES that look like sensitive HR data. Live validation reports which of
 * these the application user's responses CONTAIN — never their values — which
 * is how a read-only, scoped Woven application user is tested. The sync
 * discards them either way.
 */
export const SENSITIVE_KEY_PATTERN =
  /pay|wage|salary|compens|bonus|birth|dob|ssn|social|tax|phone|mobile|address|street|zip|postal|emergency|i9|i-9|background|check|note|document|bank|routing|account|payroll|deposit|leave|medical|health|gender|ethnic|race|marital|personal|rehire|reason/i;
