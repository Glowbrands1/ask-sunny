import { plannerEmployee, plannerLocation, plannerPosition } from "@/lib/employees/woven/access/adapters";
import { buildAccessPlan, type AccessPlan } from "@/lib/employees/woven/access/build";
import type { PlannerAccount } from "@/lib/employees/woven/access/types";
import type { WovenSampleDataset } from "@/lib/employees/woven/view-types";

/**
 * The sample's plan: the same planner over the sample directory and mappings,
 * with one unconfirmed account per sample login — so the demo shows what the
 * real tab shows, from data that was never written anywhere.
 */
export function sampleAccessPlan(sample: WovenSampleDataset): AccessPlan {
  const accounts: PlannerAccount[] = sample.accessPreview
    .filter((row) => row.hasLogin && row.emailAddress)
    .map((row, i) => ({
      appUserId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      email: row.emailAddress!,
      displayName: row.employeeName,
      role: (row.appUserRole ?? "salon_director") as PlannerAccount["role"],
      status: (row.appUserStatus ?? "active") as PlannerAccount["status"],
      scopeLevel: (row.appUserScopeLevel ?? "salon") as PlannerAccount["scopeLevel"],
      primaryAreaId: row.appUserScopePrimaryAreaId,
      alsoCoversAreaIds: [],
      management: null,
      linkedExternalEmployeeId: null,
      linkMethod: null,
      managedStatus: false,
      managedLocation: false,
      managedRole: false,
      terminatedAt: null,
      accessRevokedAt: null,
      override: null,
    }));
  const latest = sample.runs[0];
  return buildAccessPlan(
    {
      employees: sample.directory.map(plannerEmployee),
      positions: sample.positions.map(plannerPosition),
      locations: sample.locations.map(plannerLocation),
      accounts,
    },
    {
      runs: sample.runs.map((r) => ({
        status: r.status === "succeeded" ? "succeeded" : "failed",
        finishedAt: r.finishedAt,
        employeesActive: sample.directory.filter((d) => d.employmentStatus === "active").length,
        issueCounts: {},
      })),
      mappingBaseline: null,
      directoryRunId: null,
      now: latest?.finishedAt ? new Date(Date.parse(latest.finishedAt) + 3_600_000) : new Date(),
    },
  );
}
