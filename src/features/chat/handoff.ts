import type { FormHandoff } from "@/types";

/**
 * Chat -> Create a Form handoff.
 *
 * The draft Sunny assembles in a conversation is parked in sessionStorage and
 * picked up by the Create a Form workspace, which opens pre-filled at the
 * review step with every field editable.
 *
 * Kept in one small module so the mechanism is obvious and easy to replace with
 * a server-side draft record once forms are persisted properly.
 */
const HANDOFF_KEY = "ask-sunny:form-handoff";

export function storeFormHandoff(handoff: FormHandoff): void {
  try {
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    /* Storage unavailable — the manager can still start the form manually. */
  }
}

export function takeFormHandoff(): FormHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(HANDOFF_KEY);
    return JSON.parse(raw) as FormHandoff;
  } catch {
    return null;
  }
}
