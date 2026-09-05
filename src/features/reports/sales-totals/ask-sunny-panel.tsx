"use client";

import * as React from "react";
import { Loader2, MessageCircleQuestion, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger, SheetContent } from "@/components/ui/overlays";
import { ACTIVE_BRAND } from "@/lib/brand";
import {
  SALES_TOTALS_STARTER_PROMPTS,
  type SalesTotalsAnalysisProvenance,
  type SalesTotalsAnalysisRequest,
  type SalesTotalsAnalysisResponse,
  type SalesTotalsAnalysisTurn,
} from "@/lib/reporting/analysis/types";
import { viewFingerprint } from "@/lib/reporting/analysis/view-fingerprint";
import { cn } from "@/lib/utils/cn";

/**
 * ============================================================================
 * "ASK SUNNY ABOUT THIS REPORT"
 * ============================================================================
 *
 * A side panel on the Sales Totals dashboard. It sends WHICH VIEW the reader is
 * looking at — the date, the window, the estate summary card, the metric and
 * the selected salon numbers — and nothing else.
 *
 * IT DOES NOT SEND THE NUMBERS ON SCREEN, and that is the single most important
 * property of this component. Everything rendered here was formatted by the
 * browser, and a browser is not a source of truth about money: a stale render,
 * an edited DOM or a replayed response would all look identical. So the request
 * carries pointers at rows, the server re-reads those rows from Supabase, and
 * the answer is grounded in what the DATABASE said, not in what this page says.
 * There is deliberately no prop on this component through which a figure could
 * be passed, and no field on the request type to put one in.
 *
 * IT DOES NOT UPLOAD OR ATTACH ANYTHING. The report was ingested when the email
 * arrived. Asking about it re-reads that snapshot; it does not re-send the
 * attachment, and it does not write report rows into the knowledge base.
 *
 * WHAT THE PROVENANCE STRIP IS FOR. The panel shows what the server actually
 * analysed, as the server reported it back — not what this component believes
 * it asked for. If the reader changes the date while an answer is on screen,
 * the strip still describes the answer, so nobody reads Tuesday's analysis
 * under Wednesday's heading.
 *
 * ============================================================================
 * IT IS A CONVERSATION, AND IT ENDS AT THE EDGE OF THE VIEW
 * ============================================================================
 *
 * A manager asks "which salons stand out?" and then "what about EFTs for those
 * stores?". The second question is only answerable with the first, so the panel
 * keeps a transcript and sends the prior turns along.
 *
 * BUT A CONVERSATION BELONGS TO ONE VIEW. Change the date, the window, the
 * measure or the salon selection and the earlier turns are about different
 * numbers; carrying them forward would let one report's figures shape another
 * report's answer while the provenance strip named the second. So the
 * transcript is pinned to `viewFingerprint(view)` and discarded the moment that
 * changes.
 *
 * The panel's copy of that rule is a convenience for the screen. THE SERVER
 * ENFORCES THE REAL ONE: it recomputes the fingerprint from the rows it read
 * and ignores any history that does not match, so a stale browser, a replayed
 * request or a hand-made call cannot talk it into remembering the wrong report.
 *
 * And history is prose. The server rebuilds the authoritative figures from the
 * database on every single question, follow-ups included, and tells the model
 * the fresh grounding wins wherever an earlier turn disagrees.
 */

/** The filters the dashboard is currently showing. Pointers, never figures. */
export interface AskSunnyReportView {
  reportDate: string;
  window: string;
  estateSummaryKey: string;
  metric: string;
  salonIds: readonly string[];
}

/** A completed exchange. Report answers keep the provenance they were read at. */
interface Exchange {
  readonly question: string;
  readonly answer: SalesTotalsAnalysisResponse;
}

/** The panel's whole conversational state, tagged with the view it belongs to. */
interface Conversation {
  readonly fingerprint: string;
  readonly exchanges: readonly Exchange[];
  /** A question awaiting an answer. Rendered, but not yet part of history. */
  readonly pending: string | null;
  readonly failure: { readonly question: string; readonly message: string } | null;
  /** True after a view change discarded a transcript, until the next question. */
  readonly viewChanged: boolean;
}

