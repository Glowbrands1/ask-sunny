import "server-only";

import { WovenApiError, WovenClient, type EmployeeListResult, type TokenInfo } from "./client";
import type { WovenConfig } from "./config";
import {
  EMPLOYEES_PATH,
  EMPLOYEE_LIST_PASSES,
  FIELD,
  LOCATION_FIELD,
  QUERY_SKIP,
  QUERY_TAKE,
  SENSITIVE_KEY_PATTERN,
} from "./contract";
import {
  employeeWebhookTriggers,
  parseEnums,
  statusResolver,
  terminationTypeLabels,
  webhookTriggerVocabulary,
  type WovenEnumEntry,
} from "./enums";
import { normalizeEmployee, readAffiliations, readCatalogLocation, readId } from "./normalize";

/**
 * ============================================================================
 * LIVE VALIDATION — does the real Operations API match the OpenAPI export?
 * ============================================================================
 *
 * READ-ONLY. The token exchange, then GETs only: `/lists/enums`, every page of
 * both list passes, a small SAMPLE of employee details, and `/locations`.
 * Nothing is written to Woven, and nothing is written to Supabase. The caller
 * may pass the Ask Sunny salon numbers it has already read, for the location
 * coverage comparison; this module reads no database itself.
 *
 * AGGREGATES, KEY NAMES AND WOVEN VOCABULARY ONLY. The report carries counts,
 * KEY NAMES, Woven's own ENUM labels ("Active", "Terminated", trigger names),
 * email DOMAINS with counts, the CompanyID and company names from the token
 * response, and verdicts. It never carries a person's name, email address,
 * employee id, date or title. Location numbers and names appear only in
 * `locationReview`, which the route fills for a `manage_users` caller alone.
 * Errors are carried as the client's error CODE and HTTP status — never a
 * response body, a URL (a details URL contains an employee id) or a header.
 *
 * WHAT IT SETTLES that the spec cannot:
 *   - the CompanyID, when it is not in the Woven portal;
 *   - what the Status and TerminationType integers mean;
 *   - whether Woven has employee webhook triggers, by reading their names;
 *   - whether `includeterminatedemployee` returns a superset;
 *   - how often `Locations[]` carries an `ExpiresOn`. What it MEANS is not
 *     settled here: it is reported as needing live operational confirmation;
 *   - how Woven's location Numbers line up with Ask Sunny's salon numbers;
 *   - which sensitive fields the application user can see.
 */

export type Verdict = "pass" | "warn" | "fail";

export interface Finding {
  verdict: Verdict;
  area: string;
  message: string;
}

export interface PassReport {
  label: string;
  records: number;
  pages: number;
  pageSizes: number[];
  shape: EmployeeListResult["shape"];
  /** Raw `Status` integers with counts. */
  statusCodes: Record<string, number>;
  keysReturned: string[];
  keysNotInContract: string[];
  /** Contract field → records carrying it. */
  fieldCoverage: Record<string, number>;
}

/** What an `ExpiresOn` on a location entry means. Not known until confirmed against a real case. */
export const EXPIRES_ON_MEANING = "needs_live_operational_confirmation" as const;

export interface DetailsReport {
  /** True when fewer detail records were read than there were eligible employees. */
  isSample: boolean;
  /** Employees the sample was drawn from (not terminated). */
  eligible: number;
  /** The most detail records one validation reads. */
  sampleLimit: number;
  /** Detail records actually read. */
  sampled: number;
  failed: number;
  /** Error code → count for the detail reads that failed. */
  failureCodes: Record<string, number>;
  keysReturned: string[];
  withLocationsArray: number;
  /** Detail records whose Locations[] names more than one distinct location. */
  withMoreThanOneLocation: number;
  locationEntryKeys: string[];
  accessTypes: { primary: number; additional: number; temporary_or_expiring_access: number };
  /** Location entries, across the sampled records, carrying a real ExpiresOn. */
  entriesWithExpiresOn: number;
  expiresOnMeaning: typeof EXPIRES_ON_MEANING;
  allLocationEmployeesSampled: number;
  allLocationEmployeesWithEmptyList: number;
}

export interface EnumsReport {
  outcome: "answered" | "unavailable";
  enumerationNames: Record<string, number>;
  statusEnumeration: string | null;
  statusLabels: Record<string, string>;
  terminationTypeLabels: Record<string, string>;
  webhookTriggerVocabularies: Record<string, { value: number; name: string }[]>;
  employeeWebhookTriggers: string[];
}

/** The Ask Sunny salons the route read, or that it could not read them. */
export interface SalonComparisonInput {
  outcome: "loaded" | "unavailable";
  salons: { number: string; name: string }[];
}

/**
 * Woven `/locations` against `salons.salon_number`, EXACT string equality —
 * the same rule the mapping suggestions use. Aggregates only; nothing is
 * mapped or confirmed.
 */
