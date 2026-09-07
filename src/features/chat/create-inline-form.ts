import {
  draftNotesAreUsable,
  draftNotesFromConversation,
} from "@/lib/forms/draft-notes";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PROPOSAL -> REAL FORM, IN TWO REQUESTS AND ONE IRREVERSIBLE ORDER
 * ============================================================================
 *
 *   1. POST /api/forms/instances            create the canonical instance
 *   2. hand the caller its id IMMEDIATELY   before anything else can fail
 *   3. POST /api/forms/instances/[id]/draft ask Sunny to prefill it
 *
 * STEP 2 IS NOT A DETAIL. Once step 1 returns, a real HR record exists in
 * Postgres. If step 3 then fails — a model timeout, a rate limit, retrieval
 * down — the form is still there, and the only acceptable outcome is that the
 * manager can see and finish it. So the reference is reported the moment it
 * exists, and the drafting failure becomes a warning rather than an error that
 * unwinds anything.
 *
 * WHAT MUST NEVER HAPPEN ON A DRAFTING FAILURE: deleting the form (it may
 * already be visible in Form Monitoring), creating a second one (that is how a
 * duplicate disciplinary record happens), retrying the CREATE (same), or
 * pretending nothing occurred (the manager would re-ask and get form number two).
 *
 * ============================================================================
 * THE PROPOSAL SELECTS AN INTENT; THE SERVER CREATES THE RECORD
 * ============================================================================
 *
 * Everything sent here came out of browser-local IndexedDB and is treated as
 * untrusted orchestration metadata. `POST /api/forms/instances` re-resolves the
 * template, checks it is active with a published current version, pins that
 * version, applies the template's own `required_permission` against the
 * authenticated identity, and authorizes `locationId` against the AccessScope —
 * every time, regardless of what this file sends.
 *
 * Which is why `templateName` is not sent at all, `source` is fixed, and no
 * template version, status or field value appears anywhere below.
 */

export interface CreateInlineFormResult {
  reference: ChatFormInstanceRef;
  /** Set when the instance was created but Sunny could not prefill it. */
  draftWarning: string | null;
}

export const DRAFT_FAILED_WARNING =
  "Your draft was created, but Sunny couldn't prefill the details. You can complete them below.";

export const NO_NOTES_WARNING =
  "Your draft was created, but there wasn't enough in the conversation for Sunny to prefill it. You can complete it below.";

/** The JSON `fetch` wrapper the caller supplies — `formsFetch`, in the app. */
export type FormsCall = <T>(url: string, init?: RequestInit) => Promise<T>;

export async function createInlineForm({
  proposal,
  messages,
  call,
}: {
  proposal: ChatFormProposal;
  /** The conversation as the browser holds it, for resolving source ids. */
  messages: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  call: FormsCall;
}): Promise<CreateInlineFormResult> {
  /*
   * THE CREATE. Four values, every one of them re-derived server-side:
   *
   *   templateKey   revalidated against the published, active library
   *   employeeName  free text, and always was — there is no employee directory
   *   locationId    authorized against the authenticated AccessScope
   *   source        fixed, so Form Monitoring can tell where a form came from
   *
   * `locationName` is DELIBERATELY ABSENT. The only source of a salon display
   * name in this app is `DEMO_LOCATIONS`, which is seeded demo data — see
   * docs/chat-phase-3.md. A validated id with no name is honest; a validated id
   * with a demo name beside it is not.
   */
  const created = await call<{ instance: { id: string } }>("/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateKey: proposal.templateKey,
      employeeName: proposal.employeeName,
      locationId: proposal.locationId,
      source: "ask_sunny",
    }),
  });

  const reference: ChatFormInstanceRef = {
    instanceId: created.instance.id,
    proposalId: proposal.proposalId,
    templateName: proposal.templateName,
  };

  /*
   * THE DRAFT. Manager turns only, resolved from the ids the server retained —
   * see `draftNotesFromConversation`. An assistant turn cannot reach this, and
   * neither can a turn the bounded window dropped.
   */
  const notes = draftNotesFromConversation(messages, proposal.sourceMessageIds);
  if (!draftNotesAreUsable(notes)) {
    return { reference, draftWarning: NO_NOTES_WARNING };
  }

  try {
    await call(`/api/forms/instances/${reference.instanceId}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: notes.text }),
    });
    return { reference, draftWarning: null };
  } catch {
    // The form exists. Report it, warn about the prefill, change nothing else.
    return { reference, draftWarning: DRAFT_FAILED_WARNING };
  }
}
