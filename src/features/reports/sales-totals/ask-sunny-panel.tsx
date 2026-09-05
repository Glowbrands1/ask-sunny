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
} from "@/lib/reporting/analysis/types";
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
 * ONE QUESTION AT A TIME, no transcript. Each answer is about the view as it
 * stood when it was asked; keeping a scrollback would invite comparing two
 * answers drawn from two different selections as though they described one.
 */

/** The filters the dashboard is currently showing. Pointers, never figures. */
export interface AskSunnyReportView {
  reportDate: string;
  window: string;
  estateSummaryKey: string;
  metric: string;
  salonIds: readonly string[];
}

type PanelState =
  | { status: "idle" }
  | { status: "loading"; question: string }
  | { status: "answered"; question: string; answer: SalesTotalsAnalysisResponse }
  | { status: "error"; question: string; message: string };

const ENDPOINT = "/api/reporting/sales-totals/analyze";

export function AskSunnyReportPanel({ view }: { view: AskSunnyReportView }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [state, setState] = React.useState<PanelState>({ status: "idle" });

  /*
   * A request in flight when the panel closes must not land in it later. The
   * counter is compared on arrival, so a superseded answer is dropped rather
   * than rendered under a question the reader has moved on from.
   */
  const requestId = React.useRef(0);

  const ask = React.useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed) return;

      const id = ++requestId.current;
      setState({ status: "loading", question: trimmed });

      const body: SalesTotalsAnalysisRequest = {
        question: trimmed,
        reportDate: view.reportDate,
        window: view.window,
        estateSummaryKey: view.estateSummaryKey || null,
        metric: view.metric,
        salonIds: [...view.salonIds],
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
          setState({
            status: "error",
            question: trimmed,
            // The server's message, which is written to be shown to a manager
            // and carries no report figure. Anything unrecognised falls back to
            // wording chosen here rather than to a raw response body.
            message:
              payload?.error ??
              "Sunny could not answer that just now. Nothing was changed — try again.",
          });
          return;
        }

        setState({ status: "answered", question: trimmed, answer: payload });
      } catch {
        if (id !== requestId.current) return;
        setState({
          status: "error",
          question: trimmed,
          message:
            "The request did not reach the server. Check your connection and try again.",
        });
      }
    },
    [view],
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const question = draft;
    setDraft("");
    void ask(question);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Closing abandons any answer in flight, so re-opening starts clean
        // rather than showing an answer to a question asked before the reader
        // changed the filters.
        if (!next) {
          requestId.current += 1;
          setState({ status: "idle" });
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
                  const question = draft;
                  setDraft("");
                  void ask(question);
                }
              }}
              rows={2}
              maxLength={1000}
              placeholder="Ask about these figures…"
              className="scroll-slim min-h-[3.75rem] flex-1 resize-none rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-selected"
            />
            <Button
              type="submit"
              size="sm"
              disabled={state.status === "loading" || draft.trim().length === 0}
            >
              {state.status === "loading" ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Ask
            </Button>
          </form>
        }
      >
        <div className="space-y-4">
          <ViewSummary view={view} />

          {state.status === "idle" ? (
            <StarterPrompts onPick={(question) => void ask(question)} />
          ) : null}

          {state.status !== "idle" ? (
            <QuestionBubble question={state.question} />
          ) : null}

          {state.status === "loading" ? <Thinking /> : null}

          {state.status === "answered" ? (
            <AnswerBubble answer={state.answer} />
          ) : null}

          {state.status === "error" ? (
            <ErrorBubble
              message={state.message}
              onRetry={() => void ask(state.question)}
            />
          ) : null}
        </div>
      </SheetContent>
    </Dialog>
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
