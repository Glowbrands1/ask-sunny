/**
 * ============================================================================
 * MOCK WOVEN — fixtures and a fake Operations API, for tests only
 * ============================================================================
 *
 * Built from the OFFICIAL OpenAPI export's shapes: `Employee` list rows,
 * `EmployeeDetail` with `Locations: EmployeeLocationAccess[]`, `Location[]`
 * from `/locations`, `EnumerationType[]` from `/lists/enums`, and
 * `AuthenticationJwtResponse` from `POST /tokens/v2`. It is the spec, not a
 * recording of a real response — which is why the read-only live check
 * compares the first real response with it.
 *
 * Every fixture also carries the SENSITIVE fields the spec says those
 * responses include (CellPhone, DateOfBirth, RateOfPay, Address, emergency
 * contacts, Gender, Ethnicity, TerminationReason, …), each set to a
 * `SENSITIVE-…` marker, so a test can prove none reaches anything stored.
 *
 * All names, emails and ids are invented.
 */

export const SENSITIVE_MARKER = "SENSITIVE-";

/** Sensitive fields `GET /employees` rows carry, per the spec. */
export function sensitiveListFields(): Record<string, unknown> {
  return {
    CellPhone: "SENSITIVE-CELL",
    DateOfBirth: "SENSITIVE-DOB",
    Username: "SENSITIVE-USERNAME",
    RoleID: "SENSITIVE-ROLE-ID",
    RoleName: "SENSITIVE-ROLE-NAME",
    RoleAuthorityLevel: 99,
    POSEmployeeID: "SENSITIVE-POS",
    ExternalZenotiID: "SENSITIVE-ZENOTI",
    TerminatedAllowRehire: "SENSITIVE-REHIRE",
    ProfileImageURL: "SENSITIVE-IMAGE",
    EmployeeTwoFactorAuthentication: { TwoFactorAuthenticationCellPhone: "SENSITIVE-2FA-PHONE", EmailAddress: "SENSITIVE-2FA@example.test" },
  };
}

/** Sensitive fields `GET /employees/{id}/details` adds, per the spec. */
export function sensitiveDetailFields(): Record<string, unknown> {
  return {
    ...sensitiveListFields(),
    RateOfPay: "SENSITIVE-RATE",
    RateOfPay2: "SENSITIVE-RATE-2",
    PaymentMethod: "SENSITIVE-PAYMENT",
    PayType: "SENSITIVE-PAYTYPE",
    TerminationReason: "SENSITIVE-TERMINATION-REASON",
    Notes: "SENSITIVE-NOTES",
    Address: { Address1: "SENSITIVE-STREET", City: "SENSITIVE-CITY" },
    HomePhone: "SENSITIVE-HOME-PHONE",
    EmergencyContactName: "SENSITIVE-EMERGENCY-NAME",
    EmergencyContactCellPhone: "SENSITIVE-EMERGENCY-PHONE",
    MaritalStatus: "SENSITIVE-MARITAL",
    Ethnicity: "SENSITIVE-ETHNICITY",
    Gender: "SENSITIVE-GENDER",
    PTODaysPerYear: "SENSITIVE-PTO",
  };
}

/** The fake's `/lists/enums` vocabulary. Woven's real names are confirmed by the live check. */
export const FAKE_STATUS = { active: 1, terminated: 2, onLeave: 3 } as const;

export const FAKE_ENUMS: Record<string, unknown>[] = [
  { EnumerationName: "EmployeeStatus", PropertyName: "Active", PropertyDisplayName: "Active", PropertyValue: 1 },
  { EnumerationName: "EmployeeStatus", PropertyName: "Terminated", PropertyDisplayName: "Terminated", PropertyValue: 2 },
  { EnumerationName: "EmployeeStatus", PropertyName: "OnLeave", PropertyDisplayName: "On Leave", PropertyValue: 3 },
  { EnumerationName: "TerminationType", PropertyName: "Voluntary", PropertyDisplayName: "Voluntary", PropertyValue: 1 },
  { EnumerationName: "TerminationType", PropertyName: "Involuntary", PropertyDisplayName: "Involuntary", PropertyValue: 2 },
  { EnumerationName: "CompanyWebhookNotificationTrigger", PropertyName: "WorkOrderCreated", PropertyDisplayName: "Work Order Created", PropertyValue: 6 },
  { EnumerationName: "CompanyWebhookNotificationTrigger", PropertyName: "WorkOrderUpdated", PropertyDisplayName: "Work Order Updated", PropertyValue: 8 },
];

export interface FixtureEmployeeOptions {
  firstName?: string;
  lastName?: string;
  preferredFirstName?: string | null;
  email?: string | null;
  /** A `Status` integer. Defaults to FAKE_STATUS.active. */
  status?: number | null;
  hireDate?: string | null;
  startDate?: string | null;
  terminationDate?: string | null;
  lastDayWorked?: string | null;
  terminationType?: number | null;
  positionId?: string | null;
  positionName?: string | null;
  primaryLocationId?: string | null;
  primaryLocationName?: string | null;
  hasMultipleLocationAccess?: boolean | null;
  allLocationAccess?: boolean | null;
  vendorId?: string | null;
}

