import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { loadDirectoryRows } from "../directory";
import { listWovenLocations } from "../locations";
import { listWovenPositions } from "../positions";
import { classifyStatusError } from "../status";
import { plannerAccount, plannerEmployee, plannerLocation, plannerPosition } from "./adapters";
import { buildAccessPlan, type AccessPlan } from "./build";
import type { DirectoryRunFacts, MappingCounts } from "./guards";

export { buildAccessPlan, type AccessPlan } from "./build";

/**
 * ============================================================================
 * THE ACCESS PLAN, FROM THE DATABASE — read-only
 * ============================================================================
 *
 * Reads the directory, the two mappings, the accounts (through the
 * `employee_access_accounts` view — never `app_users` directly), recent
 * directory runs and the last recorded access run, then plans and guards.
 * Writes nothing.
 */


const PAGE = 1000;

async function loadAccounts() {
  const db = getSupabaseAdmin();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("employee_access_accounts").select("*").order("app_user_id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw classifyStatusError(error);
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map(plannerAccount).filter((a) => a !== null);
}

async function loadRunFacts(): Promise<{ runs: DirectoryRunFacts[]; latestSuccessId: string | null }> {
  const { data, error } = await getSupabaseAdmin()
    .from("employee_sync_runs")
    .select("id, status, finished_at, employees_active, issue_counts")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) throw classifyStatusError(error);
  const rows = (data ?? []) as Record<string, unknown>[];
  const runs = rows.map((r) => ({
    status: (["running", "succeeded", "failed", "rejected"].includes(String(r.status)) ? r.status : "failed") as DirectoryRunFacts["status"],
    finishedAt: typeof r.finished_at === "string" ? r.finished_at : null,
    employeesActive: typeof r.employees_active === "number" ? r.employees_active : 0,
    issueCounts: r.issue_counts && typeof r.issue_counts === "object" ? (r.issue_counts as Record<string, number>) : {},
  }));
  const latestSuccess = rows.find((r) => r.status === "succeeded");
  return { runs, latestSuccessId: latestSuccess ? String(latestSuccess.id) : null };
}

async function loadMappingBaseline(): Promise<MappingCounts | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("employee_access_runs")
    .select("counts")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw classifyStatusError(error);
  const counts = (data?.[0] as { counts?: { mappings?: MappingCounts } } | undefined)?.counts?.mappings;
  return counts && typeof counts.mappedLocations === "number" && typeof counts.confirmedPositions === "number" ? counts : null;
}

export async function loadAccessPlan(now: Date = new Date()): Promise<AccessPlan> {
  const [directory, locations, positions, accounts, runFacts, mappingBaseline] = await Promise.all([
    loadDirectoryRows(),
    listWovenLocations(),
    listWovenPositions(),
    loadAccounts(),
    loadRunFacts(),
    loadMappingBaseline(),
  ]);
  return buildAccessPlan(
    {
      employees: directory.map(plannerEmployee),
      positions: positions.map(plannerPosition),
      locations: locations.map(plannerLocation),
      accounts,
    },
    { runs: runFacts.runs, mappingBaseline, directoryRunId: runFacts.latestSuccessId, now },
  );
}
