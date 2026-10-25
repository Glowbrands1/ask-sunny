import { NextResponse } from "next/server";

import { salonById } from "@/data/salons";

import { historyWantsSeparateDocument } from "@/lib/ai/second-form";
import { errorResponse } from "@/lib/api/respond";
import {
  conversationDraftReuseEnabled,
  conversationProposalDedupeEnabled,
  draftActionsEnabled,
  draftDedupeEnabled,
  payrollAmountFieldEnabled,
} from "@/lib/config/chat-quality-flags";
import { parseHistory } from "@/lib/api/validation";
import { authorizeForms } from "@/lib/forms/access";
import {
  isStatedWarningLevel,
  WARNING_LEVEL_STATED_KEYS,
  WARNING_TYPE_KEY,
} from "@/lib/forms/corrective-action-intake";
import { isIsoCalendarDate } from "@/lib/forms/form-date-answer";
import { conversationKeyOf } from "@/lib/forms/conversation-key";
import {
  applyTurnsSinceDraft,
  findConversationDraft,
  lastManagerTurnId,
  noteConversationDraft,
} from "@/lib/forms/conversation-draft";
import { businessToday } from "@/lib/business-date";
import { findConversationProposalDraft } from "@/lib/forms/conversation-proposal-draft";
import { isProposalId } from "@/lib/forms/proposal-id";
import {
  applyStatedFacts,
  createInstance,
  findRecentAssistantDraft,
  loadInstance,
  deleteDemoInstances,
  findDemoInstances,
  InstanceProtectedError,
  listInstances,
  type InstanceView,
} from "@/lib/forms/instances";
import { instanceListFilterFor, visibleInstances } from "@/lib/forms/instance-scope";
import { historySaysDifferentIncident } from "@/lib/forms/draft-actions";
import { findOpenIncidentDraft, findResentDraft } from "@/lib/forms/draft-reopen";
import { authorizeLocation } from "@/lib/forms/location-scope";
import { checkProposalIsCurrent } from "@/lib/forms/proposal-currency";
import { allowsTeamSubject, isTeamSubject } from "@/lib/forms/team-subject";
import { isDemoMode } from "@/lib/config/runtime";
import { getTemplateByKey } from "@/lib/forms/repository";
import {
  PAYROLL_AMOUNT_KEY,
  PAYROLL_AMOUNT_STATED_KEYS,
} from "@/lib/forms/payroll-amount-field";
import {
  isPayrollDeductAnswer,
  PAYROLL_DEDUCT_STATED_KEYS,
  payrollAmountFromConversation,
  payrollDeductChecked,
} from "@/lib/forms/payroll-deduct";
import type { Permission } from "@/types";

