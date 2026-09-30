import { CHANGE_KINDS, EMPLOYMENT_STATUSES, type ChangeKind, type EmploymentStatus } from "./types";
import {
  DIRECTORY_FILTERS,
  type AccessPreviewRow,
  type ChangePage,
  type ChangeQuery,
  type ChangeRow,
  type DirectoryFilter,
  type DirectoryPage,
  type DirectoryQuery,
  type DirectoryRow,
  type EligibilityResult,
  type ReviewStatus,
} from "./view-types";

/**
 * ============================================================================
 * THE TABS' RULES — pure, and the same for real and sample data
 * ============================================================================
 *
 * Filtering, searching, paging and the eligibility preview are defined ONCE,
 * here, as pure functions. The server reads the directory from Supabase and
 * passes it through them; a demo build passes the labelled sample set through
 * the same functions. So a sample screen behaves exactly as the real one
 * will, and the rules are unit-tested without a database.
 *
 * NOTHING HERE DECIDES ACCESS. `evaluateEligibility` answers "would a later
 * phase let this person have an account?" — as a preview. Phase one has no
 * code path that creates, disables or changes a login.
 */

export const DIRECTORY_PAGE_SIZE = 50;

const CHANGE_KIND_LABELS: Record<ChangeKind, string> = {
  new_employee: "New employee",
  terminated: "Terminated",
  reactivated: "Reactivated",
  position_changed: "Position changed",
  primary_location_changed: "Primary location changed",
  location_access_added: "Location access added",
  location_access_removed: "Location access removed",
  email_changed: "Email changed",
  missing_from_source: "Missing from Woven",
};

/**
 * A change as a person reads it. The event keeps its stored kind and
 * classification for history; only the words differ. The first sync's
 * `new_employee` events are the initial import, not 150 new people.
 */
export function changeLabel(kind: ChangeKind, classification: string | null): string {
  if (kind === "new_employee") {
    if (classification === "initial_load") return "Initial import";
    if (classification === "new_hire") return "New hire";
    return "New employee";
  }
  return CHANGE_KIND_LABELS[kind];
}
export const CHANGE_PAGE_SIZE = 50;