export interface SalonCoverage {
  outcome: "compared" | "salons_unavailable" | "not_compared";
  salons: number;
  /** Woven locations whose Number equals a salon number exactly. */
  exactMatches: number;
  /** Salons with at least one exactly matching Woven location. */
  salonsMatched: number;
  /** Woven locations with no exact match, including those with no Number. */
  unmatchedWovenLocations: number;
  /** Of those, the ones neither closed nor flagged as a non-location. */
  unmatchedOpenWovenLocations: number;
  salonsWithoutWovenLocation: number;
  /** Would match only if leading zeros were ignored. NOT counted as matches. */
  leadingZeroOnlyMatches: number;
  /** Woven Numbers carried by more than one Woven location. */
  duplicateWovenNumbers: number;
}

export interface LocationsReport {
  outcome: "answered" | "not_found" | "refused" | "error";
  records: number;
  withNumber: number;
  nonLocations: number;
  closed: number;
  keysReturned: string[];
  salonCoverage: SalonCoverage;
}

/** Location numbers and names behind the coverage counts. `manage_users` only. Never employees. */
export interface LocationReview {
  wovenLocations: {
    number: string | null;
    name: string | null;
    closed: boolean | null;
    nonLocation: boolean | null;
    matchedSalonNumber: string | null;
  }[];
  salonsWithoutWovenLocation: { number: string; name: string }[];
}

export interface ValidationReport {
  ok: boolean;
  checkedAt: string;
  baseUrl: string;
  requestsMade: number;
  token: (TokenInfo & { ok: true }) | { ok: false; code: string; status: number | null };
  enums: EnumsReport | null;
  passes: PassReport[];
  /** Employees in the default read that the with-terminated read did not return. */
  currentNotInWithTerminated: number;
  details: DetailsReport | null;
  locations: LocationsReport | null;
  normalized: {
    employees: number;
    rejected: number;
    active: number;
    terminated: number;
    statusUnknown: number;
    distinctPositionIds: number;
    distinctPrimaryLocations: number;
    multipleLocationFlagTrue: number;
    multipleLocationFlagFalse: number;
    allLocationAccess: number;
    issueCounts: Record<string, number>;
    /** Email domain → count, as stored (no domain filter applies to storage). */
    emailDomains: Record<string, number>;
    /** How many addresses the CONFIGURED login-email rule would accept. */
    loginEligibleByDomain: number;
  };
  locationReview: LocationReview | null;
  sensitiveKeysReturned: string[];
  /**
   * Where live behaviour differed from the OpenAPI export, in sanitized words:
   * codes, statuses and key names. Empty means none was seen.
   */
  specDiscrepancies: string[];
  findings: Finding[];
}

const KEY_SAMPLE = 250;
const DETAIL_SAMPLE = 10;
const MAPPED_KEYS = new Set<string>([...Object.values(FIELD).flat(), ...Object.values(LOCATION_FIELD).flat()]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function keysOf(records: unknown[], limit = KEY_SAMPLE): string[] {
  const keys = new Set<string>();
  for (const record of records.slice(0, limit)) {
    if (isRecord(record)) for (const key of Object.keys(record)) keys.add(key);
  }
  return [...keys].sort();
}

function has(record: Record<string, unknown>, aliases: readonly string[]): boolean {
  return aliases.some((key) => Object.hasOwn(record, key) && record[key] !== null && record[key] !== undefined && record[key] !== "");
}

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function coverage(records: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const field of Object.keys(FIELD)) out[field] = 0;
  for (const record of records) {
    if (!isRecord(record)) continue;
    for (const [field, aliases] of Object.entries(FIELD)) if (has(record, aliases)) out[field] += 1;
  }
  return out;
}

function statusCodes(records: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const record of records) {
    if (!isRecord(record)) continue;
    const raw = record[FIELD.status[0]];
    const key = typeof raw === "number" && Number.isInteger(raw) ? String(raw) : raw === undefined || raw === null ? "(none)" : "(not an integer)";
    if (Object.keys(out).length < 25 || key in out) bump(out, key);
    else bump(out, "(other)");
  }
  return out;
}

function recordId(record: unknown): string | null {
  if (!isRecord(record)) return null;
  return readId(record[FIELD.employeeId[0]]);
}

function sensitiveKeys(keys: Iterable<string>): string[] {
  /* Keys the contract maps are allowlisted fields ("EmailAddress" is not a home address). */
  return [...new Set([...keys].filter((key) => !MAPPED_KEYS.has(key) && SENSITIVE_KEY_PATTERN.test(key)))].sort();
}

export type ValidationClient = Pick<
  WovenClient,
  "get" | "listEmployees" | "getEmployeeDetails" | "listLocations" | "listEnums" | "requestsMade" | "tokenInfo"