/**
 * GET    /api/forms/instances   Form Monitoring's history, and what a demo
 *                               sweep would remove
 * POST   /api/forms/instances   starts a form from a template's current version
 * DELETE /api/forms/instances   removes every DEMO DRAFT, by provenance
 *
 * The permission is the TEMPLATE's, not a blanket "forms" one: a Salon Director
 * may create a coaching form and not a disciplinary plan of action, and that
 * distinction is data on the template rather than a rule written here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authorizeForms(request, "view_form_monitoring");
    const { searchParams } = new URL(request.url);

    const requested = searchParams.get("view");
    const view: InstanceView =
      requested === "archived" || requested === "all" ? requested : "active";

    /*
     * ==========================================================================
     * FORM MONITORING IS SCOPE-FILTERED ON THE SERVER
     * ==========================================================================
     *
     * This listed EVERY form in the company to anybody holding
     * `view_form_monitoring` — which is every manager role. A Salon Director at
     * one salon read the employee names, coaching topics and disciplinary
     * history of every other salon.
     *
     * Filtered HERE rather than in the screen, because a client-side filter is
     * a presentation choice and this is an access boundary: the rows would
     * still have crossed the wire, and `GET /api/forms/instances` is callable
     * without the screen.
     *
     * ==========================================================================
     * NARROWED IN THE QUERY, THEN RE-CHECKED IN MEMORY
     * ==========================================================================
     *
     * This read the whole company ordered by recency, took 200, and filtered
     * that page. Confidential — no foreign row reached the browser — and wrong
     * as a history: across 22 salons, an authorized record older than 200
     * foreign ones never entered the page, so the filter could not return it
     * and a manager's own history silently lost rows.
     *
     * `instanceListFilterFor` moves the narrowing into the query so the limit
     * applies to the VISIBLE set. `visibleInstances` still runs afterwards, and
     * that redundancy is the point: the query decides what is read, the
     * predicate re-checks what is returned, and the predicate is the one that
     * fails closed if they ever drift.
     */
    const instances = visibleInstances(
      actor,
      await listInstances(view, undefined, instanceListFilterFor(actor)),
    );

    // The sweep's shape is returned alongside so the screen can say "Delete 5
    // demo forms" with a real number rather than counting what it happens to
    // be showing — the active list is filtered, and a count taken from it
    // would be wrong the moment somebody switches to Archived.
    //
    // Scoped by the same rule: a count of forms the caller may not see would
    // offer a "Delete 5" that removed nothing, and would leak how many exist.
    const sweep = await findDemoInstances();
    return NextResponse.json({
      instances,
      view,
      demo: {
        deletable: visibleInstances(actor, sweep.deletable).length,
        protected: visibleInstances(actor, sweep.protected).length,
      },
    });
  } catch (error) {
    return errorResponse(error, "forms/instances");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      templateKey?: string;
      variantKey?: string | null;
      employeeName?: string;
      employeeRole?: string | null;
      locationId?: string | null;
      locationName?: string | null;
      source?: "manual" | "ask_sunny";
      formDate?: string;
      payrollDeduct?: unknown;
      payrollDeductAmount?: unknown;
      warningLevel?: unknown;
      /** The chat the proposal came from, for `checkProposalIsCurrent`. Ask Sunny only. */
      conversation?: unknown;
      /** Optional stable id for this chat. The first message id is used when this is absent. */
      conversationId?: unknown;
      proposalId?: unknown;
    } | null;

    if (!body?.templateKey || !body.employeeName?.trim()) {
      return NextResponse.json(
        { error: "A form type and an employee are required." },
        { status: 400 },
      );
    }

    /*
     * THE TEMPLATE MUST EXIST AND BE ACTIVE, CHECKED HERE AND AGAIN BELOW.
     *
     * `createInstance` refuses an inactive template too, and that stays: it is
     * the layer every future caller goes through, and a rule that only lives in
     * a route is a rule the next route forgets.
     *
     * The check is repeated here because of WHAT HAPPENS IN BETWEEN. Without it
     * an inactive template's `required_permission` is applied to the caller,
     * and the eventual refusal arrives as a generic 500 rather than a 404 that
     * says which form is unavailable — which matters now that a proposal
     * carried in browser-local storage can name a template that was retired
     * after the conversation started.
     */
    const template = await getTemplateByKey(body.templateKey);
    if (!template || !template.active) {
      return NextResponse.json({ error: "No such form template." }, { status: 404 });
    }

    const actor = await authorizeForms(request, template.requiredPermission as Permission);

    /*
     * A TEAM-WIDE SUBJECT ONLY WHERE THE TEMPLATE ALLOWS ONE. "All team
     * members" on a Corrective Action Form or an EPP would file a disciplinary
     * document against nobody in particular. See `lib/forms/team-subject.ts`.
     */
    if (isTeamSubject(body.employeeName) && !allowsTeamSubject(body.templateKey)) {
      return NextResponse.json(
        { error: "This form is about one employee. Tell Sunny who it is for." },
        { status: 400 },
      );
    }

    /*
     * A PROPOSAL CARD IS ONLY AS CURRENT AS THE CONVERSATION BEHIND IT.
     *
     * After the permission check, so a caller who may not create this form
     * learns nothing about the conversation. A chat card that the manager has
     * since corrected — a different employee, "not Jordan", another form —
     * is refused here even if the browser still offered it. See
     * `lib/forms/proposal-currency.ts`.
     */
    if (body.source === "ask_sunny" && Array.isArray(body.conversation)) {
      const currency = checkProposalIsCurrent({
        conversation: parseHistory(body.conversation),
        templateKey: body.templateKey,
        employeeName: body.employeeName,
      });
      if (!currency.current) {
        return NextResponse.json({ error: currency.reason, code: "proposal_superseded" }, { status: 409 });
      }
    }

    /*
     * ==========================================================================
     * THE SALON IS THE SERVER'S DECISION, NOT THE CALLER'S
     * ==========================================================================
     *
     * This route accepted `locationId` and `locationName` and stored them
     * unchecked. The authenticated identity has carried an `AccessScope` all
     * along — `authorizeForms` was discarding it — so nothing compared the salon
     * on a disciplinary record against the salons the person filing it covers.
     *
     * ENFORCED HERE, AT THE ROUTE EVERY CALLER GOES THROUGH, rather than in the
     * chat orchestration that will use it next. A check that lives in one
     * caller is a check the next caller does not have.
     *
     * A REFUSAL IS A 403 WITH A REASON, not a silently dropped field. Quietly
     * storing the form without its salon would file an HR document against
     * nobody's location and tell the manager it worked.
     */
    const location = authorizeLocation(actor.scope, body.locationId ?? null);
    if (location.kind === "refused") {
      return NextResponse.json({ error: location.reason }, { status: 403 });
    }
    const locationId = location.kind === "authorized" ? location.locationId : null;

    /*
     * THE ANSWERS THIS CARD CARRIES, as the manager's own statements. On a new
     * draft they fill it; on a reused one (`applyStatedFacts` fills only what
     * is blank) they never replace a value already there.
     */
    const card = body;
    async function applyCardFacts(instanceId: string): Promise<void> {
      /*
       * "IS PAYROLL DEDUCT APPLICABLE?", AS THE MANAGER ANSWERED IT IN CHAT.
       *
       * Written as the manager's own statement — the path the employment change
       * forms use for their stated facts — and only where the pinned version
       * has the group: `applyStatedFacts` validates the key and the option
       * against it, and a version without the question (or any other template)
       * gets nothing. No answer sent means nothing written; it is never
       * defaulted. See `lib/forms/payroll-deduct.ts`.
       */
      if (isPayrollDeductAnswer(card.payrollDeduct)) {
        await applyStatedFacts(
          instanceId,
          { values: {}, checked: payrollDeductChecked(card.payrollDeduct) },
          actor.id,
          PAYROLL_DEDUCT_STATED_KEYS,
        );
      }

      /*
       * PAYROLL DEDUCTION AMOUNT, FROM THE MANAGER'S OWN WORDS.
       *
       * Written only when the amount field is on, payroll is Yes, and the
       * conversation states a figure. The body may carry the same figure; it is
       * not the source. A policy quotation is not a figure. No figure means the
       * line stays blank, and the form is still created.
       */
      if (payrollAmountFieldEnabled() && card.payrollDeduct === "yes" && Array.isArray(card.conversation)) {
        const turns = parseHistory(card.conversation);
        const amount = payrollAmountFromConversation(turns, { payrollAnswer: "yes" });
        if (amount) {
          await applyStatedFacts(
            instanceId,
            { values: { [PAYROLL_AMOUNT_KEY]: amount }, checked: {} },
            actor.id,
            PAYROLL_AMOUNT_STATED_KEYS,
          );
        }
      }

      /*
       * THE TYPE OF WARNING, AS THE MANAGER STATED IT FOR THIS FORM IN CHAT —
       * "create verbal CA for …". The same path as the payroll answer: their own
       * statement, only a verbal or written level, and only where the pinned
       * version offers it (`applyStatedFacts` validates the option). Nothing sent
       * means nothing written; it is never defaulted. The draft leaves it as it
       * is. See `statedWarningLevel` in `lib/forms/corrective-action-intake.ts`.
       */
      if (isStatedWarningLevel(card.warningLevel)) {
        await applyStatedFacts(
          instanceId,
          { values: {}, checked: { [WARNING_TYPE_KEY]: [card.warningLevel] } },
          actor.id,
          WARNING_LEVEL_STATED_KEYS,
        );
      }
    }

    /*
     * ONE DRAFT PER FORM IN THIS CHAT (CONVERSATION_DRAFT_REUSE_ENABLED). A new
     * card for the same form and employee opens the draft this chat already
     * made, unless the manager asked for another document since. Before the
     * any-chat check below, which one earlier "another" switches off for the
     * rest of the chat. See `conversation-draft.ts`.
     */
    /*
     * "DIFFERENT INCIDENT", answering whether this is the same incident as the
     * form on file (QA F8): a new form, so no open draft is reopened in its
     * place. DRAFT_ACTIONS_ENABLED only. Read before the chat's own draft too,
     * so "different incident" is not folded into the draft this chat already
     * made when both flags are on.
     */
    const newIncident = draftActionsEnabled() && historySaysDifferentIncident(body.conversation);
    const draftChat =
      body.source === "ask_sunny" && conversationDraftReuseEnabled() && !newIncident
        ? conversationKeyOf({ conversationId: body.conversationId, conversation: body.conversation })
        : null;
    const chatTurns = draftChat ? parseHistory(body.conversation) : [];
    if (draftChat) {
      // A guard that cannot read is no guard: the create goes ahead as before.
      const same = await findConversationDraft({
        createdBy: actor.id,
        templateKey: body.templateKey,
        employeeName: body.employeeName.trim().slice(0, 120),
        conversationKey: draftChat,
        turns: chatTurns,
      }).catch(() => null);
      if (same) {
        /*
         * The facts said since that draft was made, then this card's own
         * stated answers where the draft is still blank — never over a value.
         */
        await applyTurnsSinceDraft({
          request,
          instanceId: String(same.instance.id),
          turns: chatTurns,
          lastTurnId: same.lastTurnId,
          today: businessToday(),
        }).catch(() => undefined);
        await applyCardFacts(String(same.instance.id)).catch(() => undefined);
        const updated = await loadInstance(String(same.instance.id)).catch(() => null);
        return NextResponse.json({ instance: updated?.instance ?? same.instance, reused: true });
      }
    }

    /*
     * SAME EMPLOYEE, SAME TEMPLATE, SAME INCIDENT, ANY CHAT. An open draft is
     * reopened instead of filing another one. A different date or a different
     * account of what happened still creates. Not after "different incident"
     * (`newIncident`, above).
     */
    if (body.source === "ask_sunny" && !newIncident && !historyWantsSeparateDocument(body.conversation)) {
      const turns = Array.isArray(body.conversation) ? parseHistory(body.conversation) : [];
      const incidentText = turns
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.content)
        .join("\n")
        .trim()
        .slice(0, 2000);
      const open = await findOpenIncidentDraft({
        templateKey: body.templateKey,
        employeeName: body.employeeName.trim().slice(0, 120),
        createdBy: actor.id,
        locationId,
        formDate: isIsoCalendarDate(body.formDate) ? body.formDate : null,
        incident: incidentText || null,
      }).catch(() => null);
      if (open) return NextResponse.json({ instance: open, reused: true });
    }

    /*
     * A global non-admin may create the draft with no salon. When
     * GLOBAL_SALON_ASK_ENABLED is on, chat asks which salon once and does
     * not block this create. Pau approved that on 24 Oct 2026.
     */

    /* See `resolveLocationName`. */
    const locationName = resolveLocationName(locationId, body.locationName ?? null);

    /*
     * ONE DRAFT PER CARD. A press of a card whose create already succeeded —
     * the response was lost, the card was pressed twice, or in another tab —
     * returns that draft instead of filing a second record (QA, 22 Oct 2026:
     * a second press filed a second Corrective Action). A new card always
     * creates. See `findRecentAssistantDraft`.
     */
    const proposalId = body.source === "ask_sunny" && isProposalId(body.proposalId) ? body.proposalId : undefined;
    const conversationKey =
      proposalId && conversationProposalDedupeEnabled()
        ? conversationKeyOf({ conversationId: body.conversationId, conversation: body.conversation })
        : null;
    if (proposalId && conversationKey) {
      // A guard that cannot read is no guard: the create goes ahead as before.
      const existing = await findConversationProposalDraft({
        createdBy: actor.id,
        proposalId,
        conversationKey,
      }).catch(() => null);
      if (existing) return NextResponse.json({ instance: existing, reused: true });
    } else if (proposalId) {
      // A guard that cannot read is no guard: the create goes ahead as before.
      const existing = await findRecentAssistantDraft({
        templateKey: body.templateKey,
        employeeName: body.employeeName.trim().slice(0, 120),
        createdBy: actor.id,
        locationId,
        proposalId,
      }).catch(() => null);
      if (existing) return NextResponse.json({ instance: existing, reused: true });
    }

    /*
     * A resent create for the same person, form and salon. Only when
     * DRAFT_DEDUPE_ENABLED is on, and never when the conversation asked for
     * a second or follow-up document. The card-id match above is unchanged.
     */
    if (
      draftDedupeEnabled() &&
      body.source === "ask_sunny" &&
      !newIncident &&
      !historyWantsSeparateDocument(body.conversation)
    ) {
      const turns = Array.isArray(body.conversation) ? parseHistory(body.conversation) : [];
      const incidentText = turns
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.content)
        .join("\n")
        .trim()
        .slice(0, 2000);
      const resent = await findResentDraft({
        templateKey: body.templateKey,
        employeeName: body.employeeName.trim().slice(0, 120),
        createdBy: actor.id,
        locationId,
        ...(incidentText
          ? { incident: incidentText, formDate: isIsoCalendarDate(body.formDate) ? body.formDate : null }
          : {}),
      }).catch(() => null);
      if (resent) return NextResponse.json({ instance: resent, reused: true });
    }

    const instance = await createInstance({
      templateKey: body.templateKey,
      variantKey: body.variantKey ?? null,
      employeeName: body.employeeName.trim().slice(0, 120),
      employeeRole: body.employeeRole ?? null,
      locationId,
      locationName,
      createdBy: actor.id,
      createdByRole: actor.role,
      source: body.source === "ask_sunny" ? "ask_sunny" : "manual",
      // A real calendar day or nothing, in which case the form is dated today.
      formDate: isIsoCalendarDate(body.formDate) ? body.formDate : undefined,
      proposalId,
      ...(conversationKey ? { conversationKey } : {}),
    });
    /* A concurrent press of the same card: its row, as it already is. See `cardInstanceId`. */
    if (instance.reused) return NextResponse.json({ instance, reused: true });
    if (draftChat) {
      await noteConversationDraft(String(instance.id), draftChat, lastManagerTurnId(chatTurns)).catch(() => undefined);
    }

    await applyCardFacts(String(instance.id));

    return NextResponse.json({ instance });
  } catch (error) {
    return errorResponse(error, "forms/instances/create");
  }
}