export function employeeName(row: {
  firstName: string | null;
  lastName: string | null;
  preferredFirstName: string | null;
}): string {
  const first = row.preferredFirstName ?? row.firstName;
  const name = [first, row.lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : "(no name in Woven)";
}

export function matchesFilter(row: DirectoryRow, filter: DirectoryFilter): boolean {
  switch (filter) {
    case "active":
      return row.employmentStatus === "active";
    case "terminated":
      return row.employmentStatus === "terminated";
    case "new_hire":
      return row.recentChangeKinds.includes("new_hire");
    case "position_changed":
      return row.recentChangeKinds.includes("position_changed");
    case "transfer":
      return row.recentChangeKinds.includes("primary_location_changed");
    case "multiple_locations":
      return row.activeLocationCount > 1 || row.hasMultipleLocationAccess === true || row.hasAllLocationAccess === true;
    case "missing_email":
      return row.emailAddress === null;
    case "unmapped_position":
      return row.positionId !== null && (row.positionMappingStatus === null || row.positionMappingStatus === "unmapped");
    case "unmapped_location":
      return row.hasUnmappedLocation;
  }
}

export type MappingTone = "ready" | "attention" | "failed" | "neutral";

export interface MappingSummary {
  label: string;
  tone: MappingTone;
  /** Why, for the badge's tooltip; null when the label says it all. */
  note: string | null;
}

/**
 * The directory's Mapping column. A DISPLAY RULE ONLY: the filters and counts
 * above still come from the stored flags, unchanged.
 *
 * A primary location reviewed as `ignored` (Corporate) is a deliberate
 * non-salon exception, not a missing salon mapping. Those rows read as
 * "[Woven PositionName] + [their Woven scope]": "All locations" only when
 * Woven says AllLocationAccess, otherwise what the affiliations actually show.
 * An unresolved location in their access (NE Omaha Q) is still counted under
 * Unmapped location, and said so in the note.
 */
export function mappingSummary(row: DirectoryRow): MappingSummary {
  if (row.emailAddress === null) return { label: "Missing email", tone: "failed", note: null };
  const positionMapped = row.positionMappingStatus === "mapped" || row.positionMappingStatus === "ignored";

  if (row.primaryLocationMappingStatus === "ignored") {
    const scope =
      row.hasAllLocationAccess === true
        ? "All locations"
        : row.dataIssues.includes("affiliations_not_verified")
          ? "Locations not verified"
          : row.activeLocationCount > 1
            ? `${row.activeLocationCount} locations`
            : `${row.primaryLocationName ?? "Primary location"} only`;
    const notes = [`${row.primaryLocationName ?? "This primary location"} is not a salon (approved exception).`];
    if (!positionMapped && row.positionId !== null) notes.push("Position not yet mapped to an Ask Sunny role.");
    if (row.hasUnmappedLocation) notes.push("Access includes a location not yet mapped to a salon, still counted under Unmapped location.");
    return { label: `${row.positionName ?? "No position"} + ${scope}`, tone: "neutral", note: notes.join(" ") };
  }

  if (positionMapped && !row.hasUnmappedLocation) return { label: "Mapped", tone: "ready", note: null };
  if (!positionMapped && row.hasUnmappedLocation) return { label: "Position + location", tone: "attention", note: null };
  return { label: positionMapped ? "Location unmapped" : "Position unmapped", tone: "attention", note: null };
}

function matchesSearch(row: DirectoryRow, search: string): boolean {
  if (search.length === 0) return true;
  const needle = search.toLowerCase();
  return [employeeName(row), row.emailAddress ?? "", row.externalEmployeeId]
    .some((value) => value.toLowerCase().includes(needle));
}

function locationIds(row: DirectoryRow): string[] {
  return [
    row.primaryLocationId,
    ...row.additionalLocations.map((l) => l.wovenLocationId),
    ...row.temporaryOrExpiringLocations.map((l) => l.wovenLocationId),
  ].filter((id): id is string => id !== null);
}

const FILTER_KEYS = new Set<string>(DIRECTORY_FILTERS.map((f) => f.key));

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function all(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function page(value: string | string[] | undefined): number {
  const n = Number(first(value));
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

const ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** Reads the directory tab's URL. Unknown filters, statuses and malformed ids are dropped, never guessed. */
export function parseDirectoryQuery(params: Params): DirectoryQuery {
  const location = first(params.location);
  const position = first(params.position);
  const status = first(params.status);
  return {
    search: first(params.q).trim().slice(0, 120),
    status: (EMPLOYMENT_STATUSES as readonly string[]).includes(status) ? (status as EmploymentStatus) : null,
    filters: [...new Set(all(params.filter).filter((f) => FILTER_KEYS.has(f)))] as DirectoryFilter[],
    locationId: ID.test(location) ? location : null,
    positionId: ID.test(position) ? position : null,
    page: page(params.page),
  };
}

export function queryDirectory(rows: readonly DirectoryRow[], query: DirectoryQuery, pageSize = DIRECTORY_PAGE_SIZE): DirectoryPage {
  const filterCounts = Object.fromEntries(
    DIRECTORY_FILTERS.map((f) => [f.key, rows.filter((row) => matchesFilter(row, f.key)).length]),
  ) as Record<DirectoryFilter, number>;

  const statusCounts = Object.fromEntries(
    EMPLOYMENT_STATUSES.map((s) => [s, rows.filter((row) => row.employmentStatus === s).length]),
  ) as Record<EmploymentStatus, number>;

  const matching = rows
    .filter((row) => query.status === null || row.employmentStatus === query.status)
    .filter((row) => matchesSearch(row, query.search))
    .filter((row) => query.filters.every((f) => matchesFilter(row, f)))
    .filter((row) => query.locationId === null || locationIds(row).includes(query.locationId))
    .filter((row) => query.positionId === null || row.positionId === query.positionId)
    .sort((a, b) => employeeName(a).localeCompare(employeeName(b)) || a.externalEmployeeId.localeCompare(b.externalEmployeeId));

  const locations = new Map<string, string>();
  const positions = new Map<string, string>();
  for (const row of rows) {
    if (row.primaryLocationId) {
      locations.set(
        row.primaryLocationId,
        row.primarySalonNumber ? `${row.primarySalonNumber} · ${row.primaryLocationName ?? ""}`.trim() : row.primaryLocationName ?? row.primaryLocationId,
      );
    }
    for (const l of [...row.additionalLocations, ...row.temporaryOrExpiringLocations]) {
      if (!locations.has(l.wovenLocationId)) locations.set(l.wovenLocationId, l.name ?? l.wovenLocationId);
    }
    if (row.positionId) positions.set(row.positionId, row.positionName ?? row.positionId);
  }

  const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
  const current = Math.min(query.page, lastPage);
  return {
    rows: matching.slice((current - 1) * pageSize, current * pageSize),
    total: matching.length,
    page: current,
    pageSize,
    filterCounts,
    statusCounts,
    locations: [...locations].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
    positions: [...positions].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

const REVIEW_STATUSES = new Set<string>(["unreviewed", "acknowledged", "dismissed"]);

export function parseChangeQuery(params: Params): ChangeQuery {
  const kind = first(params.kind);
  const review = first(params.review);
  return {
    kind: (CHANGE_KINDS as readonly string[]).includes(kind) ? (kind as ChangeKind) : null,
    review: REVIEW_STATUSES.has(review) ? (review as ReviewStatus) : null,
    page: page(params.page),
  };
}

export function emptyKindCounts(): Record<ChangeKind, number> {
  return Object.fromEntries(CHANGE_KINDS.map((k) => [k, 0])) as Record<ChangeKind, number>;
}

/** The change feed over rows already in memory — the sample set, or a test. */
export function queryChanges(rows: readonly ChangeRow[], query: ChangeQuery, pageSize = CHANGE_PAGE_SIZE): ChangePage {
  const kindCounts = emptyKindCounts();
  for (const row of rows) kindCounts[row.kind] += 1;
  const matching = rows
    .filter((row) => query.kind === null || row.kind === query.kind)
    .filter((row) => query.review === null || row.reviewStatus === query.review)
    .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  const lastPage = Math.max(1, Math.ceil(matching.length / pageSize));
  const current = Math.min(query.page, lastPage);
  return {
    rows: matching.slice((current - 1) * pageSize, current * pageSize),
    total: matching.length,
    page: current,
    pageSize,
    kindCounts,
  };
}

/* ------------------------------------------------------ access preview -- */

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).trim().toLowerCase();
}

export function domainEligible(email: string | null, domains: readonly string[]): boolean {
  return email !== null && domains.includes(emailDomain(email));
}

/** Rows where a later phase would do something. Read-only: this changes nobody. */
export function accessDrift(rows: readonly AccessPreviewRow[]): AccessPreviewRow[] {
  return rows.filter((r) => r.wouldDeactivate || r.roleDiffers || r.primarySalonDiffers || r.wouldProvision);
}

/**
 * WHAT FIRST-LOGIN PROVISIONING WOULD SAY about an email — a PREVIEW.
 *
 * Eligible only when every condition a later phase would need holds: exactly
 * one directory employee has the email, they are active, the address is at a
 * configured login domain, their position is confirmed with a role, and their
 * primary location is mapped to a salon. Anything missing is "held for
 * review"; not active, not at a login domain or not in Woven is "not eligible".
 * With no login domain configured, nobody is eligible.
 */
export function evaluateEligibility(
  email: string,
  rows: readonly AccessPreviewRow[],
  loginEmailDomains: readonly string[],
): EligibilityResult {
  const normalized = email.trim().toLowerCase();
  const reasons: string[] = [];
  const base = { previewOnly: true as const };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ...base, verdict: "not_eligible", reasons: ["That is not an email address."], employee: null };
  }
  if (loginEmailDomains.length === 0) {
    reasons.push("No login-email domain is configured (WOVEN_LOGIN_EMAIL_DOMAINS), so nobody is eligible yet.");
  } else if (!loginEmailDomains.includes(emailDomain(normalized))) {
    reasons.push("The address is not at a configured login-email domain.");
  }

  const matches = rows.filter((r) => r.emailAddress !== null && r.emailAddress.toLowerCase() === normalized);
  if (matches.length === 0) {
    return { ...base, verdict: "not_eligible", reasons: [...reasons, "No Woven employee has this email address."], employee: null };
  }
  if (matches.length > 1) {
    return {
      ...base,
      verdict: "held_for_review",
      reasons: [...reasons, `${matches.length} Woven employees share this email address; a person must resolve it.`],
      employee: null,
    };
  }

  const m = matches[0];
  const employee = {
    name: m.employeeName,
    externalEmployeeId: m.externalEmployeeId,
    employmentStatus: m.employmentStatus,
    wouldCreateRole: m.positionMappingConfirmed ? m.mappedRole : null,
    wouldCreateScopeLevel: m.positionMappingConfirmed ? m.mappedScopeLevel : null,
    primarySalonNumber: m.mappedPrimarySalonNumber,
  };

  if (m.employmentStatus !== "active") {
    return {
      ...base,
      verdict: "not_eligible",
      reasons: [...reasons, m.employmentStatus === "terminated" ? "Woven shows this employee as terminated." : "Woven's status for this employee is not Active."],
      employee,
    };
  }
  if (reasons.length > 0) return { ...base, verdict: "not_eligible", reasons, employee };

  const held: string[] = [];
  if (m.hasLogin) held.push("An Ask Sunny login already exists for this email; provisioning would not create another.");
  if (!m.positionMappingConfirmed) held.push("Their Woven position has no confirmed Ask Sunny role yet.");
  if (m.mappedPrimarySalonNumber === null) held.push("Their primary Woven location is not matched to an Ask Sunny salon yet.");
  if (held.length > 0) return { ...base, verdict: "held_for_review", reasons: held, employee };

  return {
    ...base,
    verdict: "eligible",
    reasons: ["Active in Woven, at a login-email domain, with a confirmed role and a mapped salon."],
    employee,
  };
}
