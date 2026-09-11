"use client";

import { useCallback, useMemo, useState } from "react";

import { getAIProvider } from "@/lib/ai";
import { useSession } from "@/lib/session/session-context";
import { useAppStore } from "@/lib/store/app-store";
import { nowIso } from "@/lib/utils/date";
import { createId } from "@/lib/utils/id";
import { continuationFor } from "@/lib/forms/proposal-continuation";
import type { ChatReportContext } from "@/lib/reporting/read/chat-report-context";
import type { AnswerMode, ChatConversation, ChatMessage } from "@/types";
import { toChatTurnError } from "./chat-error";

/**
 * =============================================================================
 * ASKING SUNNY WITHOUT LEAVING THE PAGE
 * =============================================================================
 *
 * The send path the Overview's band and the report tabs' ask bar both use.
 *
 * EXTRACTED RATHER THAN COPIED, and that is the whole reason this file exists.
 * The Overview already held a conversation in place; the report tabs were asked
 * to do the same. Two copies of this logic would be two audit trails to keep in
 * step, and the failure would be silent — a question asked on a report page
 * quietly not appearing in history is exactly the gap the Overview's own notes
 * warn about, for advice a manager may act on.
 *
 * THREE PROPERTIES IT GUARANTEES, all of them carried over verbatim:
 *
 *   1. AN INLINE ANSWER IS A REAL CHAT TURN. It writes to the same conversation
 *      store the chat screen reads, through the same provider, so a question
 *      typed on a report appears in history exactly as if it had been asked on
 *      the chat page.
 *
 *   2. THE THREAD LIVES IN THE STORE, NOT IN LOCAL STATE. Only the
 *      conversation's id is held here. That is what lets the exchange survive a
 *      refresh, makes `history` on a follow-up the real thread rather than an
 *      empty list, and lets "Continue in Ask Sunny" adopt the SAME conversation
 *      instead of replaying it.
 *
 *   3. A FAILED TURN IS A STORED TURN. The question is written before the
 *      request goes out and a failure is appended as a message, so nothing is
 *      ever lost to silence.
 *
 * IT SENDS NO FIGURES. `reportContext` is pointers only — which family, which
 * period, which salons, which measure — and there is nowhere in it to put a
 * number. The server re-reads the report for itself, which is what stops a stale
 * render or an edited DOM from being treated as a fact about money.
 *
 * THE CONTEXT TRAVELS WITH FOLLOW-UPS TOO, and that is what makes the report
 * conversation work at all: "why is #1 the biggest problem?" names no report
 * and no measure, and the server's routing reads the question's own words.
 */
export interface InlineAskOptions {
  /**
   * What the manager is looking at, when they are asking from a report tab.
   *
   * Null on the Overview, which is asking about nothing in particular.
   */
  reportContext?: ChatReportContext | null;
  /** Told the host when the thread opens or is cleared, so it can react. */
  onActiveChange?: (active: boolean) => void;
}

/** A question kept with the answer it produced. */
export interface InlineExchange {
  question: ChatMessage;
  answer: ChatMessage | null;
}

