/**
 * ============================================================================
 * WHAT THE WOVEN ADMIN TABS RENDER — types only, safe on either side
 * ============================================================================
 *
 * The six tabs render these shapes and nothing else. The server fills them
 * from the migration's views (`directory.ts`, `positions.ts`,
 * `access-preview.ts`, `status.ts`), and a DEMO build fills them from the
 * labelled sample set behind the demo boundary (`data/demo/woven.ts`). One
 * shape, two sources, so a sample screen is exactly the real screen.
 *
 * Types only: importing this module ships nothing.
 */

import type { AccessType, ChangeKind, EmploymentStatus, LocationMapStatus, PositionMapStatus } from "./types";

export interface DirectoryLocation {
  wovenLocationId: string;
  name: string | null;
  number: string | null;
  expiresOn?: string | null;
}

export interface DirectoryRow {
  id: string;
  externalEmployeeId: string;
  firstName: string | null;
  lastName: string | null;
  preferredFirstName: string | null;
  emailAddress: string | null;
  employmentStatus: EmploymentStatus;
  positionId: string | null;
  positionName: string | null;
  positionMappingStatus: PositionMapStatus | null;
  primaryLocationId: string | null;
  primaryLocationName: string | null;
  /** The primary location's map status; `ignored` is a deliberate non-salon location such as Corporate. */
  primaryLocationMappingStatus: LocationMapStatus | null;
  primarySalonNumber: string | null;
  additionalLocations: DirectoryLocation[];
  temporaryOrExpiringLocations: DirectoryLocation[];
  activeLocationCount: number;
  hasUnmappedLocation: boolean;
  hasMultipleLocationAccess: boolean | null;
  hasAllLocationAccess: boolean | null;
  hireDate: string | null;
  terminationDate: string | null;
  dataIssues: string[];
  /** Consecutive stored runs this employee was in no read of. Above 0, their status is not observed (`observedStatus`). */
  missingSyncCount: number;
  lastSeenAt: string;
  lastSyncedAt: string;
  lastChangeKind: ChangeKind | null;
  /** The last change's classification (`initial_load`, `new_hire`, …), so the screen can say "Initial import". */
  lastChangeClassification: string | null;
  lastChangeAt: string | null;
  /** Change kinds in the last 30 days; `new_hire` stands in for a new employee classified as a hire. */
  recentChangeKinds: string[];
}

export type DirectoryFilter =
  | "active"
  | "terminated"
  | "new_hire"
  | "position_changed"
  | "transfer"
  | "multiple_locations"
  | "missing_email"
  | "unmapped_position"
  | "unmapped_location";

export const DIRECTORY_FILTERS: readonly { key: DirectoryFilter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "terminated", label: "Terminated" },
  { key: "new_hire", label: "New hire" },
  { key: "position_changed", label: "Position changed" },
  { key: "transfer", label: "Transfer" },
  { key: "multiple_locations", label: "Multiple locations" },
  { key: "missing_email", label: "Missing email" },
  { key: "unmapped_position", label: "Unmapped position" },
  { key: "unmapped_location", label: "Unmapped location" },
];

export interface DirectoryQuery {
  search: string;
  /** Woven's normalised employment status. Null: all statuses. Never derived from a termination date. */
  status: EmploymentStatus | null;
  filters: DirectoryFilter[];
  locationId: string | null;
  positionId: string | null;
  page: number;
}

export interface DirectoryPage {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Counts per filter across the whole directory, for the chips. */
  filterCounts: Record<DirectoryFilter, number>;
  /** Counts per employment status across the whole directory, for the status dropdown. */
  statusCounts: Record<EmploymentStatus, number>;
  locations: { id: string; label: string }[];
  positions: { id: string; label: string }[];
}

export type ReviewStatus = "unreviewed" | "acknowledged" | "dismissed";

export interface ChangeRow {
  id: string;
  employeeName: string;
  externalEmployeeId: string;
  kind: ChangeKind;
  fieldName: string | null;
  classification: string | null;
  fromValue: unknown;
  toValue: unknown;
  effectiveDate: string | null;
  detectedAt: string;
  syncRunId: string;
  reviewStatus: ReviewStatus;
}

export interface ChangeQuery {
  kind: ChangeKind | null;
  review: ReviewStatus | null;
  page: number;
}

export interface ChangePage {
  rows: ChangeRow[];
  total: number;
  page: number;
  pageSize: number;
  kindCounts: Record<ChangeKind, number>;
}