/**
 * THE DEMO SWEEP — the one destructive action that runs without naming a row.
 *
 * It is therefore the most carefully bounded. `deleteDemoInstances` selects on
 * the `demo:` PROVENANCE PREFIX and on draft status, so a real record cannot be
 * in the set; and the caller sends the count it showed the person, so a list
 * that changed underneath aborts instead of deleting a different set than was
 * agreed to.
 *
 * A finalized demo form is not swept. The rule about signed documents does not
 * bend because the document happens to be synthetic — those are reported and
 * left for archiving.
 */
export async function DELETE(request: Request) {
  try {
    await authorizeForms(request, "manage_form_records");
    const { searchParams } = new URL(request.url);

    // Explicit and narrow: there is no "delete everything" shape of this call.
    if (searchParams.get("scope") !== "demo") {
      return NextResponse.json(
        { error: "This endpoint only removes demo records. Pass scope=demo." },
        { status: 400 },
      );
    }

    const expected = Number(searchParams.get("expected"));
    if (!Number.isInteger(expected) || expected < 0) {
      return NextResponse.json(
        { error: "Say how many forms you expect to remove." },
        { status: 400 },
      );
    }

    const result = await deleteDemoInstances(expected);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InstanceProtectedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return errorResponse(error, "forms/instances/demo-sweep");
  }
}


