import type { AskResponse } from "@/lib/ai/types";
import { isQuestionNotForm } from "@/lib/ai/question-not-form";
import { formEditSingleWriterEnabled, openDraftKeepsTurnsEnabled } from "@/lib/config/chat-quality-flags";
import { extractEmployeeNames, samePerson } from "@/lib/forms/proposal";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * WITH A DRAFT OPEN, A TURN ABOUT IT GOES TO IT — NEVER TO A NEW CARD
 * ============================================================================
 *
 * OPEN_DRAFT_KEEPS_TURNS_ENABLED. The 2 Nov 2026 scan (QA, 3 Nov): "Details
 * managers had typed were lost … her next message started a new draft without
 * what she'd typed, and that generic version is the one that got finalized."
 * A Salon Director created a verbal Corrective Action draft, typed on it, and
 * 42 minutes later said "underperformance for the month of october". No path
 * read that as an edit of the open draft, so the intake offered a new card for
 * the same person; its Create made a second draft, without her words, and
 * that one was finalized.
 *
 * Last of the open-form paths (after the correction, policy, redraft, copy
 * and revision readers): with a DRAFT open, a turn that names no form, no
 * other person, and is not a question, is content for that draft — revised in
 * the manager's words. If the revision writes nothing, the reply says so;
 * either way no new card is offered for a form already open.
 */
export async function openDraftTurn(input: {
  request: Request;
  instanceId: string;
  question: string;
  history: readonly ChatMessage[];
  today: string;
}): Promise<AskResponse | null> {
  if (!openDraftKeepsTurnsEnabled()) return null;
  const question = input.question.trim();
  if (!question || /\?\s*$/.test(question) || isQuestionNotForm(question, input.history)) return null;
  if (detectTemplateIntent(question).kind !== "none") return null;
  const open = await (await import("@/lib/forms/open-form-summary")).describeOpenForm(input.request, input.instanceId);
  if (!open || open.status !== "draft") return null;
  if (extractEmployeeNames(question).some((name) => !samePerson(name, open.employeeName))) return null;
  /*
   * FORM_EDIT_SINGLE_WRITER_ENABLED: the draft before the turn, and the
   * revision's claim checked against what was saved (`lib/forms/form-write.ts`).
   * The write itself is the revision's (`chat-revision.ts`, protected) until
   * 2b routes it through `writeRevisionEdits`.
   */
  const before = formEditSingleWriterEnabled()
    ? await (await import("@/lib/forms/form-write")).editSnapshot(input.instanceId, "open_draft")
    : null;
  const revised = await (await import("@/lib/forms/chat-revision")).reviseActiveForm({
    request: input.request,
    instanceId: input.instanceId,
    question: `Add this to the ${open.templateName}: ${question}`,
    history: [...input.history],
    today: input.today,
  });
  if (revised && formEditSingleWriterEnabled() && before) {
    return (await import("@/lib/forms/form-write")).realizedClaim(revised, input.instanceId, before);
  }
  if (revised) return revised;
  return {
    content: [
      `**Nothing on the form has changed yet.** I couldn't place that on the open ${open.templateName} for ${open.employeeName}.`,
      "Tell me which part it belongs in — for example \"add to the observation: …\" — or type it on the card and press **Save changes**. The draft you have open is the one I'll change; I won't start another.",
    ].join("\n\n"),
    citations: [],
    coverage: "not_applicable",
    recommendedVideoIds: [],
  };
}
