import "server-only";

import { hasPermission, DEFAULT_PERMISSION_MATRIX } from "@/lib/permissions";
import { reportingScopeOf } from "@/lib/reporting/scope/authorized-salons";
import { EMPTY_REVIEW_FILTERS } from "@/lib/reviews/filters";
import { loadReviewFeed } from "@/lib/reviews/queries";
import { GOOGLE_REVIEW_LOCATIONS } from "@/lib/reviews/store-codes";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { AccessScope, Role } from "@/types";

import { storeCodesForSalonNumbers } from "./chat-data-plan";
import { formatBreakdown, type BreakdownPlan, type BreakdownRow } from "./report-breakdown";

/**
 * The flagged breakdown read. Callers invoke this only when
 * REPORT_BREAKDOWN_ENABLED is on. Salon scope is applied in the query.
 */

const CAP = 40;

export async function readFlaggedBreakdown(input: {
  readonly plan: BreakdownPlan;
  readonly role: Role | null;
  readonly scope: AccessScope | null;
}): Promise<string> {
  const plan = input.plan;
  if (plan.kind === "unavailable" || plan.unavailable) return formatBreakdown(plan, [], null);
  const reports = input.role !== null && hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_reports");
  const reviews = input.role !== null && hasPermission(DEFAULT_PERMISSION_MATRIX, input.role, "view_google_reviews");
  if (plan.kind === "reviews") {
    if (!reviews) return "Google review breakdowns require the view_google_reviews permission. No reviews were read.";
    return formatBreakdown(plan, await reviewRows(input.scope, plan), null);
  }
  if (!reports) return "Report breakdowns require the view_reports permission. No report rows were read.";
  if (plan.kind === "comp") return formatBreakdown(plan, await compRows(input.scope, plan), null);
  if (plan.kind === "sales") return formatBreakdown(plan, await salesRows(input.scope, plan), null);
  return "";
}

async function reviewRows(scope: AccessScope | null, plan: BreakdownPlan): Promise<BreakdownRow[]> {
  const allowed = reportingScopeOf(scope);
  const storeCodes = allowed.unrestricted
    ? GOOGLE_REVIEW_LOCATIONS.map((entry) => entry.storeCode)
    : storeCodesForSalonNumbers(allowed.salonNumbers);
  const rows: BreakdownRow[] = [];
  for (const storeCode of storeCodes.slice(0, 15)) {
    const feed = await loadReviewFeed({
      ...EMPTY_REVIEW_FILTERS,
      storeCode,
      rating: plan.rating ?? "all",
    });
    const listing = GOOGLE_REVIEW_LOCATIONS.find((entry) => entry.storeCode === storeCode);
    rows.push({
      label: listing?.googleLabel ?? storeCode,
      when: "feed",
      value: `${feed.total} review${feed.total === 1 ? "" : "s"}${plan.rating ? ` at ${plan.rating} star` : ""}`,
    });
    if (rows.length >= CAP) break;
  }
  return rows;
}

async function salesRows(scope: AccessScope | null, plan: BreakdownPlan): Promise<BreakdownRow[]> {
  const allowed = reportingScopeOf(scope);
  const window = plan.groupBy === "month" ? "mtd" : "daily";
  let query = getSupabaseAdmin()
    .from("sales_totals_current_facts")
    .select("report_date, salon_number, store_name, metric_code, value, report_window, scope_kind")
    .eq("report_window", window)
    .eq("metric_code", plan.metric ?? "grand_total")
    .eq("scope_kind", "salon")
    .order("report_date", { ascending: false })
    .limit(CAP);
  if (!allowed.unrestricted) query = query.in("salon_number", allowed.salonNumbers);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    label: String(row.store_name ?? row.salon_number ?? "salon"),
    when: String(row.report_date ?? ""),
    value: `${plan.metric ?? "value"} ${row.value ?? "blank"}`,
  }));
}

async function compRows(scope: AccessScope | null, plan: BreakdownPlan): Promise<BreakdownRow[]> {
  const allowed = reportingScopeOf(scope);
  let query = getSupabaseAdmin()
    .from("comp_sales_current_facts")
    .select("period_id, salon_number, store_name, metric_code, basis_year, value")
    .eq("metric_code", plan.metric ?? "total_revenue")
    .order("period_id", { ascending: false })
    .limit(CAP);
  if (!allowed.unrestricted) query = query.in("salon_number", allowed.salonNumbers);
  const { data, error } = await query;
  if (error || !Array.isArray(data) || data.length === 0) return [];
  const period = String(data[0]?.period_id ?? "");
  return data
    .filter((row) => String(row.period_id ?? "") === period)
    .map((row) => ({
      label: String(row.store_name ?? row.salon_number ?? "salon"),
      when: period,
      value: `${plan.metric ?? "value"} ${row.value ?? "blank"} (basis ${row.basis_year ?? "not stored"})`,
    }));
}
