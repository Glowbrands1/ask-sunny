import Link from "next/link";
import { ArrowUp } from "lucide-react";

import { SunMark } from "@/components/brand-mark";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  chatReportContextToParams,
  type ChatReportContext,
} from "@/lib/reporting/read/chat-report-context";
import { REPORT_FAMILIES_BY_ID } from "@/lib/reporting/read/report-families";
import { cn } from "@/lib/utils/cn";

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
 * A PLAIN LINK
 * ============================================================================
 *
 * Not a button with an onClick router push. The destination is a real URL with
 * the whole context in it, so it can be opened in a new tab, bookmarked and
 * shared, and middle-click and Back all behave. A server component, because
 * nothing here needs the browser: the pages have already resolved the filters
 * server-side, which is also what guarantees the pointers describe the view
 * that was actually rendered rather than one the browser inferred.
 *
 * ============================================================================
 * IT IS NOW THE BAND'S ASK BAR, AND ONLY THE PRESENTATION MOVED
 * ============================================================================
 *
 * This was a small bordered pill in the page header's action slot. The current
 * Marquee Reports artifact puts it inside the near-black band as a full-width
 * white bar with the sun, a prompt and a round yellow send control — the same
 * object the Overview and the Chat tab draw, at the report tab's slimmer size.
 *
 * THE WIRING IS UNTOUCHED. Same `ChatReportContext`, same
 * `chatReportContextToParams`, same opening question per family, same `/chat`
 * destination, still no numbers. What changed is the class list and where the
 * five pages mount it. A duplicate "report ask bar" component would have been
 * the wrong move twice over: two controls to keep in step, and the context
 * plumbing copied into the one that did not have it.
 *
 * THE PROMPT IS SHOWN, NOT HIDDEN. The artifact draws the actual question in
 * the bar rather than only the label, because "Ask Sunny about this report" on
 * its own does not tell a manager what they will get. It renders the same
 * `OPENING_QUESTION` string the link carries, so what is on screen and what is
 * asked cannot diverge.
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
  const params = chatReportContextToParams(context);
  params.set("q", OPENING_QUESTION[context.family]);

  return (
    <Link
      href={`/chat?${params.toString()}`}
      className={cn(
        "flex items-center gap-3 rounded-[14px] bg-surface py-2.5 pr-3 pl-4 shadow-ask transition-shadow hover:shadow-ask-focus",
        className,
      )}
    >
      <SunMark className="size-6" onDark />
      <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-placeholder-foreground">
        <span className="font-bold text-foreground">
          Ask {ACTIVE_BRAND.assistantName} about this report
        </span>
        {" — "}
        {OPENING_QUESTION[context.family]}
      </span>
      {/*
        The family is named to the screen reader but not repeated on screen: the
        bar sits under a heading that already says which report this is, and two
        copies of "Bed Usage" a centimetre apart reads as a mistake.
      */}
      <span className="sr-only"> ({family.label})</span>
      <span
        aria-hidden
        className="grid size-[34px] shrink-0 place-items-center rounded-full bg-brand-yellow text-brand-yellow-foreground"
      >
        <ArrowUp className="size-3.5" strokeWidth={2.5} />
      </span>
    </Link>
  );
}
