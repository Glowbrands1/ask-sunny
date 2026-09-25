"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { History, PanelRightClose, PanelRightOpen, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SOURCE_PROMISE } from "@/data/answer-modes";
import { aiProviderStatus, getAIProvider } from "@/lib/ai";
import { quickQuestionsFor } from "@/lib/ai/quick-questions";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { activityNowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
import { conversationRatingTarget } from "@/lib/feedback/conversation";
import type {
  AnswerMode,
  ChatConversation,
  ChatFormInstanceRef,
  ChatMessage,
} from "@/types";
import {
  CREATE_FORM_FROM_CONVERSATION,
  continuationFor,
} from "@/lib/forms/proposal-continuation";
import {
  chatReportContextFromParams,
  type ChatReportContext,
} from "@/lib/reporting/read/chat-report-context";
import { toChatTurnError } from "./chat-error";
import { Composer } from "./composer";
import { ContextPanel } from "./context-panel";
import { ConversationList } from "./conversation-list";
import { ImportLocalHistoryPrompt } from "./import-local-history";
import { MessageBubble, ThinkingBubble } from "./message-bubble";
import { ConversationRating } from "./conversation-rating";

export function ChatScreen() {
  const searchParams = useSearchParams();
  const { brand, can, primaryLocationName, managerDisplayName, user } = useSession();
  const {
    conversations,
    addConversation,
    appendConversationMessages,
    patchConversationMessage,
    removeConversation,
    clearConversations,
    accountHistory,
    conversationSyncFailed,
    retryConversationSync,
  } = useAppStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AnswerMode>("standard");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);

  /*
   * THE EMPTY STATE'S OPENINGS, for this reader.
   *
   * The same resolution the Overview band uses, and deliberately the same
   * function rather than a second list: the two screens are the same offer made
   * in two places, and they went out of step the moment one of them sliced the
   * list differently. The band shows the first four; this shows all of them.
   */
  const quickQuestions = useMemo(
    () => quickQuestionsFor({ scope: user.scope, can }),
    [can, user.scope],
  );

  const provider = useMemo(() => getAIProvider(), []);
  /*
    THE CONNECTION FACT, READ ONCE. The artifact moves it out of the composer's
    three stacked trust blocks: into the band's one-line `.trust` row in the
    empty state, and into the slim header in the answered state.
  */
  const providerStatus = useMemo(() => aiProviderStatus(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seededQuery = useRef(false);
  const adoptedConversation = useRef(false);

  /**
   * ==========================================================================
   * THE REPORT THIS CONVERSATION IS ABOUT
   * ==========================================================================
   *
   * Set when the manager arrived from a report tab's "Ask Sunny about this
   * report", read from the URL, and sent with EVERY turn including follow-ups.
   *
   * THE FOLLOW-UPS ARE THE WHOLE REASON IT PERSISTS. "Why is #1 the biggest
   * problem?" names no report and no metric, and the server's routing reads the
   * question's own words — by design, so a briefing does not attach itself to
   * every turn forever once it arrives. Without this the second question in a
   * report conversation would lose the report.
   *
   * POINTERS ONLY. Which family, which period, which salons, which measure.
   * There is nowhere in it to put a figure, so nothing this browser rendered
   * can be sent as a fact; the server re-reads the rows. See
   * `reporting/read/chat-report-context.ts`.
   *
   * DERIVED FROM THE URL RATHER THAN HELD IN STATE, so it survives a refresh
   * and travels in a shared link — the same reasons the report tabs use real
   * URLs rather than client-side panel swapping.
   */
  const reportContext: ChatReportContext | null = useMemo(
    () => chatReportContextFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const activeConversation = useMemo(
    () => conversations.find((entry) => entry.id === activeId) ?? null,
    [conversations, activeId],
  );

  const messages = activeConversation?.messages ?? draftMessages;

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, busy]);

  /* --------------------------------------------------------------- send -- */

  /*
   * ==========================================================================
   * THE INTENT NAMES THE ANSWER IT BELONGS TO, NOT "THE NEXT CARD TO MOUNT"
   * ==========================================================================
   *
   * THIS WAS A BOOLEAN REF, AND IT FILED FORMS NOBODY ASKED FOR. The flag was
   * set by the click handler and cleared by whichever proposal card mounted
   * first, which left two ways for a real `form_instances` row to be created
   * off a decision the manager never made:
   *
   *   A CLICK THAT WAS NEVER SENT STILL SET IT. `send` refuses while a turn is
   *   in flight, and the handler set the flag BEFORE calling it — so clicking
   *   "Corrective Action Form" during the previous answer sent nothing, and
   *   armed the flag. The turn already running then came back with a ready
   *   COACHING proposal, its card mounted, consumed the armed flag and created
   *   a coaching record. Reproduced in `rollout-fixes.dom.test.tsx`: two calls
   *   to `/api/forms/instances` from a click that never left the browser.
   *
   *   A TURN THAT FAILED, OR ANSWERED WITHOUT A PROPOSAL, LEFT IT ARMED. There
   *   was no card to consume it, so it waited — through however many ordinary
   *   questions — for the next proposal to arrive, and created that one.
   *
   * So the intent is now the ID OF THE ANSWER it belongs to. It is recorded
   * inside `send`, after the guard that decides whether the turn goes out and
   * only when the answer actually carries a proposal, and it is matched by the
   * card against its own message. There is no window in which it is armed for
   * "whatever mounts next", because it never refers to anything but one answer.
   *
   * A REF, NOT STATE: a re-render must not make a second form.
   */
  const autoDraftMessageId = useRef<string | null>(null);

  /**
   * True for the one answer a picker choice produced, and once only.
   *
   * READ, CLEAR, THEN COMPARE — deliberately in that order. Every proposal card
   * asks this on mount, so clearing unconditionally means an intent can only
   * ever be spent once and can never outlive the render that armed it. The
   * failure mode of clearing it against the wrong card is that no form is
   * created, which is the direction this whole path is supposed to fail in.
   */
  const consumeAutoDraft = (messageId: string) => {
    const armed = autoDraftMessageId.current;
    autoDraftMessageId.current = null;
    return armed !== null && armed === messageId;
  };

  const send = useCallback(
    async (
      rawText: string,
      /*
       * WHETHER THIS TURN IS A DOCUMENT THE MANAGER PICKED BY NAME.
       *
       * Passed in rather than set by the caller beforehand, and that is the
       * whole of the fix described at `autoDraftMessageId` above: the intent is
       * recorded by the function that also decides whether the turn goes out at
       * all, so a refused send cannot leave one behind.
       */
      options: { fromPicker?: boolean } = {},
    ): Promise<boolean> => {
      const text = rawText.trim();
      /*
       * REFUSED, AND THE CALLER IS TOLD. It used to return `undefined` either
       * way, so every caller treated "sent" and "dropped while a turn was in
       * flight" as the same outcome — see `chooseSuggestedForm`.
       */
      if (!text || busy) return false;

      /*
       * NOTHING IS CHECKED HERE BUT THE TEXT AND THE IN-FLIGHT TURN.
       *
       * This used to consult `feedbackDueOn` and return early while the last
       * answer was unrated — which is what "it ends the chat" was. Every form
       * card, every follow-up chip and "Create a form from this conversation"
       * all send through here, so one unrated answer silently disabled the
       * entire Forms flow: the manager clicked "Coaching Form", nothing
       * happened, and the conversation looked finished. Rating is voluntary and
       * no conversation action waits on it.
       */

      setInput("");
      setBusy(true);

      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        content: text,
        createdAt: activityNowIso(),
      };

      let conversationId = activeId;
      let history: ChatMessage[];

      if (conversationId && activeConversation) {
        history = activeConversation.messages;
        /*
         * APPENDED, not rewritten from `history`. Rewriting would erase
         * anything added since this render — a form reference attached while a
         * question was in flight, most concretely. `history` is still the
         * snapshot SENT to the model, which is correct: that is what the
         * conversation looked like when the question was asked.
         */
        appendConversationMessages(conversationId, [userMessage]);
      } else {
        history = draftMessages;
        const conversation: ChatConversation = {
          id: createId("conv"),
          title: provider.titleForConversation(text),
          createdAt: userMessage.createdAt,
          updatedAt: userMessage.createdAt,
          attachedDocumentIds: [],
          messages: [...history, userMessage],
        };
        conversationId = conversation.id;
        addConversation(conversation);
        setActiveId(conversation.id);
        setDraftMessages([]);
      }

      try {
        const response = await provider.ask({
          question: text,
          mode,
          history,
          // Which of the manager's own turns this answer was read from. Echoed
          // back on a form proposal as provenance; it names browser-local
          // state and confers nothing.
          questionMessageId: userMessage.id,
          /*
           * "Sarah Test" answering "who is this form for?" continues that
           * proposal instead of becoming a knowledge query. A template KEY and
           * nothing else — every fact is still re-derived server-side, and the
           * key is revalidated there. See `lib/forms/proposal-continuation.ts`.
           */
          continueProposalTemplateKey: continuationFor(history)?.templateKey,
          /*
           * Sent on every turn, not just the first. Pointers at rows; the
           * server re-reads them and never trusts a rendered number.
           */
          reportContext,
          /*
           * WHICH SURFACE THIS IS. Reporting only — it reaches the analytics
           * row and nothing else. See `AskRequest.surface`.
           */
          surface: "main_chat",
          // No corpus. The server derives it from the active brand; sending one
          // could only ever be ignored or trusted, and one of those is a bug.
          /*
           * NO `todayIso`. The server sets it from its own clock.
           *
           * This sent `DEMO_ANCHOR.slice(0, 10)` — the prototype's frozen date
           * — and the route preferred it over the real one, so the prompt
           * opened with a day that had already passed and every freshness
           * judgement was made against it. What day it is is a fact the server
           * knows; a browser can only assert one. See `/api/chat`.
           */
          context: {
            userName: managerDisplayName,
            locationName: primaryLocationName,
          },
        });

        const assistantMessage: ChatMessage = {
          id: createId("msg"),
          role: "assistant",
          content: response.content,
          createdAt: activityNowIso(),
          mode,
          /*
           * THE SERVER'S NAME FOR THIS TURN, beside the browser's own id. It is
           * what a rating attaches to; a conversation whose answers carry none
           * offers no rating control — see `ConversationRating`.
           */
          turnId: response.turnId,
          citations: response.citations,
          coverage: response.coverage ?? "not_applicable",
          recommendedVideoIds: response.recommendedVideoIds,
          followUpSuggestions: response.followUpSuggestions,
          /*
           * WHAT SUNNY IS OFFERING, NOT WHAT IT DREW UP.
           *
           * `formHandoff`, `pendingFormTemplateId` and `pendingFormValues` were
           * assigned here. Between them they parked a drafted set of HR field
           * values and a half-filled bag of pending ones in browser-local chat
           * state, and the next turn read them back and filled the gaps with
           * defaults. A proposal carries no field values at all.
           */
          formProposal: response.formProposal,
          /*
           * The choices for a request that named no form. Data, not a decision:
           * nothing is created until the manager clicks a card, which sends an
           * ordinary turn back through `send`.
           */
          formSelection: response.formSelection,
        };

        /*
         * PINNED TO THIS ANSWER, and only when this answer actually carries a
         * proposal. Set before the append below, because appending is what
         * mounts the card whose effect reads it.
         */
        if (options.fromPicker && assistantMessage.formProposal) {
          autoDraftMessageId.current = assistantMessage.id;
        }

        appendConversationMessages(conversationId, [assistantMessage]);
      } catch (caught) {
        /*
         * A failed turn becomes a visible, actionable message in the thread
         * rather than nothing at all. Previously this was `try/finally` with no
         * catch, so a failure left the manager staring at their own question
         * with the thinking indicator gone and no explanation.
         *
         * It is stored in the conversation like any other turn so it survives a
         * refresh, and it is never turned into an answer.
         */
        const errorMessage: ChatMessage = {
          id: createId("msg"),
          role: "assistant",
          content: "",
          createdAt: activityNowIso(),
          mode,
          error: toChatTurnError(caught, text),
        };

        appendConversationMessages(conversationId, [errorMessage]);
      } finally {
        setBusy(false);
      }

      return true;
    },
    [
      busy,
      activeId,
      activeConversation,
      draftMessages,
      provider,
      mode,
      managerDisplayName,
      primaryLocationName,
      addConversation,
      appendConversationMessages,
      reportContext,
    ],
  );

  /**
   * Accept ?c= — a conversation that was STARTED INLINE on the Overview.
   *
   * The band writes its turn to the same store this screen reads, so "Continue
   * in Ask Sunny" does not replay the question: it adopts the existing thread,
   * which is why the answer the manager already read is the one they land on
   * and why it is in history exactly once.
   */
  useEffect(() => {
    if (adoptedConversation.current) return;
    const id = searchParams.get("c");
    if (!id) return;
    if (!conversations.some((entry) => entry.id === id)) return;
    adoptedConversation.current = true;
    /* Scheduled, not called inline — same reason as the ?q= effect below. */
    const timer = window.setTimeout(() => setActiveId(id), 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, conversations]);

  /**
   * Accept ?q= from the dashboard prompt chips and the band's follow-up chips.
   *
   * The send is scheduled rather than called inline so no state is written
   * synchronously inside the effect body — the first update then happens in a
   * callback, which is the pattern React actually recommends for kicking off
   * work when a component mounts.
   */
  useEffect(() => {
    if (seededQuery.current) return;
    const query = searchParams.get("q");
    if (!query) return;
    /*
     * When a conversation came with the question, wait for it to become the
     * active one. Sending first would append the follow-up to a NEW thread and
     * leave the original answer stranded in history — the exact split the
     * direction warns about.
     */
    const target = searchParams.get("c");
    if (target && activeId !== target) return;
    seededQuery.current = true;
    const timer = window.setTimeout(() => void send(query), 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, send, activeId]);

  /**
   * ==========================================================================
   * THE ID, AND NOTHING BUT THE ID
   * ==========================================================================
   *
   * A form created from a proposal is a real `form_instances` row, and Postgres
   * is its source of truth from that moment on. What gets written into the
   * browser-local conversation is a POINTER — instance id, which proposal it
   * came from, and a label to show before the fetch lands.
   *
   * No field values, no checked options, no status, no follow-up date. All of
   * those change on the server — from Form Monitoring, from a later edit, from
   * finalizing — and a copy here would be stale in the most dangerous
   * direction, because it would look authoritative.
   *
   * Written through `updateConversation` rather than local state so it survives
   * a refresh: that is what makes the same message reopen the same form.
   */
  const attachFormInstance = useCallback(
    (messageId: string, reference: ChatFormInstanceRef) => {
      if (!activeId) return;
      /*
       * ATOMIC. This mapped over `activeConversation.messages` — an array
       * captured when the callback was created — and wrote the result back
       * wholesale, so any turn the manager sent while the form was being
       * created was erased by the reference landing. `patchConversationMessage`
       * does the map inside the store's own updater, against current state.
       */
      patchConversationMessage(activeId, messageId, { formInstanceRef: reference });
    },
    [activeId, patchConversationMessage],
  );

  /**
   * A NEW FORM IS A NEW REQUEST, NEVER A REUSED RECORD.
   *
   * The finalized instance is frozen and stays exactly where it is — in the
   * thread, and in Form Monitoring. This only puts the manager back at the
   * composer with the opening words of a fresh request, in the SAME
   * conversation, so the next form gets its own `form_instances` row.
   */
  const startAnotherForm = useCallback(() => {
    setInput("Create a coaching form for ");
    window.setTimeout(() => {
      const node = scrollRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    }, 0);
  }, []);

  /**
   * The right rail's "Create a form from this conversation".
   *
   * Sends an ordinary turn, so the ENTIRE existing pathway runs: the bounded
   * manager-only context, `detectTemplateIntent`, the continuation hint, the
   * authorized template list and the permission check. Nothing about form
   * creation is re-implemented for the button.
   *
   * The turn is visible in the thread on purpose. The conversation is the
   * record the eventual form is drawn from, and a request that produced a
   * proposal but left no trace of having been made would be a gap in it.
   */
  /**
   * ==========================================================================
   * A CARD CLICK IS THE DECISION, AND IT SHOULD NOT HAVE TO BE MADE TWICE
   * ==========================================================================
   *
   * Choosing "SDIT EPP" from the picker sends the same sentence a manager
   * could have typed, and the answer comes back as a proposal card with its
   * own "Create draft" button — asking them to confirm a form they just
   * named.
   *
   * So the CHOICE is remembered for exactly one turn, and a proposal that
   * comes back ready and inline-draftable creates itself. Nothing is widened
   * by this: the create route re-resolves the template, re-applies its
   * permission and re-authorises the salon, and a proposal that is missing
   * the employee or the salon is not `ready` and still asks.
   *
   * THE CHOICE TRAVELS WITH THE SEND, rather than being armed beside it. See
   * `autoDraftMessageId` above for the two ways the old arrangement created
   * forms nobody had asked for.
   */
  const chooseSuggestedForm = useCallback(
    (phrase: string) => {
      void send(phrase, { fromPicker: true });
    },
    [send],
  );


  /*
   * THE RAIL'S ACTION. `send` owns the in-flight guard — this used to repeat it
   * here and return silently, so the button stayed live, was pressed, and did
   * nothing at all. The panel is told `busy` instead and disables the control,
   * which is the same report ("I click it and nothing happens") that the
   * feedback gate produced before it was removed.
   */
  const createFormFromConversation = useCallback(() => {
    void send(CREATE_FORM_FROM_CONVERSATION);
  }, [send]);

  /**
   * The one way to start a thread, called by the rail, the mobile drawer and
   * the chat header alike.
   *
   * A conversation is created lazily by `send`, on the first question asked —
   * never here. So this only drops the current selection, and pressing it
   * twice, or a re-render firing it again, cannot leave empty duplicates in
   * the history. Nothing already stored is touched: the previous conversation
   * stays in the list and is one click away again.
   */
  const startNewChat = useCallback(() => {
    setActiveId(null);
    setDraftMessages([]);
    setInput("");
    setHistoryOpen(false);
  }, []);

  /**
   * DELETING NOW REACHES THE ACCOUNT, so it can fail, and a failure has to be
   * visible.
   *
   * The store removes the account's copy first and this browser's only if that
   * succeeded — otherwise the thread would vanish from the panel and merge
   * straight back on the next load, which is a worse outcome than being told it
   * could not be deleted.
   */
  const [historyError, setHistoryError] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setHistoryError(null);
    try {
      await removeConversation(id);
      if (activeId === id) startNewChat();
    } catch (error) {
      setHistoryError(
        error instanceof Error && error.message
          ? error.message
          : "That conversation could not be deleted just now. Nothing was removed.",
      );
    }
  };

  /* Rejects on failure so the dialog can stay open and say so. */
  const handleClearAll = async () => {
    setHistoryError(null);
    await clearConversations();
    startNewChat();
  };

  const isEmpty = messages.length === 0;

  /*
   * WHICH TURN A RATING FOR THIS CONVERSATION WOULD ATTACH TO, and what was
   * already said about it. Null while nothing rateable has come back, which is
   * why the control simply is not there on a fresh thread.
   */
  const ratingTarget = useMemo(() => conversationRatingTarget(messages), [messages]);

  return (
    /*
     * ======================================================================
     * THE WORKSPACE IS EXACTLY THE VIEWPORT MINUS THE SHELL HEADER
     * ======================================================================
     *
     * THE NUMBER TRACKS THE SHELL HEADER, which the Marquee direction takes to
     * 64px — so this is `4rem`, not the `3.5rem` it was. A test pins the pair
     * together rather than trusting them to stay in step, and it caught exactly
     * this when the bar grew.
     *
     * THE DEFECT THIS REPLACES. This read `h-[calc(100dvh-3.5rem)] lg:h-dvh`,
     * and the `lg:` half was wrong. `AppShell` renders a `h-16` (4rem)
     * header ABOVE this in normal flow — sticky occupies space — so claiming
     * the whole dynamic viewport made the page 56px taller than the viewport
     * on every laptop. The result was a page-level scrollbar with nothing but
     * the composer below the fold, on top of a conversation pane that was
     * already short. One height is correct at every width, because the header
     * is the same height at every width.
     *
     * `min-h-0` is load-bearing on this element AND on the conversation column
     * below. A flex child defaults to `min-height: auto`, which lets it grow
     * past its parent instead of scrolling inside it — so without both, the
     * `overflow-y-auto` on the message list never engages and the composer is
     * pushed off-screen by a long answer.
     */
    <div className="flex h-[calc(100dvh-4rem)] min-h-0">
      {/*
        ==================================================================
        CHAT HISTORY IS CLOSED UNTIL SOMEBODY ASKS FOR IT
        ==================================================================

        REQUESTED: "Can we hide the chat history so it isn't visible all the
        time?"

        WHAT WAS HERE: a permanent 232px rail at `xl` and up, plus this drawer
        for everything narrower — two components, two behaviours, and a panel
        that took a fifth of a laptop screen away from the conversation for the
        whole session.

        NOW THERE IS ONE PANEL AT EVERY WIDTH, and it starts closed. That is the
        request, and it also settles a second report from the same rollout:
        "there's no way to go back into a past chat". The rail was
        `display:none` below 1280px, which is most of the Teams tab — so the
        ONLY route back to a thread was a History button that looked like a
        different thing from the rail nobody could see. One control, at every
        width, is what makes the answer to "where is my last conversation" the
        same sentence for everybody.

        NOTHING IS REMOVED. The history, the deletes and Clear History are the
        same component with the same props; only when it is on screen changed.

        IT CLOSES ON SELECTION, so the conversation is what is left in front of
        the person — "after selecting a conversation, normal chat view remains
        the primary focus". A panel that stayed open would be the rail again,
        opened by hand.
      */}
      {historyOpen ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            aria-label="Close chat history"
            className="absolute inset-0 bg-[color-mix(in_srgb,var(--foreground)_32%,transparent)]"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="animate-in-fade absolute inset-y-0 left-0 flex w-[min(19rem,86vw)] flex-col border-r border-border bg-background shadow-float">
            <div className="flex h-12 items-center justify-between border-b border-border px-3">
              <p className="text-[13px] font-semibold">Chat history</p>
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Close chat history"
                onClick={() => setHistoryOpen(false)}
              >
                <X />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <ConversationList
                conversations={conversations}
                activeId={activeId}
                onSelect={(id) => {
                  setActiveId(id);
                  setHistoryOpen(false);
                }}
                onNew={startNewChat}
                onDelete={handleDelete}
                onClearAll={handleClearAll}
                showHeading={false}
                accountHistory={accountHistory}
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Conversation */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/*
          THE SLIM HEADER — the collapsed band. Near-black with the same 4px
          yellow edge the hero band carries, so the two states read as one
          object at two heights rather than as two different headers. The
          connection status moves here from the composer stack, which is where
          the artifact puts it: "in the active state the connection moves to the
          slim header and the disclaimer sits beside the mode selector."

          IT IS ALWAYS RENDERED, AT TWO HEIGHTS. A fresh conversation carries
          the 30px headline and the location; a thread carries the thread's own
          title at 19px. It used to be suppressed entirely on the empty state,
          because the empty state held its own taller band with the composer
          inside it — and that is what put the chatbox at the top of the page.
        */}
        <div
          className={cn(
            "flex shrink-0 flex-wrap items-center justify-between gap-3 border-b-4 border-brand-yellow bg-band px-4 sm:px-6",
            isEmpty ? "py-5" : "py-3.5",
          )}
          style={isEmpty ? { backgroundImage: "var(--band-glow)" } : undefined}
        >
          <div
            className={cn(
              "flex min-w-0 gap-2",
              isEmpty ? "flex-col items-start" : "items-center",
            )}
          >
            <ThreadControls
              onNew={startNewChat}
              onHistory={() => setHistoryOpen((open) => !open)}
              historyOpen={historyOpen}
            />
            {isEmpty ? (
              <div className="min-w-0">
                {/*
                  THE ONLY HEADLINE ON THE SCREEN, so it can carry the weight
                  the Overview greeting carries: the display face at 30px with
                  the assistant's name in yellow.
                */}
                <h1 className="display text-[26px] text-band-foreground sm:text-[30px]">
                  How can{" "}
                  <span className="text-brand-yellow">{brand.assistantName}</span>{" "}
                  help today?
                </h1>
                {/*
                  LOCATION AND WHO IS ASKING, and NOT the same name twice.
                  `managerDisplayName` is the account's title for a salon login
                  — "Salon Director — MO Kansas City Wornall" — so concatenating it
                  with the location rendered the salon twice.
                */}
                <p className="mt-1.5 text-[12px] text-band-muted-foreground">
                  {managerDisplayName.includes(primaryLocationName)
                    ? managerDisplayName
                    : `${primaryLocationName} · ${managerDisplayName}`}
                </p>
              </div>
            ) : (
              <p className="display hidden truncate text-[19px] text-band-foreground xl:block">
                {activeConversation ? activeConversation.title : "New conversation"}
              </p>
            )}
            {/*
              THE REPORT THIS THREAD IS ABOUT, as the artifact's `.ctx` chip.
              Only when the manager arrived from a report tab — otherwise there
              is no context to name and an empty chip is furniture.
            */}
            {reportContext ? (
              <span className="hidden shrink-0 rounded-[22px] border border-band-pill-border px-2.5 py-[5px] text-[8.5px] font-black tracking-[0.1em] whitespace-nowrap uppercase text-band-muted-foreground lg:inline-block">
                {reportContext.family.replace(/-/g, " ")}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {/* The connection line, moved out of the composer stack. */}
            <span className="hidden items-center gap-1.5 text-[10px] font-bold whitespace-nowrap text-band-label sm:flex">
              <span
                aria-hidden
                className={cn(
                  "size-[7px] rounded-full",
                  providerStatus.connected ? "bg-delta-up" : "bg-band-label",
                )}
              />
              {providerStatus.name} · {providerStatus.connected ? "connected" : "offline"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="hidden text-band-chip-foreground hover:bg-hover-surface hover:text-hover-surface-foreground lg:inline-flex"
              onClick={() => setContextOpen((open) => !open)}
              aria-pressed={contextOpen}
            >
              {contextOpen ? <PanelRightClose /> : <PanelRightOpen />}
              {contextOpen ? "Hide context" : "Show context"}
            </Button>
          </div>
        </div>

        {/*
          ======================================================================
          ONE BODY, ONE DOCK — THE CHATBOX IS ALWAYS AT THE BOTTOM
          ======================================================================

          REPORTED: "for the Ask sunny tab interface, please follow screenshot
          #4. Chatbox at the bottom not up."

          Screenshot #4 is the artifact's own State 2 plate — slim header, the
          conversation on paper, the composer docked at the foot — and it is the
          layout the whole tab now uses. The empty state used to render a taller
          band with the ask card INSIDE it, which is State 1 as the artifact
          draws it, but it means the place you type moves the moment you ask
          something: top of the page for the first question, bottom of the page
          for every one after it. A control that relocates after its first use
          is the thing to fix, and the artifact's own dark-at-the-edges
          principle is satisfied either way — "where you type is near-black;
          where you read is peach and white".

          So the skeleton is now identical in both states: header band, a peach
          body that scrolls, and the dock. Only the BODY changes — the starter
          prompts before the first question, the thread after it.
        */}
        <div
          ref={scrollRef}
          className="scroll-slim min-h-0 flex-1 overflow-y-auto bg-background"
        >
          {/*
            ==================================================================
            THE TWO THINGS THE ACCOUNT'S COPY OF HISTORY CAN SAY
            ==================================================================

            ABOVE THE THREAD, not inside it, because neither is a turn and
            neither may ever be mistaken for one.

            The import prompt is the ONLY path from this browser's old
            conversations to the account, and it asks first — see
            `ImportLocalHistoryPrompt`. It renders nothing at all when there is
            nothing to offer, which is every account that has already imported
            and every browser that never held anything.

            The sync notice appears only when a save gave up. It is deliberately
            calm: nothing was lost, the conversation on screen is intact and
            still in this browser, and the only thing that is out of date is the
            copy on the account. Saying "your message failed" would be false.
          */}
          <div className="mx-auto w-full max-w-3xl px-4 pt-4 sm:px-6">
            <ImportLocalHistoryPrompt />

            {conversationSyncFailed ? (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3.5 py-2.5">
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  This conversation is saved on this device, but Ask Sunny could
                  not add it to your account yet. Nothing has been lost.
                </p>
                <Button size="sm" variant="ghost" onClick={retryConversationSync}>
                  Try again
                </Button>
              </div>
            ) : null}

            {historyError ? (
              <p
                role="alert"
                className="mb-3 text-[12px] leading-relaxed text-status-failed"
              >
                {historyError}
              </p>
            ) : null}
          </div>

          <div
            className={cn(
              "mx-auto flex w-full max-w-3xl flex-col px-4 py-6 sm:px-6",
              /* The artifact's 22px rhythm between turns. */
              isEmpty ? "gap-4" : "gap-5.5",
            )}
          >
            {isEmpty ? (
              <>
                {/*
                  THE SIX PROMPTS, ON THE PAPER. They were chips inside the
                  white ask card; with the composer docked they become the
                  body's own content, which is what the empty state is for.
                  Still uniform — none is highlighted, because if one needs to
                  lead it leads by being first.
                */}
                <p className="eyebrow">Start with one of these</p>
                <div className="flex flex-wrap gap-2">
                  {quickQuestions.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void send(prompt)}
                      className="rounded-[22px] border border-border-strong bg-surface px-3.5 py-2 text-left text-[12px] font-bold text-foreground shadow-soft transition-colors hover:border-brand-yellow"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>

                {/*
                  THREE TRUST FACTS ON ONE LINE — the artifact's third item.
                  "Connection status, the source promise and the
                  decision-support disclaimer collapse into a single 10.5px
                  line. Today they take three separate blocks under the
                  composer." On the paper rather than in the band, because the
                  band no longer has room for them at this height.
                */}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-subtle-foreground">
                  <span
                    aria-hidden
                    className={cn(
                      "size-[7px] shrink-0 rounded-full",
                      providerStatus.connected ? "bg-delta-up" : "bg-measure-fill",
                    )}
                  />
                  <span>
                    {providerStatus.name} ·{" "}
                    {providerStatus.connected ? "connected" : "offline"}
                  </span>
                  <span aria-hidden>·</span>
                  <span>{SOURCE_PROMISE}</span>
                </p>
              </>
            ) : (
              <>
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    conversation={messages}
                    onSuggestion={(value) => void send(value)}
                    onChooseForm={chooseSuggestedForm}
                    consumePickerChoice={() => consumeAutoDraft(message.id)}
                    onRetry={(question) => void send(question)}
                    onFormCreated={attachFormInstance}
                    onStartAnother={startAnotherForm}
                  />
                ))}
                {busy ? <ThinkingBubble /> : null}

                {/*
                  ==========================================================
                  RATE THIS CONVERSATION — ONCE, AT THE FOOT, WAITED ON BY
                  NOTHING
                  ==========================================================

                  What used to be here was a feedback panel under EVERY answer,
                  each one saying "Required before your next question" and each
                  one telling the truth: the composer and every form action were
                  held until somebody rated. One quiet line now sits below the
                  thread, and the conversation is finished whether or not it is
                  ever pressed.

                  ONE CONTROL PER CONVERSATION, not per answer, which is what
                  makes "already rated" a thing this screen can know — see
                  `conversationRatingTarget` for which turn it attaches to and
                  why an edit lands on the row that already exists.

                  IT STAYS MOUNTED WHILE A TURN IS IN FLIGHT. Hiding it during
                  a send would be tidier and would throw away a half-typed
                  comment the moment somebody asked something else — the same
                  loss the save-failure path goes out of its way to avoid.
                */}
                {ratingTarget && activeId ? (
                  <ConversationRating
                    turnId={ratingTarget.turnId}
                    messageId={ratingTarget.messageId}
                    conversationId={activeId}
                    saved={ratingTarget.saved}
                    onSaved={(feedback) =>
                      patchConversationMessage(activeId, ratingTarget.messageId, {
                        feedback,
                      })
                    }
                    className="mt-1"
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        <Composer
          value={input}
          onChange={setInput}
          onSubmit={() => void send(input)}
          mode={mode}
          onModeChange={setMode}
          busy={busy}
        />
      </div>

      {/* Context rail */}
      {contextOpen ? (
        <aside className="hidden w-76 shrink-0 border-l border-border bg-background lg:block">
          <ContextPanel
            messages={messages}
            onCreateForm={createFormFromConversation}
            busy={busy}
          />
        </aside>
      ) : null}
    </div>
  );
}

/**
 * NEW CHAT AND HISTORY, AT EVERY WIDTH.
 *
 * These were `xl:hidden`, because at `xl` and up a permanent conversation rail
 * carried its own copy of both and these would have been duplicates. The rail
 * is gone — history is closed until asked for, at every width — so this is now
 * the only pair, and it is on screen wherever the chat is.
 *
 * THAT IS ALSO THE FIX FOR "THERE'S NO WAY TO GO BACK INTO A PAST CHAT". The
 * rail was `display:none` below 1280px, so on a Teams tab the route back to a
 * thread was this History button and nothing else — discoverable only if you
 * already knew. One control at one place, always visible, is the answer.
 *
 * ONE COMPONENT BECAUSE THERE ARE TWO CHROME STATES. The slim header and the
 * empty-state band both need it, and two copies is how one of them ends up
 * without History again.
 *
 * `aria-expanded` because this button now OWNS the panel's state rather than
 * merely opening a drawer that something else also rendered. A screen reader is
 * told whether history is showing, which is the whole question the control
 * answers.
 *
 * Primary next to a ghost, so the pair reads as "start one" / "go back to one"
 * rather than as two equal tabs.
 */
function ThreadControls({
  onNew,
  onHistory,
  historyOpen,
  className,
}: {
  onNew: () => void;
  onHistory: () => void;
  historyOpen: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button size="sm" onClick={onNew}>
        <Plus />
        New chat
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-band-chip-foreground hover:bg-hover-surface hover:text-hover-surface-foreground"
        onClick={onHistory}
        aria-expanded={historyOpen}
      >
        <History />
        History
      </Button>
    </div>
  );
}
