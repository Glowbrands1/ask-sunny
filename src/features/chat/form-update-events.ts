/**
 * ============================================================================
 * "SUNNY CHANGED THIS FORM" — FROM THE CHAT TURN TO THE EDITOR SHOWING IT
 * ============================================================================
 *
 * A correction typed in chat ("change her new location to salon 24") is saved
 * on the server by the chat route. The inline editor showing that form is a
 * different component, possibly several messages up, and it must re-read the
 * canonical instance rather than keep showing the old value.
 *
 * AN ID, NOT VALUES. The event says which instance changed; the editor fetches
 * it, the same way it does after Sunny's prefill settles. Nothing about the
 * form's contents travels through the browser here.
 */
import type { AskResponse } from "@/lib/ai/types";
import type { ChatFormInstanceRef } from "@/types";

export const FORM_UPDATED_EVENT = "ask-sunny:form-updated";

export function announceFormUpdate(instanceId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(FORM_UPDATED_EVENT, { detail: { instanceId } }));
}

export function onFormUpdate(instanceId: string, callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ instanceId?: string }>).detail;
    if (detail?.instanceId === instanceId) callback();
  };
  window.addEventListener(FORM_UPDATED_EVENT, listener);
  return () => window.removeEventListener(FORM_UPDATED_EVENT, listener);
}

/**
 * ============================================================================
 * A FORM THE TURN PUT IN FRONT OF THE MANAGER, AS A CARD ON THAT ANSWER
 * ============================================================================
 *
 * "Edit the exit form for Ashley Rogers" — or a correction asked of a
 * finalized form — answers with `formOpened`: the form on file, or the new
 * draft opened from the finalized one. The answer carries a POINTER to it, the
 * same `ChatFormInstanceRef` a created form gets, so the card renders, survives
 * a refresh and becomes the conversation's open form for the next correction.
 *
 * A finalized form this turn revised is announced too, so its card further up
 * the thread re-reads and shows that it now has a newer version.
 */
export function openedFormReference(
  opened: AskResponse["formOpened"] | undefined,
): ChatFormInstanceRef | undefined {
  if (!opened) return undefined;
  if (opened.revisesInstanceId) announceFormUpdate(opened.revisesInstanceId);
  return {
    instanceId: opened.instanceId,
    // Not a proposal: the form already existed. Names where the pointer came from.
    proposalId: `opened:${opened.instanceId}`,
    templateName: opened.templateName,
  };
}
