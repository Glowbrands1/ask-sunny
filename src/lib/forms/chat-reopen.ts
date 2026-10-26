import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import type { ChatMessage } from "@/types";

import { authorizeForms } from "./access";
import { correctActiveForm } from "./chat-correction";
import { reviseActiveForm } from "./chat-revision";
import { formOpenedFor, openEditableDraft, openingLine, reasonRequiredReply } from "./editable-draft";
import { RevisionReasonRequiredError } from "./revision-chain";
import { authorizeInstance, instanceListFilterFor, visibleInstances } from "./instance-scope";
import { applyAssistantDraft, listInstances, loadInstance, type InstanceRow } from "./instances";
import { extractEmployeeNames, samePerson } from "./proposal";
import { draftMergeEnabled, formEditDateRulesEnabled } from "@/lib/config/chat-quality-flags";

import { fieldsToRestore, showDraftWithEdits } from "./draft-merge";
import { readReopenRequest } from "./reopen-request";

/**
 * ============================================================================
 * "CHANGE EXIT FOR LACEY MORROW" — A FORM ON FILE, BROUGHT BACK INTO CHAT
 * ============================================================================
 *
 * Production feedback: a manager asked to change, then to duplicate, an exit
 * form that already existed, and Sunny could only send them to Form
 * Monitoring — which has no editor. This finds the form and puts it in the
 * thread, editable:
 *
 *   A DRAFT is opened as it is.
 *   A FINALIZED form gets a new draft (a revision) with everything carried
 *   over; the finalized one stays on file, unchanged, marked revised.
 *   A REVISED form is followed to its newer version.
 *
 * Then whatever change the same sentence asked for ("… and change date notice
 * given to 9-27-26") is made on that draft, by the same readers that correct
 * a form already in the conversation.
 *
 * WHICH FORM. The form in this conversation when it is the one meant;
 * otherwise the newest active form of the named template, for the named
 * employee, among the forms this actor may see — `instanceListFilterFor` and
 * `visibleInstances`, exactly as Form Monitoring lists them — and then
 * re-authorized for "edit" before anything is opened.
 *
 * NOTHING NEW IS EVER CREATED HERE. "Create an exit form for Lacey Morrow"
 * is not read as a reopen request; it still proposes a new form.
 */