/** One `/employees` list row, shaped like `WovenTeam.Common.Models.Employee`. */
export function wovenEmployee(id: string, options: FixtureEmployeeOptions = {}): Record<string, unknown> {
  const pick = <T,>(value: T | undefined, fallback: T) => (value === undefined ? fallback : value);
  const row: Record<string, unknown> = {
    EmployeeID: id,
    EmployeeLoginID: `LOGIN-${id}`,
    ExternalHRISID: `HRIS-${id}`,
    FirstName: options.firstName ?? `First${id}`,
    LastName: options.lastName ?? `Last${id}`,
    PreferredFirstName: pick(options.preferredFirstName, null),
    FullName: `SENSITIVE-FULLNAME-${id}`,
    EmailAddress: pick(options.email, `employee${id}@suntancity.test`),
    Status: pick<number | null>(options.status, 1),
    HireDate: pick(options.hireDate, "2024-03-11T00:00:00"),
    StartDate: pick(options.startDate, "2024-03-18T00:00:00"),
    TerminationDate: pick(options.terminationDate, "0001-01-01T00:00:00"),
    TerminatedLastDayWorked: pick(options.lastDayWorked, "0001-01-01T00:00:00"),
    TerminationType: pick(options.terminationType, 0),
    PositionID: pick(options.positionId, "POS-SC"),
    PositionName: pick(options.positionName, "Salon Consultant"),
    PositionColor: "#123456",
    PrimaryLocationID: pick(options.primaryLocationId, "WL-0306"),
    PrimaryLocationName: pick(options.primaryLocationName, "KS Manhattan"),
    HasMultipleLocationAccess: pick(options.hasMultipleLocationAccess, false),
    AllLocationAccess: pick(options.allLocationAccess, false),
    IsLoginAllowed: true,
    VendorID: pick(options.vendorId, "00000000-0000-0000-0000-000000000000"),
    CompanyID: "11111111-1111-1111-1111-111111111111",
    ...sensitiveListFields(),
  };
  for (const key of Object.keys(row)) if (row[key] === null) delete row[key];
  return row;
}

export interface FixtureLocation {
  id: string;
  name?: string;
  number?: string;
  expires?: string;
}

/** One `/employees/{id}/details` body, shaped like `EmployeeDetail`. */
export function wovenDetails(id: string, locations: FixtureLocation[]): Record<string, unknown> {
  return {
    EmployeeID: id,
    ...sensitiveDetailFields(),
    Locations: locations.map((l) => ({
      LocationID: l.id,
      CompanyID: "11111111-1111-1111-1111-111111111111",
      Name: l.name ?? `Location ${l.id}`,
      DisplayName: l.name ?? `Location ${l.id}`,
      Number: l.number ?? null,
      ExpiresOn: l.expires ?? "0001-01-01T00:00:00",
      PrimaryPhone: "SENSITIVE-LOCATION-PHONE",
      ManagerEmployeeName: "SENSITIVE-MANAGER-NAME",
      LocationAddress: { Address1: "SENSITIVE-LOCATION-STREET" },
    })),
  };
}

/** One `/locations` entry, shaped like `Location`. */
export function wovenLocation(id: string, options: Partial<{ name: string; number: string; district: string; region: string; closed: boolean; nonLocation: boolean }> = {}) {
  return {
    LocationID: id,
    CompanyID: "11111111-1111-1111-1111-111111111111",
    Name: options.name ?? `Location ${id}`,
    DisplayName: options.name ?? `Location ${id}`,
    Number: options.number ?? null,
    DistrictID: "22222222-2222-2222-2222-222222222222",
    DistrictName: options.district ?? "North",
    RegionID: "33333333-3333-3333-3333-333333333333",
    RegionName: options.region ?? "Central",
    IsClosed: options.closed ?? false,
    IsNonLocation: options.nonLocation ?? false,
    PrimaryPhone: "SENSITIVE-LOCATION-PHONE",
    ManagerEmployeeName: "SENSITIVE-MANAGER-NAME",
  };
}

/* ------------------------------------------------------------ fake API -- */

export interface RecordedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string | null;
}

type Scripted = Response | "timeout" | "network";

interface Override {
  when: (call: RecordedCall) => boolean;
  respond: (call: RecordedCall) => Scripted;
  times: number;
}

