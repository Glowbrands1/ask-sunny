import "server-only";

import { extractPage, WovenApiError, WovenClient, type EmployeeListResult, type TokenInfo } from "./client";
import type { WovenConfig } from "./config";
import {
  EMPLOYEE_LIST_PASSES,
  FIELD,
  LOCATION_FIELD,
  QUERY_SKIP,
  QUERY_STATUS,
  QUERY_TAKE,
  REFERENCE_PATHS,
  SENSITIVE_KEY_PATTERN,
} from "./contract";
import { normalizeEmployee, readAffiliations, readId } from "./normalize";

/**
 * ============================================================================
 * LIVE VALIDATION — does the real Operations API match `contract.ts`?
 * ============================================================================
 *
 * READ-ONLY. The token exchange, then GETs: every page of each status pass, a
 * small sample of employee details, and one small read of each assumed
 * reference endpoint. Nothing is written to Woven, and nothing is written to
 * Supabase — this runs before the directory migration exists.
 *
 * AGGREGATES AND KEY NAMES ONLY. The report carries counts, KEY NAMES, raw
 * STATUS VALUES (e.g. "Active"), work-email DOMAINS with counts, and verdicts.
 * It never carries a name, an email address, an employee id, a date, a
 * position title, a location name or any other field value — so it is safe to
 * show on an admin screen, paste into a ticket, or keep in a log.
 *
 * It also reports which returned KEY NAMES look like sensitive HR data. That
 * is the practical test of a scoped, read-only Woven application user: if the
 * API honours the user's role, those keys should not come back at all.
 */

export type Verdict = "pass" | "warn" | "fail";

export interface Finding {
  verdict: Verdict;
  area: string;
  message: string;
}

export interface FieldCoverage {
  /** Contract field → records carrying any alias of it. */
  [field: string]: number;
}

export interface PassReport {
  label: string;
  statusFilter: string;
  records: number;
  pages: number;
  reportedTotal: number | null;
  pageSizes: number[];
  shape: EmployeeListResult["shape"];
  envelopeKeys: string[];
  /** Raw status values, trimmed, with counts. Status words, never personal data. */
  statusValues: Record<string, number>;
  keysReturned: string[];
  keysNotInContract: string[];
  fieldCoverage: FieldCoverage;
}

export interface DetailsReport {
  sampled: number;
  failed: number;
  keysReturned: string[];
  withLocationsArray: number;
  locationEntryKeys: string[];
  affiliationKinds: { primary: number; additional: number; temporary: number };
  entriesWithExpiry: number;
  entriesFlaggedBorrowed: number;
}

export interface ReferenceReport {
  path: string;
  outcome: "answered" | "not_found" | "refused" | "error";
  status: number | null;
  shape: "array" | "envelope" | "unrecognised" | null;
  records: number | null;
  keysReturned: string[];
}

export interface ValidationReport {
  ok: boolean;
  checkedAt: string;
  baseUrl: string;
  requestsMade: number;
  token: (TokenInfo & { ok: true }) | { ok: false; code: string; status: number | null };
  passes: PassReport[];
  /** Employees returned by BOTH the active and the terminated pass. */
  idsInBothPasses: number;
  /**
   * One extra read with NO status filter: how many employees it returns, and
   * how many of those neither filtered pass returned (with their raw status
   * values). An employee on leave, say, would otherwise be invisible to the
   * sync without anyone knowing.
   */
  unfiltered: { records: number; notInEitherPass: number; statusValues: Record<string, number> } | null;
  details: DetailsReport | null;
  references: ReferenceReport[];
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
    multipleLocationFlagMissing: number;
    issueCounts: Record<string, number>;
    /** Work-email domain → count, before any domain filter. */
    workEmailDomains: Record<string, number>;
    /** How many work emails the CONFIGURED domain filter would drop. */
    droppedByDomainFilter: number;
  };
  /** Returned key names that look like sensitive HR data, across every response read. */
  sensitiveKeysReturned: string[];
  findings: Finding[];
}

const KEY_SAMPLE = 250;
const DETAIL_SAMPLE = 10;
const MAPPED_KEYS = new Set<string>(Object.values(FIELD).flat());

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

