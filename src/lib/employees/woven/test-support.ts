/**
 * ============================================================================
 * MOCK WOVEN — fixtures and a fake Operations API, for tests only
 * ============================================================================
 *
 * Built from the DOCUMENTED field names (PositionID, PositionName,
 * PrimaryLocationID, PrimaryLocationName, Locations[], AccessToken,
 * queryskip/querytake) and the assumed spellings in `contract.ts`. It is the
 * contract as understood before live access, not a recording of a real
 * response — which is exactly why `docs/woven-employee-sync.md` §7 checks the
 * first live response against it.
 *
 * Every fixture employee also carries the SENSITIVE fields an HR record may
 * hold, each set to a `SENSITIVE-…` marker string, so a test can prove none of
 * them reaches anything Ask Sunny stores.
 *
 * All names, emails and ids are invented.
 */

export const SENSITIVE_MARKER = "SENSITIVE-";

export function sensitiveFields(): Record<string, unknown> {
  return {
    PayRate: "SENSITIVE-PAY-RATE",
    HourlyRate: "SENSITIVE-HOURLY",
    Salary: "SENSITIVE-SALARY",
    Compensation: { Amount: "SENSITIVE-COMPENSATION" },
    DateOfBirth: "SENSITIVE-DOB",
    BirthDate: "SENSITIVE-BIRTHDATE",
    PersonalPhone: "SENSITIVE-PERSONAL-PHONE",
    MobilePhone: "SENSITIVE-MOBILE",
    PersonalEmail: "SENSITIVE-personal@example.test",
    Email: "SENSITIVE-plain-email@example.test",
    HomeAddress: { Street: "SENSITIVE-STREET", City: "SENSITIVE-CITY" },
    Address1: "SENSITIVE-ADDRESS",
    EmergencyContacts: [{ Name: "SENSITIVE-EMERGENCY-NAME", Phone: "SENSITIVE-EMERGENCY-PHONE" }],
    SSN: "SENSITIVE-SSN",
    I9Status: "SENSITIVE-I9",
    I9Documents: ["SENSITIVE-I9-DOC"],
    BackgroundCheck: { Result: "SENSITIVE-BACKGROUND" },
    Notes: "SENSITIVE-NOTES",
    SecureDocuments: [{ Title: "SENSITIVE-SECURE-DOC" }],
    BankAccount: { Routing: "SENSITIVE-ROUTING", Account: "SENSITIVE-ACCOUNT" },
    PayrollID: "SENSITIVE-PAYROLL",
    LeaveBalance: "SENSITIVE-LEAVE",
    MedicalNotes: "SENSITIVE-MEDICAL",
  };
}

export interface FixtureEmployeeOptions {
  firstName?: string;
  lastName?: string;
  workEmail?: string | null;
  status?: string | null;
  hireDate?: string | null;
  terminationDate?: string | null;
  positionId?: string | null;
  positionName?: string | null;
  primaryLocationId?: string | null;
  primaryLocationName?: string | null;
  hasMultipleLocations?: boolean | null;
}

/** One `/employees` list row, as the documentation describes it. */
export function wovenEmployee(id: string, options: FixtureEmployeeOptions = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    EmployeeID: id,
    FirstName: options.firstName ?? `First${id}`,
    LastName: options.lastName ?? `Last${id}`,
    WorkEmail: options.workEmail === undefined ? `employee${id}@suntancity.test` : options.workEmail,
    Status: options.status === undefined ? "Active" : options.status,
    HireDate: options.hireDate === undefined ? "2024-03-11T00:00:00" : options.hireDate,
    TerminationDate: options.terminationDate === undefined ? "0001-01-01T00:00:00" : options.terminationDate,
    PositionID: options.positionId === undefined ? "POS-SC" : options.positionId,
    PositionName: options.positionName === undefined ? "Salon Consultant" : options.positionName,
    PrimaryLocationID: options.primaryLocationId === undefined ? "WL-0306" : options.primaryLocationId,
    PrimaryLocationName: options.primaryLocationName === undefined ? "KS Manhattan" : options.primaryLocationName,
    HasMultipleLocations: options.hasMultipleLocations === undefined ? false : options.hasMultipleLocations,
    ...sensitiveFields(),
  };
  for (const key of Object.keys(row)) if (row[key] === null) delete row[key];
  return row;
}

export interface FixtureLocation {
  id: string;
  name?: string;
  primary?: boolean;
  borrowed?: boolean;
  expires?: string;
}

/** One `/employees/{id}/details` body. */
export function wovenDetails(id: string, locations: FixtureLocation[]): Record<string, unknown> {
  return {
    EmployeeID: id,
    ...sensitiveFields(),
    Locations: locations.map((l) => ({
      LocationID: l.id,
      LocationName: l.name ?? `Location ${l.id}`,
      IsPrimary: l.primary === true,
      IsBorrowed: l.borrowed === true,
      ExpirationDate: l.expires ?? null,
      SupervisorPhone: "SENSITIVE-SUPERVISOR-PHONE",
    })),
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
  /** Seconds, sent as ExpiresIn. Omit to send no expiry at all. */
  tokenLifetimeSeconds?: number;
  /** The gateway's own cap on querytake, below what the client asks for. */
  maxTake?: number;
  /** Wrap pages as { Items, TotalCount } rather than a bare array. */
  envelope?: boolean;
  /** Ignore the status filter and return everyone for every pass. */
  ignoreStatusFilter?: boolean;
  subscriptionKey?: string;
  username?: string;
  password?: string;
}

export const FAKE_CREDENTIALS = {
  subscriptionKey: "test-subscription-key-000000",
  username: "ask-sunny-app-user",
  password: "test-password-not-real",
};

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
  };
  const key = options.subscriptionKey ?? FAKE_CREDENTIALS.subscriptionKey;
  const validTokens = new Set<string>();

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
      const body = JSON.parse(call.body ?? "{}") as Record<string, string>;
      if (
        body.UserName !== (options.username ?? FAKE_CREDENTIALS.username) ||
        body.Password !== (options.password ?? FAKE_CREDENTIALS.password)
      ) {
        return json({ message: "invalid credentials" }, 401);
      }
      const token = `token-${issuedTokens.length + 1}`;
      issuedTokens.push(token);
      validTokens.add(token);
      return json(
        options.tokenLifetimeSeconds === undefined
          ? { AccessToken: token }
          : { AccessToken: token, ExpiresIn: options.tokenLifetimeSeconds },
      );
    }

    if (call.method !== "GET") return json({ message: "method not allowed" }, 405);
    if (!validTokens.has(headers["accesstoken"] ?? "")) return json({ message: "token" }, 401);

    if (call.path === "/employees") {
      const status = call.query.status;
      const rows =
        status && !options.ignoreStatusFilter
          ? state.employees.filter((e) => String(e.Status ?? "").toLowerCase() === status.toLowerCase())
          : state.employees;
      const skip = Number(call.query.queryskip ?? 0);
      const take = Math.min(Number(call.query.querytake ?? 50), options.maxTake ?? Infinity);
      const page = rows.slice(skip, skip + take);
      return options.envelope ? json({ Items: page, TotalCount: rows.length }) : json(page);
    }

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
