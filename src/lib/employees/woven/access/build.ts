import { evaluateAccessGuards, type DirectoryRunFacts, type GuardResult, type MappingCounts } from "./guards";
import { ACCESS_POLICY_VERSION, AUTO_PROVISION_ROLES, countActions, planAccess } from "./plan";
import type { AccessAction, PlannedRow, PlannerInput } from "./types";

export interface AccessPlan {
  rows: PlannedRow[];
  counts: Record<AccessAction, number>;
  guard: GuardResult;
  policyVersion: string;
  /** The directory run the plan is based on (the latest successful one). */
  directoryRunId: string | null;
  mappings: MappingCounts;
}

/** Pure: plan and guard an input. Shared by the loader, the shadow recorder and the demo sample. */
export function buildAccessPlan(
  input: PlannerInput,
  facts: { runs: readonly DirectoryRunFacts[]; mappingBaseline: MappingCounts | null; directoryRunId: string | null; now: Date },
): AccessPlan {
  const rows = planAccess(input);
  const mappings: MappingCounts = {
    mappedLocations: input.locations.filter((l) => l.status === "mapped").length,
    confirmedPositions: input.positions.filter((p) => p.isConfirmed).length,
    approvedProvisionPositions: input.positions.filter(
      (p) => p.isConfirmed && p.status === "mapped" && p.role !== null && AUTO_PROVISION_ROLES.includes(p.role),
    ).length,
  };
  return {
    rows,
    counts: countActions(rows),
    guard: evaluateAccessGuards({
      rows,
      runs: facts.runs,
      mappings,
      mappingBaseline: facts.mappingBaseline,
      now: facts.now,
      authUsersVerified: input.authOnly === null ? false : undefined,
    }),
    policyVersion: ACCESS_POLICY_VERSION,
    directoryRunId: facts.directoryRunId,
    mappings,
  };
}

