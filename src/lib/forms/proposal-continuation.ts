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
 * actually reads as INTAKE — an employee name, or a statement of what
 * happened, when, or what it is about (see `continuesIntake` in
 * `lib/ai/form-proposal.ts`). Without that gate, "what is the tardiness
 * policy?" typed after a proposal would be swallowed by the form flow instead
 * of being answered.
 */

/**
 * ============================================================================
 * WHAT THE RIGHT RAIL'S "CREATE A FORM FROM THIS CONVERSATION" SENDS
 * ============================================================================
 *
 * A REQUEST, NOT A COMMAND. The button used to be a `<Link href="/forms/create">`
 * — it navigated away from the conversation the manager was in the middle of,
 * to a builder where they retyped the employee and the incident they had just
 * finished describing.
 *
 * So it now sends this through the ORDINARY send path, and everything the typed
 * flow already does happens unchanged: the bounded manager context, the
 * template-intent read, the continuation hint, the authorized template list,
 * the permission check. The button is a trigger; Chat stays the orchestrator.
 *
 * DELIBERATELY AMBIGUOUS WORDING. `detectTemplateIntent` reads this as "a form,
 * unspecified", so with nothing established the server asks WHICH form and
 * lists the ones this manager may actually create. Defaulting to a coaching
 * form because a coaching form is the common case is the exact failure this
 * workstream removed.
 *
 * Where the conversation HAS established a template — an open proposal on the
 * last assistant turn — the continuation hint carries it and the server
 * continues that one instead of asking again.
 */
export const CREATE_FORM_FROM_CONVERSATION = "Create a form from this conversation.";

export interface ProposalContinuation {
  /** Revalidated server-side against the published library. Never trusted. */
  templateKey: string;
}

/** Bounded like every other caller-supplied string. */
export const CONTINUATION_KEY_MAX = 64;

/**
 * How many plain answers may sit between an open proposal and the turn that
 * continues it. Bounded, so an intake the manager walked away from does not
 * come back an hour later — and the server still continues only a turn that
 * reads as intake, so a question typed meanwhile is still answered.
 */
export const CONTINUATION_ANSWER_LOOKBACK = 3;

/**
 * The manager ending the intake in their own words: "never mind", "cancel
 * that", "no form", "forget the form".
 */
const ENDS_INTAKE =
  /\b(?:never\s*mind|nevermind|cancel(?:\s+(?:it|that|this|the\s+form))?|forget\s+(?:it|that|the\s+form|about\s+it)|no\s+form|don'?t\s+(?:want|need)\s+(?:a|an|the)?\s*form|stop\s+(?:it|that|this|the\s+form))\b/i;

export function endsIntake(text: string): boolean {
  return ENDS_INTAKE.test(text);
}

/**
 * The open proposal the next turn would be continuing, if there is one.
 *
 * ============================================================================
 * AN ADVICE ANSWER DOES NOT END AN UNFINISHED INTAKE
 * ============================================================================
 *
 * VERIFIED IN PRODUCTION QA, 30 September 2026. This used to read ONLY the
 * last assistant turn, so the moment one reply in an intake went to the
 * grounded path — "employee: avery testperson" read as nobody, say — the
 * Coaching intake was gone, and "I already said Avery Testperson", typed
 * twice more, could never bring the card back.
 *
 * So the walk looks past plain answers, up to `CONTINUATION_ANSWER_LOOKBACK`
 * of them, to the proposal the manager was building. It still STOPS at:
 *
 *   - a proposal that became a real form (`formInstanceRef`) — finished;
 *   - a form picker — the manager was asked WHICH form, so none is open;
 *   - a failed turn — nothing to continue from what nobody saw;
 *   - the manager ending it: "never mind", "no form", "cancel".
 *
 * What this carries is unchanged: a TEMPLATE KEY, revalidated on the server,
 * and every fact re-derived from the manager's own turns.
 */
export function continuationFor(messages: ChatMessage[]): ProposalContinuation | null {
  let answers = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") {
      if (!message.error && endsIntake(message.content)) return null;
      continue;
    }
    if (message.role !== "assistant") continue;
    if (message.error) return null;
    if (message.formInstanceRef) return null;
    if (message.formProposal) return { templateKey: message.formProposal.templateKey };
    if (message.formSelection) return null;
    answers += 1;
    if (answers > CONTINUATION_ANSWER_LOOKBACK) return null;
  }
  return null;
}

/**
 * ============================================================================
 * AN OLDER CARD IS SUPERSEDED BY A NEWER ONE
 * ============================================================================
 *
 * Production QA found the card from before a correction still on screen, with
 * its Create button, after the manager had corrected the employee — so the
 * record could be filed against the person they had just said it was not for.
 *
 * A proposal that was never created is superseded once any LATER assistant
 * turn carries a different proposal: that one is what the conversation now
 * says. The older card stays readable and offers nothing. The server checks
 * the same thing again at creation — see `lib/forms/proposal-currency.ts` —
 * because a card in browser storage is not proof of anything.
 */
export function isProposalSuperseded(messages: readonly ChatMessage[], proposalId: string): boolean {
  const index = messages.findIndex((message) => message.formProposal?.proposalId === proposalId);
  if (index < 0) return false;
  if (messages[index]!.formInstanceRef) return false;
  return messages
    .slice(index + 1)
    .some((message) => message.role === "assistant" && !message.error && message.formProposal && message.formProposal.proposalId !== proposalId);
}

/**
 * ============================================================================
 * THE FORM A LATER TURN MIGHT CORRECT
 * ============================================================================
 *
 * The most recent form created in this conversation, by instance id — the
 * target of "change her new location to salon 24". None once a newer, not yet
 * created proposal is on screen: the manager is talking about that one now,
 * and the continuation above carries it.
 *
 * An id only, revalidated by the server (`correctActiveForm` runs the
 * template's own edit permission and the salon scope). A forged one reaches
 * nothing the manager could not already edit in the inline form.
 */
export function activeFormInstanceFor(messages: ChatMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role !== "assistant" || message.error) continue;
    if (message.formInstanceRef) return message.formInstanceRef.instanceId;
    if (message.formProposal) return undefined;
  }
  return undefined;
}
