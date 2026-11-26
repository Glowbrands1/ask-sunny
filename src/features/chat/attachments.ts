import { toFilePart } from "@/lib/attachments/file-parts";
import type { ChatFileAttachment } from "@/lib/ai/types";
import type { ChatAttachmentName, ChatMessage } from "@/types";

/**
 * ============================================================================
 * FILES IN THE MAIN CHAT, ON THE BROWSER'S SIDE (Pau, 26 Nov 2026)
 * ============================================================================
 *
 * The DM L10 panel's mechanism (`features/l10/assistant/attachments.ts` toFilePart): each picked file becomes a data
 * URL, an image re-encoded on the way. The bytes go with the question that carried them and are never stored: the
 * message keeps the files' names (`ChatMessage.attachments`), so its bubble shows them, and a later turn or the chat
 * reopened from history tells the model, as the panel does, that the file was attached and is no longer available.
 */

export async function toChatAttachments(files: readonly File[]): Promise<ChatFileAttachment[]> {
  const parts = await Promise.all(files.map(toFilePart));
  return parts.map((part, index) => ({ filename: part.filename ?? files[index]?.name ?? "attachment", mediaType: part.mediaType, url: part.url }));
}

export const namesOf = (files: readonly ChatFileAttachment[]): ChatAttachmentName[] => files.map(({ filename, mediaType }) => ({ filename, mediaType }));

/** What a question that is only files says, so the thread and the model both have the manager's turn in words. */
export function fileOnlyQuestion(count: number): string {
  return count === 1 ? "Please read the attached file." : "Please read the attached files.";
}

/** The panel's note for a file whose bytes were not kept (`AssistantPanel.tsx` withoutStaleFiles), worded for chat. */
export function attachedEarlierNote(names: readonly ChatAttachmentName[]): string {
  const listed = names.map((file) => file.filename).join(", ");
  return `[Attached earlier: ${listed}. ${names.length === 1 ? "Its contents are" : "Their contents are"} no longer available in this saved chat; ask the manager to attach ${names.length === 1 ? "it" : "them"} again if you need ${names.length === 1 ? "it" : "them"}.]`;
}

/** The history as sent to the model: an earlier question that carried files says so, by name. */
export function historyWithAttachmentNotes(history: readonly ChatMessage[]): ChatMessage[] {
  return history.map((message) =>
    message.role === "user" && message.attachments && message.attachments.length > 0
      ? { ...message, content: `${message.content}\n\n${attachedEarlierNote(message.attachments)}` }
      : message,
  );
}
