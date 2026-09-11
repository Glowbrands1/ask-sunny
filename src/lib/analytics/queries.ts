import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { businessToday } from "@/lib/business-date";
import type { Role } from "@/types";
import {
  bucketFor,
  resolveWindow,
  type AnalyticsFilters,
  type ResolvedWindow,
} from "./filters";

/**
 * READING THE ADOPTION NUMBERS.
 *
 * EVERY AGGREGATE IS COMPUTED IN POSTGRES. This module calls five functions and
 * receives five small results; it never selects event rows and counts them here.
 * That is the difference between a dashboard that stays fast as the event table
 * grows and one that gets slower every week — and with fifteen salons and a
 * year of history, "just select them all" is the kind of shortcut that works
 * until precisely the moment somebody depends on it.
 *
 * SERVER ONLY. It holds the secret key, and it answers "which named leader has
 * used the product least", which is not a browser's business.
 */

export interface AnalyticsTotals {
  events: number;
  activeUsers: number;
  activeSalons: number;
  forms: number;
  documents: number;
  reports: number;
  chatEvents: number;
  failures: number;
}

export interface TrendPoint {
  date: string;
  events: number;
  activeUsers: number;
}

export interface BreakdownRow {
  key: string;
  events: number;
  activeUsers: number;
  activeSalons: number;
}

export interface LeaderRow {
  userId: string;
  displayName: string;
  role: Role;
  status: string;
  salonId: string | null;
  storeName: string | null;
  district: string | null;
  events: number;
  forms: number;
  documents: number;
  chatEvents: number;
  topCategory: string | null;
  lastActive: string | null;
}

export interface LocationRow {
  salonId: string;
  salonNumber: string;
  storeName: string;
  district: string | null;
  events: number;
  activeLeaders: number;
  assignedLeaders: number;
  forms: number;
  reports: number;
  topCategory: string | null;
  lastActive: string | null;
}

export interface AnalyticsSnapshot {
  window: ResolvedWindow;
  totals: AnalyticsTotals;
  previous: AnalyticsTotals;
  trend: TrendPoint[];
  byRole: BreakdownRow[];
  byCategory: BreakdownRow[];
  byFeature: BreakdownRow[];
  leaders: LeaderRow[];
  locations: LocationRow[];
  districts: string[];
  salons: { id: string; name: string; district: string | null }[];
  roster: { id: string; name: string; role: Role }[];
}

const EMPTY_TOTALS: AnalyticsTotals = {
  events: 0,
  activeUsers: 0,
  activeSalons: 0,
  forms: 0,
  documents: 0,
  reports: 0,
  chatEvents: 0,
  failures: 0,
};

/** The filter arguments every one of the five functions takes. */
function filterArgs(filters: AnalyticsFilters, window: ResolvedWindow) {
  return {
    p_from: window.from,
    p_to: window.to,
    p_district: filters.district,
    p_salon: filters.salonId,
    p_role: filters.role,
    p_actor: filters.actorId,
  };
}