>;

export interface ValidationOptions {
  config: WovenConfig;
  client?: ValidationClient;
  now?: () => Date;
  /** Ask Sunny's salons, read by the caller. Absent: the coverage comparison is not made. */
  salons?: SalonComparisonInput;
  /** Fill `locationReview` with location numbers and names. The route sets it for `manage_users` only. */
  includeLocationReview?: boolean;
}

/* Error codes that say the API answered differently from the spec, not that it was unreachable or refused us. */
const SPEC_ERROR_CODES = new Set(["bad_response", "not_found", "request_rejected", "pagination_not_advancing", "pagination_runaway"]);

function describeError(error: unknown): { code: string; status: number | null } {
  return error instanceof WovenApiError ? { code: error.code, status: error.status } : { code: "unexpected", status: null };
}

function errorLabel({ code, status }: { code: string; status: number | null }): string {
  return `${code}${status ? `, HTTP ${status}` : ""}`;
}

const NOT_COMPARED: SalonCoverage = {
  outcome: "not_compared",
  salons: 0,
  exactMatches: 0,
  salonsMatched: 0,
  unmatchedWovenLocations: 0,
  unmatchedOpenWovenLocations: 0,
  salonsWithoutWovenLocation: 0,
  leadingZeroOnlyMatches: 0,
  duplicateWovenNumbers: 0,
};

const withoutLeadingZeros = (value: string) => value.replace(/^0+(?=.)/, "");

export function compareSalonCoverage(
  locations: { number: string | null; name: string | null; isClosed: boolean | null; isNonLocation: boolean | null }[],
  salons: SalonComparisonInput | undefined,
): { coverage: SalonCoverage; review: LocationReview } {
  const review: LocationReview = { wovenLocations: [], salonsWithoutWovenLocation: [] };
  if (!salons) return { coverage: { ...NOT_COMPARED }, review };
  if (salons.outcome === "unavailable") return { coverage: { ...NOT_COMPARED, outcome: "salons_unavailable" }, review };

  const salonNumbers = new Set(salons.salons.map((salon) => salon.number));
  const salonsByLooseNumber = new Set(salons.salons.map((salon) => withoutLeadingZeros(salon.number)));
  const matchedSalons = new Set<string>();
  const numberCounts = new Map<string, number>();
  const coverage: SalonCoverage = { ...NOT_COMPARED, outcome: "compared", salons: salonNumbers.size };

  for (const location of locations) {
    const number = location.number?.trim() || null;
    if (number) numberCounts.set(number, (numberCounts.get(number) ?? 0) + 1);
    const matched = number !== null && salonNumbers.has(number);
    if (matched) {
      coverage.exactMatches += 1;
      matchedSalons.add(number);
    } else {
      coverage.unmatchedWovenLocations += 1;
      if (location.isClosed !== true && location.isNonLocation !== true) coverage.unmatchedOpenWovenLocations += 1;
      if (number !== null && salonsByLooseNumber.has(withoutLeadingZeros(number))) coverage.leadingZeroOnlyMatches += 1;
    }
    review.wovenLocations.push({
      number,
      name: location.name,
      closed: location.isClosed,
      nonLocation: location.isNonLocation,
      matchedSalonNumber: matched ? number : null,
    });
  }
  coverage.salonsMatched = matchedSalons.size;
  coverage.salonsWithoutWovenLocation = salonNumbers.size - matchedSalons.size;
  coverage.duplicateWovenNumbers = [...numberCounts.values()].filter((count) => count > 1).length;
  review.salonsWithoutWovenLocation = salons.salons
    .filter((salon) => !matchedSalons.has(salon.number))
    .sort((a, b) => a.number.localeCompare(b.number));
  /* Numbered locations first, in number order; those without a Number last. */
  review.wovenLocations.sort((a, b) =>
    a.number === null ? (b.number === null ? 0 : 1) : b.number === null ? -1 : a.number.localeCompare(b.number),
  );
  return { coverage, review };
}

