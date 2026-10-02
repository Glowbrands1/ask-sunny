import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/server";

import { classifyStatusError } from "../status";
import { decideLinkReview, LinkReviewError, type LinkReviewInput, type LinkRowToInsert } from "./link-review";
import { loadAccessPlan } from "./load";

/**
 * Records one link review. Re-plans from the database first, so the decision
 * is checked against what is true NOW, not what the screen showed. The insert
 * is the only write; the table's own keys refuse a second link for the same
 * account (primary key) or the same Woven employee (unique index), so two
 * admins confirming at once cannot both succeed.
 *
 * Writes `employee_account_links` and nothing else: no app_users row, no auth
 * call, no role, scope, status or salon.
 */
export async function recordLinkReview(input: LinkReviewInput, reviewer: string): Promise<LinkRowToInsert> {
  const plan = await loadAccessPlan();
  const row = decideLinkReview(plan.rows, input, reviewer);
  const { error } = await getSupabaseAdmin().from("employee_account_links").insert(row);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new LinkReviewError("already_linked", "This account or this Woven employee was linked a moment ago. Reload to see it.", 409);
    }
    throw classifyStatusError(error);
  }
  return row;
}