function coverage(records: unknown[]): FieldCoverage {
  const out: FieldCoverage = {};
  for (const field of Object.keys(FIELD) as (keyof typeof FIELD)[]) out[field] = 0;
  for (const record of records) {
    if (!isRecord(record)) continue;
    for (const [field, aliases] of Object.entries(FIELD)) if (has(record, aliases)) out[field] += 1;
  }
  return out;
}

function statusValues(records: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const record of records) {
    if (!isRecord(record)) continue;
    const raw = FIELD.status.map((k) => record[k]).find((v) => typeof v === "string") as string | undefined;
    /* Bounded so an unexpected free-text field cannot flood the report. */
    const key = raw === undefined ? "(none)" : raw.trim().slice(0, 40) || "(blank)";
    if (Object.keys(out).length < 25 || key in out) bump(out, key);
    else bump(out, "(other)");
  }
  return out;
}

function recordId(record: unknown): string | null {
  if (!isRecord(record)) return null;
  for (const key of FIELD.employeeId) if (Object.hasOwn(record, key)) return readId(record[key]);
  return null;
}

function sensitiveKeys(keys: Iterable<string>): string[] {
  /* Keys the contract maps are allowlisted fields ("WorkEmailAddress" is not an address). */
  return [...new Set([...keys].filter((key) => !MAPPED_KEYS.has(key) && SENSITIVE_KEY_PATTERN.test(key)))].sort();
}

export interface ValidationOptions {
  config: WovenConfig;
  client?: Pick<WovenClient, "get" | "listEmployees" | "getEmployeeDetails" | "requestsMade" | "tokenInfo">;
  now?: () => Date;
}

