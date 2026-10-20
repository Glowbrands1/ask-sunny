import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import type { ChatMessage } from "@/types";

import { authorizeForms } from "./access";
import { correctActiveForm } from "./chat-correction";
import { reviseActiveForm } from "./chat-revision";
import { formOpenedFor, openEditableDraft, openingLine } from "./editable-draft";
import { authorizeInstance, instanceListFilterFor, visibleInstances } from "./instance-scope";
import { listInstances, type InstanceRow } from "./instances";
import { extractEmployeeNames, samePerson } from "./proposal";
import { readReopenRequest } from "./reopen-request";

/**
 * ============================================================================
 * "CHANGE EXIT FOR ASHLEY ROGERS" — A FORM ON FILE, BROUGHT BACK INTO CHAT
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
 * NOTHING NEW IS EVER CREATED HERE. "Create an exit form for Ashley Rogers"
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
  /*
   * A PROPOSAL NOT YET CREATED IS WHAT "CHANGE THE EXIT FORM" MEANS while it
   * is on screen — the proposal flow takes that turn, and no form on file is
   * revised behind it.
   */
  if (
    input.continuingTemplateKey &&
    (reading.templateKey === null || reading.templateKey === input.continuingTemplateKey)
  ) {
    return null;
  }

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
  if (!target && reading.templateKey) {
    let visible: InstanceRow[];
    try {
      const actor = await authorizeForms(input.request, "view_form_monitoring");
      visible = visibleInstances(actor, await listInstances("active", 200, instanceListFilterFor(actor)));
    } catch {
      return null;
    }
    const candidates = visible
      .filter((row) => row.templateKey === reading.templateKey && row.status !== "revised")
      .filter((row) => named(row.employeeName))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const found = candidates[0];
    if (found) {
      target = toTarget(found);
    } else if (names.length > 0) {
      const templateName =
        visible.find((row) => row.templateKey === reading.templateKey)?.templateName ?? "form";
      return reply(
        `I couldn't find a ${templateName === "form" ? "form" : `**${templateName}**`} for **${names[0]}** on file that you can open. Forms already created are listed in Forms → Form Monitoring. If you need a new one, ask me to create it — for example "create a ${templateName === "form" ? "form" : templateName} for ${names[0]}".`,
      );
    }
  }
  if (!target) return null;

  let draft: Awaited<ReturnType<typeof openEditableDraft>>;
  try {
    draft = await openEditableDraft(input.request, target.id, { revise: reading.mode === "edit" });
  } catch (error) {
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
  if (reading.mode === "edit" && draft.status === "draft") {
    applied =
      (await correctActiveForm({
        request: input.request,
        instanceId: draft.instanceId,
        question: input.question,
        today: input.today,
      })) ??
      // A redraft asks the model; only when the sentence asked for a change.
      (reading.asksChange
        ? await reviseActiveForm({
            request: input.request,
            instanceId: draft.instanceId,
            question: input.question,
            history: input.history,
            today: input.today,
          })
        : null);
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

function toTarget(row: Pick<InstanceRow, "id" | "templateName" | "employeeName">) {
  return { id: row.id, templateName: row.templateName, employeeName: row.employeeName };
}

/** "ashley rogers exit form": the employee's whole name, as words, in any case. */
function mentionsFullName(question: string, employee: string): boolean {
  const words = employee.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(question);
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
