import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { DUPLICATE_DRAFT_WINDOW_HOURS, loadInstance, type InstanceRow } from "./instances";

/**
 * A resent create for the same person and form.
 *
 * The card-id match stays where it is. This runs only when
 * DRAFT_DEDUPE_ENABLED is on, and only for a draft the same person
 * already started. A follow-up or a second document is not a resend.
 */

export interface ResentDraftWanted {
  readonly templateKey: string;
  readonly employeeName: string;
  readonly createdBy: string;
  readonly locationId: string | null;
  readonly now?: Date;
}

export interface ResentDraftRow {
  readonly id: string;
  readonly employeeName: string;
  readonly locationId: string | null;
  readonly createdAt: string;
}

export function sameEmployee(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, " ").toLowerCase() === right.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The newest draft that is the same person, form and salon. */
export function pickResentDraft(rows: readonly ResentDraftRow[], wanted: ResentDraftWanted): string | null {
  const matches = rows.filter(
    (row) =>
      sameEmployee(row.employeeName, wanted.employeeName) &&
      (row.locationId ?? null) === (wanted.locationId ?? null),
  );
  if (matches.length === 0) return null;
  const newest = [...matches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
  return newest.id;
}

export async function findResentDraft(input: ResentDraftWanted): Promise<InstanceRow | null> {
  const supabase = getSupabaseAdmin();
  const { data: template, error: templateError } = await supabase
    .from("form_templates")
    .select("id")
    .eq("key", input.templateKey)
    .maybeSingle();
  if (templateError || !template) return null;

  const since = new Date((input.now ?? new Date()).getTime() - DUPLICATE_DRAFT_WINDOW_HOURS * 3_600_000);
  const { data, error } = await supabase
    .from("form_instances")
    .select("id, employee_name, location_id, created_at")
    .eq("template_id", template.id)
    .eq("created_by", input.createdBy)
    .eq("source", "ask_sunny")
    .eq("status", "draft")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !Array.isArray(data)) return null;

  const id = pickResentDraft(
    (data as { id: unknown; employee_name: unknown; location_id: unknown; created_at: unknown }[]).map((row) => ({
      id: String(row.id),
      employeeName: String(row.employee_name ?? ""),
      locationId: (row.location_id as string | null) ?? null,
      createdAt: String(row.created_at ?? ""),
    })),
    input,
  );
  if (!id) return null;
  const loaded = await loadInstance(id);
  return loaded?.instance.status === "draft" ? loaded.instance : null;
}