export function useInlineAsk({ reportContext, onActiveChange }: InlineAskOptions = {}) {
  const { managerDisplayName, primaryLocationName } = useSession();
  const { conversations, addConversation, appendConversationMessages } = useAppStore();
  const provider = useMemo(() => getAIProvider(), []);

  const [mode, setMode] = useState<AnswerMode>("standard");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const thread = useMemo(
    () =>
      conversationId
        ? (conversations.find((entry) => entry.id === conversationId)?.messages ?? [])
        : [],
    [conversations, conversationId],
  );

  const setActive = useCallback(
    (active: boolean) => onActiveChange?.(active),
    [onActiveChange],
  );

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || busy) return;

      setBusy(true);

      const userMessage: ChatMessage = {
        id: createId("msg"),
        role: "user",
        content: text,
        createdAt: nowIso(),
      };

      /*
       * FIRST QUESTION OPENS A CONVERSATION; EVERY LATER ONE APPENDS TO IT.
       *
       * Created BEFORE the answer arrives, for the same reason the chat screen
       * does it: if the request fails, the question and the failure are both
       * already in history rather than lost.
       */
      let id = conversationId;
      /*
       * The thread as it stood when this question was asked — captured before
       * the append, because that is what the model should see, and read from
       * the store rather than from a local copy so a turn added on the chat
       * page in another tab is part of it.
       */
      const history = thread;

      if (id) {
        appendConversationMessages(id, [userMessage]);
      } else {
        const conversation: ChatConversation = {
          id: createId("conv"),
          title: provider.titleForConversation(text),
          createdAt: userMessage.createdAt,
          updatedAt: userMessage.createdAt,
          attachedDocumentIds: [],
          messages: [userMessage],
        };
        id = conversation.id;
        addConversation(conversation);
        setConversationId(conversation.id);
      }

      setActive(true);

      try {
        const response = await provider.ask({
          question: text,
          mode,
          history,
          /* Provenance for a form proposal; names browser-local state only. */
          questionMessageId: userMessage.id,
          /*
           * So answering a proposal's own question inline continues that
           * proposal rather than starting a knowledge query. A template KEY and
           * nothing else; every fact is re-derived and revalidated server-side.
           */
          continueProposalTemplateKey: continuationFor(history)?.templateKey,
          /* Pointers at the view. Never a figure — see the header. */
          reportContext: reportContext ?? null,
          /*
           * NO `todayIso`. The route fills the date from its own clock — the
           * browser used to send the frozen anchor and the route preferred it,
           * so every freshness judgement was made against a day already past.
           */
          context: {
            userName: managerDisplayName,
            locationName: primaryLocationName,
          },
        });

        appendConversationMessages(id, [
          {
            id: createId("msg"),
            role: "assistant",
            content: response.content,
            createdAt: nowIso(),
            mode,
            citations: response.citations,
            coverage: response.coverage ?? "not_applicable",
            recommendedVideoIds: response.recommendedVideoIds,
            followUpSuggestions: response.followUpSuggestions,
            formProposal: response.formProposal,
            formSelection: response.formSelection,
          },
        ]);
      } catch (caught) {
        /* A failed turn is a visible, stored turn — never silence. */
        appendConversationMessages(id, [
          {
            id: createId("msg"),
            role: "assistant",
            content: "",
            createdAt: nowIso(),
            mode,
            error: toChatTurnError(caught, text),
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      mode,
      provider,
      conversationId,
      thread,
      reportContext,
      addConversation,
      appendConversationMessages,
      managerDisplayName,
      primaryLocationName,
      setActive,
    ],
  );

  /*
   * CLEARING LEAVES THE CONVERSATION IN HISTORY. It drops the host back to rest
   * and forgets which thread it was in; it does not delete anything. The
   * exchange is still in the chat page's history, which is the point of writing
   * it to the store in the first place.
   */
  const reset = useCallback(() => {
    setConversationId(null);
    setActive(false);
  }, [setActive]);

  /*
   * The exchanges, question kept with its answer.
   *
   * Built by walking the thread and starting a new pair at each of the
   * manager's turns, rather than by chunking in twos — a turn that failed still
   * appends an assistant message, but nothing guarantees the thread alternates
   * perfectly, and a mis-paired question under someone else's answer is the
   * worst possible way to be wrong here.
   *
   * OLDEST FIRST. The two hosts want opposite orders — the Overview's composer
   * is at the top of the band, so it reverses this to keep the newest answer
   * off the fold — so the natural order is returned and reversing is the
   * caller's decision rather than a flag here.
   */
  const exchanges = useMemo(() => {
    const pairs: InlineExchange[] = [];
    for (const message of thread) {
      if (message.role === "user") {
        pairs.push({ question: message, answer: null });
      } else if (pairs.length > 0 && pairs[pairs.length - 1]!.answer === null) {
        pairs[pairs.length - 1]!.answer = message;
      }
    }
    return pairs;
  }, [thread]);

  return { send, busy, mode, setMode, conversationId, exchanges, reset };
}
