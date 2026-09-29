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
 * both list passes, a small sample of employee details, and `/locations`.
 * Nothing is written to Woven, and nothing is written to Supabase.
 *
 * AGGREGATES, KEY NAMES AND WOVEN VOCABULARY ONLY. The report carries counts,
 * KEY NAMES, Woven's own ENUM labels ("Active", "Terminated", trigger names),
 * email DOMAINS with counts, the CompanyID and company names from the token
 * response, and verdicts. It never carries a person's name, email address,
 * employee id, date, title or location name.
 *
 * WHAT IT SETTLES that the spec cannot:
 *   - the CompanyID, when it is not in the Woven portal;
 *   - what the Status and TerminationType integers mean;
 *   - whether Woven has employee webhook triggers, by reading their names;
 *   - whether `includeterminatedemployee` returns a superset;
 *   - how often `Locations[]` carries an `ExpiresOn`, for comparing with a
 *     known borrowed employee in Woven before anything is called "borrowed";
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

export interface DetailsReport {
  sampled: number;
  failed: number;
  keysReturned: string[];
  withLocationsArray: number;
  locationEntryKeys: string[];
  accessTypes: { primary: number; additional: number; temporary_or_expiring_access: number };
  entriesWithExpiresOn: number;
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

export interface LocationsReport {
  outcome: "answered" | "not_found" | "refused" | "error";
  records: number;
  withNumber: number;
  nonLocations: number;
  closed: number;
  keysReturned: string[];
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
  sensitiveKeysReturned: string[];
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
    sensitiveKeysReturned: [],
    findings,
  };

  /* ---- 1. authentication, via the first small read ---- */
  try {
    await client.get(EMPLOYEES_PATH, { [QUERY_SKIP]: 0, [QUERY_TAKE]: 1 });
  } catch (error) {
    const code = error instanceof WovenApiError ? error.code : "unexpected";
    const status = error instanceof WovenApiError ? error.status : null;
    const onToken = error instanceof WovenApiError && error.path === "/tokens/v2";
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
  if (token.lifetimeSource === "default") {
    findings.push({
      verdict: "warn",
      area: "Sign-in",
      message: `The token response had no usable TokenExpirationDate (keys: ${token.responseKeys.join(", ") || "none"}). The client assumes 15 minutes.`,
    });
  }

  /* ---- 2. Woven's enum vocabulary ---- */
  let entries: WovenEnumEntry[] | null = null;
  try {
    entries = parseEnums(await client.listEnums());
  } catch {
    entries = null;
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
    findings.push({ verdict: "fail", area: "Status values", message: "GET /lists/enums could not be read, so Status integers cannot be resolved. A real sync is refused until they can." });
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
      const code = error instanceof WovenApiError ? error.code : "unexpected";
      const status = error instanceof WovenApiError ? error.status : null;
      findings.push({
        verdict: "fail",
        area: "Pagination",
        message: `Reading every page of the ${pass.label} pass failed (${code}${status ? `, HTTP ${status}` : ""}). No partial read is trusted.`,
      });
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
      sampled: 0,
      failed: 0,
      keysReturned: [],
      withLocationsArray: 0,
      locationEntryKeys: [],
      accessTypes: { primary: 0, additional: 0, temporary_or_expiring_access: 0 },
      entriesWithExpiresOn: 0,
      allLocationEmployeesSampled: 0,
      allLocationEmployeesWithEmptyList: 0,
    };
    const detailKeys = new Set<string>();
    const entryKeys = new Set<string>();
    for (const candidate of sample) {
      let body: unknown;
      try {
        body = await client.getEmployeeDetails(candidate.id);
      } catch {
        d.failed += 1;
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
    d.keysReturned = [...detailKeys].sort();
    d.locationEntryKeys = [...entryKeys].sort();
    detailKeys.forEach((k) => allKeys.add(k));
    entryKeys.forEach((k) => allKeys.add(k));
    report.details = d;

    if (d.sampled > 0 && d.withLocationsArray === 0) {
      findings.push({ verdict: "fail", area: "Locations", message: `None of ${d.sampled} details responses carried Locations[] (keys: ${d.keysReturned.join(", ")}).` });
    } else if (d.sampled > 0) {
      findings.push({
        verdict: "pass",
        area: "Locations",
        message: `${d.withLocationsArray} of ${d.sampled} details responses carried Locations[]: ${d.accessTypes.primary} primary, ${d.accessTypes.additional} additional, ${d.accessTypes.temporary_or_expiring_access} with an ExpiresOn.`,
      });
      findings.push({
        verdict: "warn",
        area: "Temporary access",
        message: `${d.entriesWithExpiresOn} sampled location entries carry an ExpiresOn. Before any of them is called "borrowed", compare an employee borrowed in Woven with their Locations[] entry.`,
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
    report.locations = {
      outcome: "answered",
      records: parsed.length,
      withNumber: parsed.filter((l) => l!.number !== null).length,
      nonLocations: parsed.filter((l) => l!.isNonLocation === true).length,
      closed: parsed.filter((l) => l!.isClosed === true).length,
      keysReturned: keys,
    };
    findings.push({
      verdict: parsed.length > 0 ? "pass" : "warn",
      area: "Location catalog",
      message: `GET /locations returned ${parsed.length} locations (${report.locations.withNumber} with a Number, ${report.locations.nonLocations} non-locations, ${report.locations.closed} closed). It lists the application user's own locations, so it should cover every salon.`,
    });
  } catch (error) {
    const code = error instanceof WovenApiError ? error.code : "unexpected";
    report.locations = {
      outcome: code === "not_found" ? "not_found" : code === "forbidden" ? "refused" : "error",
      records: 0,
      withNumber: 0,
      nonLocations: 0,
      closed: 0,
      keysReturned: [],
    };
    findings.push({ verdict: "warn", area: "Location catalog", message: `GET /locations failed (${code}). Locations are still queued from employee records, without catalog fields.` });
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

  report.requestsMade = client.requestsMade;
  report.ok = !findings.some((f) => f.verdict === "fail");
  return report;
}
