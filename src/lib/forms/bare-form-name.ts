import { namesAForm } from "@/lib/forms/template-intent";

/**
 * ============================================================================
 * A TURN THAT IS ONLY A FORM'S NAME ASKS WHAT THE MANAGER NEEDS
 * ============================================================================
 *
 * BARE_FORM_NAME_ASKS_WHAT_ENABLED (ported from Ask Bubbles: QA's 17n live test there, 12 Nov 2026, 4c): a pasted bare "Corrective Action
 * Form" was answered "Who is this form for? Tell me the employee's full name." over an empty card. PASTED_FORM_NAME_
 * NOT_REQUEST reads only a lead ending in ":" before pasted lines, so it never saw this turn. On: when the manager's
 * whole turn is a form's printed title, pasted (every word capitalised) and nothing else, and the card that came back
 * names nobody, the reply asks what they need on that form, and no empty card is shown. A turn that names the person,
 * says anything more, or asks for the form in words ("coaching form", "exit form"), is as before.
 */
/**
 * A form's printed title, pasted: every word capitalised ("Corrective Action Form"). A request typed as words — "coaching
 * form", "exit form" — still starts that form's card and asks who it is for, as before (replay oct30-am-role,
 * nov11-exit-prose-bare-name).
 */
const PASTED_TITLE = /^\p{Lu}[\p{L}'’/-]*(?:\s+\p{Lu}[\p{L}'’/-]*)*$/u;

export function withBareFormNameQuestion<T extends { content: string; formProposal?: { employeeName?: string | null; templateName?: string } | null }>(
  answer: T,
  question: string,
): T {
  const card = answer.formProposal;
  const typed = question.trim().replace(/[.!?:]+$/, "");
  if (!card || card.employeeName || !PASTED_TITLE.test(typed) || !namesAForm(typed)) return answer;
  const form = card.templateName ?? "form";
  const { formProposal: _dropped, ...rest } = answer;
  void _dropped;
  return {
    ...rest,
    content: `What do you need on the **${form}**? Tell me who it's for and what happened, and I'll put the card together.`,
  } as T;
}
