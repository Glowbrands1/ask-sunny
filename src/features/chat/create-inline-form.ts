import {
  draftNotesAreUsable,
  draftNotesFromCard,
  draftNotesFromConversation,
} from "@/lib/forms/draft-notes";
import { cardPolicyToDraftEnabled } from "@/lib/config/chat-quality-flags";
import { cardOtherTopic, cardPolicyFor, cardPolicyLineFor } from "@/lib/forms/card-policy";
import { remapDraftSourcesClientEnabled } from "@/lib/config/chat-quality-flags";
import type { ChatFormInstanceRef, ChatFormProposal, ChatMessage } from "@/types";

/**
 * ============================================================================
 * PROPOSAL -> REAL FORM, IN TWO REQUESTS AND ONE IRREVERSIBLE ORDER
 * ============================================================================
 *
 *   1. POST /api/forms/instances            create the canonical instance
 *   2. onCreated(reference)                  SYNCHRONOUSLY, before step 3
 *   3. POST /api/forms/instances/[id]/draft ask Sunny to prefill it
 *
 * STEP 2 IS A CALLBACK, NOT A RETURN VALUE, AND THAT IS THE FIX.
 *
 * It used to be neither: the reference was built after step 1 and RETURNED at
 * the end, so the caller learned about it only once step 3 had settled. The
 * drafting route allows up to 120 seconds. For that whole window a real HR
 * record existed in Postgres — visible in Form Monitoring — while the chat
 * thread still showed "Create draft" as though nothing had been created. A
 * manager who clicked again, or reloaded, would file a second disciplinary
 * record for the same conversation.
 *
 * So the caller is told the instant the row exists, before anything that can
 * fail or take time. A drafting failure then becomes a warning rather than an
 * error that unwinds anything.
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
  /** The server returned the draft this card already made; nothing was drafted again. */
  reused?: boolean;
  /**
   * DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED: the reopened draft's date, which the
   * card states ("Updated your open draft from <date>"). Absent otherwise.
   */
  reusedFrom?: string;
  /**
   * What the drafting route says it left off or could not decide — an
   * observation that lost a policy finding, a refused box, a policy it could
   * not choose between. Said on the card; null when it left nothing out.
   */
  draftNotice?: string | null;
}

export const DRAFT_FAILED_WARNING =
  "Your draft was created, but Sunny couldn't prefill the details. You can complete them below.";

export const NO_NOTES_WARNING =
  "Your draft was created, but there wasn't enough in the conversation for Sunny to prefill it. You can complete it below.";

/** The JSON `fetch` wrapper the caller supplies — `formsFetch`, in the app. */
export type FormsCall = <T>(url: string, init?: RequestInit) => Promise<T>;

/*
 * ============================================================================
 * f073 (QA live test, 20 Nov 2026): A CREATE THAT NEVER ANSWERS IS GIVEN UP
 * ============================================================================
 *
 * A "Create draft" press sent no create the server saw, showed nothing, and a second press 115 s later worked; the
 * deploy had changed just before. A request on a connection that stalls (not one that fails) waits until the browser
 * gives up on its own, minutes later. The create POST alone is a few database writes, no model call, so it gets
 * CREATE_ANSWER_MS and is then aborted, and the card says to press Create again in words a manager reads.
 *
 * NEVER A SECOND FORM: a second press of the same card sends the same `proposalId`, and the create route returns the
 * draft that card already made (`findRecentAssistantDraft`), so a first request that did reach the server is reused.
 * The prefill after it is not limited here: it is a model call with its own limits, and the row exists by then.
 */
export const CREATE_ANSWER_MS = 30_000;

export const CREATE_RETRY_MESSAGE = "Something went wrong — press Create again.";

/** The create POST did not answer within CREATE_ANSWER_MS. */
export class CreateNoAnswerError extends Error {
  constructor() {
    super(CREATE_RETRY_MESSAGE);
    this.name = "CreateNoAnswerError";
  }
}

