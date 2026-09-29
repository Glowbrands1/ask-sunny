import "server-only";

import { ROLES } from "@/lib/permissions";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { Role, ScopeLevel } from "@/types";
import { readId } from "./normalize";
import { classifyStatusError } from "./status";
import { EmployeeStoreError } from "./store";
import type { PositionMapStatus } from "./types";
import type { PositionMappingRow } from "./view-types";

/**
 * ============================================================================
 * THE WOVEN POSITION → ASK SUNNY ROLE AND SCOPE MAP
 * ============================================================================
 *
 * A PERSON DECIDES EVERY MAPPING. Woven has no positions endpoint, so the sync
 * queues each PositionID it sees on an employee as `unmapped`, with its latest
 * name. A reviewer chooses the Ask Sunny role, a DEFAULT scope level and a
 * rank, and confirms it.
 *
 * IN PHASE ONE IT IS A LABEL. The change feed uses confirmed ranks to classify
 * a position change as a confirmed promotion or demotion, and the Access
 * Preview shows what a later phase would propose. Nothing reads this map to
 * set anybody's role, scope or salon access.
 *
 * A SCOPE LEVEL IS A DEFAULT, NOT A RULE: the scope AREA — which salon,
 * district or region — would come from the location map in a later phase.
 */

const SCOPE_LEVELS: readonly ScopeLevel[] = ["global", "region", "district", "salon"];
const PAGE = 1000;

async function headcounts(): Promise<Map<string, number>> {
  const db = getSupabaseAdmin();
  const counts = new Map<string, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("employee_access_directory")
      .select("position_id")
      .eq("employment_status", "active")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw classifyStatusError(error);
    const page = (data ?? []) as Record<string, unknown>[];
    for (const row of page) {
      if (typeof row.position_id === "string") counts.set(row.position_id, (counts.get(row.position_id) ?? 0) + 1);
    }
    if (page.length < PAGE) break;
  }
  return counts;
}

export async function listWovenPositions(): Promise<PositionMappingRow[]> {
  const [{ data, error }, counts] = await Promise.all([
    getSupabaseAdmin()
      .from("woven_position_map")
      .select("woven_position_id, woven_position_name, status, ask_sunny_role, ask_sunny_scope_level, hierarchy_rank, is_confirmed, reviewed_by, reviewed_at")
      .order("status", { ascending: true })
      .order("woven_position_name", { ascending: true }),
    headcounts(),
  ]);
  if (error) throw classifyStatusError(error);

  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    wovenPositionId: String(row.woven_position_id),
    name: str(row.woven_position_name),
    employeeCount: counts.get(String(row.woven_position_id)) ?? 0,
    status: row.status as PositionMapStatus,
    role: str(row.ask_sunny_role),
    scopeLevel: str(row.ask_sunny_scope_level),
    hierarchyRank: typeof row.hierarchy_rank === "number" ? row.hierarchy_rank : null,
    isConfirmed: row.is_confirmed === true,
    reviewedBy: str(row.reviewed_by),
    reviewedAt: str(row.reviewed_at),
  }));
}

export class PositionReviewError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "PositionReviewError";
  }
}

export interface PositionReview {
  wovenPositionId: string;
  status: PositionMapStatus;
  role: Role | null;
  scopeLevel: ScopeLevel | null;
  hierarchyRank: number | null;
}

/** Validates a review request. Throws `PositionReviewError` with a sentence to show. */
export function parsePositionReview(body: Partial<Record<string, unknown>>): PositionReview {
  const wovenPositionId = readId(body.wovenPositionId);
  if (!wovenPositionId) throw new PositionReviewError("A Woven position id is required.");

  const status = body.status;
  if (status !== "mapped" && status !== "ignored" && status !== "unmapped") {
    throw new PositionReviewError("A position is `mapped`, `ignored` or `unmapped`.");
  }
  if (status !== "mapped") return { wovenPositionId, status, role: null, scopeLevel: null, hierarchyRank: null };

  const role = body.role;
  if (typeof role !== "string" || !(ROLES as readonly string[]).includes(role)) {
    throw new PositionReviewError("Mapping a position needs an Ask Sunny role.");
  }
  const scopeLevel = body.scopeLevel;
  if (typeof scopeLevel !== "string" || !(SCOPE_LEVELS as readonly string[]).includes(scopeLevel)) {
    throw new PositionReviewError("Mapping a position needs a default scope level: global, region, district or salon.");
  }
  let hierarchyRank: number | null = null;
  if (body.hierarchyRank !== undefined && body.hierarchyRank !== null && body.hierarchyRank !== "") {
    const rank = Number(body.hierarchyRank);
    if (!Number.isInteger(rank) || rank < 0 || rank > 1000) {
      throw new PositionReviewError("A rank is a whole number from 0 to 1000; higher is more senior.");
    }
    hierarchyRank = rank;
  }
  return { wovenPositionId, status, role: role as Role, scopeLevel: scopeLevel as ScopeLevel, hierarchyRank };
}

export type PositionReviewResult = "reviewed" | "unknown_position" | "reviewer_required" | "role_and_scope_required";

export async function reviewWovenPosition(input: PositionReview & { reviewedBy: string }): Promise<PositionReviewResult> {
  const { data, error } = await getSupabaseAdmin().rpc("woven_position_map_review", {
    p_woven_position_id: input.wovenPositionId,
    p_status: input.status,
    p_role: input.role,
    p_scope_level: input.scopeLevel,
    p_hierarchy_rank: input.hierarchyRank,
    p_reviewed_by: input.reviewedBy,
  });
  if (error) throw new EmployeeStoreError("store_unavailable", "The Woven position could not be updated.");
  const status = (data as { status?: unknown } | null)?.status;
  return status === "reviewed" || status === "unknown_position" || status === "reviewer_required" || status === "role_and_scope_required"
    ? status
    : "unknown_position";
}
