import { NextResponse } from "next/server";
import { noteSpendUser } from "@/lib/ai/spend-meter";
import { withSpendMeter } from "@/lib/ai/spend-meter-run";

import { withSwitchAfterCreate } from "@/lib/ai/form-type-switch";
import { withCorrectionNotDropped, withProposalNameCorrection } from "@/lib/forms/proposal-name-correction";
import { enterChatRequestClock } from "@/lib/ai/chat-trace-store";
import { answerQuestion } from "@/lib/ai/server-ask";
import { modelSpendGuard } from "@/lib/ai/spend-guard";
import { isQuestionNotForm } from "@/lib/ai/question-not-form";
import { wantsSeparateDocument } from "@/lib/ai/second-form";
import { emptyReplyError, isEmptyReply } from "@/lib/ai/empty-reply";
import {
  chatLongMessageEnabled,
  draftActionsEnabled,
  formEditHonestReplyEnabled,
  claimGuardEnabled,
  nameCorrectionWordsEnabled,
  listPolicyIsEditEnabled,
  policyChangeRestOfTurnEnabled,
  openFormNoSelectionEnabled,
  personGuardEnabled,
  missedShiftCitesAttendanceEnabled,
  possessivePlaceNotPersonEnabled,
  groupWordsNotANameEnabled,
  formNameFromRosterEnabled,
  offRosterConfirmEnabled,
  exitLetterAddresseeEnabled,
  letterGreetingNotNameEnabled,
  templateOutlineFieldsEnabled,
  exitFormDateFromTerminationEnabled,
  offRosterAskBeforeCardEnabled,
  metricGuardEnabled,
  refusalNoRepeatEnabled,
  titleNotSpeakersManagerEnabled,
  newRequestOwnTurnsEnabled,
  formEditPlainWordsEnabled,
  makeThatUpdateAccountEnabled,
  questionNotFormEnabled,
  sameFormCopyEnabled,
  sameFormCopyNewPersonEnabled,
  teamCardNotProductEnabled,
  sameRequestOtherPersonEnabled,
  copyOwnSalonEnabled,
  secondFormEnabled,
  emptyReplyGuardEnabled,
  staffPickerBareAnswerEnabled,
  wholeTeamCoachingEnabled,
  addressNotPersonEnabled,
  sameAskNoRepeatEnabled,
  newRequestOpenDraftEnabled,
  coachingForEveryoneEnabled,
  staffPickerEnabled,
  chatResponseStreamEnabled,
  formPatchReducerEnabled,
  formPatchReaderFixesEnabled,
  formReplyFromDiffEnabled,
  formEditToolInStreamEnabled,
  formEditNoopGuardEnabled,
  reopenByAnyOpenVerbEnabled,
  twoFormsCardNotAskedEnabled,
  secondRequestOwnAccountEnabled,
  nearMissQuestionRulesEnabled,
  formNameOffRosterAskEnabled,
  whatHappenedNoCreateEnabled,
} from "@/lib/config/chat-quality-flags";
import { streamWhenSlow } from "@/lib/api/streamed-response";
import { finalReplyWithoutMarkers } from "@/lib/ai/source-note";
import {
  assertLiveMode,
  assertNoConfigurationProblems,
  assertWithinRateLimit,
  errorResponse,
} from "@/lib/api/respond";
import {
  LIMITS,
  optionalEnum,
  optionalString,
  parseHistory,
  parseJsonBody,
  requireChatQuestion,
  requireString,
} from "@/lib/api/validation";
import { LONG_MESSAGE_LIMIT } from "@/lib/chat/message-limit";
import { authorizeRequest } from "@/lib/auth/server";
import { closeTurn, openTurn } from "@/lib/analytics/record";
import { logTurnEvent } from "@/lib/analytics/telemetry";
import {
  classifyChatTurn,
  classifyTurnKind,
  isActivitySurface,
} from "@/lib/analytics/taxonomy";
import { activeKnowledgeCorpus } from "@/lib/knowledge/corpus";
import { CONTINUATION_KEY_MAX } from "@/lib/forms/proposal-continuation";
import { answersWhichFormOnFile, mayAskToReopen } from "@/lib/forms/reopen-cue";
import { parseChatReportContext } from "@/lib/reporting/read/chat-report-context";
import { businessToday } from "@/lib/business-date";
import { isClientConversationId } from "@/lib/chat/client-ids";
import type { AskRequest, AskResponse } from "@/lib/ai/types";
import type { AnswerMode, ChatMessage } from "@/types";

/**
 * POST /api/chat
 *
 * The only place Claude is ever called. The browser sends a question; this
 * handler retrieves company knowledge, builds the grounding context, calls
 * Claude and maps the result back to an AskResponse with real citations.
 *
 * ANTHROPIC_API_KEY and the Supabase keys are read here, on the server, and never
 * cross the boundary in either direction.
 *
 * Guard order: mode, then configuration, then authorization, then rate limit,
 * then validation. Authorization comes before the rate limit so an unauthorized
 * caller cannot consume another caller's budget, and both come before any work
 * that spends money at an external vendor.
 */
export const runtime = "nodejs";
/*
 * A LONG ANSWER IS NOT CUT OFF AT 30 SECONDS (QA, live, 1 Nov 2026). With no
 * export the platform's default stopped this route at 30 s: in 7 days 10
 * managers got "could not produce an answer" while the answer finished on the
 * server seconds later, paid for and thrown away. The same ceiling the draft
 * route uses; the model calls inside it are bounded on their own.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MODES: AnswerMode[] = ["quick", "standard", "detailed"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SPEND_GUARD_ALL_CALLS_ENABLED: this route's Claude calls are counted (`ai/spend-meter.ts`). Off, as before. */
export async function POST(request: Request) {
  // CHAT_RESPONSE_STREAM_ENABLED: a slow answer is streamed so nothing cuts it off at 30 s. See `api/streamed-response.ts`.
  if (chatResponseStreamEnabled()) return streamWhenSlow(() => withSpendMeter("chat", () => postChat(request)));
  return withSpendMeter("chat", () => postChat(request));
}