/** `call`, with the create POST given up after `limitMs`; every other request is passed through unchanged. */
export function createAnswerLimited(call: FormsCall, limitMs: number = CREATE_ANSWER_MS): FormsCall {
  return async <T,>(url: string, init: RequestInit = {}): Promise<T> => {
    if (url !== "/api/forms/instances" || String(init.method ?? "GET").toUpperCase() !== "POST") return call<T>(url, init);
    const controller = new AbortController();
    let gaveUp = false;
    const timer = setTimeout(() => {
      gaveUp = true;
      controller.abort();
    }, limitMs);
    try {
      return await call<T>(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (gaveUp) throw new CreateNoAnswerError();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * The words a create failure is shown in. A refusal from the route keeps its own reason (it describes the template or
 * the permission); a request the network lost or that never answered says to press Create again, never the browser's
 * own "Failed to fetch" / "Load failed".
 */
export function createFailureMessage(error: unknown): string {
  if (error instanceof CreateNoAnswerError) return CREATE_RETRY_MESSAGE;
  const name = (error as { name?: unknown } | null)?.name;
  if (error instanceof TypeError || name === "AbortError" || name === "TypeError") return CREATE_RETRY_MESSAGE;
  const message = error instanceof Error ? error.message.trim() : "";
  return message || CREATE_RETRY_MESSAGE;
}

export async function createInlineForm({
  proposal,
  messages,
  call,
  onCreated,
}: {
  proposal: ChatFormProposal;
  /** The conversation as the browser holds it, for resolving source ids. */
  messages: Pick<ChatMessage, "id" | "role" | "content" | "error">[];
  call: FormsCall;
  /**
   * Called the instant the row exists, before drafting is attempted.
   *
   * Persist here. Anything that waits for this function to resolve is waiting
   * out a window in which a real HR record exists and chat says it does not.
   */
  onCreated: (reference: ChatFormInstanceRef) => void;
}): Promise<CreateInlineFormResult> {
  /*
   * THE CREATE. Six values, every one of them re-derived or re-checked
   * server-side:
   *
   *   templateKey   revalidated against the published, active library
   *   variantKey    revalidated against the version that gets pinned
   *   employeeName  free text, and always was — there is no employee directory —
   *                 checked against who the conversation now names
   *                 (`conversation`), so a superseded card is refused
   *   employeeRole  free text; null unless the manager stated a job title
   *   locationId    authorized against the authenticated AccessScope
   *   source        fixed, so Form Monitoring can tell where a form came from
   *
   * `locationName` is DELIBERATELY ABSENT. The only source of a salon display
   * name in this app is `PRODUCTION_SALONS` — see
   * docs/chat-phase-3.md. A validated id with no name is honest; a validated id
   * with a demo name beside it is not.
   */
  const created = await call<{ instance: { id: string }; reused?: boolean; reusedFrom?: string; followUpNotice?: unknown }>("/api/forms/instances", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      templateKey: proposal.templateKey,
      employeeName: proposal.employeeName,
      /*
       * WHICH READING OF THE DOCUMENT. Null for the templates that print one
       * way; the single declared variant for the SDIT EPP. Sending nothing is
       * what used to pin `null` on a form whose labels are written as
       * `{{role}}`, so the page read "In what areas is the the employee
       * currently succeeding?" — which is why every EPP was refused inline.
       * Revalidated against the pinned version by the route.
       */
      variantKey: proposal.variantKey,
      /*
       * THE JOB TITLE, ONLY WHERE THE MANAGER STATED IT. It fills the form's
       * `job_title` line at creation — a `system` field no model can write —
       * and stays null when they said nothing, leaving a blank the manager
       * fills rather than a title Ask Sunny invented.
       */
      employeeRole: proposal.employeeRole,
      /*
       * THE DATE, ONLY WHERE THE MANAGER TYPED ONE. Omitted otherwise, so the
       * route keeps its default of today. Revalidated by the route.
       */
      ...(proposal.formDate ? { formDate: proposal.formDate } : {}),
      /*
       * "IS PAYROLL DEDUCT APPLICABLE?", ONLY WHERE THE MANAGER ANSWERED IT.
       * Omitted otherwise, so the form's Yes / No starts unanswered.
       * Revalidated by the route against the pinned version.
       */
      ...(proposal.payrollDeduct ? { payrollDeduct: proposal.payrollDeduct } : {}),
      /*
       * THE AMOUNT, ONLY WHERE THE MANAGER STATED ONE. Omitted otherwise, so
       * the line stays blank. The create route reads it again from this
       * conversation and does not take a figure from a policy.
       */
      ...(proposal.payrollDeductAmount ? { payrollDeductAmount: proposal.payrollDeductAmount } : {}),
      /*
       * THE TYPE OF WARNING, ONLY WHERE THE MANAGER STATED IT FOR THIS FORM.
       * Omitted otherwise, so the box starts empty. Revalidated by the route
       * against the pinned version.
       */
      ...(proposal.warningLevel ? { warningLevel: proposal.warningLevel } : proposal.loopTermination ? { warningLevel: "termination" } : {}),
      ...(proposal.fromAgentLoop ? { fromAgentLoop: true } : {}),
      locationId: proposal.locationId,
      source: "ask_sunny",
      /* The card's own id: a second press of it returns the draft it already made. */
      proposalId: proposal.proposalId,
      /*
       * THE CONVERSATION AS IT STANDS NOW, not as it stood when the card was
       * drawn. The server re-reads who and which form it now names and
       * refuses a card the manager has since corrected.
       */
      conversation: messages
        .filter((message) => !message.error)
        .map((message) => ({ id: message.id, role: message.role, content: message.content })),
    }),
  });

  const reference: ChatFormInstanceRef = {
    instanceId: created.instance.id,
    proposalId: proposal.proposalId,
    templateName: proposal.templateName,
  };

  /*
   * BEFORE THE AWAIT BELOW, not after it. See the note at the top of this file:
   * the drafting call may take up to two minutes, and for every second of it a
   * real form exists.
   */
  onCreated(reference);

  /*
   * THE CARD'S DRAFT ALREADY EXISTS: a second press, a retry after a lost
   * response, or another tab. It is opened as it is — drafting it again would
   * overwrite what Sunny and the manager have written on it since.
   */
  if (created.reused) {
    return {
      reference,
      draftWarning: null,
      reused: true,
      ...(typeof created.reusedFrom === "string" && created.reusedFrom ? { reusedFrom: created.reusedFrom } : {}),
    };
  }

  /*
   * THE DRAFT. Manager turns only, resolved from the ids the server retained —
   * see `draftNotesFromConversation`. An assistant turn cannot reach this, and
   * neither can a turn the bounded window dropped.
   */
  const fromTurns = draftNotesFromConversation(messages, proposal.sourceMessageIds);
  /*
   * NEXT_PUBLIC_REMAP_DRAFT_SOURCES_ENABLED: a form that would otherwise be
   * blank is drafted from the card the manager pressed Create on, when that
   * card shows what happened (QA H1, 25 Oct 2026). Only when no turn
   * qualified: a draft with usable turns is unchanged. Off, as before. See
   * `draftNotesFromCard`.
   */
  /*
   * LIVE FIX (QA, 18 Nov 2026; Pau's test chat): "Ca for <the manager herself> she was wearing mini skirt on 9/12", then
   * "for <employee>". The agent loop's card carried the account ("<first> was wearing a mini skirt on 9/12."), but its
   * request was only the second turn, so the notes were "for <employee>": nothing was drafted and the saved Observation
   * was blank. A loop card that carries an account drafts from the card's own lines (its account first), with the
   * manager's turns it cites after them. A loop card with no account is as before (the blank-details notice).
   */
  const loopCard = proposal.fromAgentLoop ? draftNotesFromCard(proposal) : null;
  const notes =
    loopCard && draftNotesAreUsable(loopCard)
      ? {
          ...loopCard,
          text: draftNotesAreUsable(fromTurns) ? `${loopCard.text}\n\n${fromTurns.text}` : loopCard.text,
          usedMessageIds: fromTurns.usedMessageIds,
        }
      : draftNotesAreUsable(fromTurns) || !remapDraftSourcesClientEnabled()
        ? fromTurns
        : draftNotesFromCard(proposal);
  /*
   * Pau (20 Nov 2026): the follow-up date Create set on a loop's Corrective Action, said on the card ("Follow-up: Fri,
   * Nov 27 (change it anytime)."). The drafting route says it for any other form whose Action Plan promised one.
   */
  const createdFollowUp = typeof created.followUpNotice === "string" && created.followUpNotice.trim() !== "" ? created.followUpNotice : null;
  if (!draftNotesAreUsable(notes)) {
    return { reference, draftWarning: NO_NOTES_WARNING, ...(createdFollowUp ? { draftNotice: createdFollowUp } : {}) };
  }

  try {
    const drafted = await call<{ notice?: unknown; followUpNotice?: unknown }>(`/api/forms/instances/${reference.instanceId}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        notes: notes.text,
        // NEXT_PUBLIC_CARD_POLICY_TO_DRAFT_ENABLED: the policy the card cited (QA live check, 3 Nov 2026).
        ...(cardPolicyToDraftEnabled() && cardPolicyFor(proposal, messages) ? { cardPolicy: cardPolicyFor(proposal, messages) } : {}),
        // HOTFIX (QA, 17 Nov 2026): the card's "Other — <topic>", so the saved form ticks Other and names it.
        ...(cardPolicyToDraftEnabled() && cardOtherTopic(proposal, messages) ? { cardOther: cardOtherTopic(proposal, messages) } : {}),
        // HOTFIX (QA, 17 Nov 2026): a loop card's policy is the saved form's (the draft route reads it as named).
        ...(proposal.fromAgentLoop ? { cardFromLoop: true } : {}),
        // QA (20 Nov 2026; c198): the loop card's own account, so the saved account keeps the times it holds.
        ...(proposal.fromAgentLoop && typeof proposal.issue === "string" && proposal.issue.trim() ? { cardAccount: proposal.issue.trim().slice(0, 2_000) } : {}),
        // Pau (17 Nov 2026): a Coaching Form always carries the policy and page; the card's whole line goes with it.
        ...(cardPolicyToDraftEnabled() && cardPolicyLineFor(proposal, messages) ? { cardPolicyLine: cardPolicyLineFor(proposal, messages) } : {}),
        // The coaching card's topic (QA, 17 Nov 2026): the saved form's Other topic.
        ...(proposal.coachingTopic ? { cardTopic: proposal.coachingTopic } : {}),
        // SAME_FORM_COPY_NEW_PERSON_ENABLED: the form this card copies; re-checked by the route.
        ...(proposal.copyFromInstanceId ? { copyFromInstanceId: proposal.copyFromInstanceId } : {}),
      }),
    });
    const notice = typeof drafted?.notice === "string" && drafted.notice.trim() !== "" ? drafted.notice : null;
    const draftedFollowUp = typeof drafted?.followUpNotice === "string" && drafted.followUpNotice.trim() !== "" ? drafted.followUpNotice : null;
    const notices = [notice, createdFollowUp ?? draftedFollowUp].filter((line): line is string => Boolean(line));
    return { reference, draftWarning: null, draftNotice: notices.length > 0 ? notices.join(" ") : null };
  } catch {
    // The form exists. Report it, warn about the prefill, change nothing else.
    return { reference, draftWarning: DRAFT_FAILED_WARNING, ...(createdFollowUp ? { draftNotice: createdFollowUp } : {}) };
  }
}
