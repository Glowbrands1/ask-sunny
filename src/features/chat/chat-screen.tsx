"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { History, PanelRightClose, PanelRightOpen, Plus, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { SUGGESTED_PROMPTS } from "@/data/demo/chat";
import { getAIProvider } from "@/lib/ai";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { nowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
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
import { MessageBubble, ThinkingBubble } from "./message-bubble";

export function ChatScreen() {
  const searchParams = useSearchParams();
  const { primaryLocationName, managerDisplayName } = useSession();
  const {
    conversations,
    addConversation,
    appendConversationMessages,
    patchConversationMessage,
    removeConversation,
    clearConversations,
  } = useAppStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AnswerMode>("standard");
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(true);

  const provider = useMemo(() => getAIProvider(), []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seededQuery = useRef(false);

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

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || busy) return;

      setInput("");
      setBusy(true);

      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        content: text,
        createdAt: nowIso(),
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
          createdAt: nowIso(),
          mode,
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
        };

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
          createdAt: nowIso(),
          mode,
          error: toChatTurnError(caught, text),
        };

        appendConversationMessages(conversationId, [errorMessage]);
      } finally {
        setBusy(false);
      }
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
   * Accept ?q= from the dashboard prompt chips.
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
    seededQuery.current = true;
    const timer = window.setTimeout(() => void send(query), 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, send]);

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
  const createFormFromConversation = useCallback(() => {
    if (busy) return;
    void send(CREATE_FORM_FROM_CONVERSATION);
  }, [busy, send]);

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

  const handleDelete = (id: string) => {
    removeConversation(id);
    if (activeId === id) startNewChat();
  };

  const handleClearAll = () => {
    clearConversations();
    startNewChat();
  };

  const isEmpty = messages.length === 0;

  return (
    /*
     * ======================================================================
     * THE WORKSPACE IS EXACTLY THE VIEWPORT MINUS THE SHELL HEADER
     * ======================================================================
     *
     * THE DEFECT THIS REPLACES. This read `h-[calc(100dvh-3.5rem)] lg:h-dvh`,
     * and the `lg:` half was wrong. `AppShell` renders a `h-14` (3.5rem)
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
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0">
      {/* Conversation history — desktop */}
      <aside className="hidden w-64 shrink-0 border-r border-border bg-sidebar xl:block">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={setActiveId}
          onNew={startNewChat}
          onDelete={handleDelete}
          onClearAll={handleClearAll}
        />
      </aside>

      {/* History drawer — below xl */}
      {historyOpen ? (
        <div className="fixed inset-0 z-40 xl:hidden">
          <button
            type="button"
            aria-label="Close chat history"
            className="absolute inset-0 bg-[color-mix(in_srgb,var(--foreground)_32%,transparent)]"
            onClick={() => setHistoryOpen(false)}
          />
          <div className="animate-in-fade absolute inset-y-0 left-0 w-[min(19rem,86vw)] border-r border-border bg-sidebar shadow-float">
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
            <div className="h-[calc(100%-3rem)]">
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
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Conversation */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            {/*
              NEW CHAT IS REACHABLE AT EVERY WIDTH, not just where the rail
              fits. Below `xl` the conversation rail is `display:none`, which
              took its "New chat" button off the page with it and left the
              History drawer as the only route to a fresh thread — the exact
              "I eventually found it under History" report. So the action is
              repeated here, ahead of History, wherever the rail is hidden;
              at `xl` and up the rail's own button is visible and this one
              would just be a duplicate of it.

              Same `startNewChat` the rail and the drawer call. It is a
              primary button next to a ghost History so the pair reads as
              "start one" / "go back to one" rather than as two equal tabs.
            */}
            <Button size="sm" className="xl:hidden" onClick={startNewChat}>
              <Plus />
              New chat
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="xl:hidden"
              onClick={() => setHistoryOpen(true)}
            >
              <History />
              History
            </Button>
            <p className="hidden truncate text-[13px] font-medium text-foreground xl:block">
              {activeConversation ? activeConversation.title : "New conversation"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="hidden lg:inline-flex"
            onClick={() => setContextOpen((open) => !open)}
            aria-pressed={contextOpen}
          >
            {contextOpen ? <PanelRightClose /> : <PanelRightOpen />}
            {contextOpen ? "Hide context" : "Show context"}
          </Button>
        </div>

        <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {isEmpty ? (
              <EmptyChatState onSelect={(prompt) => void send(prompt)} />
            ) : (
              <div className="space-y-6">
                {messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    conversation={messages}
                    onSuggestion={(value) => void send(value)}
                    onRetry={(question) => void send(question)}
                    onFormCreated={attachFormInstance}
                    onStartAnother={startAnotherForm}
                  />
                ))}
                {busy ? <ThinkingBubble /> : null}
              </div>
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
          <ContextPanel messages={messages} onCreateForm={createFormFromConversation} />
        </aside>
      ) : null}
    </div>
  );
}

function EmptyChatState({ onSelect }: { onSelect: (prompt: string) => void }) {
  const { brand } = useSession();
  return (
    <div className="flex flex-col items-center py-8 text-center sm:py-14">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft">
        <SunMark className="size-7" />
      </span>
      <h1 className="mt-5 text-[26px] leading-tight font-semibold text-foreground sm:text-[30px]">
        How can {brand.assistantName} help today?
      </h1>
      <p className="mt-2.5 max-w-lg text-sm leading-relaxed text-muted-foreground">
        Ask about company policies, coaching, salon operations, performance,
        training, or create a manager form.
      </p>

      <div className="mt-8 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {SUGGESTED_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSelect(prompt)}
            className={cn(
              "rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-left text-[13px] leading-snug text-foreground shadow-soft",
              "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-raised",
            )}
          >
            {prompt}
          </button>
        ))}
      </div>

      <p className="mt-7 max-w-lg text-xs leading-relaxed text-subtle-foreground">
        This prototype answers from a seeded demo knowledge base. Every answer
        shows the documents behind it.
      </p>
    </div>
  );
}