export interface RunRow {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed" | "rejected";
  sourceMode: "scheduled_poll" | "manual_poll" | "webhook";
  employeesFetched: number;
  employeesAdded: number;
  employeesUpdated: number;
  newHires: number;
  terminations: number;
  positionChanges: number;
  confirmedPromotionsDemotions: number;
  transfers: number;
  locationAccessChanges: number;
  errorCount: number;
  errorCode: string | null;
  errorDetail: string | null;
}

/** The Overview's cards. Counts and timestamps only: no name, email or employee id. */
export interface OverviewCounts {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptStatus: RunRow["status"] | null;
  totalActive: number;
  totalTerminated: number;
  totalStatusUnknown: number;
  /** Null when the last successful run was the first one (initial load). */
  newHiresSinceLast: number | null;
  initialLoadCount: number | null;
  terminationsSinceLast: number;
  positionChangesSinceLast: number;
  confirmedPromotionsDemotionsSinceLast: number;
  transfersSinceLast: number;
  locationAccessAddedSinceLast: number;
  locationAccessRemovedSinceLast: number;
  lastRunErrorCount: number;
  recordsWithIssues: number;
  unmappedLocations: number;
  unmappedPositions: number;
  employeesMissingEmail: number;
  unreviewedChanges: number;
  recentRuns: { status: RunRow["status"]; employeesFetched: number }[];
}

export interface LocationMappingRow {
  wovenLocationId: string;
  name: string | null;
  displayName: string | null;
  number: string | null;
  districtName: string | null;
  regionName: string | null;
  isClosed: boolean | null;
  isNonLocation: boolean | null;
  employeeCount: number;
  status: LocationMapStatus;
  salonNumber: string | null;
  salonName: string | null;
  suggestedSalonNumber: string | null;
  suggestedSalonName: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface PositionMappingRow {
  wovenPositionId: string;
  name: string | null;
  employeeCount: number;
  status: PositionMapStatus;
  role: string | null;
  scopeLevel: string | null;
  hierarchyRank: number | null;
  isConfirmed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface AccessPreviewRow {
  employeeId: string;
  externalEmployeeId: string;
  employeeName: string;
  employmentStatus: EmploymentStatus;
  emailAddress: string | null;
  emailIsDuplicated: boolean;
  /** Whether the email's domain is on the configured login rule. False while the rule is unset. */
  emailDomainEligible: boolean;
  positionMappingConfirmed: boolean;
  mappedRole: string | null;
  mappedScopeLevel: string | null;
  mappedPrimarySalonNumber: string | null;
  appUserRole: string | null;
  appUserStatus: string | null;
  appUserScopeLevel: string | null;
  appUserScopePrimaryAreaId: string | null;
  hasLogin: boolean;
  wouldProvision: boolean;
  wouldDeactivate: boolean;
  roleDiffers: boolean;
  primarySalonDiffers: boolean;
  /** A protected override's role, when this employee has one. */
  roleOverride: string | null;
  /** The role this employee resolves to: override → confirmed position → none. */
  effectiveRole: string | null;
  effectiveScopeLevel: string | null;
  roleSource: "override" | "position" | "none";
}

export type EligibilityVerdict = "eligible" | "held_for_review" | "not_eligible";

export interface EligibilityResult {
  verdict: EligibilityVerdict;
  reasons: string[];
  /** Present only when the email matched exactly one directory employee. */
  employee: {
    name: string;
    externalEmployeeId: string;
    employmentStatus: EmploymentStatus;
    wouldCreateRole: string | null;
    wouldCreateScopeLevel: string | null;
    primarySalonNumber: string | null;
  } | null;
  /** Always true in phase one: nothing is created. */
  previewOnly: true;
}

/** The whole labelled sample set a demo build shows in place of Supabase. */
export interface WovenSampleDataset {
  readonly label: string;
  readonly overview: OverviewCounts;
  readonly directory: readonly DirectoryRow[];
  readonly changes: readonly ChangeRow[];
  readonly runs: readonly RunRow[];
  readonly locations: readonly LocationMappingRow[];
  readonly positions: readonly PositionMappingRow[];
  readonly accessPreview: readonly AccessPreviewRow[];
  /** The login-email domains the sample pretends are configured. */
  readonly loginEmailDomains: readonly string[];
}

export type { AccessType };