function toNumber(value: unknown): number {
  /*
   * COUNTS ARRIVE AS STRINGS. Postgres `bigint` exceeds what JSON can carry
   * exactly, so supabase-js hands them over as text; `row.events + 1` on the
   * raw value would concatenate rather than add. Coerced once, here, rather
   * than at each of the dozen places that do arithmetic on a count.
   */
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The whole dashboard in one round trip's worth of parallel calls.
 *
 * Every query is independent, so they go together rather than in sequence —
 * nine sequential round trips to Supabase is most of a second of latency for no
 * reason. `Promise.all` rejects on the first failure, which is what we want: a
 * dashboard showing eight real panels and one silently empty one is worse than
 * one that says it could not load.
 */
export async function loadAnalytics(
  filters: AnalyticsFilters,
): Promise<AnalyticsSnapshot> {
  const supabase = getSupabaseAdmin();
  const window = resolveWindow(filters, businessToday());
  const args = filterArgs(filters, window);
  const previousArgs = {
    ...args,
    p_from: window.previousFrom,
    p_to: window.previousTo,
  };

  const [
    totals,
    previous,
    trend,
    byRole,
    byCategory,
    byFeature,
    leaders,
    locations,
    salons,
    roster,
  ] = await Promise.all([
    supabase.rpc("analytics_totals", args),
    supabase.rpc("analytics_totals", previousArgs),
    supabase.rpc("analytics_trend", {
      ...args,
      p_bucket: bucketFor(window.days),
    }),
    supabase.rpc("analytics_breakdown", { ...args, p_dimension: "role" }),
    supabase.rpc("analytics_breakdown", { ...args, p_dimension: "category" }),
    supabase.rpc("analytics_breakdown", { ...args, p_dimension: "feature" }),
    supabase.rpc("analytics_leaders", args),
    supabase.rpc("analytics_locations", args),
    supabase
      .from("salon_directory")
      .select("salon_id, store_name, district_label")
      .order("store_name"),
    supabase
      .from("leader_directory")
      .select("user_id, display_name, role")
      .order("display_name"),
  ]);

  const failure =
    totals.error ??
    previous.error ??
    trend.error ??
    byRole.error ??
    byCategory.error ??
    byFeature.error ??
    leaders.error ??
    locations.error ??
    salons.error ??
    roster.error;
  if (failure) {
    throw new Error(`Analytics could not be loaded: ${failure.message}`);
  }

  const salonRows = (salons.data ?? []) as {
    salon_id: string;
    store_name: string;
    district_label: string | null;
  }[];

  return {
    window,
    totals: readTotals(totals.data),
    previous: readTotals(previous.data),
    trend: (trend.data ?? []).map((row: Record<string, unknown>) => ({
      date: String(row.bucket_start),
      events: toNumber(row.events),
      activeUsers: toNumber(row.active_users),
    })),
    byRole: readBreakdown(byRole.data),
    byCategory: readBreakdown(byCategory.data),
    byFeature: readBreakdown(byFeature.data),
    leaders: (leaders.data ?? []).map((row: Record<string, unknown>) => ({
      userId: String(row.user_id),
      displayName: String(row.display_name ?? ""),
      role: row.role as Role,
      status: String(row.status ?? ""),
      salonId: (row.salon_id as string | null) ?? null,
      storeName: (row.store_name as string | null) ?? null,
      district: (row.district_label as string | null) ?? null,
      events: toNumber(row.events),
      forms: toNumber(row.forms),
      documents: toNumber(row.documents),
      chatEvents: toNumber(row.chat_events),
      topCategory: (row.top_category as string | null) ?? null,
      lastActive: (row.last_active as string | null) ?? null,
    })),
    locations: (locations.data ?? []).map((row: Record<string, unknown>) => ({
      salonId: String(row.salon_id),
      salonNumber: String(row.salon_number ?? ""),
      storeName: String(row.store_name ?? ""),
      district: (row.district_label as string | null) ?? null,
      events: toNumber(row.events),
      activeLeaders: toNumber(row.active_leaders),
      assignedLeaders: toNumber(row.assigned_leaders),
      forms: toNumber(row.forms),
      reports: toNumber(row.reports),
      topCategory: (row.top_category as string | null) ?? null,
      lastActive: (row.last_active as string | null) ?? null,
    })),
    /*
     * The filter options come from the DIRECTORIES, not from the filtered
     * result. Reading them off the current result would make a filter remove
     * its own option — pick a district and every other district vanishes from
     * the dropdown, leaving no way back but the Reset button.
     */
    districts: [
      ...new Set(
        salonRows
          .map((row) => row.district_label)
          .filter((label): label is string => Boolean(label)),
      ),
    ].sort(),
    salons: salonRows.map((row) => ({
      id: row.salon_id,
      name: row.store_name,
      district: row.district_label,
    })),
    roster: (roster.data ?? []).map(
      (row: { user_id: string; display_name: string; role: Role }) => ({
        id: row.user_id,
        name: row.display_name,
        role: row.role,
      }),
    ),
  };
}

function readTotals(data: unknown): AnalyticsTotals {
  /* The function returns a one-row table, so supabase-js hands back an array. */
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return EMPTY_TOTALS;
  const record = row as Record<string, unknown>;
  return {
    events: toNumber(record.events),
    activeUsers: toNumber(record.active_users),
    activeSalons: toNumber(record.active_salons),
    forms: toNumber(record.forms),
    documents: toNumber(record.documents),
    reports: toNumber(record.reports),
    chatEvents: toNumber(record.chat_events),
    failures: toNumber(record.failures),
  };
}

function readBreakdown(data: unknown): BreakdownRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => ({
    key: String(row.key ?? ""),
    events: toNumber(row.events),
    activeUsers: toNumber(row.active_users),
    activeSalons: toNumber(row.active_salons),
  }));
}

/**
 * Percentage change against the prior window, or null when there is nothing to
 * compare against.
 *
 * NULL RATHER THAN A NUMBER WHEN THE BASELINE IS ZERO, and this is the rule the
 * user asked for in as many words: do not show a misleading percentage when the
 * comparison period has insufficient data. Going from 0 to 7 is not "+700%" —
 * it is the first week of use, and dividing by zero to say otherwise turns a
 * real beginning into a fake trend. The card shows the figure and says the prior
 * period had none.
 */
export function changeAgainst(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}
