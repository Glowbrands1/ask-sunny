import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { AssignmentMark, AssignmentPerson, AssignmentTracker, Half, MarkState } from "./assignments";

/**
 * AI TRAINING -> ASSIGNMENTS, SERVER-SIDE. `ai_assignment_people` and `ai_assignment_marks` have RLS forced with no
 * policies (`20261123001000_ai_assignment_tracker.sql`): every read and write is here, under the secret key, AFTER
 * the caller was checked against the tracker's named list (`canSeeAssignmentTracker`) by the page, the Server Function
 * or the AI's reader that calls in.
 */

interface PersonDb {
  id: string;
  name: string;
  group_name: string | null;
  start_date: string | null;
  sort_order: number | null;
}
interface MarkDb {
  person_id: string;
  month: string;
  half: number;
  state: MarkState;
}

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`AI assignments: could not ${what}${error ? ` (${error.message})` : ""}.`);
}

export async function loadAssignmentTracker(): Promise<AssignmentTracker> {
  const db = getSupabaseAdmin();
  const [people, marks] = await Promise.all([
    db.from("ai_assignment_people").select("id, name, group_name, start_date, sort_order"),
    db.from("ai_assignment_marks").select("person_id, month, half, state"),
  ]);
  if (people.error) fail("read the people", people.error);
  if (marks.error) fail("read the marks", marks.error);
  return {
    people: ((people.data ?? []) as PersonDb[]).map(
      (r): AssignmentPerson => ({ id: r.id, name: r.name, group: r.group_name, startDate: r.start_date, sortOrder: r.sort_order }),
    ),
    marks: ((marks.data ?? []) as MarkDb[]).map(
      (r): AssignmentMark => ({ personId: r.person_id, month: r.month, half: (r.half === 1 ? 1 : 0) as Half, state: r.state }),
    ),
  };
}

export async function addAssignmentPeople(input: {
  names: readonly string[];
  group: string | null;
  startDate: string | null;
  by: string;
}): Promise<void> {
  if (!input.names.length) return;
  const { error } = await getSupabaseAdmin()
    .from("ai_assignment_people")
    .insert(input.names.map((name) => ({ name, group_name: input.group, start_date: input.startDate, created_by: input.by })));
  if (error) fail("add the people", error);
}

/** Removes the person; their marks go with them (on delete cascade). */
export async function removeAssignmentPerson(id: string): Promise<void> {
  const db = getSupabaseAdmin();
  const marks = await db.from("ai_assignment_marks").delete().eq("person_id", id);
  if (marks.error) fail("clear the person's marks", marks.error);
  const { error } = await db.from("ai_assignment_people").delete().eq("id", id);
  if (error) fail("remove the person", error);
}

/** Sets a half's mark; `null` clears it (the half reads Due or Missing again). */
export async function setAssignmentMark(input: { personId: string; month: string; half: Half; state: MarkState | null; by: string }): Promise<void> {
  const db = getSupabaseAdmin();
  if (input.state === null) {
    const { error } = await db
      .from("ai_assignment_marks")
      .delete()
      .eq("person_id", input.personId)
      .eq("month", input.month)
      .eq("half", input.half);
    if (error) fail("clear the mark", error);
    return;
  }
  const { error } = await db.from("ai_assignment_marks").upsert(
    { person_id: input.personId, month: input.month, half: input.half, state: input.state, marked_by: input.by, marked_at: new Date().toISOString() },
    { onConflict: "person_id,month,half" },
  );
  if (error) fail("save the mark", error);
}