/**
 * ============================================================================
 * A SALON NAME NOBODY VERIFIED DOES NOT GO ON A LIVE HR RECORD
 * ============================================================================
 *
 * THE NAME FOLLOWS THE ID, AND IS DROPPED WHEN THE ID IS. A location id and a
 * display name must not become two independent authorities: a caller that sent
 * an unauthorized id with a plausible name would otherwise leave the name on
 * the record after the id was refused.
 *
 * AND IN LIVE MODE THE REQUEST'S NAME IS NEVER USED, even when the id beside
 * it survives. A `locationName` arriving here is either demo data or the id
 * again, and neither is bound to the validated location by anything
 * trustworthy. The name printed on the form is looked up from the production
 * roster by the VALIDATED ID, server-side; an id the roster does not know gets
 * no name. A wrong salon NAME on a disciplinary record is worse than no name.
 *
 * DEMO MODE KEEPS THE CALLER'S NAME, EXPLICITLY AS SYNTHETIC. Preview carries
 * the standing notice that only synthetic data belongs there, and nothing in
 * preview is an HR record.
 */
function resolveLocationName(
  locationId: string | null,
  requested: string | null,
): string | null {
  if (!locationId) return null;
  /*
   * THE ROSTER EXISTS NOW, so the name is what the paragraph above said it
   * would become: resolved SERVER-SIDE from the validated id, never read from
   * the request. `PRODUCTION_SALONS` is the production roster, validated
   * against reporting (`salonRosterMatches`). An id the roster does not know
   * gets no name rather than a guess, and a name the caller typed is still
   * ignored in live mode.
   */
  const rostered = salonById(locationId)?.name ?? null;
  if (!isDemoMode()) return rostered;
  return requested ?? rostered;
}
