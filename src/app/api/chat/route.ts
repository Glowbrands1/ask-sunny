import { NextResponse } from "next/server";
import { noteSpendUser } from "@/lib/ai/spend-meter";
import { withSpendMeter } from "@/lib/ai/spend-meter-run";

import { withSwitchAfterCreate } from "@/lib/ai/form-type-switch";
import { enterChatRequestClock } from "@/lib/ai/chat-trace-store";
import { answerQuestion } from "@/lib/ai/server-ask";
import { modelSpendGuard } from "@/lib/ai/spend-guard";
import { isQuestionNotForm } from "@/lib/ai/question-not-form";
import { wantsSeparateDocument } from "@/lib/ai/second-form";
import {
  chatLongMessageEnabled,
  draftActionsEnabled,
  formEditHonestReplyEnabled,
  formEditPlainWordsEnabled,
  questionNotFormEnabled,
  sameFormCopyEnabled,
  secondFormEnabled,
} from "@/lib/config/chat-quality-flags";
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
import { mayAskToReopen } from "@/lib/forms/reopen-cue";
import { parseChatReportContext } from "@/lib/reporting/read/chat-report-context";
import { businessToday } from "@/lib/business-date";
import { isClientConversationId } from "@/lib/chat/client-ids";
import type { AskRequest } from "@/lib/ai/types";
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
export const dynamic = "force-dynamic";

const MODES: AnswerMode[] = ["quick", "standard", "detailed"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SPEND_GUARD_ALL_CALLS_ENABLED: this route's Claude calls are counted (`ai/spend-meter.ts`). Off, as before. */
export async function POST(request: Request) {
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
      return NextResponse.json({ ...capped, turnId });
    }

    let answer;
    try {
      const asked = parseAskRequest(body);
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
      const draftAnswer = draftAction && "answer" in draftAction ? draftAction.answer : null;
      /*
       * Either way the open form is not corrected or revised by this turn: it
       * was answered above, or a new incident is a new form.
       */
      // FORM_TYPE_SWITCH_AFTER_CREATE_NOTE_ENABLED: "change to coaching" after the form was created starts the other form; the created one is left as it is.
      const parsed = withSwitchAfterCreate(
        draftAction
          ? {
              ...asked,
              ...("question" in draftAction ? { question: draftAction.question } : {}),
              activeFormInstanceId: undefined,
            }
          : asked,
      );
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
      const askedQuestion = questionNotFormEnabled() && isQuestionNotForm(parsed.question, parsed.history);
      const correction = parsed.activeFormInstanceId && !askedQuestion
        ? await (await import("@/lib/forms/chat-correction")).correctActiveForm({
            request,
            instanceId: parsed.activeFormInstanceId,
            question: parsed.question,
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
      const policyChange =
        !correction && !askedQuestion && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/chat-policy-change")).changeActiveFormPolicy({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
            })
          : null;
      /*
       * "HERE'S WHAT HAPPENED" after a Corrective Action Form was created from
       * a name alone — the form on screen is redrafted from it, citation
       * included. Null for anything else. See `lib/forms/chat-redraft.ts`.
       *
       * BEFORE THE REVISION: it answers only where Sunny's draft wrote nothing,
       * and there a whole draft from the account — citation and all — is what
       * the manager needs, not one field revised in place.
       */
      const redraft =
        !correction && !askedQuestion && !policyChange && parsed.activeFormInstanceId
          ? await (await import("@/lib/forms/chat-redraft")).redraftActiveForm({
              request,
              instanceId: parsed.activeFormInstanceId,
              question: parsed.question,
              history: parsed.history,
            })
          : null;
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
      const revision =
        askedRevision ??
        (formEditPlainWordsEnabled() && !sameCopy && !correction && !policyChange && !redraft && !separateDocument && parsed.activeFormInstanceId
          ? await (async () => {
              const open = await (await import("@/lib/forms/open-form-summary")).describeOpenForm(request, parsed.activeFormInstanceId!);
              if (!open || open.status !== "draft") return null;
              const rewritten = (await import("@/lib/forms/form-content-turn")).formContentQuestion({
                question: parsed.question,
                history: parsed.history,
                templateName: open.templateName,
                employeeName: open.employeeName,
              });
              return rewritten
                ? (await import("@/lib/forms/chat-revision")).reviseActiveForm({
                    request,
                    instanceId: parsed.activeFormInstanceId!,
                    question: rewritten,
                    history: parsed.history,
                    today: parsed.context.todayIso,
                  })
                : null;
            })()
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
        !sameCopy && !draftAnswer && !correction && !policyChange && !redraft && !revision && mayAskToReopen(parsed.question)
          ? await (await import("@/lib/forms/chat-reopen")).reopenRequestedForm({
              request,
              question: parsed.question,
              history: parsed.history,
              today: parsed.context.todayIso,
              activeInstanceId: parsed.activeFormInstanceId,
              continuingTemplateKey: parsed.continueProposalTemplateKey,
            })
          : null;
      answer =
        draftAnswer ??
        correction ??
        policyChange ??
        redraft ??
        sameCopy ??
        revision ??
        reopened ??
        (await answerQuestion(
          { ...parsed, openForm },
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
       * FORM_EDIT_HONEST_REPLY_ENABLED: the ordinary answer, with a form open,
       * changed nothing — so it never says it updated the form. See
       * `honestFormReply` in `lib/forms/form-content-turn.ts`.
       */
      if (
        formEditHonestReplyEnabled() &&
        parsed.activeFormInstanceId &&
        !draftAnswer && !correction && !policyChange && !redraft && !revision && !reopened &&
        !answer.formUpdate
      ) {
        const honest = (await import("@/lib/forms/form-content-turn")).honestFormReply(answer.content, formEditPlainWordsEnabled());
        if (honest) answer = { ...answer, content: honest };
      }
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

    return NextResponse.json({ ...answer, turnId });
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
