"use client";

import { useRef, useState } from "react";
import { ArrowUp, X } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { AnswerSheet } from "@/features/dashboard/answer-sheet";
import { useInlineAsk } from "@/features/chat/use-inline-ask";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  chatReportContextToParams,
  type ChatReportContext,
} from "@/lib/reporting/read/chat-report-context";
import { REPORT_FAMILIES_BY_ID } from "@/lib/reporting/read/report-families";

/**
 * ============================================================================
 * "ASK SUNNY ABOUT THIS REPORT" — ON EVERY REPORT TAB
 * ============================================================================
 *
 * One control, five dashboards. It opens Chat already talking about what the
 * reader was looking at, and it carries the filter state so the conversation
 * starts in the right place and STAYS there across follow-ups.
 *
 * IT SENDS NO NUMBERS, and that is the property worth stating twice. Every
 * parameter is a pointer at rows — which report, which period, which window,
 * which salons, which districts, which measure, which view. There is no prop on
 * this component through which a figure could be passed and no field in
 * `ChatReportContext` to put one in, because everything on the screen was
 * formatted by a browser and a browser is not a source of truth about money. A
 * stale render, an edited DOM and a replayed response all look identical. The
 * server re-reads the rows and answers from what Postgres said.
 *
 * ============================================================================
 * WHY IT OPENS CHAT RATHER THAN A PANEL
 * ============================================================================
 *
 * The Sales Totals dashboard already has an in-place panel, and it stays: it
 * answers about ONE view, keeps its transcript pinned to that view's
 * fingerprint, and discards it the moment a filter changes. That is the right
 * behaviour for "summarise what I am looking at".
 *
 * This is the other question. "What should I focus on today?" starts on Sales
 * Totals and needs the Comp Report's trend; "why is Spa weak?" starts on Spa
 * Engagement and needs the traffic. Answering those inside a single report's
 * panel would mean either a panel that reads other reports — at which point it
 * is Chat with a worse conversation history — or an answer that stops at the
 * tab boundary. So this hands the question to the pipeline that can already
 * reason across all five families and the Knowledge Base at once, and the
 * follow-ups land there too.
 *
 * ============================================================================
 * IT ANSWERS HERE. IT DOES NOT NAVIGATE AWAY.
 * ============================================================================
 *
 * REPORTED, AND THE REASON IS THE WHOLE POINT OF THE CONTROL: "when I click ask
 * sunny about this reports, it moves me to a different tab which i dont like,
 * can we please stay on the reports so we can ask sunny about it."
 *
 * That is right. A manager asking about the report in front of them wants the
 * answer next to the figures it is about — being thrown to a different screen
 * means reading an answer with the numbers no longer on it, and coming back
 * means finding the filters again. So the bar now holds the conversation in
 * place, exactly as the Overview's band does.
 *
 * IT USES THE SAME SEND PATH AS EVERY OTHER SURFACE — `useInlineAsk`, which was
 * extracted from the Overview's band for this change rather than copied. So an
 * answer here is a REAL CHAT TURN: same provider, same conversation store, and
 * it appears in the chat tab's history and the audit trail exactly as if it had
 * been typed there. A coaching or disciplinary answer that is not on the record
 * is a gap, and an inline answer that skipped history would be one.
 *
 * THE HAND-OFF IS KEPT, NOT FORCED. `AnswerSheet` still offers "Continue in Ask
 * Sunny" on the newest exchange, and it adopts the SAME conversation rather
 * than replaying it — so the manager chooses when to move, instead of the
 * control choosing for them. Follow-up chips continue here.
 *
 * IT STILL SENDS NO NUMBERS. Every parameter is a pointer at rows — which
 * report, which period, which window, which salons, which districts, which
 * measure, which view. There is nowhere in `ChatReportContext` to put a figure,
 * so the server re-reads the rows and answers from what Postgres said.
 *
 * ============================================================================
 * THE BAND'S ASK BAR
 * ============================================================================
 *
 * This was a small bordered pill in the page header's action slot. The current
 * Marquee Reports artifact puts it inside the near-black band as a full-width
 * white bar with the sun, a prompt and a round yellow send control — the same
 * object the Overview and the Chat tab draw, at the report tab's slimmer size.
 *
 * THE PROMPT IS THE PLACEHOLDER, so the field is genuinely typeable and the
 * suggested question is still what a manager gets by pressing send on an empty
 * bar. The artifact draws the question in the bar rather than only the label,
 * because "Ask Sunny about this report" on its own does not say what you will
 * get; making it the placeholder keeps that and makes the control an input
 * rather than a link that looks like one.
 */

/** The opening question, by family. Broad enough to want the manager reasoning. */
const OPENING_QUESTION: Readonly<Record<ChatReportContext["family"], string>> = {
  /*
   * DELIBERATELY NOT "summarise this report" ON ANY OF THEM. A summary is a
   * metric dump, and the framework's first operating rule is that a number is a
   * behaviour signal. Each opening question is the one a manager standing in
   * front of that dashboard actually has, phrased so the routing and the
   * interpretation gate both recognise it.
   */
  "sales-totals":
    "Looking at this Sales Totals view, what should I focus on today and what should I coach?",
  "salon-performance":
    "Looking at this Salon Performance view, are we improving, what is driving it, and what should I focus on?",
  "bed-usage":
    "Looking at this Bed Usage view, how are our beds performing against the chain and where is the biggest opportunity?",
  "spa-wellness":
    "Looking at this Spa Wellness view, which equipment is performing and where is Spa weak?",
  "spa-engagement":
    "Looking at this Spa Engagement view, how is our Spa conversion and what should I coach?",
};

