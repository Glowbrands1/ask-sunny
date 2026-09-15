"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EyeOff, RotateCcw, Search, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
} from "@/components/ui/overlays";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { ROLE_LABEL } from "@/lib/permissions";
import {
  FEEDBACK_OUTCOMES,
  FEEDBACK_RATINGS,
  FEEDBACK_STATUSES,
  OUTCOME_LABEL,
  RESOLUTION_NOTE_MAX_LENGTH,
  STATUS_LABEL,
  type FeedbackStatus,
} from "@/lib/feedback/types";
import {
  EMPTY_FEEDBACK_FILTERS,
  hasActiveFeedbackFilters,
  serializeFeedbackFilters,
  type FeedbackFilters,
} from "@/lib/analytics/feedback-filters";
import { serializeFilters, type AnalyticsFilters } from "@/lib/analytics/filters";
import {
  ACTIVITY_SURFACES,
  CATEGORY_LABEL,
  SURFACE_LABEL,
} from "@/lib/analytics/taxonomy";
import type { FeedbackItem, FeedbackPage } from "@/lib/analytics/feedback-queries";
import { SingleSelectMenu, useQueryNavigation } from "@/features/reports/filter-menu";

/**
 * SUGGESTIONS & COMMENTS — the moderation queue.
 *
 * ============================================================================
 * IT IS A WORK QUEUE, NOT A FEED
 * ============================================================================
 *
 * The dashboard this is modelled on prints comments as a scrolling list with no
 * state and nothing to do about them. That is a feed, and a feed of complaints
 * is read once and then avoided — there is no way to tell what has been dealt
 * with, so every visit re-reads the same nine things.
 *
 * So every item carries a status, every action is one click, and the filters
 * default to nothing hidden. "What is still pending" is the question this page
 * exists to answer.
 *
 * ============================================================================
 * TWO SETS OF FILTERS IN ONE URL
 * ============================================================================
 *
 * The shared analytics filters — date, district, salon, role — narrow this like
 * they narrow every other panel, and are edited by the bar above. The queue's
 * own five are edited here. Both are serialised into the same query string so a
 * link to "pending 1-stars on Spa Engagement, this month, Knoxville" is one URL
 * somebody can send.
 *
 * ============================================================================
 * HIDING IS NOT DELETING, AND THE UI SAYS SO
 * ============================================================================
 *
 * There is no delete control because there is no delete route. Hiding is
 * confirmed, attributed, reversible, and the hidden items stay one filter away.
 * An administrator who wants an abusive comment off the dashboard gets exactly
 * that; nobody gets the ability to make it as though nobody complained.
 */