export async function reopenRequestedForm(input: {
  request: Request;
  question: string;
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  today: string;
  activeInstanceId?: string;
  /** The template of a proposal still waiting to be created, if any. */
  continuingTemplateKey?: string;
}): Promise<AskResponse | null> {
  const reading = readReopenRequest(input.question);
  if (!reading) return null;
  const merging = draftMergeEnabled() && reading.mode === "show" && showDraftWithEdits(input.question);
  /*
   * A PROPOSAL NOT YET CREATED IS WHAT "CHANGE THE EXIT FORM" MEANS while it
   * is on screen — the proposal flow takes that turn, and no form on file is
   * revised behind it.
   */
  /*
   * FORM_EDIT_DATE_RULES_ENABLED: "can you edit the form I already finalized
   * for Test Employee? change the date to 10-20-26" (QA replay S21,
   * conv_mvnt79t822zud9j) names the form on file, not the card on screen. The
   * card's form is the one looked up, and a finalized one opens as a revision.
   */
  const finalizedMeant = formEditDateRulesEnabled() && REFERS_TO_FINALIZED.test(input.question);
  if (
    input.continuingTemplateKey &&
    !finalizedMeant &&
    (reading.templateKey === null || reading.templateKey === input.continuingTemplateKey)
  ) {
    return null;
  }
  const templateKey = reading.templateKey ?? (finalizedMeant ? (input.continuingTemplateKey ?? null) : null);

  const names = extractEmployeeNames(input.question).map((name) => name.replace(/['’]s?$/, ""));
  const named = (employee: string) =>
    names.some((name) => samePerson(name, employee)) || mentionsFullName(input.question, employee);

  let target: { id: string; templateName: string; employeeName: string } | null = null;

  /* The form already in this conversation, when it is the one meant. */
  if (input.activeInstanceId) {
    try {
      const { loaded } = await authorizeInstance(input.request, input.activeInstanceId, "view");
      const active = loaded.instance;
      const sameTemplate = reading.templateKey === null || reading.templateKey === active.templateKey;
      const samePersonMeant = names.length === 0 || named(active.employeeName);
      if (sameTemplate && samePersonMeant) target = toTarget(active);
    } catch {
      // Gone or no longer permitted: fall through to the lookup by name.
    }
  }

  /* Otherwise the newest one on file for the named employee. */
  if (!target && (templateKey || finalizedMeant)) {
    let visible: InstanceRow[];
    try {
      const actor = await authorizeForms(input.request, "view_form_monitoring");
      visible = visibleInstances(actor, await listInstances("active", 200, instanceListFilterFor(actor)));
    } catch {
      return null;
    }
    const candidates = visible
      .filter((row) => (templateKey === null || row.templateKey === templateKey) && row.status !== "revised")
      .filter((row) => !finalizedMeant || row.status === "finalized")
      .filter((row) => named(row.employeeName))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const found = candidates[0];
    if (found) {
      target = toTarget(found);
    } else if (names.length > 0) {
      const templateName =
        (templateKey ? visible.find((row) => row.templateKey === templateKey)?.templateName : null) ?? "form";
      return reply(
        `I couldn't find a ${templateName === "form" ? "form" : `**${templateName}**`} for **${names[0]}** on file that you can open. Forms already created are listed in Forms → Form Monitoring. If you need a new one, ask me to create it — for example "create a ${templateName === "form" ? "form" : templateName} for ${names[0]}".`,
      );
    }
  }
  if (!target && finalizedMeant) {
    return reply(
      "I couldn't find a finalized form on file for that employee that you can open. Name the form and the employee — for example \"edit the corrective action form for <name>\" — and I'll open a new draft of the finalized one to change; the finalized form stays on file. Forms already created are listed in Forms → Form Monitoring.",
    );
  }
  if (!target) return null;

  let draft: Awaited<ReturnType<typeof openEditableDraft>>;
  try {
    draft = await openEditableDraft(input.request, target.id, { revise: reading.mode === "edit" });
  } catch (error) {
    if (error instanceof RevisionReasonRequiredError) return reasonRequiredReply(input.request, target.id);
    return reply(
      `I found the **${target.templateName}** for **${target.employeeName}**, but couldn't open it to edit: ${(error as Error).message}`,
    );
  }

  /*
   * THE CHANGE THE SAME SENTENCE ASKED FOR, on the draft — the correction
   * readers first, then a coaching redraft. Either returns null when the
   * sentence asked for no particular change, and the draft is simply open.
   */
  let applied: AskResponse | null = null;
  let heldRows: { fieldKey: string; value: string | null; checked: readonly string[] }[] | null = null;
  let editorId: string | null = null;
  if (merging && draft.status === "draft") {
    try {
      const opened = await authorizeInstance(input.request, draft.instanceId, "edit");
      heldRows = opened.loaded.values.map((row) => ({
        fieldKey: row.fieldKey,
        value: row.value,
        checked: row.checked,
      }));
      editorId = opened.actor.id;
    } catch {
      heldRows = null;
    }
  }
  if ((reading.mode === "edit" || merging) && draft.status === "draft") {
    applied =
      (await correctActiveForm({
        request: input.request,
        instanceId: draft.instanceId,
        question: input.question,
        today: input.today,
      })) ??
      // A redraft asks the model; only when the sentence asked for a change.
      (reading.asksChange || merging
        ? await reviseActiveForm({
            request: input.request,
            instanceId: draft.instanceId,
            question: input.question,
            history: input.history,
            today: input.today,
          })
        : null);
  }
  if (heldRows && editorId) {
    try {
      const after = await loadInstance(draft.instanceId);
      const restore = after
        ? fieldsToRestore({
            question: input.question,
            before: heldRows,
            after: after.values.map((row) => ({
              fieldKey: row.fieldKey,
              value: row.value,
              checked: row.checked,
            })),
          })
        : { values: {}, checked: {} };
      if (Object.keys(restore.values).length > 0 || Object.keys(restore.checked).length > 0) {
        await applyAssistantDraft(draft.instanceId, restore, editorId);
      }
    } catch {
      // The draft is already open. A failed restore leaves the edit as written.
    }
  }

  const closing =
    draft.status === "draft"
      ? "Edit anything that needs changing below, save, and finalize it when it's ready."
      : null;
  return {
    ...reply(
      [openingLine(draft), applied?.content ?? closing].filter((line): line is string => Boolean(line)).join("\n\n"),
    ),
    ...(applied?.formUpdate ? { formUpdate: applied.formUpdate } : {}),
    formOpened: formOpenedFor(draft),
  };
}

/** "the form I already finalized", "the one we submitted": a form already on file. */
const REFERS_TO_FINALIZED = /\bfinali[sz]ed\b|\b(?:i|we)\s+(?:already\s+)?(?:submitted|filed|signed)\b/i;

function toTarget(row: Pick<InstanceRow, "id" | "templateName" | "employeeName">) {
  return { id: row.id, templateName: row.templateName, employeeName: row.employeeName };
}

/** "lacey morrow exit form": the employee's whole name, as words, in any case. */
function mentionsFullName(question: string, employee: string): boolean {
  const words = employee.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(question);
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
