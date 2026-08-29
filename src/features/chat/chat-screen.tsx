"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { History, PanelRightClose, PanelRightOpen, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { SUGGESTED_PROMPTS } from "@/data/demo/chat";
import { getAIProvider } from "@/lib/ai";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { cn } from "@/lib/utils/cn";
import { DEMO_ANCHOR, nowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
import type { AnswerMode, ChatConversation, ChatMessage } from "@/types";
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
    updateConversation,
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
        updateConversation(conversationId, {
          messages: [...history, userMessage],
          updatedAt: userMessage.createdAt,
        });
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
          scopeId: "stc-core",
          context: {
            userName: managerDisplayName,
            locationName: primaryLocationName,
            todayIso: DEMO_ANCHOR.slice(0, 10),
          },
        });

        const assistantMessage: ChatMessage = {
          id: createId("msg"),
          role: "assistant",
          content: response.content,
          createdAt: nowIso(),
          mode,
          citations: response.citations,
          recommendedVideoIds: response.recommendedVideoIds,
          formHandoff: response.formHandoff,
          followUpSuggestions: response.followUpSuggestions,
          pendingFormTemplateId: response.pendingFormTemplateId,
          pendingFormValues: response.pendingFormValues,
        };

        updateConversation(conversationId, {
          messages: [...history, userMessage, assistantMessage],
          updatedAt: assistantMessage.createdAt,
        });
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
      updateConversation,
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

  const startNewChat = () => {
    setActiveId(null);
    setDraftMessages([]);
    setInput("");
    setHistoryOpen(false);
  };

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
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 lg:h-dvh">
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
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Conversation */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-13 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
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
                    onSuggestion={(value) => void send(value)}
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
          <ContextPanel messages={messages} />
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
