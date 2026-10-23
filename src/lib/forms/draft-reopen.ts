import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { trigramSimilarity } from "@/lib/ai/intake-augment";

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
  /** When set, a draft is the same one only if its narrative is this incident. */
  readonly incident?: string | null;
  readonly formDate?: string | null;
}

export interface ResentDraftRow {
  readonly id: string;
  readonly employeeName: string;
  readonly locationId: string | null;
  readonly createdAt: string;
  readonly narrative?: string | null;
  readonly formDate?: string | null;
}

export function sameEmployee(left: string, right: string): boolean {
  return left.trim().replace(/\s+/g, " ").toLowerCase() === right.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Whether two accounts are the same incident. Omitted incident keeps the
 * employee match. An empty draft narrative is not the same incident.
 */
export function sameIncident(wanted: string, narrative: string): boolean {
  const left = wanted.trim();
  const right = narrative.trim();
  if (!left || !right) return false;
  if (trigramSimilarity(left, right) >= 0.42) return true;
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 5),
    );
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size) >= 0.5;
}

/** The newest draft that is the same person, form, salon, and incident. */
export function pickResentDraft(rows: readonly ResentDraftRow[], wanted: ResentDraftWanted): string | null {
  const matches = rows.filter((row) => {
    if (!sameEmployee(row.employeeName, wanted.employeeName)) return false;
    if ((row.locationId ?? null) !== (wanted.locationId ?? null)) return false;
    if (wanted.incident == null) return true;
    if (wanted.formDate && row.formDate && wanted.formDate !== row.formDate) return false;
    return sameIncident(wanted.incident, row.narrative ?? "");
  });
  if (matches.length === 0) return null;
  const newest = [...matches].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0]!;
  return newest.id;
}

const NARRATIVE_FIELD = /coaching_details|follow_up_observation|what_happened|incident|description|narrative|details/i;

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
    .select("id, employee_name, location_id, created_at, form_date")
    .eq("template_id", template.id)
    .eq("created_by", input.createdBy)
    .eq("source", "ask_sunny")
    .eq("status", "draft")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !Array.isArray(data)) return null;

  let rows: ResentDraftRow[] = (
    data as { id: unknown; employee_name: unknown; location_id: unknown; created_at: unknown; form_date: unknown }[]
  ).map((row) => ({
    id: String(row.id),
    employeeName: String(row.employee_name ?? ""),
    locationId: (row.location_id as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
    formDate: typeof row.form_date === "string" ? row.form_date : null,
  }));

  if (input.incident != null) {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return null;
    const { data: values, error: valuesError } = await supabase
      .from("form_instance_values")
      .select("instance_id, field_key, value")
      .in("instance_id", ids);
    if (valuesError || !Array.isArray(values)) return null;
    const narrative = new Map<string, string>();
    for (const row of values) {
      const key = String(row.field_key ?? "");
      const value = String(row.value ?? "").trim();
      if (!value || !NARRATIVE_FIELD.test(key)) continue;
      const id = String(row.instance_id);
      narrative.set(id, [narrative.get(id), value].filter(Boolean).join("\n"));
    }
    rows = rows.map((row) => ({ ...row, narrative: narrative.get(row.id) ?? "" }));
  }

  const id = pickResentDraft(rows, input);
  if (!id) return null;
  const loaded = await loadInstance(id);
  return loaded?.instance.status === "draft" ? loaded.instance : null;
}