const ENDPOINT = "/api/reporting/sales-totals/analyze";

/** The identity fields, in the shape the shared fingerprint function wants. */
function descriptorFor(view: AskSunnyReportView) {
  return {
    reportDate: view.reportDate,
    window: view.window,
    estateSummaryKey: view.estateSummaryKey || null,
    metric: view.metric,
    salonIds: view.salonIds,
  };
}

/**
 * Applies a result ONLY IF the conversation is still about the view the
 * question was sent for.
 *
 * The check reads the fingerprint out of `previous`, inside the updater, which
 * is the one place the current value is available without a ref. A reader who
 * changed the date while an answer was in flight gets the answer dropped rather
 * than appended under a heading it does not belong to.
 */
function settle(
  setConversation: React.Dispatch<React.SetStateAction<Conversation>>,
  sentFor: string,
  update: (previous: Conversation) => Conversation,
): void {
  setConversation((previous) =>
    previous.fingerprint === sentFor ? update(previous) : previous,
  );
}

export function AskSunnyReportPanel({ view }: { view: AskSunnyReportView }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  /*
   * THE WHOLE CONVERSATION IN ONE PIECE OF STATE, CARRYING ITS OWN FINGERPRINT.
   *
   * Split across four `useState` calls it could not be checked atomically: an
   * answer arriving after a filter change would have to compare against a
   * fingerprint held in a ref, and a ref cannot be read or written during
   * render. Held together, every update is a functional one that sees the
   * CURRENT fingerprint in `previous` and can refuse to append to a
   * conversation that has since moved to another view.
   */
  const [conversation, setConversation] = React.useState<Conversation>(() => ({
    fingerprint: viewFingerprint(descriptorFor(view)),
    exchanges: [],
    pending: null,
    failure: null,
    viewChanged: false,
  }));

  /*
   * A request in flight when the panel closes must not land in it afterwards.
   * The fingerprint check above covers a change of view; this covers everything
   * else — a close, or a second question sent before the first returned.
   */
  const requestId = React.useRef(0);

  /*
   * THE TRANSCRIPT IS PINNED TO ONE VIEW.
   *
   * Adjusted during render rather than in an effect, so the first paint after a
   * filter change already shows the empty conversation. An effect would render
   * the old transcript once beneath the new view's heading — briefly, but the
   * whole point is that those numbers never appear together.
   */
  const fingerprint = viewFingerprint(descriptorFor(view));

  if (conversation.fingerprint !== fingerprint) {
    setConversation({
      fingerprint,
      exchanges: [],
      pending: null,
      failure: null,
      viewChanged: true,
    });
  }

  /*
   * Read straight off the state, with no fallback for the mismatched case.
   * React re-renders immediately after a render-phase `setState` on the same
   * component, so by the time anything is painted the reset above has already
   * been applied — a defensive second copy of the empty conversation here would
   * be dead code that quietly hid a bug in the reset if one were ever
   * introduced.
   */
  const { exchanges, pending, failure, viewChanged } = conversation;

  const ask = React.useCallback(
    async (question: string, history: readonly Exchange[]) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      const id = ++requestId.current;
      const sentFor = viewFingerprint(descriptorFor(view));

      setConversation((previous) => ({
        ...previous,
        pending: trimmed,
        failure: null,
        viewChanged: false,
      }));

      const body: SalesTotalsAnalysisRequest = {
        question: trimmed,
        reportDate: view.reportDate,
        window: view.window,
        estateSummaryKey: view.estateSummaryKey || null,
        metric: view.metric,
        salonIds: [...view.salonIds],
        history: toTurns(history),
        /*
         * Sent only when there is something to attach it to, and only ever the
         * fingerprint the SERVER returned with the last answer — never the one
         * computed here. The server compares it against the view it actually
         * read; sending its own value back is what makes the comparison mean
         * something.
         */
        historyFingerprint: history.length > 0 ? history[history.length - 1].answer.fingerprint : null,
      };

      try {
        const response = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const payload = (await response.json().catch(() => null)) as
          | (SalesTotalsAnalysisResponse & { error?: string })
          | null;

        if (id !== requestId.current) return;

        if (!response.ok || !payload?.content) {
          settle(setConversation, sentFor, (previous) => ({
            ...previous,
            pending: null,
            failure: {
              question: trimmed,
              // The server's message, which is written to be shown to a manager
              // and carries no report figure. Anything unrecognised falls back
              // to wording chosen here, not to a raw response body.
              message:
                payload?.error ??
                "Sunny could not answer that just now. Nothing was changed — try again.",
            },
          }));
          return;
        }

        settle(setConversation, sentFor, (previous) => ({
          ...previous,
          pending: null,
          exchanges: [...previous.exchanges, { question: trimmed, answer: payload }],
        }));
      } catch {
        if (id !== requestId.current) return;
        settle(setConversation, sentFor, (previous) => ({
          ...previous,
          pending: null,
          failure: {
            question: trimmed,
            message:
              "The request did not reach the server. Check your connection and try again.",
          },
        }));
      }
    },
    [view],
  );

  const busy = pending !== null;

  function send(question: string) {
    // The failed turn is NOT in `exchanges`, so a retry sends the same history
    // the first attempt did rather than the question twice.
    void ask(question, exchanges);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const question = draft;
    setDraft("");
    send(question);
  }

  const empty = exchanges.length === 0 && !busy && !failure;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Closing ends the conversation. Re-opening starts a fresh one rather
        // than resuming a transcript whose view may have moved since.
        if (!next) {
          requestId.current += 1;
          setConversation({
            fingerprint,
            exchanges: [],
            pending: null,
            failure: null,
            viewChanged: false,
          });
          setDraft("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Sparkles aria-hidden />
          Ask {ACTIVE_BRAND.assistantName} about this report
        </Button>
      </DialogTrigger>

      <SheetContent
        title={`Ask ${ACTIVE_BRAND.assistantName} about this report`}
        description="Answers are read from the report in the database for the view you have open — not from the numbers rendered on screen."
        footer={
          <form onSubmit={submit} className="flex items-end gap-2">
            <label htmlFor="ask-sunny-report-question" className="sr-only">
              Ask a question about this report
            </label>
            <textarea
              id="ask-sunny-report-question"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, Shift+Enter makes a new line — the convention
                // every chat surface in this app already uses.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (busy) return;
                  const question = draft;
                  setDraft("");
                  send(question);
                }
              }}
              rows={2}
              maxLength={1000}
              placeholder={
                exchanges.length === 0 ? "Ask about these figures…" : "Ask a follow-up…"
              }
              className="scroll-slim min-h-[3.75rem] flex-1 resize-none rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-selected"
            />
            <Button type="submit" size="sm" disabled={busy || draft.trim().length === 0}>
              {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Ask
            </Button>
          </form>
        }
      >
        <div className="space-y-4">
          <ViewSummary view={view} />

          {viewChanged ? <NewViewNote /> : null}

          {empty ? <StarterPrompts onPick={(question) => send(question)} /> : null}

          {exchanges.map((exchange, index) => (
            <React.Fragment key={`${index}-${exchange.question}`}>
              <QuestionBubble question={exchange.question} />
              <AnswerBubble answer={exchange.answer} />
            </React.Fragment>
          ))}

          {pending !== null ? (
            <>
              <QuestionBubble question={pending} />
              <Thinking />
            </>
          ) : null}

          {failure ? (
            <>
              <QuestionBubble question={failure.question} />
              <ErrorBubble
                message={failure.message}
                onRetry={() => send(failure.question)}
              />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Dialog>
  );
}