async function postChat(request: Request) {
  enterChatRequestClock();
  try {
    assertLiveMode();
    assertNoConfigurationProblems();
    const context = await authorizeRequest(request, "ask_questions");
    noteSpendUser(context.identity.subject);
    assertWithinRateLimit(request, "chat");

    const body = await parseJsonBody<AskRequest>(request);

    const askedAt = Date.now();

    /*
     * =====================================================================
     * THE TURN IS OPENED BEFORE THE MODEL IS CALLED
     * =====================================================================
     *
     * IT USED TO BE RECORDED AFTERWARDS, bounded at 1500ms so a slow write
     * could never delay an answer. That produced the defect this ordering
     * exists to remove: on a cold serverless instance the first Supabase call
     * pays client construction, DNS and TLS before its insert, lost the race,
     * and the route answered with no turn on it — so the feedback control had
     * nothing to attach to and the gate released. A fully working, entirely
     * untracked conversation, on the first question of a session only.
     *
     * Opening first inverts every part of that:
     *
     *   the write's latency lands in the "thinking" phase, ahead of a
     *   multi-second model call, where one cold round trip is invisible
     *
     *   a write that cannot happen refuses the request BEFORE any money is
     *   spent at Anthropic, so nothing is lost — no answer was made
     *
     *   once an answer exists its turn already exists, which turns "a
     *   successful answer with no rateable turn" from a state the code tries
     *   to avoid into one it cannot reach
     *
     * THE CATEGORY HERE IS PROVISIONAL, and honestly so: three of the four
     * rungs of the evidence ladder are facts about the ANSWER, which does not
     * exist yet. What the request already knows — that a report was attached,
     * and the question itself, read transiently — is passed now, and
     * `closeTurn` replaces it once the answer can speak for itself. A turn
     * whose close is lost therefore still carries a reasonable topic rather
     * than `unclassified`.
     *
     * NO TEXT IS PERSISTED, on exactly the terms it was before. The question
     * goes to two classifiers as an argument, is matched against fixed tables
     * in memory, and is discarded when this handler returns. What is written
     * is enum values.
     */
    const surface = isActivitySurface(body.surface) ? body.surface : null;

    const turnId = await openTurn({
      feature: "chat",
      category: classifyChatTurn({
        /* Unknowable before the answer — see above. */
        proposedTemplateKey: null,
        offeredFormChoices: false,
        hadReportContext: body.reportContext !== undefined && body.reportContext !== null,
        citedCategories: [],
        question: body.question ?? null,
      }),
      turnKind: classifyTurnKind(body.question ?? null),
      surface,
      actorId: context.identity.subject,
      actorRole: context.identity.role,
      scope: context.identity.scope,
    });

    /*
     * THE ACTOR TRAVELS SEPARATELY FROM THE BODY, AND THAT SEPARATION IS THE
     * POINT.
     *
     * A form proposal has to know two things a caller must never be able to
     * assert about itself: which role is asking, and which salons they are
     * assigned to. Both come from `authorizeRequest` — a validated session and
     * `app_users` — and neither is read from `body`, which is why they are a
     * second argument rather than two more fields on `AskRequest`.
     */
    /*
     * MODEL_CALL_DAILY_CAP_ENABLED / MONTHLY_BUDGET_GUARD_ENABLED: over a spend
     * limit, one plain sentence and no model call. Before every step below,
     * since each of them can call the model. See `ai/spend-guard.ts`.
     */
    const capped = await modelSpendGuard({ userId: context.identity.subject, role: context.identity.role });
    if (capped) {
      await closeTurn(turnId, { category: "unclassified", succeeded: true, latencyMs: Date.now() - askedAt });
      return NextResponse.json({ ...finalReplyWithoutMarkers(capped), turnId });
    }

    let answer;
    // TEMPLATE_OUTLINE_FIELDS_ENABLED: the parsed turn the closing note reads (never the raw body's question).
    let outlineTurn: { question: string; instanceId: string } | null = null;
    try {
      let asked = parseAskRequest(body);
      if (asked.activeFormInstanceId) outlineTurn = { question: asked.question, instanceId: asked.activeFormInstanceId };
      /*
       * EXIT_LETTER_ADDRESSEE_ENABLED (QA, the live test of rounds 7c and 8, 9 Nov 2026): a letter to the employee,
       * signed "Sincerely,\n<C>\nDistrict Manager", is read without that sign-off in this turn and the manager's
       * earlier ones, so no reader takes the signer as the form's person nor her title (`ai/letter-signer.ts`). The
       * stored messages, and the draft, keep the whole letter.
       */
      /*
       * LETTER_GREETING_NOT_NAME_ENABLED: a letter's "Dear <A>," is read as "<A>," — the salutation is no part of the
       * name (`ai/letter-signer.ts`), so the roster finds <A>. The stored messages, and the draft, keep the letter.
       */
      if (exitLetterAddresseeEnabled() || letterGreetingNotNameEnabled()) {
        const { withoutLetterGreeting, withoutLetterSigner } = await import("@/lib/ai/letter-signer");
        const read = (text: string) => {
          const greeted = withoutLetterGreeting(text);
          return exitLetterAddresseeEnabled() ? withoutLetterSigner({ question: greeted }) : greeted;
        };
        asked = {
          ...asked,
          question: read(asked.question),
          history: asked.history.map((turn) => (turn.role === "user" && typeof turn.content === "string" ? { ...turn, content: read(turn.content) } : turn)),
        };
      }
      /*
       * OFF_ROSTER_CONFIRM_ENABLED: "use <name>" (or "yes") to the offer for a person not in Woven is read as the
       * manager's turn that typed the name, and the name is kept on the card as typed (`forms/off-roster-confirm.ts`).
       */
      if (offRosterConfirmEnabled()) {
        const taken = (await import("@/lib/forms/off-roster-confirm")).withOffRosterAnswer(asked);
        if (taken) {
          asked = taken.request;
          (await import("@/lib/forms/off-roster-store")).enterAcceptedOffRoster(taken.accepted);
        }
      }
      /*
       * SAME_FORM_COPY_NEW_PERSON_ENABLED: "can you create the same draft that
       * we did with <C> by changing the name and position?" with <C>'s own form
       * open — asked who the new form is for, nothing written, no card. The
       * turn after it that names one roster person is read as the request for
       * that person's form, and the card carries the form to copy from. See
       * `lib/forms/same-form-copy.ts`.
       */
      const newPersonCopy =
        sameFormCopyEnabled() && sameFormCopyNewPersonEnabled()
          ? await (await import("@/lib/forms/same-form-copy")).newPersonCopyTurn({
              request,
              question: asked.question,
              activeInstanceId: asked.activeFormInstanceId,
              pendingFromInstanceId: asked.pendingCopyFromInstanceId,
            })
          : null;
      if (newPersonCopy && "answer" in newPersonCopy) {
        await closeTurn(turnId, { category: "unclassified", succeeded: true, latencyMs: Date.now() - askedAt });
        return NextResponse.json({ ...finalReplyWithoutMarkers(newPersonCopy.answer), turnId });
      }
      if (newPersonCopy) {
        asked = {
          ...asked,
          question: newPersonCopy.question,
          activeFormInstanceId: undefined,
          continueProposalTemplateKey: newPersonCopy.source.templateKey,
        };
      }
      /*
       * SAME_REQUEST_OTHER_PERSON_ENABLED: "do the same thing for <B> but switch it to a written" / "also make a
       * coaching form for <B>" with <A>'s card on screen or <A>'s form open — answered as a new request for <B>,
       * without <A>'s card, open form or request turns (`lib/forms/same-request-other-person.ts`).
       */
      let sameRequestOther: import("@/lib/forms/same-request-other-person").SameRequestTurn | null = null;
      const sameRequest = sameRequestOtherPersonEnabled() && !newPersonCopy ? await import("@/lib/forms/same-request-other-person") : null;
      // Only a turn of that shape reads the roster, and never for long (`sameRequestKind` leaves "the same coaching form for <B>" to the copy path).
      if (sameRequest && sameRequest.sameRequestKind(asked.question)) {
        const { sameRequestForOtherPerson } = sameRequest;
        const { loadScopedRoster } = await import("@/lib/forms/employee-roster");
        const roster = await Promise.race([
          loadScopedRoster(context.identity.scope).catch(() => []),
          new Promise<[]>((resolve) => setTimeout(() => resolve([]), 1_500)),
        ]);
        const other = sameRequestForOtherPerson({
          question: asked.question,
          history: asked.history,
          roster,
          continueTemplateKey: asked.continueProposalTemplateKey,
          formOpen: Boolean(asked.activeFormInstanceId),
        });
        if (other) {
          sameRequestOther = other;
          asked = {
            ...asked,
            question: other.question,
            history: asked.history.slice(0, other.historyBefore),
            activeFormInstanceId: undefined,
            continueProposalTemplateKey: undefined,
          };
        }
      }
      // FORM_NAME_FROM_ROSTER_ENABLED, part 2: every name reader of the turn reads this message's request slot (`lib/forms/request-slot.ts`).
      if (formNameFromRosterEnabled()) (await import("@/lib/forms/request-message-store")).enterRequestMessage(asked.question);
      // METRIC_GUARD_ENABLED, FORM_NAME off: only the metric guards read the message (`request-slot.ts` metricMessage).
      else if (metricGuardEnabled()) (await import("@/lib/forms/request-message-store")).enterMetricMessage(asked.question);
      // SECOND_REQUEST_OWN_ACCOUNT_ENABLED: the app's reply before this turn, so the answer to its own question continues
      // the same request (`lib/ai/form-state.ts` stateForTurn). After the FORM_NAME / METRIC_GUARD pair, never between it.
      if (secondRequestOwnAccountEnabled()) {
        const reply = [...asked.history].reverse().find((turn) => turn.role === "assistant");
        if (reply) (await import("@/lib/forms/last-reply-store")).enterLastReply(String(reply.content ?? ""));
      }
      // NEAR_MISS_QUESTION_RULES_ENABLED (after the FORM_NAME / METRIC_GUARD pair above, never between them — the sibling
      // app's round-6 gate, 8 Nov 2026: there it took that `else` and the metric guards stopped reading the message): the card on screen, so a near-miss never replaces it (`lib/forms/near-miss-question-rules.ts`).
      if (nearMissQuestionRulesEnabled()) {
        const onScreen = (await import("@/lib/forms/near-miss-question-rules")).cardEmployee(asked);
        if (onScreen) (await import("@/lib/forms/request-message-store")).enterCardOnScreen(onScreen);
      }
      /*
       * PERSON_GUARD_ENABLED: the actor's roster, for the rule that somebody on
       * it is always a person. One directory read per turn, only with the flag
       * on. See `lib/forms/person-guard.ts`.
       */
      if (personGuardEnabled()) {
        const [{ loadScopedRoster }, { enterPersonRoster }] = await Promise.all([
          import("@/lib/forms/employee-roster"),
          import("@/lib/forms/person-roster-store"),
        ]);
        // Never holds the turn up: no roster in 1.5 s and the guard runs without it.
        const roster = await Promise.race([
          loadScopedRoster(context.identity.scope).catch(() => []),
          new Promise<[]>((resolve) => setTimeout(() => resolve([]), 1_500)),
        ]);
        const names = roster.map((person) => `${person.preferredFirstName?.trim() || person.firstName} ${person.lastName}`);
        // FORM_NAME_FROM_ROSTER_ENABLED: a person with a preferred name is also known by the legal one.
        // OFF_ROSTER_ASK_BEFORE_CARD_ENABLED too (the switch-on, 9 Nov 2026; found by the sibling app's gate): a roster
        // person typed by the legal name was asked about as a name not on the roster (`lib/forms/off-roster-ask.ts`).
        if (formNameFromRosterEnabled() || offRosterAskBeforeCardEnabled()) {
          for (const person of roster) {
            if (person.preferredFirstName?.trim() && person.preferredFirstName.trim() !== person.firstName.trim()) {
              names.push(`${person.firstName} ${person.lastName}`);
            }
          }
        }
        enterPersonRoster(names);
        // FORM_NAME_OFF_ROSTER_ASK_ENABLED: the scope's level, so a name not on the roster is held for a salon manager only (`lib/forms/roster-scope.ts`).
        // The manager's own turns too, so a full name typed on an earlier turn is still the manager's (QA's #741 eval, g1–g6).
        if (formNameOffRosterAskEnabled()) {
          const managerTurns = [...asked.history.filter((turn) => turn.role === "user").map((turn) => String(turn.content ?? "")), asked.question];
          (await import("@/lib/forms/person-roster-store")).enterRosterScope(context.identity.scope?.level ?? "", managerTurns);
        }
        /*
         * FORM_NAME_FROM_ROSTER_ENABLED: does this message name somebody on the
         * roster (exact or close, or a roster first name typed in lowercase)?
         * Every name reader of the turn reads the same answer — the intent
         * slots read the employee before the card is proposed.
         */
        if (formNameFromRosterEnabled() && roster.length > 0) {
          const { enterRosterAnchor, messageAnchoredOnRoster } = await import("@/lib/forms/roster-anchor-store");
          enterRosterAnchor(messageAnchoredOnRoster(asked.question, roster));
        }
      }
      /*
       * "DELETE THAT DRAFT", "SAME INCIDENT" (QA F8). Ahead of every open-form
       * path: the revision path read "delete that draft" as a change and said
       * "I haven't changed…". Deletes a draft only under the forms API's own
       * DELETE rules; "same incident" opens the form on file; "different
       * incident" is asked as a new form for that person. Null for anything
       * else, and off unless DRAFT_ACTIONS_ENABLED. See
       * `lib/forms/chat-draft-actions.ts`.
       */
      const draftAction = draftActionsEnabled()
        ? await (await import("@/lib/forms/chat-draft-actions")).draftActionForTurn({
            request,
            question: asked.question,
            history: asked.history,
            today: asked.context.todayIso,
            activeInstanceId: asked.activeFormInstanceId,
            continuingTemplateKey: asked.continueProposalTemplateKey,
          })
        : null;
      /*
       * STAFF_PICKER_ENABLED: "a coaching form for my whole staff" — no card
       * for everyone: which salon, then its staff by name and position, then
       * one person at a time. No model call. See `lib/forms/staff-picker.ts`.
       */
      // STAFF_PICKER_BARE_ANSWER_ENABLED: with a draft open, only a turn that is nothing but "for whole staff".
      const bareWholeStaff =
        staffPickerBareAnswerEnabled() &&
        Boolean(asked.activeFormInstanceId) &&
        (await import("@/lib/forms/staff-picker")).isBareWholeStaff(asked.question);
      // WHOLE_TEAM_COACHING_ENABLED: "earlier you made a coaching form for all team members" is about the past — what to do, not a refusal.
      const pastTeam =
        wholeTeamCoachingEnabled() && !draftAction && (await import("@/lib/forms/whole-team-coaching")).pastTeamStatement(asked.question)
          ? (await import("@/lib/forms/staff-picker")).staffPickerAnswer((await import("@/lib/forms/whole-team-coaching")).pastTeamReply())
          : null;
      /*
       * COACHING_FOR_EVERYONE_ENABLED: "create this coaching form for everyone
       * on my team", with a Coaching draft open — one confirmation listing
       * who, then one draft each. No model call. See
       * `lib/forms/coaching-for-everyone.ts`.
       */
      const everyone =
        coachingForEveryoneEnabled() && !draftAction
          ? await (await import("@/lib/forms/coaching-for-everyone")).coachingForEveryoneTurn({
              request,
              question: asked.question,
              history: asked.history,
              activeInstanceId: asked.activeFormInstanceId,
            })
          : null;
      const staffPick =
        everyone ??
        pastTeam ??
        // Never with a draft open: there a turn is about that draft (independent review, 31 Oct 2026).
        (staffPickerEnabled() && !draftAction && (!asked.activeFormInstanceId || bareWholeStaff)
          ? await (await import("@/lib/forms/staff-picker")).staffPickerTurn({
              question: asked.question,
              history: asked.history,
              continuing: Boolean(asked.continueProposalTemplateKey) || bareWholeStaff,
              templateKey: asked.continueProposalTemplateKey ?? null,
              scope: context.identity.scope,
              role: context.identity.role,
            })
          : null);
      const draftAnswer = (draftAction && "answer" in draftAction ? draftAction.answer : null) ?? staffPick;
      /*
       * Either way the open form is not corrected or revised by this turn: it
       * was answered above, or a new incident is a new form.
       */
      // FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED: "change to coaching" after the form was created starts the other form; the created one is left as it is.
      /*
       * WHOLE_TEAM_COACHING_ENABLED: a whole-team coaching request is the team
       * card, the same with or without a draft open — handed to the intake as
       * a request of its own, with the salon already named. See
       * `lib/forms/whole-team-coaching.ts`.
       */
      const team =
        wholeTeamCoachingEnabled() && !draftAction && !staffPick
          ? await (async () => {
              const wtc = await import("@/lib/forms/whole-team-coaching");
              const staff = await import("@/lib/forms/staff-picker");
              const open =
                asked.activeFormInstanceId && staff.isBareWholeStaff(asked.question)
                  ? await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, asked.activeFormInstanceId)
                  : null;
              return wtc.wholeTeamRequest({
                question: asked.question,
                history: asked.history,
                continuingTemplateKey: asked.continueProposalTemplateKey,
                openTemplateName: open?.templateName ?? null,
                draftOpen: Boolean(asked.activeFormInstanceId),
              });
            })()
          : null;
      /*
       * NEW_REQUEST_OPEN_DRAFT_ENABLED: with her draft open, "make me a CA for
       * <her> for <a new incident>" is a new card — never written into the open
       * draft (QA live check, 3 Nov 2026). See `lib/forms/new-request-open-draft.ts`.
       */
      const newRequestOpen =
        !draftAction && !staffPick && !team && asked.activeFormInstanceId && newRequestOpenDraftEnabled()
          ? (await import("@/lib/forms/new-request-open-draft")).newRequestForOpenDraft({
              question: asked.question,
              history: asked.history,
              employeeName: (await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, asked.activeFormInstanceId))
                ?.employeeName,
            })
          : false;
      // PROPOSAL_NAME_CORRECTION_ENABLED: "fix her last name …" on a card not yet created. See `lib/forms/proposal-name-correction.ts`.
      /*
       * MAKE_THAT_UPDATE_ACCOUNT_ENABLED: "make that update" after a reply that offered nothing is her own account, as
       * every reader of the open draft (Step B's patch reading included) reads it. See `lib/forms/form-content-turn.ts`.
       */
      if (makeThatUpdateAccountEnabled() && asked.activeFormInstanceId) {
        const content = await import("@/lib/forms/form-content-turn");
        const open = await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, asked.activeFormInstanceId).catch(() => null);
        const withAccount = open ? content.makeThatUpdateWithAccount({ question: asked.question, history: asked.history, employeeName: open.employeeName }) : null;
        if (withAccount) asked = { ...asked, question: withAccount };
      }
      const parsed = withProposalNameCorrection(withSwitchAfterCreate(
        draftAction || staffPick || newRequestOpen
          ? {
              ...asked,
              ...(draftAction && "question" in draftAction ? { question: draftAction.question } : {}),
              activeFormInstanceId: undefined,
            }
          : team
            ? {
                ...asked,
                question: team.question,
                history: team.history,
                activeFormInstanceId: undefined,
                continueProposalTemplateKey: undefined,
              }
            : asked,
      ));
      /*
       * A CORRECTION TO A FORM THIS CONVERSATION ALREADY CREATED — "change her
       * new location to salon 24". Tried first, and only where the browser
       * named such a form; `correctActiveForm` re-authorizes the instance and
       * returns null for anything that is not a correction, so every other
       * turn is answered exactly as before. Imported on demand: a turn that
       * names no created form does not pay to load the forms write path.
       */
      /*
       * A QUESTION IS ANSWERED, NEVER WRITTEN INTO THE OPEN FORM ("what policy
       * does that fall under?"). It skips the correction, policy, redraft and
       * revision paths below; the answer still knows the form is open. See
       * `lib/ai/question-not-form.ts`. Behind QUESTION_NOT_FORM_ENABLED.
       */
      // LIST_POLICY_IS_EDIT_ENABLED: "please list the policy" with a form open is an edit (EDIT_POLICY_ASK), never a question.
      const listPolicyEdit =
        listPolicyIsEditEnabled() && (await import("@/lib/ai/list-policy-ask")).listPolicyIsEdit(parsed.question, Boolean(parsed.activeFormInstanceId));
      const askedQuestion = !listPolicyEdit && questionNotFormEnabled() && isQuestionNotForm(parsed.question, parsed.history);
      /*
       * STEP B (FORM_PATCH_REDUCER_ENABLED + FORM_REPLY_FROM_DIFF_ENABLED): the
       * open form as saved before this turn, so the reply about it can come
       * from what really changed. See `lib/forms/form-snapshot.ts`.
       */
      const formBefore =
        formPatchReducerEnabled() && formReplyFromDiffEnabled() && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/form-snapshot")).snapshotForm(parsed.activeFormInstanceId, request)
          : null;
      // NAME_CORRECTION_WORDS_ENABLED: the open draft, for "fix her last name …". See `lib/forms/name-correction-words.ts`.
      const nameFix =
        nameCorrectionWordsEnabled() && parsed.activeFormInstanceId
          ? await (async () => {
              const open = await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, parsed.activeFormInstanceId!);
              const question = (await import("@/lib/forms/name-correction-words")).nameCorrectionQuestion(parsed.question, open?.employeeName ?? null);
              return question && open ? { question, open } : null;
            })()
          : null;
      /*
       * FORM_PATCH_READER_FIXES_ENABLED (QA's latency ask, 7 Nov 2026): the Step B reading is started now, so
       * its model call runs while the steps below do; the patch turn takes it only if its input is the same.
       * A name correction the app's own reader recognised ("fix her last name, it is …") goes to the
       * correction path without a reading (QA's re-run: those turns paid for both).
       */
      if (formPatchReaderFixesEnabled() && !formEditToolInStreamEnabled() && !askedQuestion && !nameFix && parsed.activeFormInstanceId) {
        (await import("@/lib/forms/form-patch-turn")).startPatchReading({
          request,
          instanceId: parsed.activeFormInstanceId,
          question: parsed.question,
          history: parsed.history,
          today: parsed.context.todayIso,
        });
      }
      const correction = parsed.activeFormInstanceId && !askedQuestion
        ? await (await import("@/lib/forms/chat-correction")).correctActiveForm({
            request,
            instanceId: parsed.activeFormInstanceId,
            // NAME_CORRECTION_WORDS_ENABLED: "fix her last name …" is read as "change her name to …". See `lib/forms/name-correction-words.ts`.
            question: nameFix?.question ?? parsed.question,
            today: parsed.context.todayIso,
            history: parsed.history,
          })
        : null;
      /*
       * "ADD THE LATE OPENING POLICY TO THIS FORM" — a manual section named,
       * added, swapped or removed on the Direct policy line of the form that
       * is open. The manual's own words, found by its own heading; no model
       * writes them. Null for anything else. See `lib/forms/chat-policy-change.ts`.
       */
      const policyChangeOnly =
        !correction && !askedQuestion && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/chat-policy-change")).changeActiveFormPolicy({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
            })
          : null;
      // POLICY_CHANGE_REST_OF_TURN_ENABLED: the rest of the same message is not dropped. See `lib/forms/policy-rest-of-turn.ts`.
      const policyChange =
        policyChangeOnly && policyChangeRestOfTurnEnabled()
          ? await (await import("@/lib/forms/policy-rest-of-turn")).withRestOfPolicyTurn({
              request,
              policyChange: policyChangeOnly,
              question: parsed.question,
              history: parsed.history,
              today: parsed.context.todayIso,
            })
          : policyChangeOnly;
      /*
       * "HERE'S WHAT HAPPENED" after a Corrective Action Form was created from
       * a name alone — the form on screen is redrafted from it, citation
       * included. Null for anything else. See `lib/forms/chat-redraft.ts`.
       *
       * BEFORE THE REVISION: it answers only where Sunny's draft wrote nothing,
       * and there a whole draft from the account — citation and all — is what
       * the manager needs, not one field revised in place.
       */
      /*
       * FORM_EDIT_TOOL_IN_STREAM_ENABLED (Step 3, ported from Ask Bubbles
       * c5534279): with a draft open and a turn that is not a correction, a
       * name fix or a policy change (a question too, Pau's ruling A3, ported
       * from Ask Bubbles 899438b5), the ordinary answering call
       * is made HERE, offered the `edit_form` tool. A tool edit that was written
       * is this turn's reply (the saved diff), in the redraft's place so no
       * path below runs; otherwise the paths below run as before and, if none
       * answers, this call's answer is the answer. One model call: nothing is
       * sent back. Off, nothing here runs. See `lib/forms/form-edit-tool.ts`.
       */
      const chatActor = {
        role: context.identity.role,
        scope: context.identity.scope,
        subject: context.identity.subject,
        verified: context.identity.verified,
      };
      const formEditTool =
        formEditToolInStreamEnabled() && !correction && !nameFix && !policyChange && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/form-edit-tool")).prepareFormEditTool({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
              today: parsed.context.todayIso,
              /*
               * Pau's ruling A3 (4 Nov 2026): offered on any turn with a draft
               * open, question-phrased turns included. The existing question
               * reading goes into the trace only; it no longer decides the offer.
               */
              gate: (await import("@/lib/ai/question-not-form")).readQuestion(parsed.question, parsed.history),
              scope: context.identity.scope,
            })
          : null;
      /*
       * FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): on a turn the edit tool is
       * offered, the open form as saved before the tool or the old chain
       * writes, so the reply about it is the saved diff. See
       * `lib/forms/form-noop-reply.ts`.
       */
      const noopBefore =
        formEditNoopGuardEnabled() && formEditTool?.turn.offer
          ? await (await import("@/lib/forms/form-noop-reply")).formBeforeTurn(parsed.activeFormInstanceId!, request)
          : null;
      /*
       * A failed main call (a model or configuration error) is no offer: the
       * paths below answer the turn as with the flag off, and the last
       * fallback makes its own call (classification fix, 4 Nov 2026).
       */
      const toolMain = formEditTool?.turn.offer
        ? await answerQuestion(
            {
              ...parsed,
              openForm: await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, parsed.activeFormInstanceId!),
              formEditTool: formEditTool.turn,
            },
            chatActor,
            { memoryOwnerId: context.identity.subject },
          ).catch(() => {
            formEditTool.turn.failed();
            return null;
          })
        : null;
      const toolEdit = formEditTool?.edited() ?? null;
      /*
       * FORM_PATCH_REDUCER_ENABLED: the turn on the open draft, read once as a
       * patch and merged by code; the reply is the realized diff. Null — the
       * paths below run as before — for a turn not about this form, a blank
       * Corrective Action Form, or any fallback. See `lib/forms/form-patch-turn.ts`.
       * FORM_EDIT_TOOL_IN_STREAM_ENABLED: skipped; the tool reads the turn instead.
       */
      const patchTurn =
        formPatchReducerEnabled() && !formEditToolInStreamEnabled() && !correction && !askedQuestion && !policyChange && !(formPatchReaderFixesEnabled() && nameFix) && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/form-patch-turn")).patchActiveForm({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
              today: parsed.context.todayIso,
            })
          : null;
      const redraft = toolEdit ?? patchTurn ?? (
        !correction && !askedQuestion && !policyChange && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/chat-redraft")).redraftActiveForm({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
            })
          : null);
      /*
       * "REDRAFT IT WITH THESE CHANGES" on a coaching or Corrective Action form
       * this conversation created — the open record, revised in place, rather
       * than a new form drafted from scratch. Null for anything that is not
       * that, exactly like the correction above. See `lib/forms/chat-revision.ts`.
       */
      /*
       * SAME_FORM_COPY_ENABLED: "create the same draft that we did with <name>"
       * with the other person's draft open — that named form's content, copied
       * onto the open one. Null unless a form of this manager's is named. See
       * `lib/forms/same-form-copy.ts`.
       */
      const sameCopy =
        sameFormCopyEnabled() && !correction && !askedQuestion && !policyChange && !redraft && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/same-form-copy")).copyIntoOpenForm({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
            })
          : null;
      const separateDocument = !sameCopy && secondFormEnabled() && wantsSeparateDocument(parsed.question);
      const askedRevision =
        !sameCopy && !correction && !askedQuestion && !policyChange && !redraft && parsed.activeFormInstanceId && !separateDocument
          ? await (await import("@/lib/forms/chat-revision")).reviseActiveForm({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
              today: parsed.context.todayIso,
            })
          : null;
      /*
       * FORM_EDIT_PLAIN_WORDS_ENABLED: "this is what i am wanting to coach on:
       * …", "make that update", "update the draft with these details" — said
       * for the open Coaching Form in words the revision does not read as an
       * edit. Rewritten into one it does, and revised by the same path. See
       * `lib/forms/form-content-turn.ts`.
       */
      const plainRevision =
        askedRevision ??
        (formEditPlainWordsEnabled() && !sameCopy && !correction && !policyChange && !redraft && !separateDocument && parsed.activeFormInstanceId
          ? await (async () => {
              const open = await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, parsed.activeFormInstanceId!);
              if (!open || open.status !== "draft") return null;
              const content = await import("@/lib/forms/form-content-turn");
              const rewritten = content.formContentRevision({
                question: parsed.question,
                history: parsed.history,
                templateName: open.templateName,
                employeeName: open.employeeName,
              });
              if (!rewritten) return null;
              const revised = await (await import("@/lib/forms/chat-revision")).reviseActiveForm({
                request,
                instanceId: parsed.activeFormInstanceId!,
                question: rewritten.question,
                history: rewritten.history,
                today: parsed.context.todayIso,
              });
              /*
               * Read as content for the form and still nothing written: said
               * so (FORM_EDIT_HONEST_REPLY_ENABLED), never the unrelated
               * ordinary answer the turn would otherwise fall through to.
               */
              if (!revised && formEditHonestReplyEnabled()) {
                return {
                  content: content.notWrittenReply(open.templateName, open.employeeName),
                  citations: [],
                  coverage: "not_applicable" as const,
                  recommendedVideoIds: [],
                };
              }
              return revised;
            })()
          : null);
      /*
       * OPEN_DRAFT_KEEPS_TURNS_ENABLED: with a draft open, a turn about it that
       * no path above read is content for that draft — never a new card. See
       * `lib/forms/open-draft-turn.ts`.
       */
      const revision =
        plainRevision ??
        (!sameCopy && !correction && !askedQuestion && !policyChange && !redraft && !separateDocument && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/open-draft-turn")).openDraftTurn({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
              today: parsed.context.todayIso,
            })
          : null);
      /*
       * AN ORDINARY ANSWER STILL KNOWS THE FORM IS THERE. Without this it was
       * told no card ever comes with an answer, and said "no form has been
       * created yet" beside the draft on screen.
       */
      const openForm =
        !sameCopy && !correction && !policyChange && !redraft && !revision && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, parsed.activeFormInstanceId)
          : null;
      /*
       * "CHANGE EXIT FOR LACEY MORROW" — a form already on file, asked for by
       * name and employee: found among the forms this actor may see and put
       * in the thread, a finalized one as a new draft of it. Null for any
       * sentence that does not ask to edit or see an existing form. See
       * `lib/forms/chat-reopen.ts`.
       */
      const reopened =
        !sameCopy && !draftAnswer && !correction && !policyChange && !redraft && !revision && (mayAskToReopen(parsed.question, reopenByAnyOpenVerbEnabled()) || (reopenByAnyOpenVerbEnabled() && answersWhichFormOnFile(parsed.history)))
          ? await (await import("@/lib/forms/chat-reopen")).reopenRequestedForm({
              request,
              question: parsed.question,
              history: parsed.history,
              today: parsed.context.todayIso,
              activeInstanceId: parsed.activeFormInstanceId,
              continuingTemplateKey: parsed.continueProposalTemplateKey,
              // REOPEN_NOT_OPEN_FORM_ENABLED: the form open when the turn arrived, read only by that flag.
              openWhenAsked: asked.activeFormInstanceId,
            })
          : null;
      let toolNothing: Awaited<ReturnType<typeof answerQuestion>> | null = null;
      answer =
        draftAnswer ??
        correction ??
        // A name correction this form does not take in chat: said plainly, never a model's "updated".
        (nameFix && !correction ? (await import("@/lib/forms/name-correction-words")).nameNotCorrectedReply(nameFix.open) : null) ??
        policyChange ??
        redraft ??
        sameCopy ??
        revision ??
        reopened ??
        // FORM_EDIT_TOOL_IN_STREAM_ENABLED: the tool was called and wrote nothing — said so, never the model's text.
        (toolNothing = formEditTool?.calledWithoutEdit() ? (await import("@/lib/forms/form-edit-tool")).nothingChangedAnswer() : null) ??
        toolMain ??
        (await answerQuestion(
          // FORM_EDIT_TOOL_IN_STREAM_ENABLED: a turn the tool was not offered on carries only its trace (and a failed main call's fallback, no offer).
          { ...parsed, openForm, ...(formEditTool && !formEditTool.turn.offer ? { formEditTool: formEditTool.turn } : {}) },
          {
            role: context.identity.role,
            scope: context.identity.scope,
            subject: context.identity.subject,
            verified: context.identity.verified,
          },
          /*
           * WHOSE EARLIER CONVERSATIONS SUNNY MAY RECALL: the validated
           * session's, and only ever theirs. See `chat/person-memory-store.ts`.
           */
          { memoryOwnerId: context.identity.subject },
        ));
      /*
       * FORM_EDIT_NOOP_GUARD_ENABLED (Step 4): the tool was offered and handed
       * the turn off (not called, refused, or nothing to change) — the old
       * chain's reply about the form is the saved diff, one "Updated:" line
       * per real change, or "I didn't change anything on the form. Tell me
       * which part to change and what it should say." A copy that wrote
       * nothing and claims nothing (its "replace them?") is kept. The tool's
       * own edit is already the diff (`form-edit-tool.ts`).
       */
      const handedOff: AskResponse = answer;
      if (noopBefore && !toolEdit && [redraft, sameCopy, revision, toolNothing].some((path) => path !== null && path === handedOff)) {
        answer = await (await import("@/lib/forms/form-noop-reply")).replyFromSavedDiff({
          request,
          before: noopBefore,
          answer: handedOff,
          keepUnchanged: handedOff === sameCopy && !handedOff.formUpdate,
        });
      }
      /*
       * FORM_REPLY_FROM_DIFF_ENABLED: a correction, policy, redraft, copy or
       * revision reply that claims a change (`formUpdate`) is checked against
       * the saved form, read again. The path's reply is kept, word for word,
       * unless none of the keys it claims changed; then it is replaced by what
       * really changed. No claim, no change to the reply. A patch turn's reply
       * already is the diff. See `checkedClaim` in `lib/forms/form-snapshot.ts`
       * and `docs/step-b-reply-rewrites.md`.
       */
      if (
        formBefore &&
        formReplyFromDiffEnabled() &&
        !draftAnswer &&
        !patchTurn &&
        !toolEdit &&
        [correction, policyChange, redraft, sameCopy, revision].includes(answer) &&
        answer.formUpdate?.instanceId === formBefore.instanceId
      ) {
        const snapshot = await import("@/lib/forms/form-snapshot");
        const formAfter = await snapshot.snapshotForm(formBefore.instanceId, request);
        if (formAfter) answer = snapshot.checkedClaim(answer, formBefore, formAfter);
      }
      // NEW_REQUEST_OWN_TURNS_ENABLED: a new request for the same person is drafted from its own turns. See `lib/forms/new-request-turns.ts`.
      if (newRequestOwnTurnsEnabled() && answer.formProposal) {
        answer = (await import("@/lib/forms/new-request-turns")).withOwnRequestTurns(answer, [
          ...parsed.history,
          { id: parsed.questionMessageId, role: "user", content: asked.question },
        ]);
      }
      // SAME_ASK_NO_REPEAT_ENABLED: a card still waiting never repeats the last reply word for word (`lib/forms/reply-guards.ts`).
      if (sameAskNoRepeatEnabled()) answer = (await import("@/lib/forms/reply-guards")).withoutRepeatedAsk(answer, asked.history);
      // REFUSAL_NO_REPEAT_ENABLED, TITLE_NOT_SPEAKERS_MANAGER_ENABLED: see `lib/forms/reply-guards.ts`.
      if (refusalNoRepeatEnabled() || titleNotSpeakersManagerEnabled()) {
        const guards = await import("@/lib/forms/reply-guards");
        answer = guards.withoutRepeatedRefusal(answer, parsed.history);
        answer = guards.withoutSpeakersManagerTitle(answer, [
          ...parsed.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
          asked.question,
        ]);
      }
      // PERSON_GUARD_ENABLED: whichever reader named the card's employee, a name that is not a person never stays on it.
      // TEAM_CARD_NOT_PRODUCT_ENABLED: a team coaching card's "Spray Tan Kits" is the topic, not a person (`lib/forms/team-card-not-product.ts`).
      if (teamCardNotProductEnabled() && answer.formProposal?.employeeName) {
        const { loadScopedRoster } = await import("@/lib/forms/employee-roster");
        answer = (await import("@/lib/forms/team-card-not-product")).withTeamCardNotProduct(answer, {
          turns: [
            ...parsed.history.filter((turn) => turn.role === "user").map((turn) => ({ id: turn.id, content: String(turn.content ?? "") })),
            { id: parsed.questionMessageId, content: parsed.question },
          ],
          roster: await loadScopedRoster(context.identity.scope).catch(() => []),
        });
      }
      if (personGuardEnabled()) answer = (await import("@/lib/forms/person-guard")).withPersonOnCard(answer);
      // MISSED_SHIFT_CITES_ATTENDANCE_ENABLED: a card whose Policy line is the app's own reading has its Action Plan on that policy (`lib/forms/ca-policy.ts`).
      if (missedShiftCitesAttendanceEnabled()) answer = (await import("@/lib/forms/ca-policy")).withPlanOnReadPolicy(answer);
      // POSSESSIVE_PLACE_NOT_PERSON_ENABLED: "<Name>'s … Plaza" never puts "<Name>" on the card (`lib/forms/possessive-place.ts`).
      if (possessivePlaceNotPersonEnabled()) {
        answer = (await import("@/lib/forms/possessive-place")).withPossessivePlaceNotPerson(answer, [
          ...parsed.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
          asked.question,
        ]);
      }
      // EXIT_FORM_DATE_FROM_TERMINATION_ENABLED: a stated "terminated, effective <date>" dates the exit card (`lib/forms/exit-form-date.ts`).
      if (exitFormDateFromTerminationEnabled()) {
        answer = (await import("@/lib/forms/exit-form-date")).withExitFormDateFromTermination(
          answer,
          [...parsed.history.filter((turn) => turn.role === "user").map((turn) => turn.content), asked.question],
          businessToday(),
        );
      }
      // GROUP_WORDS_NOT_A_NAME_ENABLED: "the same form for multiple employees" asks which employees (`lib/forms/group-words-ask.ts`).
      if (groupWordsNotANameEnabled()) {
        answer = (await import("@/lib/forms/group-words-ask")).withGroupWordsAsk(answer, [
          ...parsed.history.filter((turn) => turn.role === "user").map((turn) => turn.content),
          asked.question,
        ]);
      }
      // PROPOSAL_NAME_CORRECTION_ENABLED: an off-roster "change her name to …" on the card is never kept silently; with the roster, the card stays for the one roster person it can only be, and a typo is never offered as a person.
      answer = withCorrectionNotDropped(answer, parsed);
      // TWO_FORMS_CARD_NOT_ASKED_ENABLED: a card that names its employee is never asked "Which of them … — <that employee> or …?" (`lib/forms/card-not-asked.ts`).
      if (twoFormsCardNotAskedEnabled()) answer = (await import("@/lib/forms/card-not-asked")).withoutWhichAskOnSeatedCard(answer);
      // NEAR_MISS_QUESTION_RULES_ENABLED: "no, …" to "Is this for <name>?" never gets a card for that name.
      if (nearMissQuestionRulesEnabled()) answer = (await import("@/lib/forms/near-miss-question-rules")).withoutTurnedDownName(answer, asked);
      // ADDRESS_NOT_PERSON_ENABLED: "coaching form for 123 Main Street" names an address, not a person (QA, 3 Nov 2026).
      if (addressNotPersonEnabled())
        answer = (await import("@/lib/forms/person-guard")).withAddressNotPerson(
          answer,
          [...asked.history.filter((turn) => turn.role === "user").map((turn) => String(turn.content)), asked.question],
          asked.context.todayIso,
        );
      /*
       * FORM_EDIT_HONEST_REPLY_ENABLED: the ordinary answer, with a form open,
       * changed nothing — so it never says it updated the form. See
       * `honestFormReply` in `lib/forms/form-content-turn.ts`.
       */
      if (
        (formEditHonestReplyEnabled() || claimGuardEnabled()) &&
        parsed.activeFormInstanceId &&
        !draftAnswer && !correction && !policyChange && !redraft && !revision && !reopened &&
        !answer.formUpdate
        // FORM_PATCH_REDUCER_ENABLED: a patch turn's reply is already the realized diff.
        && !patchTurn
      ) {
        const honest = (await import("@/lib/forms/form-content-turn")).honestFormReply(answer.content, formEditPlainWordsEnabled());
        if (honest) answer = { ...answer, content: honest };
      }
      /*
       * OPEN_FORM_NO_SELECTION_ENABLED: with a draft open, no form selection —
       * its heading ("Based on what you've described, I can prepare:") was all
       * the manager saw, under a reply about the open draft.
       */
      if (openFormNoSelectionEnabled() && parsed.activeFormInstanceId && answer.formSelection) {
        const { formSelection: _dropped, ...rest } = answer;
        void _dropped;
        answer = { ...rest, content: rest.content.replace(/\n*Based on what you've described, I can prepare:\s*$/, "").trimEnd() };
      }
      // WHAT_HAPPENED_NO_CREATE_ENABLED: while the reply asks what happened, the card offers no Create (`lib/forms/what-happened-no-create.ts`).
      if (whatHappenedNoCreateEnabled()) answer = (await import("@/lib/forms/what-happened-no-create")).withNoCreateWhileAsking(answer);
      // OFF_ROSTER_ASK_BEFORE_CARD_ENABLED: a salon manager's card for a full name not on their roster is asked about once, before the card (`lib/forms/off-roster-ask.ts`).
      if (offRosterAskBeforeCardEnabled()) {
        answer = (await import("@/lib/forms/off-roster-ask")).withOffRosterAskBeforeCard(answer, { scope: context.identity.scope, history: parsed.history, question: asked.question });
      }
      // SAME_FORM_COPY_NEW_PERSON_ENABLED: the named person's card carries the form to copy from.
      if (newPersonCopy) {
        answer = (await import("@/lib/forms/same-form-copy")).withCopyFrom(answer, newPersonCopy.source, newPersonCopy.name);
      }
      // COPY_OWN_SALON_ENABLED: a card that copies another person's form takes the new person's own salon.
      if (copyOwnSalonEnabled()) answer = await (await import("@/lib/forms/same-form-copy")).withCopyOwnSalon(answer, request, asked.question);
      // SAME_REQUEST_OTHER_PERSON_ENABLED: <B>'s card says what of the earlier request it carries.
      if (sameRequestOther) answer = (await import("@/lib/forms/same-request-other-person")).withSameRequestNote(answer, sameRequestOther);
      /*
       * NEVER A BLANK ANSWER (EMPTY_REPLY_GUARD_ENABLED). An answer with no
       * prose and no card is a failure, said as one: the turn closes as failed
       * below and the thread shows an error card, not an empty bubble.
       */
      if (emptyReplyGuardEnabled() && isEmptyReply(answer)) throw emptyReplyError();
    } catch (error) {
      /*
       * A FAILED ANSWER IS STILL A RECORDED TURN, closed as a failure. The row
       * is already open, and leaving it reading "succeeded" would make the
       * answer rate on the dashboard flattering rather than honest.
       */
      await closeTurn(turnId, {
        category: "unclassified",
        succeeded: false,
        latencyMs: Date.now() - askedAt,
      });
      throw error;
    }

    /*
     * THE EVIDENCE LADDER, now that the answer can speak, strongest first —
     * see `classifyChatTurn`:
     *   1. the template the answer proposed          (a fact about the answer)
     *   2. an attached report                        (a fact about the request)
     *   3. the knowledge categories it cited         (authoritative metadata on
     *                                                 the documents themselves)
     *   4. the question, read transiently            (only when 1-3 found none)
     */
    await closeTurn(turnId, {
      category: classifyChatTurn({
        proposedTemplateKey: answer.formProposal?.templateKey ?? null,
        offeredFormChoices: answer.formSelection !== undefined,
        hadReportContext: body.reportContext !== undefined && body.reportContext !== null,
        citedCategories: answer.citations.map((citation) => citation.category),
        question: body.question ?? null,
      }),
      succeeded: true,
      latencyMs: Date.now() - askedAt,
    });

    /*
     * `turnId` is always present here — `openTurn` throws rather than returning
     * nothing — so the answer is unconditionally rateable. The event below is
     * unreachable under this lifecycle and is kept as a tripwire: if a later
     * change ever reintroduces the gap, it is one log search rather than one
     * reproduction.
     */
    if (!turnId) {
      logTurnEvent("turn.answer.missing_turn", { surface, where: "api/chat" });
    }

    /*
     * TEMPLATE_OUTLINE_FIELDS_ENABLED (Pau's sf-s21, QA's ruling): "the Must see behaviors and not the standard of
     * conduct" on a form that still cites Standards of Conduct is answered with why (`lib/forms/template-outline.ts`).
     */
    if (templateOutlineFieldsEnabled() && outlineTurn) {
      const { question: outlineQuestion, instanceId: outlineInstanceId } = outlineTurn;
      const outline = await import("@/lib/forms/template-outline");
      const loaded = await (await import("@/lib/forms/instance-scope"))
        .authorizeInstance(request, outlineInstanceId, "view")
        .then((authorized) => authorized.loaded)
        .catch(() => null);
      const value = (key: string) => loaded?.values.find((row) => row.fieldKey === key)?.value ?? "";
      const note = loaded
        ? outline.policyKeptNote({ question: outlineQuestion, policyViolated: value("policy_violated"), policyLanguage: value("policy_language") })
        : null;
      if (note) answer = { ...answer, content: outline.withPolicyKeptNote(answer.content, note) };
    }
    // FINAL_REPLY_MARKER_GUARD_ENABLED: no bare source tag reaches the manager, whatever path answered. See `ai/source-note.ts`.
    return NextResponse.json({ ...finalReplyWithoutMarkers(answer), turnId });
  } catch (error) {
    return errorResponse(error, "POST /api/chat");
  }
}