export async function runWovenLiveValidation(options: ValidationOptions): Promise<ValidationReport> {
  const { config } = options;
  const now = options.now ?? (() => new Date());
  if (!config.credentials) throw new Error("Woven credentials are not configured.");

  const client =
    options.client ?? new WovenClient({ baseUrl: config.baseUrl, credentials: config.credentials, deadlineAt: Date.now() + 240_000 });

  const findings: Finding[] = [];
  const allKeys = new Set<string>();
  const report: ValidationReport = {
    ok: false,
    checkedAt: now().toISOString(),
    baseUrl: config.baseUrl,
    requestsMade: 0,
    token: { ok: false, code: "not_attempted", status: null },
    passes: [],
    idsInBothPasses: 0,
    unfiltered: null,
    details: null,
    references: [],
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
      multipleLocationFlagMissing: 0,
      issueCounts: {},
      workEmailDomains: {},
      droppedByDomainFilter: 0,
    },
    sensitiveKeysReturned: [],
    findings,
  };

  /* ---- 1. authentication, via the first small read ---- */
  try {
    await client.get("/employees", { [QUERY_SKIP]: 0, [QUERY_TAKE]: 1 });
  } catch (error) {
    const code = error instanceof WovenApiError ? error.code : "unexpected";
    const status = error instanceof WovenApiError ? error.status : null;
    const onToken = error instanceof WovenApiError && error.path === "/tokens/v2";
    report.token = onToken || client.tokenInfo === null ? { ok: false, code, status } : { ...client.tokenInfo, ok: true };
    findings.push({
      verdict: "fail",
      area: onToken ? "Sign-in" : "Employees",
      message: onToken
        ? code === "forbidden"
          ? "Woven refused the token request (403). The subscription key may not be active for this product, or the application user may lack API access."
          : "Woven did not issue an access token. Check the subscription key and the application user; if both are right, the token request's field names in contract.ts (tokenRequestBody) need confirming."
        : `The first employee read failed (${code}${status ? `, HTTP ${status}` : ""}).`,
    });
    report.requestsMade = client.requestsMade;
    return report;
  }
  report.token = { ...client.tokenInfo!, ok: true };
  findings.push({ verdict: "pass", area: "Sign-in", message: "Woven issued an access token and accepted it on /employees." });
  if (client.tokenInfo!.lifetimeSource === "default") {
    findings.push({
      verdict: "warn",
      area: "Sign-in",
      message: `The token response states no lifetime under a recognised key (keys: ${client.tokenInfo!.responseKeys.join(", ") || "none"}). The client assumes 15 minutes; add the real key to contract.ts if one exists.`,
    });
  }

  /* ---- 2. every page of each status pass ---- */
  const idsByPass: Set<string>[] = [];
  const recordsByPass: { pass: (typeof EMPLOYEE_LIST_PASSES)[number]; records: unknown[] }[] = [];

  for (const pass of EMPLOYEE_LIST_PASSES) {
    let result: EmployeeListResult;
    try {
      result = await client.listEmployees({ status: pass.status }, config.pageSize);
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
    idsByPass.push(new Set(result.records.map(recordId).filter((id): id is string => id !== null)));
    recordsByPass.push({ pass, records: result.records });

    report.passes.push({
      label: pass.label,
      statusFilter: pass.status,
      records: result.records.length,
      pages: result.pages,
      reportedTotal: result.reportedTotal,
      pageSizes: result.pageSizes,
      shape: result.shape,
      envelopeKeys: result.envelopeKeys,
      statusValues: statusValues(result.records),
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
    if (result.reportedTotal !== null && result.reportedTotal !== result.records.length) {
      findings.push({
        verdict: "fail",
        area: "Pagination",
        message: `The ${pass.label} pass reported ${result.reportedTotal} records and delivered ${result.records.length}.`,
      });
    }
  }

  const [activeIds, terminatedIds] = idsByPass;
  report.idsInBothPasses = [...activeIds].filter((id) => terminatedIds?.has(id)).length;
  const activePass = report.passes[0];
  const terminatedPass = report.passes[1];

  /* ---- 2b. one unfiltered read, to find statuses neither pass returns ---- */
  try {
    const all = await client.listEmployees({}, config.pageSize);
    keysOf(all.records).forEach((k) => allKeys.add(k));
    const missed = all.records.filter((r) => {
      const id = recordId(r);
      return id !== null && !activeIds.has(id) && !terminatedIds?.has(id);
    });
    report.unfiltered = { records: all.records.length, notInEitherPass: missed.length, statusValues: statusValues(missed) };
    findings.push(
      missed.length === 0
        ? { verdict: "pass", area: "Status coverage", message: `An unfiltered read returned ${all.records.length} records, all covered by the active and terminated passes.` }
        : {
            verdict: "warn",
            area: "Status coverage",
            message: `${missed.length} employees are returned without a status filter but by neither the active nor the terminated pass (statuses: ${Object.entries(report.unfiltered.statusValues).map(([v, c]) => `${v} (${c})`).join(", ")}). The sync would never see them; decide whether to add a pass for these statuses.`,
          },
    );
  } catch (error) {
    const code = error instanceof WovenApiError ? error.code : "unexpected";
    findings.push({ verdict: "warn", area: "Status coverage", message: `The unfiltered read failed (${code}), so statuses outside the two passes could not be checked.` });
  }

  if (activePass.records === 0) {
    findings.push({ verdict: "fail", area: "Employees", message: "The active pass returned no employees." });
  } else {
    findings.push({
      verdict: "pass",
      area: "Pagination",
      message: `Read ${activePass.records} active and ${terminatedPass?.records ?? 0} terminated records across ${report.passes.reduce((a, p) => a + p.pages, 0)} pages.`,
    });
  }
  if (activePass.records > 0 && report.idsInBothPasses > activePass.records * 0.5) {
    findings.push({
      verdict: "fail",
      area: "Status filter",
      message: `${report.idsInBothPasses} employees came back in BOTH the active and terminated passes: the status filter (query "${QUERY_STATUS}" = Active / Terminated in contract.ts) appears to be ignored. Confirm its real name and values.`,
    });
  } else if (terminatedPass && terminatedPass.records > 0) {
    findings.push({ verdict: "pass", area: "Status filter", message: "The active and terminated passes returned different employees." });
  } else {
    findings.push({
      verdict: "warn",
      area: "Status filter",
      message: "The terminated pass returned no records. Either the filter value differs from contract.ts, or terminated employees are not exposed to this user.",
    });
  }

  /* ---- 3. normalise everything, locally — the same code the sync uses ---- */
  const today = now().toISOString().slice(0, 10);
  const positions = new Set<string>();
  const primaries = new Set<string>();
  const seen = new Set<string>();
  const n = report.normalized;
  const candidates: { id: string; multi: boolean | null }[] = [];

  for (const { pass, records } of recordsByPass) {
    for (const record of records) {
      const result = normalizeEmployee(record, { impliedStatus: pass.impliedStatus, workEmailDomains: [], today });
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
      if (e.hasMultipleLocations === true) n.multipleLocationFlagTrue += 1;
      else if (e.hasMultipleLocations === false) n.multipleLocationFlagFalse += 1;
      else n.multipleLocationFlagMissing += 1;
      for (const issue of e.issues) bump(n.issueCounts, issue);
      if (e.workEmail) {
        const domain = e.workEmail.slice(e.workEmail.lastIndexOf("@") + 1);
        bump(n.workEmailDomains, domain);
        if (config.workEmailDomains.length > 0 && !config.workEmailDomains.includes(domain)) n.droppedByDomainFilter += 1;
      }
      if (e.employmentStatus === "active") candidates.push({ id: e.externalEmployeeId, multi: e.hasMultipleLocations });
    }
  }
  n.distinctPositionIds = positions.size;
  n.distinctPrimaryLocations = primaries.size;

  const pct = (x: number) => (n.employees === 0 ? 0 : Math.round((x / n.employees) * 100));
  const coverageOf = (field: keyof typeof FIELD) =>
    report.passes.reduce((a, p) => a + (p.fieldCoverage[field] ?? 0), 0);

  for (const field of ["employeeId", "firstName", "lastName", "workEmail", "positionId", "primaryLocationId", "hireDate"] as const) {
    const count = coverageOf(field);
    if (count === 0 && n.employees > 0) {
      findings.push({
        verdict: "fail",
        area: "Fields",
        message: `No record carries any key contract.ts expects for ${field} (${FIELD[field].join(", ")}). Compare with the keys returned and add the real one.`,
      });
    }
  }
  if (n.employees > 0 && coverageOf("status") === 0) {
    findings.push({
      verdict: "warn",
      area: "Fields",
      message: "No record states a status under a recognised key; status is being inferred from which pass returned it.",
    });
  }
  const unknownValues = Object.keys(activePass.statusValues)
    .concat(terminatedPass ? Object.keys(terminatedPass.statusValues) : [])
    .concat(report.unfiltered ? Object.keys(report.unfiltered.statusValues) : [])
    .filter((v) => !["(none)", "active", "employed", "current", "terminated", "termed", "separated"].includes(v.toLowerCase()));
  if (unknownValues.length > 0) {
    findings.push({
      verdict: "warn",
      area: "Status values",
      message: `Status values not mapped in contract.ts: ${[...new Set(unknownValues)].join(", ")}. They are stored as "unknown" and never as terminated until mapped deliberately.`,
    });
  }
  if (n.employees > 0 && (n.issueCounts.missing_work_email ?? 0) > n.employees * 0.5) {
    findings.push({
      verdict: "warn",
      area: "Work email",
      message: `${pct(n.issueCounts.missing_work_email ?? 0)}% of employees have no value under the work-email keys. Check whether Woven uses a different key; a plain "Email" key is deliberately not read.`,
    });
  }
  if (config.workEmailDomains.length === 0 && Object.keys(n.workEmailDomains).length > 0) {
    findings.push({
      verdict: "warn",
      area: "Work email",
      message: `No approved work-email domain is configured, so every address in the work-email field would be stored. Domains seen: ${Object.entries(n.workEmailDomains).sort((a, b) => b[1] - a[1]).map(([d, c]) => `${d} (${c})`).join(", ")}. Set WOVEN_WORK_EMAIL_DOMAINS before a real sync.`,
    });
  }

  /* ---- 4. a small sample of details ---- */
  const sample = [
    ...candidates.filter((c) => c.multi === true),
    ...candidates.filter((c) => c.multi !== true),
  ].slice(0, DETAIL_SAMPLE);
  if (sample.length > 0) {
    const d: DetailsReport = {
      sampled: 0,
      failed: 0,
      keysReturned: [],
      withLocationsArray: 0,
      locationEntryKeys: [],
      affiliationKinds: { primary: 0, additional: 0, temporary: 0 },
      entriesWithExpiry: 0,
      entriesFlaggedBorrowed: 0,
    };
    const detailKeys = new Set<string>();
    const entryKeys = new Set<string>();
    for (const { id } of sample) {
      let body: unknown;
      try {
        body = await client.getEmployeeDetails(id);
      } catch {
        d.failed += 1;
        continue;
      }
      d.sampled += 1;
      const top = isRecord(body) ? body : {};
      Object.keys(top).forEach((k) => detailKeys.add(k));
      const locations = [top.Locations, top.locations].find(Array.isArray) as unknown[] | undefined;
      if (locations) {
        d.withLocationsArray += 1;
        for (const entry of locations) {
          if (!isRecord(entry)) continue;
          Object.keys(entry).forEach((k) => entryKeys.add(k));
          if (has(entry, LOCATION_FIELD.expiresOn)) d.entriesWithExpiry += 1;
          if (LOCATION_FIELD.isTemporary.some((k) => entry[k] === true)) d.entriesFlaggedBorrowed += 1;
        }
      }
      const listRecord = recordsByPass.flatMap((p) => p.records).find((r) => recordId(r) === id);
      const primary = listRecord
        ? normalizeEmployee(listRecord, { workEmailDomains: [], today })
        : null;
      const affiliations = readAffiliations(body, {
        primaryLocationId: primary?.ok ? primary.employee.primaryLocationId : null,
        primaryLocationName: null,
      });
      for (const a of affiliations ?? []) d.affiliationKinds[a.kind] += 1;
    }
    d.keysReturned = [...detailKeys].sort();
    d.locationEntryKeys = [...entryKeys].sort();
    detailKeys.forEach((k) => allKeys.add(k));
    entryKeys.forEach((k) => allKeys.add(k));
    report.details = d;

    if (d.sampled > 0 && d.withLocationsArray === 0) {
      findings.push({
        verdict: "fail",
        area: "Locations",
        message: `None of ${d.sampled} employee-details responses carried a Locations array (keys: ${d.keysReturned.join(", ")}). Multi-location affiliations cannot be read until contract.ts names the right key.`,
      });
    } else if (d.sampled > 0) {
      findings.push({
        verdict: "pass",
        area: "Locations",
        message: `${d.withLocationsArray} of ${d.sampled} details responses carried a Locations array: ${d.affiliationKinds.primary} primary, ${d.affiliationKinds.additional} additional, ${d.affiliationKinds.temporary} temporary affiliations.`,
      });
      if (d.entriesWithExpiry === 0 && d.entriesFlaggedBorrowed === 0) {
        findings.push({
          verdict: "warn",
          area: "Locations",
          message: "No sampled affiliation carried a recognised expiry or borrowed flag. Temporary affiliations may be absent from the sample, or use keys contract.ts does not list — check the location entry keys.",
        });
      }
    }
  }

  /* ---- 5. assumed reference endpoints, one small read each ---- */
  for (const path of Object.values(REFERENCE_PATHS)) {
    try {
      const body = await client.get(path, { [QUERY_SKIP]: 0, [QUERY_TAKE]: 25 });
      const page = extractPage(body);
      const keys = page ? keysOf(page.items) : isRecord(body) ? Object.keys(body).sort() : [];
      keys.forEach((k) => allKeys.add(k));
      report.references.push({
        path,
        outcome: "answered",
        status: 200,
        shape: page ? (Array.isArray(body) ? "array" : "envelope") : "unrecognised",
        records: page ? page.items.length : null,
        keysReturned: keys,
      });
    } catch (error) {
      const code = error instanceof WovenApiError ? error.code : "unexpected";
      report.references.push({
        path,
        outcome: code === "not_found" ? "not_found" : code === "forbidden" ? "refused" : "error",
        status: error instanceof WovenApiError ? error.status : null,
        shape: null,
        records: null,
        keysReturned: [],
      });
    }
  }

  /* ---- 6. what came back that should not have ---- */
  report.sensitiveKeysReturned = sensitiveKeys(allKeys);
  if (report.sensitiveKeysReturned.length > 0) {
    findings.push({
      verdict: "warn",
      area: "Access scope",
      message: `Responses contain keys that look like sensitive HR data: ${report.sensitiveKeysReturned.join(", ")}. Ask Sunny discards them, but a read-only, scoped Woven application user should not receive them at all — ask Woven whether API access follows the user's role.`,
    });
  } else {
    findings.push({ verdict: "pass", area: "Access scope", message: "No returned key looks like sensitive HR data." });
  }

  report.requestsMade = client.requestsMade;
  report.ok = !findings.some((f) => f.verdict === "fail");
  return report;
}