/**
 * The transcript, flattened for the wire.
 *
 * PROSE ONLY — the question as it was typed and the answer as it was written.
 * The provenance stays on the client, because it is a label for a reader; the
 * server does not need to be told what it read last time, and telling it would
 * be handing it back its own output to trust.
 */
function toTurns(exchanges: readonly Exchange[]): SalesTotalsAnalysisTurn[] {
  return exchanges.flatMap((exchange) => [
    { role: "user" as const, content: exchange.question },
    { role: "assistant" as const, content: exchange.answer.content },
  ]);
}

/** Said once, when a filter change ended the previous conversation. */
function NewViewNote() {
  return (
    <p className="rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
      The report view changed, so this is a new conversation. Earlier answers
      described different figures and are not carried over.
    </p>
  );
}

/**
 * What is about to be asked about, before anything is asked.
 *
 * Derived from the filters this component was handed, and labelled as such —
 * `AnswerProvenance` below is the one that reports what the SERVER read, and
 * they are kept visually distinct so the second is never mistaken for the
 * first.
 */
function ViewSummary({ view }: { view: AskSunnyReportView }) {
  const selection =
    view.salonIds.length === 0
      ? "all salons in this delivery"
      : `${view.salonIds.length} selected salon${view.salonIds.length === 1 ? "" : "s"}`;

  return (
    <p className="rounded-[var(--radius-sm)] bg-surface-muted px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
      Questions are answered against{" "}
      <span className="font-medium text-foreground">Sales Totals</span> for{" "}
      <span className="font-medium text-foreground">{view.reportDate}</span>,{" "}
      {view.window === "mtd" ? "month to date" : "the previous day"}, covering{" "}
      {selection}.
    </p>
  );
}