export function FeedbackQueue({
  base,
  filters,
  queue,
  page,
}: {
  base: string;
  filters: AnalyticsFilters;
  queue: FeedbackFilters;
  page: FeedbackPage;
}) {
  const { apply, pending } = useQueryNavigation(base);
  const [open, setOpen] = React.useState<FeedbackItem | null>(null);

  /**
   * Both filter sets, merged, so editing one never drops the other.
   *
   * THE PAGE RESETS ON EVERY CHANGE BUT PAGING ITSELF. Narrowing to "pending"
   * while on page 4 of the unfiltered queue would otherwise land on an empty
   * page whose controls all look correct, which reads as "no pending feedback"
   * when the truth is "there are eleven, three pages back".
   */
  const push = React.useCallback(
    (next: Partial<FeedbackFilters>, keepPage = false) => {
      const merged: FeedbackFilters = {
        ...queue,
        ...next,
        page: keepPage ? (next.page ?? queue.page) : 1,
      };
      const params = new URLSearchParams(serializeFilters(filters));
      for (const [key, value] of new URLSearchParams(
        serializeFeedbackFilters(merged),
      )) {
        params.set(key, value);
      }
      apply(params);
    },
    [apply, filters, queue],
  );

  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));

  return (
    <div className="space-y-4">
      <QueueFilters queue={queue} onChange={push} pending={pending} />

      {page.items.length === 0 ? (
        <EmptyState
          title={
            hasActiveFeedbackFilters(queue)
              ? "No feedback matches these filters"
              : "No feedback in this period"
          }
          description={
            hasActiveFeedbackFilters(queue)
              ? "Clear a filter to widen the search. Hidden comments are excluded unless you ask for them."
              : "Ratings are collected under every Ask Sunny answer and appear here as they arrive. Nothing is backfilled."
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-border-row rounded-[var(--radius-lg)] border border-border bg-surface">
            {page.items.map((item) => (
              <QueueRow key={item.id} item={item} onOpen={() => setOpen(item)} />
            ))}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12.5px] text-muted-foreground">
              {formatNumber(page.total)}{" "}
              {page.total === 1 ? "comment" : "comments"} · page {page.page} of{" "}
              {pages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page.page <= 1 || pending}
                onClick={() => push({ page: page.page - 1 }, true)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page.page >= pages || pending}
                onClick={() => push({ page: page.page + 1 }, true)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}

      {/*
        KEYED ON THE ITEM, so opening a second comment remounts the panel with
        its own note rather than an effect overwriting the first one's. Same
        reason as the search box: `react-hooks/set-state-in-effect` forbids
        writing state from an effect, and a remount has no wrong intermediate
        render to correct.
      */}
      {open ? (
        <FeedbackDetail key={open.id} item={open} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- filters --- */

function QueueFilters({
  queue,
  onChange,
  pending,
}: {
  queue: FeedbackFilters;
  onChange: (next: Partial<FeedbackFilters>) => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/*
        KEYED ON THE TERM IN THE URL, so Reset and the back button remount the
        box with the right value instead of an effect writing state after the
        render that got it wrong. `react-hooks/set-state-in-effect` forbids the
        latter, and a remount is the better answer anyway: there is no moment
        where the field shows a term the page is not filtered by.
      */}
      <SearchBox key={queue.search} initial={queue.search} onSearch={onChange} pending={pending} />

      <SingleSelectMenu
        label="Status"
        emptyLabel="Any status"
        selected={queue.status}
        pending={pending}
        options={FEEDBACK_STATUSES.map((status) => ({
          value: status,
          label: STATUS_LABEL[status],
        }))}
        onChange={(value) =>
          onChange({ status: (value || null) as FeedbackStatus | null })
        }
      />

      <SingleSelectMenu
        label="Rating"
        emptyLabel="Any rating"
        selected={queue.rating ? String(queue.rating) : null}
        pending={pending}
        options={[...FEEDBACK_RATINGS].reverse().map((value) => ({
          value: String(value),
          label: `${value} ${value === 1 ? "star" : "stars"}`,
        }))}
        onChange={(value) =>
          onChange({
            rating: value
              ? (Number(value) as FeedbackFilters["rating"])
              : null,
          })
        }
      />

      <SingleSelectMenu
        label="Outcome"
        emptyLabel="Any outcome"
        selected={queue.outcome}
        pending={pending}
        options={FEEDBACK_OUTCOMES.map((outcome) => ({
          value: outcome,
          label: OUTCOME_LABEL[outcome],
        }))}
        onChange={(value) =>
          onChange({ outcome: (value || null) as FeedbackFilters["outcome"] })
        }
      />

      <SingleSelectMenu
        label="Surface"
        emptyLabel="Any surface"
        selected={queue.surface}
        pending={pending}
        options={ACTIVITY_SURFACES.map((surface) => ({
          value: surface,
          label: SURFACE_LABEL[surface],
        }))}
        onChange={(value) =>
          onChange({ surface: (value || null) as FeedbackFilters["surface"] })
        }
      />

      <Button
        variant={queue.includeHidden ? "primary" : "secondary"}
        size="sm"
        disabled={pending}
        onClick={() => onChange({ includeHidden: !queue.includeHidden })}
        aria-pressed={queue.includeHidden}
      >
        <EyeOff className="size-3.5" aria-hidden />
        {queue.includeHidden ? "Showing hidden" : "Show hidden"}
      </Button>

      {hasActiveFeedbackFilters(queue) ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onChange(EMPTY_FEEDBACK_FILTERS)}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset
        </Button>
      ) : null}
    </div>
  );
}

/**
 * THE SEARCH BOX, UNCONTROLLED BY THE URL AND SUBMITTING ON ENTER.
 *
 * Not debounced-as-you-type: each keystroke would be a server round trip and a
 * history entry, so the back button would walk back through "p", "pe", "pen".
 * A form submit is one navigation and one entry, and Enter is what a search box
 * already promises.
 */
function SearchBox({
  initial,
  onSearch,
  pending,
}: {
  initial: string;
  onSearch: (next: Partial<FeedbackFilters>) => void;
  pending: boolean;
}) {
  const [term, setTerm] = React.useState(initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSearch({ search: term });
      }}
      className="flex items-center gap-1.5 rounded-full border border-border-strong bg-surface py-1.5 pr-1.5 pl-3"
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <label htmlFor="feedback-search" className="sr-only">
        Search comments
      </label>
      <input
        id="feedback-search"
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search comments"
        className="w-44 bg-transparent text-[12.5px] text-foreground placeholder:text-placeholder-foreground focus-visible:outline-none"
      />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        Search
      </Button>
    </form>
  );
}

/* ----------------------------------------------------------------- row --- */

