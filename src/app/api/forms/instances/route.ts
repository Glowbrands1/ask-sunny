import { NextResponse } from "next/server";
import { redactHrApproval } from "@/lib/forms/hr-approval-rules";

import { cardPayrollAmount } from "@/lib/forms/card-payroll-amount";
import { teamTopicReadConversation } from "@/lib/forms/team-card-not-product";
import { sameRequestReadConversation } from "@/lib/forms/same-request-other-person";
import { switchReadConversation } from "@/lib/ai/form-type-switch";
import { typoReadingTurns } from "@/lib/ai/typo-reading-copy";
import { protectedNameWords } from "@/lib/ai/typo-name-words";
import { salonById } from "@/data/salons";

import { historyWantsSeparateDocument } from "@/lib/ai/second-form";
import { errorResponse } from "@/lib/api/respond";
import {
  conversationDraftReuseEnabled,
  draftReuseSameChatOnlyEnabled,
  draftReuseOwnOnlyEnabled,
  conversationProposalDedupeEnabled,
  draftActionsEnabled,
  draftDedupeEnabled,
  payrollAmountFieldEnabled,
  typoReadingRoutesEnabled,
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
import { actorMaySeeInstance, instanceListFilterFor, visibleInstances } from "@/lib/forms/instance-scope";
import { privateAwareLimit, privateCreatorsActive } from "@/lib/forms/private-creators";
import { historySaysDifferentIncident } from "@/lib/forms/draft-actions";
import { findOpenIncidentDraft, findResentDraft } from "@/lib/forms/draft-reopen";
import type { SameChat } from "@/lib/forms/draft-same-chat";
import { authorizeLocation } from "@/lib/forms/location-scope";
import { TERMINATION_OPTION, statesTermination } from "@/lib/forms/termination-stated";
import { saysTerminationWord } from "@/lib/forms/termination-word";
import { EXIT_DETAIL_FIELDS, EXIT_NOTICE_GROUP, EXIT_OPTION, EXIT_TEMPLATE_KEY, EXIT_TYPE_GROUP } from "@/lib/forms/exit-library";
import { exitReasonOnly } from "@/lib/forms/exit-reason-only";

/** The resignation types a loop exit card may carry (never the involuntary box). */
const LOOP_EXIT_HOW = new Set<string>([EXIT_OPTION.submittedFulfilledNotice, EXIT_OPTION.immediateVoluntary, EXIT_OPTION.noticeNotFulfilled, EXIT_OPTION.noCallNoShow]);

/** The checkbox group that holds this option on the draft's own template version, or null when it is not on it. */
async function exitOptionGroup(instanceId: string, option: string): Promise<string | null> {
  const loaded = await loadInstance(instanceId).catch(() => null);
  if (!loaded) return null;
  const { checkboxGroupsForVariant, parseFormDocument } = await import("@/lib/forms/document");
  return checkboxGroupsForVariant(parseFormDocument(loaded.version.document), loaded.instance.variantKey).find((group) => group.options.some((candidate) => candidate.key === option))?.key ?? null;
}
/** The exit form's Additional Details line (`exit-library.ts`). */
const EXIT_ADDITIONAL_DETAILS_KEY = "details";
/** QA item 17: the exit form's own payroll question (`exit-library.ts`, EXIT_YES_NO_QUESTIONS). */
const EXIT_PAYROLL_KEY = "payroll_deduction_applicable";
/** The exit form's rehire question (`exit-library.ts`, EXIT_YES_NO_QUESTIONS). */
const EXIT_REHIRE_KEY = "eligible_for_rehire";
import { terminationStatedTicksEnabled } from "@/lib/config/chat-quality-flags";
import { checkProposalIsCurrent } from "@/lib/forms/proposal-currency";
import { preferredNamesOf } from "@/lib/forms/preferred-name-current";
import { looseRosterFor } from "@/lib/forms/loose-name";
import { rosterNamesFor } from "@/lib/forms/roster-names";
import { allowsTeamSubject, isTeamSubject } from "@/lib/forms/team-subject";
import { isDemoMode } from "@/lib/config/runtime";
import { getTemplateByKey } from "@/lib/forms/repository";
import { applyLoopFollowUpDefault } from "@/lib/forms/follow-up-default-write";
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
    // PRIVATE_CREATOR_FORMS: over-read, then trim to the default page of 200; off, as before.
    const instances = visibleInstances(
      actor,
      await listInstances(view, privateCreatorsActive() ? privateAwareLimit(200) : undefined, instanceListFilterFor(actor)),
    ).slice(0, 200);

    // The sweep's shape is returned alongside so the screen can say "Delete 5
    // demo forms" with a real number rather than counting what it happens to
    // be showing — the active list is filtered, and a count taken from it
    // would be wrong the moment somebody switches to Archived.
    //
    // Scoped by the same rule: a count of forms the caller may not see would
    // offer a "Delete 5" that removed nothing, and would leak how many exist.
    const sweep = await findDemoInstances();
    return NextResponse.json({
      // The approval columns only for those who may read HR's decision (owner, 23 Nov 2026: no leaks).
      instances: instances.map((instance) => redactHrApproval(actor, instance)),
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
      /** The agent loop's card: its termination is the model's, locked; today's reader never decides it. */
      fromAgentLoop?: unknown;
      /** QA item 17: the loop termination's account (the exit form's reason line). */
      loopAccount?: unknown;
      /** The loop's exit card: how the person left (a resignation_type option) and the manager's words for it. */
      exitHow?: unknown;
      exitHowQuote?: unknown;
      /** The loop's exit card: How Employee Resigned and the manager's words for it (port from Ask Bubbles #1021, U26). */
      exitMethod?: unknown;
      exitMethodQuote?: unknown;
      /** The loop's exit card: Reason for Resignation in the manager's words, and their quote (port of Ask Bubbles #1047, B6). */
      exitReason?: unknown;
      exitReasonQuote?: unknown;
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
      // PREFERRED_NAME_CARD_CURRENT_ENABLED: "kit dovetail" is the card's Katrin Dovetail when the manager's roster says Kit is her preferred name. Off: none, and no roster read.
      const alsoCalled = await preferredNamesOf(actor.scope, body.employeeName);
      /*
       * QA (17 Nov 2026; Runner 2's saved-form run on 33863575: c003, c039, c134, c210, c220, c232): the agent loop's own card
       * is read with the loop's record for it (this proposal id, this name): the turns after the card's own turn, which the
       * loop already read with its evidence checks, and the names the loop settled as its person. Never for a card the loop
       * has no record of. See `lib/ai/agent-loop/settled-names.ts`.
       */
      const settledNames = body.fromAgentLoop === true && typeof body.proposalId === "string"
        ? await import("@/lib/ai/agent-loop/settled-names")
        : null;
      const settlement = settledNames
        ? await settledNames.loopCardSettlement({
            conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
            userId: actor.id,
            messageIds: (body.conversation as { id?: unknown; role?: unknown }[]).filter((turn) => turn?.role === "user" && typeof turn.id === "string").map((turn) => String(turn.id)),
            proposalId: String(body.proposalId),
            employeeName: body.employeeName,
          })
        : null;
      const history = parseHistory(body.conversation);
      const readFrom = settledNames && settlement ? [...settledNames.turnsAfterCard(history, settlement)] : history;
      const currency = checkProposalIsCurrent({
        // FORM_TYPE_SWITCH_ENABLED: "change to coaching" is read as the chat read it, so the switched card is current.
        // TEAM_CARD_NOT_PRODUCT_ENABLED: on the team card, "selling Spray Tan Kits" is the topic, as the chat read it.
        // SAME_REQUEST_OTHER_PERSON_ENABLED: "the same thing for <B>" is read from that turn on, as the chat read it.
        // SAME_REQUEST_KEEPS_EARLIER_CARD_ENABLED: <A>'s card is read as it stood before "the same thing for <B>".
        conversation: sameRequestReadConversation(teamTopicReadConversation(switchReadConversation(readFrom), body.employeeName), body.employeeName),
        templateKey: body.templateKey,
        employeeName: body.employeeName,
        alsoCalled,
        // PARTIAL_NAME_LOOSE_MATCH_ENABLED: "marisol co" is the card's Marisol Camarillo when nobody else on the roster fits. Off: undefined, no roster read.
        looseRoster: await looseRosterFor(actor.scope),
        // STALE_NEEDS_ROSTER_PERSON_ENABLED: "drop wage" and "forfeit bonus" are not more people. Off: undefined, and no roster read.
        rosterNames: await rosterNamesFor(actor.scope),
        ...(settlement ? { isSettledName: settlement.isSettledName } : {}),
      });
      if (!currency.current) {
        return NextResponse.json({ error: currency.reason, code: "proposal_superseded" }, { status: 409 });
      }
      /*
       * THE LAST GATE FOR THE SAME INCIDENT (QA's live check on the sibling app, 24 Nov 2026: "create a verbal CA for <P>
       * with all the same information given" put up a second CA with no date on the card, so the agent loop had nothing to
       * compare). A Corrective Action or Coaching card the loop made is held here when this person (by name, as the card
       * names them) already has that form on file for the date the form will be saved with (a form filed since the card
       * was made counts), unless the manager said that date is a separate incident (the loop's record). The reply's own
       * question.
       */
      const { appConfig } = await import("@/lib/ai/agent-loop/app-config");
      const sameDayKinds = new Set([appConfig().formKeys.corrective, appConfig().formKeys.coaching]);
      const saveDate = isIsoCalendarDate(body.formDate) ? body.formDate : businessToday();
      if (settlement && sameDayKinds.has(body.templateKey) && settlement.sameIncidentChecked !== saveDate) {
        const [{ formsOnFileSameDay, sameDayOnFileQuestion }, { candidateNameWords }, { samePerson }] = await Promise.all([
          import("@/lib/forms/same-incident"),
          import("@/lib/forms/chat-form-records"),
          import("@/lib/forms/proposal"),
        ]);
        const cardName = body.employeeName ?? "";
        const onFile = await formsOnFileSameDay(actor, {
          nameWords: candidateNameWords(cardName),
          isPerson: (name) => samePerson(name, cardName) || settlement.isSettledName(name),
          templateKey: body.templateKey,
          formDate: saveDate,
        });
        if (onFile.length > 0) {
          const first = cardName.trim().split(/\s+/)[0] || cardName;
          return NextResponse.json({ error: sameDayOnFileQuestion(first, template.name, onFile), code: "same_incident_on_file" }, { status: 409 });
        }
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
      if (payrollAmountFieldEnabled() && card.payrollDeduct === "yes" && (card.fromAgentLoop === true || Array.isArray(card.conversation))) {
        /*
         * QA's code audit (20 Nov 2026, item 20): a loop card's amount is the card's own (`card-payroll-amount.ts`),
         * never the chat's latest figure. Every other card reads the conversation, as before.
         */
        const amount =
          card.fromAgentLoop === true
            ? cardPayrollAmount(card.payrollDeductAmount)
            : // TYPO_READING_ROUTES_ENABLED: the reader sees "amont" as amount; the stored conversation stays as typed.
              payrollAmountFromConversation(await readingTurns(parseHistory(card.conversation as unknown[])), { payrollAnswer: "yes" });
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
      /*
       * TERMINATION_STATED_TICKS_ENABLED (Pau's P15 ruling "A", 10 Nov 2026): with no verbal or written stated, a
       * termination the manager STATED for this form in chat ("I need a term CA for …") is ticked as their statement,
       * through the same write as a stated level; the card has said it needs DM/HR approval before it is finalized.
       * Read from the manager's own turns; a hedge ("she might be terminated if this continues") states nothing. Off,
       * `statesTermination` is false.
       */
      /*
       * The agent loop's card (QA's design, 15 Nov 2026; Pau's standing approval): its model decided this form is a
       * termination, and that is accepted only when the conversation's own user turns carry a termination word, checked
       * here, server-side (`saysTerminationWord`). Otherwise today's reader below decides, as before.
       */
      const userTurns = Array.isArray(card.conversation)
        ? (await readingTurns(parseHistory(card.conversation))).filter((turn) => turn.role === "user").map((turn) => String(turn.content)).join("\n")
        : "";
      /* QA's third review: gated by TERMINATION_STATED_TICKS like today's tick; a loop card never runs today's reader. */
      const fromAgentLoop = card.fromAgentLoop === true;
      const loopTermination = card.templateKey === "dpoa" && card.warningLevel === "termination" && terminationStatedTicksEnabled() && saysTerminationWord(userTurns);
      const statedLevel = isStatedWarningLevel(card.warningLevel)
        ? card.warningLevel
        : loopTermination
          ? TERMINATION_OPTION
          : !fromAgentLoop && card.templateKey === "dpoa" &&
            Array.isArray(card.conversation) &&
            statesTermination(
              (await readingTurns(parseHistory(card.conversation)))
                .filter((turn) => turn.role === "user")
                .map((turn) => String(turn.content))
                .join("\n"),
            )
          ? TERMINATION_OPTION
          : null;
      if (statedLevel) {
        await applyStatedFacts(
          instanceId,
          { values: {}, checked: { [WARNING_TYPE_KEY]: [statedLevel] } },
          actor.id,
          WARNING_LEVEL_STATED_KEYS,
        );
      }

      /*
       * QA item 17 (20 Nov 2026; the production audit's exit form, which arrived nearly empty): the agent loop's EXIT card
       * puts what the manager stated in the exit form's own fields, as their statements (the draft never replaces them):
       * its payroll answer in "Is Payroll Deduction applicable?", and a termination the model decided (locked on the
       * termination word, checked again here) as "Immediate involuntary separation" with the account as the reason.
       * `applyStatedFacts` validates every key against the pinned version, so a form without these lines gets nothing.
       */
      if (fromAgentLoop && card.templateKey !== "dpoa") {
        const exitStated: { values: Record<string, string>; checked: Record<string, string[]> } = { values: {}, checked: {} };
        if (isPayrollDeductAnswer(card.payrollDeduct)) exitStated.checked[EXIT_PAYROLL_KEY] = [card.payrollDeduct];
        const account = typeof card.loopAccount === "string" ? card.loopAccount.trim().slice(0, 2_000) : "";
        if (card.warningLevel === "termination" && saysTerminationWord(userTurns)) {
          exitStated.checked[EXIT_TYPE_GROUP] = [EXIT_OPTION.immediateInvoluntary];
          if (account) {
            /* f077 and QA2's R3 (21 Nov 2026): only the reason; a rehire answer in the account is the rehire question's. */
            const { reason, rehire } = exitReasonOnly(account, new Date().toISOString().slice(0, 10));
            exitStated.values[EXIT_DETAIL_FIELDS.resignationReason] = reason;
            if (rehire) exitStated.checked[EXIT_REHIRE_KEY] = [rehire];
            /*
             * QA's live L6 (22 Nov 2026; Pau: saved = card, nothing invented): with nothing stated for Additional Details, the
             * drafting model wrote "The departure was recorded effective 2026-11-21.", words no one said. A termination's
             * Additional Details are the card's account, the manager's own words, as a resignation's already are.
             */
            exitStated.values[EXIT_ADDITIONAL_DETAILS_KEY] = account;
          }
        } else if (account && card.templateKey === EXIT_TEMPLATE_KEY) {
          /*
           * QA (20 Nov 2026, #1138's live test: "final paycheck should deduct the uniform cost"): the exit form has no line
           * for a payroll amount or its reason, so the card's account (the manager's words, the uniform cost and any amount
           * in it) is the form's Additional Details, as their statement (the draft never replaces it).
           */
          exitStated.values[EXIT_ADDITIONAL_DETAILS_KEY] = account;
        }
        /*
         * A real manager's exit form (20 Nov 2026): "immideate volunatary termination" ticked no type. The loop card's
         * exit_how (never the involuntary box) is ticked as the manager's statement only when its quoted words are in this
         * chat's own manager turns, checked here, server-side.
         */
        /*
         * QA's re-run (22 Nov 2026, B6; port of Ask Bubbles #1011): the exit form's own reader ticking a box in EITHER
         * Resignation Details group (one set of boxes, split for the page's layout) is the one decision of how the person
         * left; the card's exit_how is then never added beside it ("Submitted & Fulfilled Notice" with "Did not fulfill …
         * notice").
         */
        const readerTicks = card.templateKey === EXIT_TEMPLATE_KEY
          ? (await (async () => {
              const { readExitFacts, exitFactValues } = await import("@/lib/forms/exit-facts");
              const checked = exitFactValues(readExitFacts(userTurns, new Date().toISOString().slice(0, 10))).checked;
              return [EXIT_TYPE_GROUP, EXIT_NOTICE_GROUP].some((group) => (checked[group] ?? []).length > 0);
            })())
          : false;
        if (card.templateKey === EXIT_TEMPLATE_KEY && card.warningLevel !== "termination" && exitStated.checked[EXIT_TYPE_GROUP] === undefined && exitStated.checked[EXIT_NOTICE_GROUP] === undefined && !readerTicks) {
          const how = typeof card.exitHow === "string" && LOOP_EXIT_HOW.has(card.exitHow) ? card.exitHow : null;
          const flat = (text: string) => text.toLowerCase().replace(/[*_"“”]/g, "").replace(/\s+/g, " ").trim();
          const quote = typeof card.exitHowQuote === "string" ? flat(card.exitHowQuote) : "";
          /* QA (22 Nov 2026, B6 on Sunny): the option goes to its own group on this draft's template version (Submitted & Fulfilled Notice: resignation_notice). */
          const group = how ? await exitOptionGroup(instanceId, how) : null;
          if (how && group && quote !== "" && flat(userTurns).includes(quote)) exitStated.checked[group] = [how];
        }
        /*
         * U26 (QA's Bubbles round 2, 22 Nov 2026): the loop card's How Employee Resigned, written as the manager's statement
         * only on a resignation, when its quote is in this chat's manager turns and names that method (`quoteNamesMethod`).
         */
        if (card.templateKey === EXIT_TEMPLATE_KEY && card.warningLevel !== "termination" && typeof card.exitMethod === "string" && typeof card.exitMethodQuote === "string") {
          const { quoteNamesMethod } = await import("@/lib/forms/exit-details");
          const flat = (text: string) => text.toLowerCase().replace(/[*_"“”]/g, "").replace(/\s+/g, " ").trim();
          if (flat(card.exitMethodQuote) !== "" && flat(userTurns).includes(flat(card.exitMethodQuote)) && quoteNamesMethod(card.exitMethodQuote, card.exitMethod)) {
            exitStated.values[EXIT_DETAIL_FIELDS.resignationMethod] = card.exitMethod;
          }
        }
        /*
         * Port of Ask Bubbles #1047 (B6, its QA's live round 3, 22 Nov 2026): the loop card's Reason for Resignation, written as
         * the manager's statement only on a resignation, when its quote is in this chat's manager turns and holds every word of
         * the reason (`exit-reason-said.ts`).
         */
        if (card.templateKey === EXIT_TEMPLATE_KEY && card.warningLevel !== "termination" && typeof card.exitReason === "string" && typeof card.exitReasonQuote === "string") {
          const { reasonFromQuote } = await import("@/lib/forms/exit-reason-said");
          const flat = (text: string) => text.toLowerCase().replace(/[*_"“”]/g, "").replace(/\s+/g, " ").trim();
          const reason = flat(card.exitReasonQuote) !== "" && flat(userTurns).includes(flat(card.exitReasonQuote)) ? reasonFromQuote(card.exitReason, card.exitReasonQuote) : null;
          if (reason) exitStated.values[EXIT_DETAIL_FIELDS.resignationReason] = reason;
        }
        if (Object.keys(exitStated.checked).length > 0 || Object.keys(exitStated.values).length > 0) {
          await applyStatedFacts(instanceId, exitStated, actor.id, new Set([EXIT_PAYROLL_KEY, EXIT_TYPE_GROUP, EXIT_NOTICE_GROUP, EXIT_DETAIL_FIELDS.resignationReason, EXIT_DETAIL_FIELDS.resignationMethod, EXIT_ADDITIONAL_DETAILS_KEY, EXIT_REHIRE_KEY]));
        }
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
    /*
     * DRAFT_REUSE_SAME_CHAT_ONLY_ENABLED. Every lookup below that hands back
     * an existing draft keeps only a draft this chat made (`sameChat`), the
     * chat's own draft is not reused for a card dated differently, every new
     * chat draft records its chat, and a reuse tells the card the draft's
     * date (`reused`, below). See `draft-same-chat.ts`.
     */
    const sameChatOnly = body.source === "ask_sunny" && draftReuseSameChatOnlyEnabled();
    const chatKey = sameChatOnly
      ? conversationKeyOf({ conversationId: body.conversationId, conversation: body.conversation })
      : null;
    const sameChat: SameChat | undefined = sameChatOnly ? { conversationKey: chatKey } : undefined;
    const cardDate = isIsoCalendarDate(body.formDate) ? body.formDate : null;
    /*
     * DRAFT_REUSE_OWN_ONLY_ENABLED (QA, 25 Oct 2026). On, no lookup below
     * hands this manager a draft another manager made: the finders read only
     * this manager's drafts, and each draft found is checked here again
     * (`mine`). No acting user reuses nothing. Off, `mine` is always true.
     * Opening or editing a named draft through the chat, and DRAFT_MERGE, are
     * not a reuse and are not changed by this.
     */
    const ownOnly = draftReuseOwnOnlyEnabled();
    const mine = (instance: { createdBy?: string | null }) => !ownOnly || (Boolean(actor.id) && instance.createdBy === actor.id);
    const reused = (instance: { formDate?: string | null }) =>
      NextResponse.json({
        instance,
        reused: true,
        ...(sameChatOnly && instance.formDate ? { reusedFrom: instance.formDate } : {}),
      });
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
        ...(sameChatOnly && cardDate ? { formDate: cardDate } : {}),
      }).catch(() => null);
      if (same && mine(same.instance)) {
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
        return reused(updated?.instance ?? same.instance);
      }
    }

    /*
     * SAME EMPLOYEE, SAME TEMPLATE, SAME INCIDENT, ANY CHAT. An open draft is
     * reopened instead of filing another one. A different date or a different
     * account of what happened still creates. Not after "different incident"
     * (`newIncident`, above). With DRAFT_REUSE_OWN_ONLY_ENABLED on, only a
     * draft this manager made is reopened; off, any manager's counts.
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
        ...(sameChat ? { sameChat } : {}),
      }).catch(() => null);
      // Re-checked against the reader, as the sibling app's cross-chat lookup is (leak audit, 23 Nov 2026): a draft they
      // may not see, such as someone else's waiting for HR with the approval flag since turned off, is never handed over.
      if (open && mine(open) && actorMaySeeInstance(actor, open)) return reused(open);
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
      if (existing && mine(existing)) return reused(existing);
    } else if (proposalId) {
      // A guard that cannot read is no guard: the create goes ahead as before.
      const existing = await findRecentAssistantDraft({
        templateKey: body.templateKey,
        employeeName: body.employeeName.trim().slice(0, 120),
        createdBy: actor.id,
        locationId,
        proposalId,
      }).catch(() => null);
      if (existing && mine(existing)) return reused(existing);
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
        ...(sameChat ? { sameChat } : {}),
      }).catch(() => null);
      if (resent && mine(resent)) return reused(resent);
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
    if (instance.reused) return reused(instance);
    if (draftChat) {
      await noteConversationDraft(String(instance.id), draftChat, lastManagerTurnId(chatTurns)).catch(() => undefined);
    } else if (chatKey) {
      // Same chat only: the draft records its chat even with CONVERSATION_DRAFT_REUSE_ENABLED off.
      const turns = Array.isArray(body.conversation) ? parseHistory(body.conversation) : [];
      await noteConversationDraft(String(instance.id), chatKey, lastManagerTurnId(turns)).catch(() => undefined);
    }

    await applyCardFacts(String(instance.id));

    /*
     * Pau (20 Nov 2026): a Corrective Action the agent loop creates gets its follow-up date, the one the manager
     * stated or one week after the form date, so the follow-up its Action Plan promises is on the calendar. The
     * card says it ("Follow-up: Fri, Nov 27 (change it anytime)."). See `follow-up-default.ts`.
     */
    const followUp = body.fromAgentLoop === true
      ? await applyLoopFollowUpDefault({
          instance: { ...instance, id: String(instance.id) },
          managerWords: Array.isArray(body.conversation)
            ? parseHistory(body.conversation).filter((turn) => turn.role === "user").map((turn) => String(turn.content)).join("\n")
            : "",
          actorId: actor.id,
        }).catch(() => null)
      : null;

    return NextResponse.json({
      instance: followUp ? { ...instance, followUpDate: followUp.date } : instance,
      ...(followUp ? { followUpNotice: followUp.notice } : {}),
    });
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
    const actor = await authorizeForms(request, "manage_form_records");
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

    const result = await deleteDemoInstances(expected, { id: actor.id, role: actor.role, via: "demo_sweep" });
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

/**
 * TYPO_READING_ROUTES_ENABLED: the manager's turns as the payroll-amount reader
 * above sees them, each typo read as the one known word it can only be
 * (`ai/typo-reading-copy.ts`). Only that reader gets it; the conversation
 * stored and compared elsewhere in this route is the raw one. Off, the turns
 * as given.
 */
async function readingTurns<T extends { role: string; content: string }>(turns: T[]): Promise<T[]> {
  if (!typoReadingRoutesEnabled()) return turns;
  return typoReadingTurns(turns, await protectedNameWords());
}