function StarterPrompts({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="space-y-2">
      <p className="eyebrow">Start with</p>
      <ul className="space-y-1.5">
        {SALES_TOTALS_STARTER_PROMPTS.map((prompt) => (
          <li key={prompt}>
            <button
              type="button"
              onClick={() => onPick(prompt)}
              className="flex w-full items-start gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-left text-[13px] leading-relaxed text-foreground transition-colors hover:bg-hover-surface focus-visible:ring-2 focus-visible:ring-selected focus-visible:outline-none"
            >
              <MessageCircleQuestion
                className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                aria-hidden
              />
              {prompt}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionBubble({ question }: { question: string }) {
  return (
    <div className="ml-auto max-w-[85%] rounded-[var(--radius-md)] bg-selected px-3 py-2 text-[13px] leading-relaxed text-selected-foreground">
      {question}
    </div>
  );
}

function Thinking() {
  return (
    <div
      className="flex items-center gap-2 text-[13px] text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="size-3.5 animate-spin" aria-hidden />
      Reading the report…
    </div>
  );
}

function AnswerBubble({ answer }: { answer: SalesTotalsAnalysisResponse }) {
  return (
    <div className="space-y-3" aria-live="polite">
      <div className="rounded-[var(--radius-md)] border border-border bg-surface-muted px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
        {answer.content}
      </div>
      <AnswerProvenance provenance={answer.provenance} />
    </div>
  );
}

/**
 * WHERE THE ANSWER CAME FROM — as the SERVER reported it.
 *
 * Not a source citation, and it must never grow into one. Nothing was retrieved
 * from the knowledge base for a report answer, so a numbered document card here
 * would be a reference to a document that does not exist. What a reader needs
 * instead is which report, which date, which window and which salons — enough
 * to reproduce the answer from the dashboard themselves.
 */
function AnswerProvenance({
  provenance,
}: {
  provenance: SalesTotalsAnalysisProvenance;
}) {
  const facts = [
    provenance.reportType,
    provenance.reportDateLabel,
    provenance.windowLabel,
    provenance.isAllSalons
      ? `All ${provenance.salonCount} salons in this delivery`
      : `${provenance.salonCount} salon${provenance.salonCount === 1 ? "" : "s"} selected`,
    `Metric: ${provenance.selectedMetric}`,
    provenance.estateSummaryLabel ? `Estate summary: ${provenance.estateSummaryLabel}` : null,
  ].filter((fact): fact is string => Boolean(fact));

  return (
    <div className="space-y-1.5">
      <p className="eyebrow">Read from</p>
      <ul className="flex flex-wrap gap-1.5">
        {facts.map((fact) => (
          <li
            key={fact}
            className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {fact}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A failure a reader can act on.
 *
 * ALWAYS RETRYABLE, because none of the ways this can fail leaves anything
 * behind: no report row is written, no figure is cached, and nothing was
 * changed. The message is the server's own, which is written for a manager and
 * carries no request body, no report value and no configuration detail.
 */
function ErrorBubble({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "space-y-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-[13px] leading-relaxed",
        "border-[color-mix(in_srgb,var(--status-failed)_28%,transparent)] bg-status-failed-bg text-status-failed",
      )}
    >
      <p>{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