function QueueRow({ item, onOpen }: { item: FeedbackItem; onOpen: () => void }) {
  return (
    <li
      className={cn(
        "px-4 py-3.5",
        /* Hidden items are visibly set apart, never silently identical. */
        item.hiddenAt && "bg-surface-muted",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <StatusChip status={item.status} hidden={Boolean(item.hiddenAt)} />
        <RatingStars rating={item.rating} />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 basis-full text-left text-[13.5px] leading-relaxed text-foreground underline-offset-2 hover:underline sm:basis-auto"
        >
          {/*
            THE COMMENT IS THE ROW, and clicking it opens the detail. Verbatim
            and unclipped: a truncated complaint is one an administrator has to
            open to read, which is a click for every row on the page.
          */}
          “{item.comment}”
        </button>
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
        <span>{OUTCOME_LABEL[item.gotWhatNeeded]}</span>
        <span aria-hidden>·</span>
        <span>{item.surface ? SURFACE_LABEL[item.surface] : "Surface not recorded"}</span>
        {item.category ? (
          <>
            <span aria-hidden>·</span>
            <span>{CATEGORY_LABEL[item.category]}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <span>
          {item.displayName ?? "Unattributed"}
          {item.role ? ` (${ROLE_LABEL[item.role]})` : ""}
        </span>
        {item.storeName ? (
          <>
            <span aria-hidden>·</span>
            <span>{item.storeName}</span>
          </>
        ) : null}
        <span aria-hidden>·</span>
        <time dateTime={item.createdAt}>{shortDate(item.createdAt)}</time>
      </p>

      <div className="mt-2.5">
        <ModerationActions item={item} />
      </div>
    </li>
  );
}

/* ---------------------------------------------------------- the actions -- */

function ModerationActions({ item }: { item: FeedbackItem }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/admin/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error ?? "That change could not be saved.");
      }
      /*
       * THE SERVER RE-RENDERS, rather than this component patching its own copy
       * of the row. The list is server-computed and so are the queue counts in
       * the summary above it — updating one in place would leave "12 pending"
       * on screen next to eleven pending rows.
       */
      router.refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That change failed.");
    } finally {
      setBusy(false);
    }
  };

  const hidden = Boolean(item.hiddenAt);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.status !== "in_review" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void patch({ status: "in_review" })}
        >
          Start review
        </Button>
      ) : null}
      {item.status !== "resolved" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void patch({ status: "resolved" })}
        >
          Resolve
        </Button>
      ) : null}
      {item.status !== "dismissed" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void patch({ status: "dismissed" })}
        >
          Dismiss
        </Button>
      ) : null}
      {item.status !== "pending" ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void patch({ status: "pending" })}
        >
          Reopen
        </Button>
      ) : null}

      <HideControl item={item} busy={busy} onConfirm={() => patch({ hidden: !hidden })} />

      {problem ? (
        <span role="alert" className="text-[11.5px] font-bold text-measure-flagged-foreground">
          {problem}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Hiding asks first. Restoring does not.
 *
 * THE CONFIRMATION IS ON THE DESTRUCTIVE-LOOKING DIRECTION ONLY, which is the
 * rule worth keeping: a dialog in front of an action that puts something BACK
 * teaches people to click through dialogs, which is exactly how the one in
 * front of the removal stops working.
 */
function HideControl({
  item,
  busy,
  onConfirm,
}: {
  item: FeedbackItem;
  busy: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const hidden = Boolean(item.hiddenAt);

  if (hidden) {
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onConfirm()}>
        Restore
      </Button>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        <EyeOff className="size-3.5" aria-hidden />
        Hide
      </Button>
      <DialogContent
        title="Hide this comment?"
        description="It disappears from the feedback list, and stops counting toward the average rating and the distribution."
      >
        <div className="px-6 py-4">
          <p className="text-[13px] leading-relaxed text-body-foreground">
            “{item.comment}”
          </p>
          {/*
            THE THING PEOPLE ACTUALLY NEED TO KNOW BEFORE CLICKING: it is
            reversible and it is recorded. Without this line "Hide" reads like a
            delete, and an administrator hesitates over a reversible action.
          */}
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            Nothing is deleted. The record stays, your name and the time are
            recorded against it, and you can restore it from the “Show hidden”
            filter.
          </p>
          <DialogActions>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                void onConfirm();
              }}
            >
              Hide comment
            </Button>
          </DialogActions>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------- the detail --- */

function FeedbackDetail({
  item,
  onClose,
}: {
  item: FeedbackItem;
  onClose: () => void;
}) {
  const router = useRouter();
  /*
   * A LAZY INITIALIZER, and the caller remounts this on every item. Together
   * those replace the effect that used to sync the note — see the key above.
   */
  const [note, setNote] = React.useState(() => item.resolutionNote ?? "");
  const [busy, setBusy] = React.useState(false);

  const saveNote = async () => {
    setBusy(true);
    try {
      await fetch(`/api/admin/feedback/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolutionNote: note }),
      });
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        wide
        title="Feedback detail"
        description="The rating, what was said, and the shape of the turn it is about."
      >
        <div className="space-y-4 px-6 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <RatingStars rating={item.rating} />
            <StatusChip status={item.status} hidden={Boolean(item.hiddenAt)} />
            <span className="text-[12.5px] text-muted-foreground">
              Got what they needed: {OUTCOME_LABEL[item.gotWhatNeeded]}
            </span>
          </div>

          <p className="text-[14px] leading-relaxed text-foreground">
            “{item.comment}”
          </p>

          <dl className="grid gap-x-6 gap-y-2 text-[12.5px] sm:grid-cols-2">
            <Fact label="Left by">
              {item.displayName ?? "Unattributed"}
              {item.role ? ` · ${ROLE_LABEL[item.role]}` : ""}
            </Fact>
            <Fact label="Salon">
              {item.storeName ?? "Not recorded"}
              {item.district ? ` · ${item.district}` : ""}
            </Fact>
            <Fact label="Surface">
              {item.surface ? SURFACE_LABEL[item.surface] : "Not recorded"}
            </Fact>
            <Fact label="Topic">
              {item.category ? CATEGORY_LABEL[item.category] : "Not recorded"}
            </Fact>
            <Fact label="Answer completed">
              {item.succeeded ? "Yes" : "No — the turn errored"}
            </Fact>
            <Fact label="Answered at">{longDate(item.occurredAt)}</Fact>
            <Fact label="Rated at">{longDate(item.createdAt)}</Fact>
            <Fact label="Turn reference">
              <code className="text-[11px]">{item.turnId}</code>
            </Fact>
            {item.resolvedAt ? (
              <Fact label="Closed by">
                {item.resolvedByName ?? "Unknown"} · {longDate(item.resolvedAt)}
              </Fact>
            ) : null}
            {item.hiddenAt ? (
              <Fact label="Hidden by">
                {item.hiddenByName ?? "Unknown"} · {longDate(item.hiddenAt)}
              </Fact>
            ) : null}
          </dl>

          {/*
            WHAT IS DELIBERATELY NOT HERE: the question and the answer.
            Neither is stored anywhere in this schema — managers ask Ask Sunny
            about named employees' attendance and performance, and an adoption
            dashboard needs to know THAT somebody asked, never WHAT. The turn
            reference, the surface and the topic are what an administrator can
            actually act on.
          */}
          <p className="rounded-lg bg-surface-muted px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
            The question and the answer are not shown because they are not
            stored. Ask Sunny records that a question was asked, which topic it
            was about and which surface it came from — never the text. Use the
            turn reference above if you need to correlate with a report of a
            specific conversation.
          </p>

          <div>
            <label
              htmlFor="resolution-note"
              className="text-[12.5px] font-bold text-foreground"
            >
              Internal resolution note
            </label>
            <textarea
              id="resolution-note"
              rows={3}
              value={note}
              maxLength={RESOLUTION_NOTE_MAX_LENGTH}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What was done about this, or why nothing was."
              className="scroll-slim mt-1.5 w-full resize-none rounded-lg border border-border-strong bg-surface px-3 py-2 text-[13px] text-foreground placeholder:text-placeholder-foreground focus-visible:border-brand-yellow focus-visible:outline-none"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Internal only. The person who left the feedback never sees this.
            </p>
          </div>

          <DialogActions>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void saveNote()}>
              {busy ? "Saving…" : "Save note"}
            </Button>
          </DialogActions>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-body-foreground">{children}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- atoms --- */

function RatingStars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5">
      <span className="sr-only">{rating} out of 5 stars</span>
      {FEEDBACK_RATINGS.map((value) => (
        <Star
          key={value}
          aria-hidden
          className={cn(
            "size-3.5",
            value <= rating
              ? "fill-brand-yellow text-brand-yellow"
              : "text-border-strong",
          )}
        />
      ))}
    </span>
  );
}

function StatusChip({
  status,
  hidden,
}: {
  status: FeedbackStatus;
  hidden: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span
        className={cn(
          "rounded-[4px] px-2 py-[3px] text-[9px] font-black tracking-[0.08em] uppercase",
          status === "pending" && "bg-brand-yellow text-brand-yellow-foreground",
          status === "in_review" && "bg-band text-band-foreground",
          status === "resolved" &&
            "bg-measure-positive-soft text-measure-positive-foreground",
          status === "dismissed" && "bg-surface-muted text-muted-foreground",
        )}
      >
        {STATUS_LABEL[status]}
      </span>
      {hidden ? (
        <span className="rounded-[4px] bg-measure-flagged-soft px-2 py-[3px] text-[9px] font-black tracking-[0.08em] text-measure-flagged-foreground uppercase">
          Hidden
        </span>
      ) : null}
    </span>
  );
}

function shortDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function longDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
