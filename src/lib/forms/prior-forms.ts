import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { FormsActor } from "./access";
import { chatFormsActor, type FormRecordsActor } from "./chat-form-records";
import { instanceListFilterFor, visibleInstances } from "./instance-scope";
import { listInstances } from "./instances";
import { priorFormsFromRows, type PriorFormOnFile } from "./prior-forms-lines";

export type { PriorFormOnFile } from "./prior-forms-lines";

/**
 * ============================================================================
 * THE COACHING AND CORRECTIVE ACTION FORMS ALREADY ON FILE FOR THIS EMPLOYEE
 * ============================================================================
 *
 * District Manager feedback, 21 Oct 2026: a Corrective Action's history line
 * was filled only from what the manager typed in chat, although the employee's
 * earlier Coaching Form and Verbal CA were sitting in Form Monitoring, filed
 * through this same app. So the record is read too, and each finalized step
 * becomes a line on the list — read back in chat before the form is created
 * and written onto it when it is drafted.
 *
 * THE SAME VISIBILITY AS FORM MONITORING, AND NOTHING WIDER: the read goes
 * through `instanceListFilterFor` and `visibleInstances`, so a manager sees on
 * the line exactly the forms they could open on the screen.
 *
 * A RECORD, NOT A GUESS. Only FINALIZED forms count — a draft was never
 * signed, and a revised one has been replaced by its revision — and only where
 * the employee's name matches word for word; see `prior-forms-lines.ts`. Never
 * throws: a failed read lists nothing, and the manager's own account stands.
 */
export async function loadPriorFormsOnFile(input: {
  actor: FormsActor;
  employeeName: string;
  /** The form being drafted, which is never its own history. */
  excludeInstanceId?: string;
}): Promise<PriorFormOnFile[]> {
  const words = input.employeeName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2);
  if (words.length === 0) return [];

  try {
    const rows = visibleInstances(
      input.actor,
      await listInstances("all", 50, {
        ...instanceListFilterFor(input.actor),
        employeeNameWords: words,
      }),
    );

    const correctiveIds = rows
      .filter((row) => row.templateKey === "dpoa" && row.status === "finalized")
      .map((row) => row.id);
    const warningLevels = new Map<string, string[]>();
    if (correctiveIds.length > 0) {
      const { data, error } = await getSupabaseAdmin()
        .from("form_instance_values")
        .select("instance_id, checked")
        .eq("field_key", "warning_type")
        .in("instance_id", correctiveIds);
      if (error) throw new Error(error.message);
      for (const row of data ?? []) {
        warningLevels.set(
          String(row.instance_id),
          Array.isArray(row.checked) ? (row.checked as string[]) : [],
        );
      }
    }

    return priorFormsFromRows({
      rows,
      employeeName: input.employeeName,
      excludeInstanceId: input.excludeInstanceId,
      warningLevels,
    });
  } catch {
    return [];
  }
}

/**
 * The same list for a chat turn, under the caller's Form Monitoring
 * visibility. Empty when they may not read it or the read fails — the
 * manager's own account then stands alone.
 */
export async function priorFormsForChat(
  actor: FormRecordsActor,
  employeeName: string,
): Promise<PriorFormOnFile[]> {
  try {
    const formsActor = await chatFormsActor(actor);
    return formsActor ? await loadPriorFormsOnFile({ actor: formsActor, employeeName }) : [];
  } catch {
    return [];
  }
}
