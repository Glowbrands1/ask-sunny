import type { ChatMessage } from "@/types";

/**
 * ============================================================================
 * ANSWERING SUNNY'S QUESTION IS PART OF THE SAME REQUEST
 * ============================================================================
 *
 *   Manager: "Build me a coaching form for that."
 *   Sunny:   "I don't yet know who this form is about..."
 *   Manager: "Sarah Test"
 *
 * That third turn was routed into ordinary retrieval: `detectTemplateIntent`
 * saw no form words in "Sarah Test" and returned `none`, so the manager
 * answered a direct question and got a knowledge-base answer about a person's
 * name. The proposal they were building silently ended.
 *
 * ============================================================================
 * A HINT, NOT A STATE MACHINE — AND EXPLICITLY NOT THE OLD ONE
 * ============================================================================
 *
 * The prototype solved this with `pendingFormTemplateId` / `pendingFormValues`:
 * a bag of half-filled HR values parked on an assistant turn in browser storage
 * and read back on the next one, where anything still missing became a default.
 * That is not what this is, and the difference is the whole point.
 *
 * THIS CARRIES A TEMPLATE KEY. Nothing else. No employee, no salon, no topic,
 * no field value, no status the server would trust. It says only "the last
 * thing Sunny offered was a form of this kind" — and every fact on the
 * resulting proposal is re-derived from the manager's own turns, exactly as it
 * would be on a first request.
 *
 * ============================================================================
 * WHY A TAMPERED HINT GAINS NOTHING
 * ============================================================================
 *
 * It arrives from browser-local IndexedDB, so treat it as chosen by the caller.
 * The server then resolves it against the published, active library, requires a
 * published current version, and applies the TEMPLATE'S OWN permission to the
 * authenticated identity — the identical path a typed request takes. So the
 * most a forged hint can do is produce a proposal the caller could have
 * produced by typing the template's name, which creates nothing and authorizes
 * nothing.
 *
 * The server narrows it further: a hint is only honoured when the current turn
 * actually reads as an ANSWER — it must yield an employee name. Without that
 * gate, "what is the tardiness policy?" typed after a proposal would be
 * swallowed by the form flow instead of being answered.
 */

export interface ProposalContinuation {
  /** Revalidated server-side against the published library. Never trusted. */
  templateKey: string;
}

/** Bounded like every other caller-supplied string. */
export const CONTINUATION_KEY_MAX = 64;

/**
 * The open proposal the next turn would be continuing, if there is one.
 *
 * ONLY THE LAST ASSISTANT TURN COUNTS. A conversation that has moved on — a
 * knowledge question asked and answered in between — has ended the exchange,
 * and reviving a proposal from three turns back would be the same
 * "conversation state persists forever" mistake in a new form.
 *
 * A proposal that already became a real form (`formInstanceRef`) is finished:
 * the manager is editing the record now, and another turn is a new request.
 */
export function continuationFor(messages: ChatMessage[]): ProposalContinuation | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant") continue;
    if (message.error) return null;
    if (message.formInstanceRef) return null;
    if (!message.formProposal) return null;
    return { templateKey: message.formProposal.templateKey };
  }
  return null;
}