export interface FakeWovenOptions {
  employees: Record<string, unknown>[];
  details?: Record<string, Record<string, unknown>>;
  locations?: Record<string, unknown>[];
  enums?: Record<string, unknown>[] | null;
  /** Seconds, sent as TokenExpirationDate relative to `clock`. Omit to send no expiry. */
  tokenLifetimeSeconds?: number;
  /** The clock the token expiry is computed against. Defaults to real time. */
  clock?: () => number;
  /** The gateway's own cap on querytake, below what the client asks for. */
  maxTake?: number;
  /** Return terminated employees even without includeterminatedemployee. */
  alwaysIncludeTerminated?: boolean;
  subscriptionKey?: string;
  username?: string;
  password?: string;
  /** When set, the token request must carry exactly this CompanyID. */
  requiredCompanyId?: string;
}

export const FAKE_CREDENTIALS = {
  subscriptionKey: "test-subscription-key-000000",
  username: "ask-sunny-app-user",
  password: "test-password-not-real",
};

export const FAKE_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function createFakeWoven(options: FakeWovenOptions) {
  const calls: RecordedCall[] = [];
  const overrides: Override[] = [];
  const issuedTokens: string[] = [];
  const state = {
    employees: options.employees,
    details: options.details ?? {},
    locations: options.locations ?? [],
    enums: options.enums === undefined ? FAKE_ENUMS : options.enums,
  };
  const key = options.subscriptionKey ?? FAKE_CREDENTIALS.subscriptionKey;
  const validTokens = new Set<string>();
  const clock = options.clock ?? Date.now;

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => (headers[name.toLowerCase()] = value));
    const call: RecordedCall = {
      method: init?.method ?? "GET",
      path: url.pathname.replace(/^\/api/, ""),
      query: Object.fromEntries(url.searchParams),
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    };
    calls.push(call);

    const override = overrides.find((o) => o.times > 0 && o.when(call));
    if (override) {
      override.times -= 1;
      const scripted = override.respond(call);
      if (scripted === "timeout") {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      if (scripted === "network") throw new TypeError("fetch failed");
      return scripted;
    }

    if (headers["subscription-key"] !== key) return json({ message: "bad key" }, 401);
    if (headers["apiversion"] !== "1.0") return json({ message: "version" }, 400);

    if (call.method === "POST" && call.path === "/tokens/v2") {
      const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
      if (
        body.Username !== (options.username ?? FAKE_CREDENTIALS.username) ||
        body.Password !== (options.password ?? FAKE_CREDENTIALS.password)
      ) {
        return json({ message: "invalid credentials" }, 400);
      }
      if (options.requiredCompanyId && body.CompanyID !== options.requiredCompanyId) {
        return json({ message: "company" }, 400);
      }
      const token = `token-${issuedTokens.length + 1}`;
      issuedTokens.push(token);
      validTokens.add(token);
      return json({
        AccessToken: token,
        ...(options.tokenLifetimeSeconds === undefined
          ? {}
          : { TokenExpirationDate: new Date(clock() + options.tokenLifetimeSeconds * 1000).toISOString() }),
        RefreshToken: "SENSITIVE-REFRESH-TOKEN",
        CompanyID: FAKE_COMPANY_ID,
        CompanyName: "Sun Tan City (test)",
        HasMultipleCompanyAccess: false,
        CompanyLoginOptions: [{ CompanyID: FAKE_COMPANY_ID, CompanyName: "Sun Tan City (test)" }],
        FirstName: "SENSITIVE-APP-USER-FIRST",
      });
    }

    if (call.method !== "GET") return json({ message: "method not allowed" }, 405);
    if (!validTokens.has(headers["accesstoken"] ?? "")) return json({ message: "token" }, 401);

    if (call.path === "/employees") {
      const includeTerminated = call.query.includeterminatedemployee === "true" || options.alwaysIncludeTerminated;
      const rows = includeTerminated ? state.employees : state.employees.filter((e) => e.Status !== 2);
      const skip = Number(call.query.queryskip ?? 0);
      const take = Math.min(Number(call.query.querytake ?? 50), options.maxTake ?? Infinity);
      return json(rows.slice(skip, skip + take));
    }
    if (call.path === "/lists/enums") {
      return state.enums === null ? json({ message: "not found" }, 404) : json(state.enums);
    }
    if (call.path === "/locations") return json(state.locations);

    const detail = /^\/employees\/([^/]+)\/details$/.exec(call.path);
    if (detail) {
      const body = state.details[decodeURIComponent(detail[1])];
      return body ? json(body) : json({ message: "not found" }, 404);
    }
    return json({ message: "no route" }, 404);
  }) as typeof fetch;

  return {
    fetch: fakeFetch,
    calls,
    issuedTokens,
    state,
    /** Revokes every issued token, as a server-side expiry would. */
    expireTokens() {
      validTokens.clear();
    },
    /** Scripts the next `times` matching calls. */
    override(when: (call: RecordedCall) => boolean, respond: (call: RecordedCall) => Scripted, times = 1) {
      overrides.push({ when, respond, times });
    },
    json,
  };
}
