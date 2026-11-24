import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

/**
 * WHICH BELL ITEMS STAY UNTIL THEIR MATTER IS SETTLED (owner, 24 Nov 2026, with Curt, Madeline and Marissa all HR
 * approvers: "when one of us open this notification, it will not clear it for the other people. also do not remove the
 * unread if not solved yet keep it persistent unless [HR] or anyone sends it back to manager").
 *
 * Every approver already has their own row, so one opening it never touches another's. On top of that, HR's "A form is
 * waiting for your approval" is PINNED while the form it links to is still waiting for HR: it shows as unread, and
 * opening it, Mark all as read, the × and Clear all leave it alone. Once HR approves, rejects or sends it back (or the
 * form is deleted or archived), `clearRequestBells` marks every approver's copy read and the pin lifts, because the
 * form is no longer waiting. A form that no longer exists, or a link that is not a form, pins nothing.
 *
 * The kind and link are spelled here, not imported from forms, so the bell's store does not depend on the forms code;
 * `pinned.test.ts` checks they match `hr-approval-bells.ts`.
 */
export const PINNED_REQUEST_KIND = "form_hr_approval_request";
const FORM_HREF = /^\/forms\/hr-approval\/([0-9a-f-]{36})$/i;

export interface PinCandidate {
  id: string;
  kind: string;
  href: string | null;
}

/** The ids, among these rows, that are pinned now. Fails open: if the forms cannot be read, nothing is pinned. */
export async function pinnedIds(rows: readonly PinCandidate[]): Promise<Set<string>> {
  const formOf = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== PINNED_REQUEST_KIND || !row.href) continue;
    const match = FORM_HREF.exec(row.href);
    if (match) formOf.set(row.id, match[1].toLowerCase());
  }
  if (formOf.size === 0) return new Set();
  const { data, error } = await getSupabaseAdmin()
    .from("form_instances")
    .select("id")
    .in("id", [...new Set(formOf.values())])
    .eq("hr_approval_state", "pending");
  if (error) {
    console.error("[notifications] could not read which forms still wait for HR:", error.message);
    return new Set();
  }
  const waiting = new Set(((data ?? []) as { id: string }[]).map((form) => String(form.id).toLowerCase()));
  return new Set([...formOf].filter(([, form]) => waiting.has(form)).map(([id]) => id));
}
