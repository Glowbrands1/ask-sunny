import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";
import { REMINDER_ROW, mayView, type Coverage, type ReminderRow } from "./sources";

/**
 * Personal reminders ("+ New event" and the chat's reminder card): public.calendar_reminders
 * (20261127001000_calendar.sql), server-only, read and written under the secret key and filtered here by `mayView`.
 */
export const REMINDER_TITLE_MAX = 200;
const HOURLY_LIMIT = 60;

export async function listVisibleReminders(viewer: { subject: string; coverage: Coverage; manager: boolean }, range: { from: string; to: string }): Promise<ReminderRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("calendar_reminders")
    .select("id, owner_subject, owner_name, title, on_date, start_time, visibility, team_salon_numbers")
    .is("deleted_at", null)
    .gte("on_date", range.from)
    .lte("on_date", range.to)
    .order("on_date")
    .limit(2000);
  if (error) throw new Error(`Could not read reminders: ${error.message}`);
  return (data ?? []).flatMap((raw) => {
    const r = REMINDER_ROW.safeParse(raw);
    return r.success && mayView(r.data, viewer) ? [r.data] : [];
  });
}

export type SaveReminder = { title: string; date: string; time: string | null; visibility: "only_me" | "my_team"; ref: string };
export type ReminderSaveResult = { ok: true; id: string; already: boolean } | { ok: false; reason: "invalid" | "limit" | "signin" | "unavailable" };

export async function saveReminderAs(owner: { subject: string; email: string; name: string; coverage: Coverage }, input: SaveReminder): Promise<ReminderSaveResult> {
  const supabase = getSupabaseAdmin();
  const existing = await supabase.from("calendar_reminders").select("id").eq("owner_subject", owner.subject).eq("ref", input.ref).maybeSingle();
  if (existing.error) return { ok: false, reason: "unavailable" };
  if (existing.data) return { ok: true, id: String(existing.data.id), already: true };
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const recent = await supabase.from("calendar_reminders").select("id", { count: "exact", head: true }).eq("owner_subject", owner.subject).gte("created_at", since);
  if (recent.error) return { ok: false, reason: "unavailable" };
  if ((recent.count ?? 0) >= HOURLY_LIMIT) return { ok: false, reason: "limit" };
  const { data, error } = await supabase
    .from("calendar_reminders")
    .insert({
      owner_subject: owner.subject,
      owner_email: owner.email,
      owner_name: owner.name,
      title: input.title.trim(),
      on_date: input.date,
      start_time: input.time,
      visibility: input.visibility,
      team_salon_numbers: input.visibility === "my_team" ? (owner.coverage === null ? null : [...owner.coverage]) : [],
      ref: input.ref,
    })
    .select("id")
    .single();
  if (error) {
    // A second Save of the same card racing the first: the unique (owner, ref) kept one.
    if (error.code === "23505") return { ok: true, id: "", already: true };
    return { ok: false, reason: error.code === "23514" ? "invalid" : "unavailable" };
  }
  return { ok: true, id: String(data.id), already: false };
}

/** Only the owner, only here; a soft delete. */
export async function deleteReminderAs(ownerSubject: string, id: string): Promise<{ ok: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false };
  const { data, error } = await getSupabaseAdmin()
    .from("calendar_reminders")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_subject", ownerSubject)
    .is("deleted_at", null)
    .select("id");
  return { ok: !error && Array.isArray(data) && data.length === 1 };
}