/** Validates and bounds everything that arrived from the browser. */
function parseAskRequest(body: Partial<AskRequest>): AskRequest {
  const context = body.context;

  return {
    /*
     * CHAT_LONG_MESSAGE_ENABLED raises the limit to 12,000 characters and
     * says how long a refused message is. The text is refused, never cut.
     * Off, the 4,000 check and its wording are what main ships.
     */
    question: chatLongMessageEnabled()
      ? requireChatQuestion(body.question, LONG_MESSAGE_LIMIT)
      : requireString(body.question, "A question", LIMITS.question),
    mode: optionalEnum<AnswerMode>(body.mode, MODES, "standard"),
    history: parseHistory(body.history) as ChatMessage[],
    questionMessageId: optionalString(body.questionMessageId, LIMITS.messageId) || undefined,
    /*
     * A TEMPLATE KEY, BOUNDED, AND NOTHING ELSE. It says which kind of form the
     * last assistant turn offered, so answering "Sarah Test" to "who is this
     * for?" continues that proposal instead of becoming a knowledge query. Every
     * fact on the resulting proposal is still re-derived from the manager's own
     * turns, and the key is revalidated against the published library and the
     * actor's permission.
     */
    continueProposalTemplateKey:
      optionalString(body.continueProposalTemplateKey, CONTINUATION_KEY_MAX) || undefined,
    // An id and nothing more; malformed ones are dropped rather than looked up.
    activeFormInstanceId: UUID.test(String(body.activeFormInstanceId ?? ""))
      ? String(body.activeFormInstanceId)
      : undefined,
    // SAME_FORM_COPY_NEW_PERSON_ENABLED: an id and nothing more, re-checked before it is used.
    pendingCopyFromInstanceId: UUID.test(String(body.pendingCopyFromInstanceId ?? ""))
      ? String(body.pendingCopyFromInstanceId)
      : undefined,
    // A `conv_*` id and nothing more; anything else is dropped. See `AskRequest`.
    conversationId: isClientConversationId(String(body.conversationId ?? ""))
      ? String(body.conversationId)
      : undefined,
    /*
     * THE MOST IMPORTANT OF THE SIX. Chat retrieves knowledge without the
     * caller naming a document, so a caller-chosen corpus here turns a question
     * into a search of another company's policies — with the answer quoting
     * them back. Answer mode, history, context and RAG semantics are unchanged;
     * only the corpus authority moved.
     */
    scopeId: activeKnowledgeCorpus(),
    /*
     * THE REPORT THE MANAGER WAS LOOKING AT, AS POINTERS.
     *
     * `parseChatReportContext` bounds and trims every field and returns null
     * unless the family is one of the five, so a malformed link selects nothing
     * rather than briefing on a guessed report. There is no field in the shape
     * through which a FIGURE could travel — the server re-reads the report — so
     * unlike the corpus above this one is safe to take from the body: the worst
     * a forged context can do is name rows the reader could already open the
     * dashboard to see, and `view_reports` is not what gates this route.
     *
     * Which is worth saying out loud, because it IS a real limitation and it is
     * the reporting read layer's rather than this route's: reads are not
     * narrowed per person's area, so everyone who reaches Chat sees the same
     * delivery the dashboards show them. That gap is recorded at length in
     * `api/reporting/sales-totals/analyze/route.ts` and is unchanged here.
     */
    reportContext: parseChatReportContext(body.reportContext),
    /*
     * REPORTING ONLY. It reaches the analytics row and nothing else — see the
     * field's own note on `AskRequest`. Validated here so a bad value becomes
     * null rather than travelling further as a string.
     */
    surface: isActivitySurface(body.surface) ? body.surface : null,
    attachedDocumentIds: Array.isArray(body.attachedDocumentIds)
      ? body.attachedDocumentIds
          .filter((id): id is string => typeof id === "string")
          .slice(0, LIMITS.documentIds)
      : undefined,
    context: {
      userName: optionalString(context?.userName, LIMITS.personName, "Manager"),
      locationName: optionalString(
        context?.locationName,
        LIMITS.personName,
        "your salon",
      ),
      /*
       * WHAT DAY IT IS COMES FROM THE SERVER, IN THE BUSINESS TIMEZONE.
       *
       * Two corrections live in this one line.
       *
       * IT USED TO PREFER THE CALLER'S `todayIso`, and the browser sent
       * `DEMO_ANCHOR.slice(0, 10)` — a frozen prototype date. So the prompt
       * opened with "Today is 2026-08-26" for as long as that constant stood,
       * and every freshness judgement Sunny could have made was made against a
       * day that had already passed. What day it is is a fact the server knows
       * and a client can only assert: the same argument as the corpus above,
       * one field down.
       *
       * AND IT USED TO BE UTC, which is the wrong ruler for "today" in a
       * business that operates in US zones. At 8pm Eastern the UTC date has
       * already rolled over, so a report covering yesterday would be described
       * as two days behind for the whole evening — every evening. `businessToday`
       * is the app's one answer to this, already used by follow-up dates and the
       * Overview, and reusing it is what keeps the product from holding two
       * opinions about what day it is.
       *
       * THE STORED PERIOD IS STILL AUTHORITATIVE. This decides only what
       * "today" means for the freshness comparison; which period a figure comes
       * from is read from the report, and no clock can move it.
       */
      todayIso: businessToday(),
    },
  };
}
