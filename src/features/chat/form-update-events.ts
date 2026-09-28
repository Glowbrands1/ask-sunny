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
