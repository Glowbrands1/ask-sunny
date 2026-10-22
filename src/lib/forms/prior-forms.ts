import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import type { FormsActor } from "./access";
import { chatFormsActor, type FormRecordsActor } from "./chat-form-records";
import { instanceListFilterFor, visibleInstances } from "./instance-scope";
import { listInstances } from "./instances";
import {
  classifyPriorForms,
  priorFormsFromRows,
  sameName,
  type PriorFormOnFile,
  type PriorFormsReading,
} from "./prior-forms-lines";

export type { PriorFormOnFile, PriorFormsReading } from "./prior-forms-lines";

/**
 * How many forms one read may return. A full page means older forms may be
 * missing, so the reading is "incomplete" and nothing is attached (QA F-11).
 */
const READ_LIMIT = 200;

const NOTHING: PriorFormsReading = { attach: [], possible: [], identity: "none" };

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
 * the employee's name matches word for word; see `prior-forms-lines.ts`.
 *
 * A NAME IS NOT AN IDENTITY (QA F-11, 22 Oct 2026). What comes back is split
 * by `classifyPriorForms`: `attach` only when the name can mean one person at
 * the form's own salon; everything else is `possible`, for the manager to
 * confirm, and is never written onto a form. Never throws: a failed read lists
 * nothing, and the manager's own account stands. Nothing on file is changed.
 */
export async function readPriorFormsOnFile(input: {
  actor: FormsActor;
  employeeName: string;
  /** The form being drafted, which is never its own history. */
  excludeInstanceId?: string;
  /** The salon on the form being drafted; null when it has none. */
  locationId: string | null;
  /** The form being drafted's own date: anything dated after it is not "previous". */
  before?: string;
}): Promise<PriorFormsReading> {
  const found = await readOnFile(input);
  return found ? classifyPriorForms({ ...found, employeeName: input.employeeName, locationId: input.locationId }) : NOTHING;
}

interface OnFile {
  forms: PriorFormOnFile[];
  sameNameLocations: (string | null)[];
  complete: boolean;
}

/** One bounded read under the actor's visibility; null when there is nothing to read or it failed. */
async function readOnFile(input: {
  actor: FormsActor;
  employeeName: string;
  excludeInstanceId?: string;
  before?: string;
}): Promise<OnFile | null> {
  const words = input.employeeName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2);
  if (words.length === 0) return null;

  try {
    const read = await listInstances("all", READ_LIMIT, {
      ...instanceListFilterFor(input.actor),
      employeeNameWords: words,
    });
    const rows = visibleInstances(input.actor, read);

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

    const forms = priorFormsFromRows({
      rows,
      employeeName: input.employeeName,
      excludeInstanceId: input.excludeInstanceId,
      before: input.before,
      warningLevels,
    });
    return {
      forms,
      sameNameLocations: rows
        .filter((row) => row.id !== input.excludeInstanceId && sameName(row.employeeName, input.employeeName))
        .map((row) => row.locationId ?? null),
      complete: read.length < READ_LIMIT,
    };
  } catch {
    return null;
  }
}

/**
 * The same reading for a chat turn, under the caller's Form Monitoring
 * visibility. Nothing when they may not read it or the read fails — the
 * manager's own account then stands alone.
 *
 * `locationId` is the salon on the proposal. Without one, the forms are only
 * read back when every same-name form the manager can see is at ONE salon (so
 * the name can mean one person); the draft still attaches them only when the
 * form's own salon is that salon.
 */
export async function priorFormsReadingForChat(
  actor: FormRecordsActor,
  employeeName: string,
  locationId?: string | null,
): Promise<PriorFormsReading> {
  try {
    const formsActor = await chatFormsActor(actor);
    if (!formsActor) return NOTHING;
    const found = await readOnFile({ actor: formsActor, employeeName });
    if (!found) return NOTHING;
    const places = new Set([...found.sameNameLocations, ...found.forms.map((form) => form.locationId)]);
    const only = places.size === 1 ? [...places][0]! : null;
    return classifyPriorForms({ ...found, employeeName, locationId: locationId !== undefined ? locationId : only });
  } catch {
    return NOTHING;
  }
}

/**
 * The lines the chat may promise to put on the form: only those whose identity
 * is established. Possible matches are not among them (QA F-11).
 */
export async function priorFormsForChat(
  actor: FormRecordsActor,
  employeeName: string,
): Promise<PriorFormOnFile[]> {
  return [...(await priorFormsReadingForChat(actor, employeeName)).attach];
}
