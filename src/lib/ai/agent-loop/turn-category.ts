import { classifyChatTurn, type ActivityCategory } from "@/lib/analytics/taxonomy";

/**
 * ============================================================================
 * THE LOOP'S TURN IS LOGGED WITH A REAL CATEGORY (Pau's audit, 15 Nov 2026; PR 4)
 * ============================================================================
 *
 * A loop turn was closed as "unclassified" (`app/api/chat/route.ts`). Its category now comes from the tools the turn
 * actually called, never from the message text (no question text reaches the classifier):
 *
 *   card        propose_form / coach_team  → the proposed form's own category (corrective_action, coaching_form, …),
 *                                            else form_request
 *   edit        edit_form                  → form_request
 *   open_form   open_form                  → form_request
 *   past_forms  find_past_forms / read_form→ form_request
 *   policy      read_policy / search_knowledge → the cited knowledge category, else policy_question
 *   chat        anything else (or no tool) → general_guidance
 *
 * The first that applies, in that order. The values are the analytics taxonomy's existing categories (the column is that
 * enum), so the dashboard needs no new bar.
 */
export function loopTurnCategory(
  tools: readonly string[],
  answer: { readonly formProposal?: { readonly templateKey?: string | null } | null; readonly citations?: readonly { readonly category: Parameters<typeof classifyChatTurn>[0]["citedCategories"][number] }[] },
): ActivityCategory {
  const called = new Set(tools);
  const any = (...names: string[]) => names.some((name) => called.has(name));
  if (any("propose_form", "coach_team")) {
    const category = classifyChatTurn({ proposedTemplateKey: answer.formProposal?.templateKey ?? "unnamed", offeredFormChoices: false, hadReportContext: false, citedCategories: [], question: null });
    return category;
  }
  if (any("edit_form", "open_form", "find_past_forms", "read_form")) return "form_request";
  if (any("read_policy", "search_knowledge")) {
    const cited = classifyChatTurn({ proposedTemplateKey: null, offeredFormChoices: false, hadReportContext: false, citedCategories: (answer.citations ?? []).map((citation) => citation.category), question: null });
    return cited === "unclassified" ? "policy_question" : cited;
  }
  return "general_guidance";
}
