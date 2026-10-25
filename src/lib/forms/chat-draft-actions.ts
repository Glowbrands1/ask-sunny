import "server-only";

import type { AskResponse } from "@/lib/ai/types";
import { AuthError } from "@/lib/auth/types";
import { PERMISSION_LABEL } from "@/lib/permissions";
import type { ChatMessage } from "@/types";

import { reopenRequestedForm } from "./chat-reopen";
import { incidentQuestionAsked, readDraftDelete, readIncidentAnswer } from "./draft-actions";
import { authorizeInstance, InstanceNotVisibleError } from "./instance-scope";
import { deleteInstance, InstanceProtectedError } from "./instances";

/**
 * ============================================================================
 * WHAT A MANAGER SAYS ABOUT A DRAFT, DONE — NOT ANSWERED WITH A PHRASE TO TYPE
 * ============================================================================
 *
 * QA F8 (21–22 Oct 2026). Behind DRAFT_ACTIONS_ENABLED; tried by the chat
 * route before every open-form path, and null for any other turn.
 *
 * "DELETE THAT DRAFT" uses the same rules as the forms API's DELETE
 * (`api/forms/instances/[id]`): `authorizeInstance(…, "manage")` — the
 * `manage_form_records` permission and the form's salon scope — then
 * `deleteInstance`, which refuses anything but a draft. A finalized form is
 * never deleted. A manager whose role cannot delete is told so, truthfully,
 * with what the draft means while it stays and who can delete it.
 *
 * "SAME INCIDENT", answering "is this the same incident as the <form> for
 * <name>, or a new one?", opens that form the way "edit the <form> for
 * <name>" does (`reopenRequestedForm`): a draft as it is, a finalized one as
 * a new draft of it (Edit as new draft). "Different incident" asks the
 * proposal path for a new form for that person instead.
 */
export type DraftAction = { answer: AskResponse } | { question: string } | null;

export async function draftActionForTurn(input: {
  request: Request;
  question: string;
  history: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  today: string;
  activeInstanceId?: string;
  continuingTemplateKey?: string;
}): Promise<DraftAction> {
  const previous = lastAnswer(input.history);

  if (readDraftDelete(input.question, previous)) {
    if (input.activeInstanceId) {
      return { answer: await deleteDraftFromChat(input.request, input.activeInstanceId) };
    }
    if (input.continuingTemplateKey) {
      return {
        answer: reply(
          "Nothing has been created yet, so there's nothing to delete — the card isn't saved until you press **Create**. Just leave it, or tell me what to change.",
        ),
      };
    }
    return null;
  }

  const choice = readIncidentAnswer(input.question);
  if (!choice) return null;
  const asked = incidentQuestionAsked(previous);
  if (!asked) return null;

  if (choice === "different") {
    return { question: `create a ${asked.formPhrase} for ${asked.employeeName}` };
  }
  const opened = await reopenRequestedForm({
    request: input.request,
    question: `edit the ${asked.formPhrase} for ${asked.employeeName}`,
    history: input.history,
    today: input.today,
    activeInstanceId: input.activeInstanceId,
  });
  return opened ? { answer: opened } : null;
}

/** The draft on screen, deleted if this manager may delete it. Never a finalized form. */
export async function deleteDraftFromChat(request: Request, instanceId: string): Promise<AskResponse> {
  let instance;
  try {
    instance = (await authorizeInstance(request, instanceId, "view")).loaded.instance;
  } catch {
    return reply("I couldn't find that draft any more — it may already have been deleted. Nothing else was changed.");
  }
  const who = `**${instance.templateName}** for **${instance.employeeName}**`;

  if (instance.status !== "draft") {
    return reply(
      instance.status === "finalized"
        ? `The ${who} is finalized, so it can't be deleted — a finalized form is kept on file, never destroyed. I haven't deleted or changed anything. To change it, ask me to edit it, or press **Edit as new draft** on the form.`
        : `The ${who} has been replaced by a newer version and is kept on file, so it can't be deleted. I haven't deleted or changed anything.`,
    );
  }

  const revision = Boolean(instance.revisesInstanceId);
  try {
    await authorizeInstance(request, instance.id, "manage");
  } catch (error) {
    if (error instanceof InstanceNotVisibleError || (error instanceof AuthError && error.code === "forbidden")) {
      return reply(
        [
          `I can't delete the draft ${who} for you — deleting a form takes the **${PERMISSION_LABEL.manage_form_records}** permission, and your role doesn't have it. Nothing has been deleted or changed.`,
          revision
            ? "While it stays a draft nothing changes: the finalized form stays on file exactly as it is, and this draft only replaces it if you finalize it."
            : "It stays in Forms → Form Monitoring as a draft until it's deleted; it isn't finalized unless you finalize it.",
          "Someone whose role can delete forms — a District Manager, for example — can delete it from Forms → Form Monitoring.",
        ].join("\n\n"),
      );
    }
    return reply(`I couldn't delete the draft ${who}: ${(error as Error).message} Nothing was changed.`);
  }

  try {
    await deleteInstance(instance.id);
  } catch (error) {
    if (error instanceof InstanceProtectedError) {
      return reply(`I didn't delete the ${who}: ${error.message}`);
    }
    return reply(`I couldn't delete the draft ${who}: ${(error as Error).message} Nothing was changed.`);
  }
  return reply(
    revision
      ? `Deleted the new draft of the ${who}. The finalized form stays on file exactly as it was. The card above can no longer be saved.`
      : `Deleted the draft ${who}. Nothing was filed. The card above can no longer be saved — ask me to create the form again if you still need it.`,
  );
}

function lastAnswer(history: Pick<ChatMessage, "role" | "content" | "error">[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (message.role === "assistant" && !message.error) return message.content;
  }
  return null;
}

function reply(content: string): AskResponse {
  return { content, citations: [], coverage: "not_applicable", recommendedVideoIds: [] };
}