export function AskSunnyAboutReport({
  context,
  className,
}: {
  /**
   * The view, as the page resolved it. Pointers only — see the header.
   *
   * Typed as the whole context rather than as loose props so a caller cannot
   * omit the family, and so adding a pointer later is one type change rather
   * than five call sites that each forgot it.
   */
  context: ChatReportContext;
  className?: string;
}) {
  const family = REPORT_FAMILIES_BY_ID[context.family];
  const suggested = OPENING_QUESTION[context.family];

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState("");
  const { send, busy, conversationId, exchanges, reset } = useInlineAsk({
    reportContext: context,
  });

  /*
   * PRESSING SEND ON AN EMPTY BAR ASKS THE SUGGESTED QUESTION, which is what
   * the control did as a link and what the placeholder promises. Typing
   * replaces it.
   */
  const submit = (text: string) => {
    const question = text.trim() || suggested;
    setValue("");
    void send(question);
  };

  /*
   * NEWEST EXCHANGE FIRST, for the same reason the Overview's band reverses
   * its thread: the composer is ABOVE the answers here, so a chronological
   * list would push each new answer further down and make the manager scroll
   * to read what they just asked for.
   */
  const newestFirst = [...exchanges].reverse();

  return (
    <div className={className}>
      <div className="flex items-center gap-3 rounded-[14px] bg-surface py-2.5 pr-3 pl-4 shadow-ask focus-within:shadow-ask-focus">
        <SunMark className="size-6 shrink-0" onDark />
        <label htmlFor="report-ask" className="sr-only">
          Ask {ACTIVE_BRAND.assistantName} about this report ({family.label})
        </label>
        <textarea
          id="report-ask"
          ref={inputRef}
          rows={1}
          value={value}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(value);
            }
          }}
          placeholder={`Ask ${ACTIVE_BRAND.assistantName} about this report — ${suggested}`}
          className="scroll-slim max-h-24 min-w-0 flex-1 resize-none bg-transparent text-[13.5px] leading-snug text-foreground placeholder:text-placeholder-foreground focus-visible:outline-none"
        />
        {conversationId ? (
          <button
            type="button"
            onClick={reset}
            aria-label="Clear this conversation"
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover-surface hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => submit(value)}
          disabled={busy}
          aria-label={`Ask ${ACTIVE_BRAND.assistantName} about this report`}
          className="grid size-[34px] shrink-0 place-items-center rounded-full bg-brand-yellow text-brand-yellow-foreground transition-opacity disabled:opacity-40"
        >
          <ArrowUp className="size-3.5" strokeWidth={2.5} />
        </button>
      </div>

      {/*
        THINKING, ON THE BAND. The same yellow dots the Overview uses, so the
        wait reads the same wherever a manager asks from.
      */}
      {busy ? (
        <p
          className="mt-2.5 flex items-center gap-2.5 text-[11px] text-band-muted-foreground"
          aria-live="polite"
        >
          <span className="flex items-center gap-1" aria-hidden>
            {[1, 0.55, 0.28].map((opacity, index) => (
              <span
                key={index}
                className="size-1.5 rounded-full bg-brand-yellow"
                style={{
                  opacity,
                  animation: "sunny-pulse-dot 1.1s ease-in-out infinite",
                  animationDelay: `${index * 0.16}s`,
                }}
              />
            ))}
          </span>
          Reading the {family.label} rows for this view
        </p>
      ) : null}

      {/*
        THE ANSWER LANDS ON PAPER, INSIDE THE BAND'S WIDTH BUT NOT ON THE DARK.
        The artifact's rule for the chat tab applies here for the same reason:
        "a six-paragraph policy answer read on near-black is worse than one read
        on paper." So the sheet is a white card sitting on the band rather than
        prose printed on it.
      */}
      {conversationId && newestFirst.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-raised">
          {newestFirst.map((exchange, index) => (
            <div key={exchange.question.id}>
              <div className="flex flex-wrap items-baseline gap-2.5 border-b border-border-row px-5 pt-4 pb-3">
                <span className="eyebrow shrink-0">You asked</span>
                <span className="min-w-0 flex-1 text-[13.5px] font-bold text-foreground">
                  {exchange.question.content}
                </span>
              </div>
              {exchange.answer ? (
                <AnswerSheet
                  message={exchange.answer}
                  conversationId={conversationId}
                  onDismiss={reset}
                  /* Follow-ups continue HERE. Handing off mid-thought is what
                     this change exists to stop. */
                  onAsk={(question) => submit(question)}
                  /* The hand-off link is useful once, on the newest exchange. */
                  showContinue={index === 0}
                />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The `/chat` URL for this view, with the opening question already in it.
 *
 * KEPT AND STILL EXPORTED even though the bar no longer navigates: the
 * hand-off is a real capability the answer sheet offers, and a caller that
 * genuinely wants to open the full chat tab about a report — a deep link in a
 * digest, a keyboard shortcut — should build the URL from the same place rather
 * than assembling the params again.
 */
export function reportChatHref(context: ChatReportContext): string {
  const params = chatReportContextToParams(context);
  params.set("q", OPENING_QUESTION[context.family]);
  return `/chat?${params.toString()}`;
}