export async function runWovenLiveValidation(options: ValidationOptions): Promise<ValidationReport> {
  const { config } = options;
  const now = options.now ?? (() => new Date());
  if (!config.credentials) throw new Error("Woven credentials are not configured.");

  const client: ValidationClient =
    options.client ??
    new WovenClient({
      baseUrl: config.baseUrl,
      credentials: config.credentials,
      companyId: config.companyId,
      platform: config.platform,
      deadlineAt: Date.now() + 240_000,
    });

  const findings: Finding[] = [];
  const allKeys = new Set<string>();
  const report: ValidationReport = {
    ok: false,
    checkedAt: now().toISOString(),
    baseUrl: config.baseUrl,
    requestsMade: 0,
    token: { ok: false, code: "not_attempted", status: null },
    enums: null,
    passes: [],
    currentNotInWithTerminated: 0,
    details: null,
    locations: null,
    normalized: {
      employees: 0,
      rejected: 0,
      active: 0,
      terminated: 0,
      statusUnknown: 0,
      distinctPositionIds: 0,
      distinctPrimaryLocations: 0,
      multipleLocationFlagTrue: 0,
      multipleLocationFlagFalse: 0,
      allLocationAccess: 0,
      issueCounts: {},
      emailDomains: {},
      loginEligibleByDomain: 0,
    },
    locationReview: null,
    sensitiveKeysReturned: [],
    specDiscrepancies: [],
    findings,
  };
  const spec = (message: string) => report.specDiscrepancies.push(message);

  /* ---- 1. authentication, via the first small read ---- */
  try {
    await client.get(EMPLOYEES_PATH, { [QUERY_SKIP]: 0, [QUERY_TAKE]: 1 });
  } catch (error) {
    const { code, status } = describeError(error);
    const onToken = error instanceof WovenApiError && error.path === "/tokens/v2";
    if (SPEC_ERROR_CODES.has(code)) {
      spec(`${onToken ? "POST /tokens/v2" : "The first GET /employees"} answered in a way the spec does not describe (${errorLabel({ code, status })}).`);
    }
    report.token = onToken || client.tokenInfo === null ? { ok: false, code, status } : { ...client.tokenInfo, ok: true };
    findings.push({
      verdict: "fail",
      area: "Sign-in",
      message: onToken
        ? code === "forbidden"
          ? "Woven refused the token request (403). The subscription key may not be active for this product, or the application user may lack API access."
          : "Woven did not issue an access token. Check the subscription key, the application user and, if set, WOVEN_COMPANY_ID."
        : `The first employee read failed (${code}${status ? `, HTTP ${status}` : ""}).`,
    });
    report.requestsMade = client.requestsMade;
    return report;
  }
  const token = client.tokenInfo!;
  report.token = { ...token, ok: true };
  findings.push({ verdict: "pass", area: "Sign-in", message: "Woven issued an access token and accepted it on /employees." });
  if (!token.companyIdSent) {
    findings.push({
      verdict: token.companyId ? "pass" : "warn",
      area: "Company",
      message: token.companyId
        ? `No WOVEN_COMPANY_ID was sent; Woven chose company ${token.companyId}${token.companyName ? ` (${token.companyName})` : ""}${token.hasMultipleCompanyAccess ? `, and this user can also sign in to ${token.companyOptions.length} compan${token.companyOptions.length === 1 ? "y" : "ies"} listed in the report` : ""}. Confirm it is the right one, then set WOVEN_COMPANY_ID.`
        : "No WOVEN_COMPANY_ID was sent and the token response named no CompanyID. Find it in the Woven portal.",
    });
  }
  if (token.tokenFrom === "header") {
    spec("The AccessToken came back in a response header, not in the /tokens/v2 response body the spec describes.");
  }
  if (token.lifetimeSource !== "expires_at") {
    spec(`The /tokens/v2 response had no usable TokenExpirationDate (${token.lifetimeSource === "expires_in" ? "a lifetime in seconds was used instead" : "a 15-minute default is assumed"}).`);
  }
  if (token.lifetimeSource === "default") {
    findings.push({
      verdict: "warn",
      area: "Sign-in",
      message: `The token response had no usable TokenExpirationDate (keys: ${token.responseKeys.join(", ") || "none"}). The client assumes 15 minutes.`,
    });
  }

  /* ---- 2. Woven's enum vocabulary ---- */
  let entries: WovenEnumEntry[] | null = null;
  let enumsError: { code: string; status: number | null } | null = null;
  try {
    entries = parseEnums(await client.listEnums());
  } catch (error) {
    entries = null;
    enumsError = describeError(error);
  }
  const statuses = statusResolver(entries);
  if (entries === null) {
    report.enums = {
      outcome: "unavailable",
      enumerationNames: {},
      statusEnumeration: null,
      statusLabels: {},
      terminationTypeLabels: {},
      webhookTriggerVocabularies: {},
      employeeWebhookTriggers: [],
    };
    findings.push({
      verdict: "fail",
      area: "Status values",
      message: `GET /lists/enums could not be read (${errorLabel(enumsError ?? { code: "unrecognised_shape", status: null })}), so Status integers cannot be resolved. A real sync is refused until they can.`,
    });
    if (!enumsError || SPEC_ERROR_CODES.has(enumsError.code)) {
      spec(`GET /lists/enums did not answer as the spec describes (${errorLabel(enumsError ?? { code: "unrecognised_shape", status: null })}).`);
    }
  } else {
    const names: Record<string, number> = {};
    for (const e of entries) bump(names, e.enumerationName);
    const vocab = webhookTriggerVocabulary(entries);
    const employeeTriggers = employeeWebhookTriggers(entries);
    report.enums = {
      outcome: "answered",
      enumerationNames: names,
      statusEnumeration: statuses.enumerationName,
      statusLabels: Object.fromEntries(Object.entries(statuses.labels).map(([k, v]) => [k, v])),
      terminationTypeLabels: Object.fromEntries(Object.entries(terminationTypeLabels(entries)).map(([k, v]) => [k, v])),
      webhookTriggerVocabularies: vocab,
      employeeWebhookTriggers: employeeTriggers,
    };
    findings.push(
      statuses.source === "enums"
        ? { verdict: "pass", area: "Status values", message: `Status integers resolve through the "${statuses.enumerationName}" enumeration: ${Object.entries(statuses.labels).map(([v, l]) => `${v} = ${l}`).join(", ")}. Only "Active" and "Terminated" are read as such; every other label is stored as unknown.` }
        : { verdict: "fail", area: "Status values", message: `/lists/enums answered, but no enumeration is named like an employee status (names: ${Object.keys(names).slice(0, 40).join(", ")}). Add the right name to EMPLOYEE_STATUS_ENUM_NAMES in contract.ts; a real sync is refused until then.` },
    );
    findings.push(
      Object.keys(vocab).length === 0
        ? { verdict: "warn", area: "Webhooks", message: "No webhook-trigger enumeration is named in /lists/enums. Employee webhooks remain undocumented; polling stays the baseline." }
        : employeeTriggers.length === 0
          ? { verdict: "warn", area: "Webhooks", message: `Webhook triggers are listed (${Object.keys(vocab).join(", ")}) but none mentions employees. Employee lifecycle webhooks appear unsupported; polling stays the baseline.` }
          : { verdict: "pass", area: "Webhooks", message: `Employee-related webhook triggers exist: ${employeeTriggers.join(", ")}. Registering one is a write to Woven and needs its own approval; a webhook would only start a normal polling sync.` },
    );
  }

  /* ---- 3. every page of both passes ---- */
  const idsByPass = new Map<string, Set<string>>();
  const records: unknown[] = [];

  for (const pass of EMPLOYEE_LIST_PASSES) {
    let result: EmployeeListResult;
    try {
      result = await client.listEmployees(pass.query, config.pageSize);
    } catch (error) {
      const failure = describeError(error);
      findings.push({
        verdict: "fail",
        area: "Pagination",
        message: `Reading every page of the ${pass.label} pass failed (${errorLabel(failure)}). No partial read is trusted.`,
      });
      if (SPEC_ERROR_CODES.has(failure.code)) spec(`GET /employees (${pass.label} pass) did not page as the spec describes (${errorLabel(failure)}).`);
      report.requestsMade = client.requestsMade;
      return report;
    }
    const keys = keysOf(result.records);
    keys.forEach((k) => allKeys.add(k));
    idsByPass.set(pass.label, new Set(result.records.map(recordId).filter((id): id is string => id !== null)));
    records.push(...result.records);

    report.passes.push({
      label: pass.label,
      records: result.records.length,
      pages: result.pages,
      pageSizes: result.pageSizes,
      shape: result.shape,
      statusCodes: statusCodes(result.records),
      keysReturned: keys,
      keysNotInContract: keys.filter((k) => !MAPPED_KEYS.has(k)),
      fieldCoverage: coverage(result.records),
    });
    if (result.shape !== "array") spec(`GET /employees (${pass.label} pass) returned a page envelope, not the bare array the spec describes.`);
    const nonInteger = report.passes[report.passes.length - 1].statusCodes["(not an integer)"] ?? 0;
    if (nonInteger > 0) spec(`${nonInteger} records in the ${pass.label} pass carry a Status that is not the int32 the spec describes.`);

    const nonEmpty = result.pageSizes.filter((n) => n > 0);
    if (nonEmpty.length > 1 && nonEmpty[0] < config.pageSize) {
      findings.push({
        verdict: "warn",
        area: "Pagination",
        message: `The ${pass.label} pass asked for ${config.pageSize} per page and received ${nonEmpty[0]}: Woven caps querytake. Pagination still completes; set WOVEN_PAGE_SIZE=${nonEmpty[0]}.`,
      });
    }
  }

  const current = idsByPass.get("current") ?? new Set<string>();
  const withTerminated = idsByPass.get("with_terminated") ?? new Set<string>();
  report.currentNotInWithTerminated = [...current].filter((id) => !withTerminated.has(id)).length;
  findings.push(
    report.currentNotInWithTerminated === 0
      ? { verdict: "pass", area: "Terminated employees", message: `includeterminatedemployee=true returned ${withTerminated.size} employees, including all ${current.size} from the default read.` }
      : { verdict: "warn", area: "Terminated employees", message: `${report.currentNotInWithTerminated} employees from the default read were not in the includeterminatedemployee=true read. The sync merges both, but the filter does not behave as a superset.` },
  );
  if (report.currentNotInWithTerminated > 0) {
    spec(`includeterminatedemployee=true did not return a superset of the default read (${report.currentNotInWithTerminated} missing).`);
  }
  if (current.size === 0) findings.push({ verdict: "fail", area: "Employees", message: "The default /employees read returned no employees." });

  /* ---- 4. normalise everything, locally — the same code the sync uses ---- */
  const today = now().toISOString().slice(0, 10);
  const positions = new Set<string>();
  const primaries = new Set<string>();
  const seen = new Set<string>();
  const n = report.normalized;
  const candidates: { id: string; multi: boolean | null; all: boolean | null; primaryLocationId: string | null }[] = [];

  for (const record of records) {
    const result = normalizeEmployee(record, { statuses, today });
    if (!result.ok) {
      n.rejected += 1;
      bump(n.issueCounts, `record_${result.reason}`);
      continue;
    }
    const e = result.employee;
    if (seen.has(e.externalEmployeeId)) continue;
    seen.add(e.externalEmployeeId);
    n.employees += 1;
    if (e.employmentStatus === "active") n.active += 1;
    else if (e.employmentStatus === "terminated") n.terminated += 1;
    else n.statusUnknown += 1;
    if (e.positionId) positions.add(e.positionId);
    if (e.primaryLocationId) primaries.add(e.primaryLocationId);
    if (e.hasMultipleLocationAccess === true) n.multipleLocationFlagTrue += 1;
    else if (e.hasMultipleLocationAccess === false) n.multipleLocationFlagFalse += 1;
    if (e.hasAllLocationAccess === true) n.allLocationAccess += 1;
    for (const issue of e.issues) bump(n.issueCounts, issue);
    if (e.emailAddress) {
      const domain = e.emailAddress.slice(e.emailAddress.lastIndexOf("@") + 1).toLowerCase();
      bump(n.emailDomains, domain);
      if (config.loginEmailDomains.includes(domain)) n.loginEligibleByDomain += 1;
    }
    if (e.employmentStatus !== "terminated") {
      candidates.push({ id: e.externalEmployeeId, multi: e.hasMultipleLocationAccess, all: e.hasAllLocationAccess, primaryLocationId: e.primaryLocationId });
    }
  }
  n.distinctPositionIds = positions.size;
  n.distinctPrimaryLocations = primaries.size;

  const coverageOf = (field: keyof typeof FIELD) => report.passes.reduce((a, p) => a + (p.fieldCoverage[field] ?? 0), 0);
  for (const field of ["employeeId", "firstName", "lastName", "emailAddress", "status", "positionId", "primaryLocationId", "hireDate"] as const) {
    if (coverageOf(field) === 0 && n.employees > 0) {
      findings.push({ verdict: "fail", area: "Fields", message: `No record carries ${FIELD[field][0]}, which the OpenAPI export names. Compare with the keys returned.` });
      spec(`No employee record carries ${FIELD[field][0]}, which the spec's Employee schema names.`);
    }
  }
  if (n.employees > 0 && statuses.source === "enums" && n.statusUnknown > 0) {
    findings.push({ verdict: "warn", area: "Status values", message: `${n.statusUnknown} employees have a Status that is neither Active nor Terminated. They are stored as unknown and never treated as terminated.` });
  }
  if (Object.keys(n.emailDomains).length > 0) {
    findings.push({
      verdict: config.loginEmailDomains.length === 0 ? "warn" : "pass",
      area: "Email",
      message:
        config.loginEmailDomains.length === 0
          ? `EmailAddress domains seen: ${Object.entries(n.emailDomains).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} (${c})`).join(", ")}. Addresses are stored as provided. WOVEN_LOGIN_EMAIL_DOMAINS is not set, so nobody is login-eligible until the real domains are confirmed.`
          : `${n.loginEligibleByDomain} of ${Object.values(n.emailDomains).reduce((a, b) => a + b, 0)} addresses are at a WOVEN_LOGIN_EMAIL_DOMAINS domain.`,
    });
  }

  /* ---- 5. a small sample of details: multi-location and all-location first ---- */
  const sample = [
    ...candidates.filter((c) => c.all === true),
    ...candidates.filter((c) => c.all !== true && c.multi === true),
    ...candidates.filter((c) => c.all !== true && c.multi !== true),
  ].slice(0, DETAIL_SAMPLE);
  if (sample.length > 0) {
    const d: DetailsReport = {
      isSample: true,
      eligible: candidates.length,
      sampleLimit: DETAIL_SAMPLE,
      sampled: 0,
      failed: 0,
      failureCodes: {},
      keysReturned: [],
      withLocationsArray: 0,
      withMoreThanOneLocation: 0,
      locationEntryKeys: [],
      accessTypes: { primary: 0, additional: 0, temporary_or_expiring_access: 0 },
      entriesWithExpiresOn: 0,
      expiresOnMeaning: EXPIRES_ON_MEANING,
      allLocationEmployeesSampled: 0,
      allLocationEmployeesWithEmptyList: 0,
    };
    const detailKeys = new Set<string>();
    const entryKeys = new Set<string>();
    for (const candidate of sample) {
      let body: unknown;
      try {
        body = await client.getEmployeeDetails(candidate.id);
      } catch (error) {
        /* The code only: a details error's path carries the employee id. */
        d.failed += 1;
        bump(d.failureCodes, describeError(error).code);
        continue;
      }
      d.sampled += 1;
      const top = isRecord(body) ? body : {};
      Object.keys(top).forEach((k) => detailKeys.add(k));
      const locations = Array.isArray(top[FIELD.locations[0]]) ? (top[FIELD.locations[0]] as unknown[]) : null;
      if (candidate.all === true) {
        d.allLocationEmployeesSampled += 1;
        if (locations && locations.length === 0) d.allLocationEmployeesWithEmptyList += 1;
      }
      if (locations) {
        d.withLocationsArray += 1;
        const distinct = new Set(
          locations.filter(isRecord).map((entry) => readId(entry[LOCATION_FIELD.locationId[0]])).filter((id) => id !== null),
        );
        if (distinct.size > 1) d.withMoreThanOneLocation += 1;
        for (const entry of locations) {
          if (!isRecord(entry)) continue;
          Object.keys(entry).forEach((k) => entryKeys.add(k));
          if (has(entry, LOCATION_FIELD.expiresOn) && !String(entry[LOCATION_FIELD.expiresOn[0]]).startsWith("0001-01-01")) d.entriesWithExpiresOn += 1;
        }
      }
      for (const a of readAffiliations(body, { primaryLocationId: candidate.primaryLocationId, primaryLocationName: null }) ?? []) {
        d.accessTypes[a.accessType] += 1;
      }
    }
    d.isSample = d.sampled + d.failed < d.eligible;
    d.keysReturned = [...detailKeys].sort();
    d.locationEntryKeys = [...entryKeys].sort();
    detailKeys.forEach((k) => allKeys.add(k));
    entryKeys.forEach((k) => allKeys.add(k));
    report.details = d;

    const sampleWords = d.isSample
      ? `a SAMPLE of ${d.sampled} employee-detail records (of ${d.eligible} employees not terminated; all-location and multiple-location employees first)`
      : `all ${d.sampled} employee-detail records of employees not terminated`;
    if (d.failed > 0) {
      findings.push({
        verdict: "warn",
        area: "Employee details",
        message: `${d.failed} detail reads failed (${Object.entries(d.failureCodes).map(([c, n]) => `${c} ×${n}`).join(", ")}).`,
      });
      const specFailures = Object.entries(d.failureCodes).filter(([c]) => SPEC_ERROR_CODES.has(c));
      if (specFailures.length > 0) spec(`GET /employees/{id}/details answered in a way the spec does not describe (${specFailures.map(([c, n]) => `${c} ×${n}`).join(", ")}).`);
    }
    if (d.sampled > 0 && d.withLocationsArray === 0) {
      findings.push({ verdict: "fail", area: "Locations", message: `None of ${d.sampled} details responses carried Locations[] (keys: ${d.keysReturned.join(", ")}).` });
      spec("No employee-details response carried the Locations[] array the spec's EmployeeDetails schema names.");
    } else if (d.sampled > 0) {
      findings.push({
        verdict: "pass",
        area: "Locations",
        message: `Checked ${sampleWords}. ${d.withLocationsArray} carried Locations[]; ${d.withMoreThanOneLocation} named more than one location. Entries: ${d.accessTypes.primary} primary, ${d.accessTypes.additional} additional, ${d.accessTypes.temporary_or_expiring_access} with an ExpiresOn.`,
      });
      findings.push({
        verdict: "warn",
        area: "ExpiresOn",
        message: `ExpiresOn present: ${d.entriesWithExpiresOn} affiliations${d.isSample ? " (in the sample)" : ""}. Meaning: needs live operational confirmation. Ask Sunny records these only as temporary or expiring access and draws no other conclusion from them.`,
      });
      if (d.allLocationEmployeesSampled > 0) {
        findings.push({
          verdict: "warn",
          area: "All-location access",
          message: `${d.allLocationEmployeesSampled} all-location employees sampled; ${d.allLocationEmployeesWithEmptyList} had an empty Locations[]. An empty list for them is kept as "not known", never as "no locations".`,
        });
      }
    }
  }

  /* ---- 6. the location catalog ---- */
  try {
    const body = await client.listLocations();
    const list = Array.isArray(body) ? body : [];
    const parsed = list.map(readCatalogLocation).filter((l) => l !== null);
    const keys = keysOf(list);
    keys.forEach((k) => allKeys.add(k));
    const catalog = parsed.filter((l): l is NonNullable<typeof l> => l !== null);
    const { coverage: salonCoverage, review } = compareSalonCoverage(catalog, options.salons);
    report.locations = {
      outcome: "answered",
      records: catalog.length,
      withNumber: catalog.filter((l) => l.number !== null).length,
      nonLocations: catalog.filter((l) => l.isNonLocation === true).length,
      closed: catalog.filter((l) => l.isClosed === true).length,
      keysReturned: keys,
      salonCoverage,
    };
    if (options.includeLocationReview === true && salonCoverage.outcome === "compared") report.locationReview = review;
    if (!Array.isArray(body)) spec("GET /locations did not return the bare array the spec describes.");
    findings.push({
      verdict: parsed.length > 0 ? "pass" : "warn",
      area: "Location catalog",
      message: `GET /locations returned ${catalog.length} locations (${report.locations.withNumber} with a Number, ${report.locations.nonLocations} non-locations, ${report.locations.closed} closed). It lists the application user's own locations, so it should cover every salon.`,
    });
    findings.push(
      salonCoverage.outcome === "compared"
        ? {
            verdict: salonCoverage.salonsWithoutWovenLocation === 0 && salonCoverage.unmatchedOpenWovenLocations === 0 ? "pass" : "warn",
            area: "Salon coverage",
            message: `${salonCoverage.exactMatches} Woven locations match an Ask Sunny salon number exactly, covering ${salonCoverage.salonsMatched} of ${salonCoverage.salons} salons. ${salonCoverage.salonsWithoutWovenLocation} salons have no matching Woven location; ${salonCoverage.unmatchedWovenLocations} Woven locations match no salon (${salonCoverage.unmatchedOpenWovenLocations} of them open and not flagged as non-locations).${salonCoverage.leadingZeroOnlyMatches > 0 ? ` ${salonCoverage.leadingZeroOnlyMatches} would match only if leading zeros were ignored; they are not counted.` : ""}${salonCoverage.duplicateWovenNumbers > 0 ? ` ${salonCoverage.duplicateWovenNumbers} Numbers are shared by more than one Woven location.` : ""} Nothing is mapped or confirmed by this check.`,
          }
        : salonCoverage.outcome === "salons_unavailable"
          ? { verdict: "warn", area: "Salon coverage", message: "Ask Sunny's salons could not be read, so Woven locations were not compared with them." }
          : { verdict: "warn", area: "Salon coverage", message: "No salon list was supplied, so Woven locations were not compared with Ask Sunny salons." },
    );
  } catch (error) {
    const failure = describeError(error);
    const code = failure.code;
    report.locations = {
      outcome: code === "not_found" ? "not_found" : code === "forbidden" ? "refused" : "error",
      records: 0,
      withNumber: 0,
      nonLocations: 0,
      closed: 0,
      keysReturned: [],
      salonCoverage: { ...NOT_COMPARED },
    };
    findings.push({ verdict: "warn", area: "Location catalog", message: `GET /locations failed (${errorLabel(failure)}). Locations are still queued from employee records, without catalog fields, and salon coverage could not be compared.` });
    if (SPEC_ERROR_CODES.has(code)) spec(`GET /locations did not answer as the spec describes (${errorLabel(failure)}).`);
  }

  /* ---- 7. what came back that should not have ---- */
  report.sensitiveKeysReturned = sensitiveKeys(allKeys);
  findings.push(
    report.sensitiveKeysReturned.length > 0
      ? {
          verdict: "warn",
          area: "Access scope",
          message: `Responses contain keys that look like sensitive HR data: ${report.sensitiveKeysReturned.join(", ")}. Ask Sunny never reads them, but a read-only, scoped Woven user should not receive them — ask Woven whether API access follows the user's role.`,
        }
      : { verdict: "pass", area: "Access scope", message: "No returned key looks like sensitive HR data." },
  );

  findings.push(
    report.specDiscrepancies.length === 0
      ? { verdict: "pass", area: "OpenAPI contract", message: "No difference from the OpenAPI export was seen in the endpoints read." }
      : { verdict: "warn", area: "OpenAPI contract", message: `${report.specDiscrepancies.length} difference${report.specDiscrepancies.length === 1 ? "" : "s"} from the OpenAPI export: ${report.specDiscrepancies.join(" ")}` },
  );

  report.requestsMade = client.requestsMade;
  report.ok = !findings.some((f) => f.verdict === "fail");
  return report;
}
