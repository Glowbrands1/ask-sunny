"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/controls";
import { Notice } from "@/components/ui/feedback";
import {
  Dialog,
  DialogActions,
  DialogClose,
  DialogContent,
} from "@/components/ui/overlays";
import type { AnchorCandidate, AnchorSetupRow } from "@/lib/reviews/anchor-admin";
import { cn } from "@/lib/utils/cn";
import { Stars } from "../review-stars";

/**
 * THE CONTROLS THAT SET A BASELINE.
 *
 * ============================================================================
 * WHAT THIS COMPONENT DOES NOT DECIDE
 * ============================================================================
 *
 * Nothing about reporting. It collects an intention — "count from the newest",
 * or "the last one we counted was this reviewer" — and posts it to
 * `/api/admin/reviews/anchor`. Which reviews that promotes, and whether the
 * boundary may move at all, are decided by `applyAnchors` and the database.
 *
 * THE GOOGLE REVIEW ID IS NEVER SHOWN AND NEVER TYPED. It travels in the
 * request because the API needs a stable key; the person picks a reviewer, a
 * rating and a comment, which is what they have in front of them in the old
 * spreadsheet.
 *
 * AN EXISTING ANCHOR IS A DIFFERENT CONVERSATION. When one is set, the panel
 * shows who it is, states plainly what moving it does, and disables both
 * buttons behind a checkbox. The server refuses the change anyway without
 * `replace: true` — this is the part that makes somebody mean it.
 */

interface AnchorResult {
  storeCode: string;
  status: string;
  anchorReviewer?: string | null;
  assignedAbove?: number;
  leftHistorical?: number;
}

/** What each outcome means, in the words somebody setting this up would use. */
const OUTCOME_LABEL: Record<string, string> = {
  anchor_set: "Anchor set.",
  baseline_set: "Baseline set. Counting starts with the next review received.",
  anchor_exists:
    "This location already has an anchor, so nothing was changed. Use Change anchor if you meant to move it.",
  review_not_held:
    "That review is no longer held for this location. Sync the Reviews page again and retry.",
  nothing_held:
    "No reviews are held for this location yet. Sync the Google Reviews page first.",
  unknown_store: "That store code is not one of the fifteen.",
};

async function postAnchors(
  anchors: { storeCode: string; externalReviewId?: string; fromNewestHeld?: boolean; replace?: boolean }[],
): Promise<{ ok: boolean; results: AnchorResult[]; message?: string }> {
  const response = await fetch("/api/admin/reviews/anchor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anchors }),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      ok: false,
      results: [],
      message:
        body?.error ??
        body?.reason ??
        `ASK Sunny answered ${response.status}. Nothing was changed.`,
    };
  }

  return { ok: true, results: (body?.anchors ?? []) as AnchorResult[] };
}

/* ------------------------------------------------------------- one listing -- */

export function AnchorPanel({
  row,
  candidates,
}: {
  row: AnchorSetupRow;
  candidates: AnchorCandidate[];
}) {
  const router = useRouter();

  const [selected, setSelected] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnchorResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /* An existing anchor must be acknowledged before either button will fire. */
  const blocked = row.trackingActive && !acknowledged;

  const submit = async (
    anchor: { externalReviewId?: string; fromNewestHeld?: boolean },
  ) => {
    setBusy(true);
    setFailure(null);
    setResult(null);
    try {
      const outcome = await postAnchors([
        { storeCode: row.storeCode, ...anchor, replace: row.trackingActive },
      ]);
      if (!outcome.ok) {
        setFailure(outcome.message ?? "Nothing was changed.");
        return;
      }
      setResult(outcome.results[0] ?? null);
      /* The row above this panel is server-rendered, so it has to be re-read. */
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-[var(--radius-lg)] border border-border-strong bg-surface-muted p-5">
      {row.trackingActive ? (
        <Notice
          tone="attention"
          icon={<AlertTriangle />}
          title="This location already has an anchor"
          className="mb-4"
        >
          <p>
            It is counting after{" "}
            <strong>{row.anchorReviewer ?? "a review that is no longer held"}</strong>
            {row.anchorRelativeDate ? ` (${row.anchorRelativeDate})` : ""}. Moving the
            anchor changes where the next sync starts counting and can promote reviews
            that are currently history into the open reporting week.{" "}
            <strong>It cannot un-count anything already counted.</strong>
          </p>
          <CheckboxField
            id={`ack-${row.storeCode}`}
            className="mt-3"
            checked={acknowledged}
            onCheckedChange={setAcknowledged}
            label={`Yes, move the anchor for ${row.locationName}`}
          />
        </Notice>
      ) : null}

      {/* ---------------------------------------------------- option one -- */}
      <section>
        <h4 className="text-[13.5px] font-black text-foreground">
          Start counting after the newest review currently held
        </h4>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
          All {row.historicalReviews} currently imported{" "}
          {row.historicalReviews === 1 ? "review" : "reviews"} will remain historical.
          Reviews received after the current newest review will begin counting toward
          weekly reporting.
        </p>
        <ConfirmButton
          label="Start counting from now"
          disabled={blocked || busy || row.heldReviews === 0}
          busy={busy}
          title={`Start counting from now — ${row.locationName}`}
          description="Nothing currently held will be counted. This draws the line at the newest review ASK Sunny holds for this location."
          confirmLabel="Set baseline"
          onConfirm={() => submit({ fromNewestHeld: true })}
        />
        {row.heldReviews === 0 ? (
          <p className="mt-2 text-[11.5px] text-measure-flagged-foreground">
            No reviews are held for this location yet. Sync the Google Reviews page
            first — there is nothing to draw a line after.
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------- option two -- */}
      <section className="mt-6 border-t border-border-hairline pt-5">
        <h4 className="text-[13.5px] font-black text-foreground">
          Choose the last review already counted
        </h4>
        <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
          Pick the review your previous manual report counted last. Reviews above it in
          Google&rsquo;s newest-first feed will become eligible for the open reporting
          period. <strong>This selected review itself will not be counted again.</strong>
        </p>

        {candidates.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            No historical reviews are held for this location, so there is nothing to
            choose from.
          </p>
        ) : (
          <>
            <ul className="mt-3 flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto pr-1">
              {candidates.map((candidate) => (
                <li key={candidate.externalReviewId}>
                  <button
                    type="button"
                    disabled={blocked || busy}
                    onClick={() =>
                      setSelected(
                        selected === candidate.externalReviewId
                          ? null
                          : candidate.externalReviewId,
                      )
                    }
                    aria-pressed={selected === candidate.externalReviewId}
                    className={cn(
                      "w-full rounded-[12px] border px-3.5 py-2.5 text-left transition-colors disabled:opacity-50",
                      selected === candidate.externalReviewId
                        ? "border-selected bg-selected text-selected-foreground"
                        : "border-border bg-surface hover:bg-hover-surface",
                    )}
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                      <span className="text-[12.5px] font-black">
                        {candidate.reviewerName}
                      </span>
                      <Stars rating={candidate.rating} />
                      <span className="text-[10.5px] opacity-80">
                        {candidate.relativeDateText ?? "no date shown by Google"}
                      </span>
                      <span className="text-[10.5px] opacity-80">
                        {candidate.hasOwnerResponse ? "· Responded" : "· Needs response"}
                      </span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-relaxed opacity-90">
                      {candidate.commentPreview ?? "Rating only — no written comment."}
                    </span>
                    <span className="mt-1 block text-[10.5px] opacity-75">
                      {candidate.inLatestFeed
                        ? candidate.promotesAbove === 0
                          ? "Newest on the last synced page — choosing this counts nothing yet"
                          : `Choosing this counts the ${candidate.promotesAbove} ${
                              candidate.promotesAbove === 1 ? "review" : "reviews"
                            } above it`
                        : /*
                           * A candidate from an older sync is still a valid
                           * boundary; it simply cannot be compared with what is
                           * held now, so nothing gets promoted. Saying so beats
                           * letting somebody expect a number to move.
                           */
                          "From an earlier sync — sets the boundary but promotes nothing"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <ConfirmButton
              className="mt-3"
              label={
                selected
                  ? `Use ${
                      candidates.find((entry) => entry.externalReviewId === selected)
                        ?.reviewerName ?? "the selected review"
                    } as the last counted review`
                  : "Select a review above"
              }
              disabled={blocked || busy || selected === null}
              busy={busy}
              title={`Set the anchor — ${row.locationName}`}
              description={
                selected
                  ? `Reviews above ${
                      candidates.find((entry) => entry.externalReviewId === selected)
                        ?.reviewerName ?? "this review"
                    } will join the open reporting week. That review itself will not be counted again.`
                  : ""
              }
              confirmLabel="Set anchor"
              onConfirm={() =>
                selected ? submit({ externalReviewId: selected }) : Promise.resolve()
              }
            />
          </>
        )}
      </section>

      {failure ? (
        <Notice tone="attention" className="mt-4" icon={<AlertTriangle />}>
          <p>{failure}</p>
        </Notice>
      ) : null}

      {result ? (
        <Notice
          tone={result.status === "anchor_set" || result.status === "baseline_set" ? "primary" : "attention"}
          className="mt-4"
          icon={<Check />}
        >
          <p>
            {OUTCOME_LABEL[result.status] ?? "Nothing was changed."}
            {result.assignedAbove ? (
              <>
                {" "}
                <strong>
                  {result.assignedAbove}{" "}
                  {result.assignedAbove === 1 ? "review" : "reviews"}
                </strong>{" "}
                moved into the open reporting week.
              </>
            ) : null}
            {result.leftHistorical ? (
              <>
                {" "}
                {result.leftHistorical}{" "}
                {result.leftHistorical === 1 ? "review" : "reviews"} could not be
                compared with it and stay historical.
              </>
            ) : null}
          </p>
        </Notice>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- the bulk baseline -- */

export function BulkBaselineButton({ rows }: { rows: AnchorSetupRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<AnchorResult[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * ONLY THE UNCONFIGURED, AND ONLY THOSE WITH SOMETHING TO ANCHOR AGAINST.
   * `applyAnchors` refuses an already-anchored listing whatever this sends —
   * this narrowing is so the confirmation names the listings it will actually
   * affect rather than fifteen of which eleven will be refused.
   */
  const targets = rows.filter((row) => !row.trackingActive && row.heldReviews > 0);
  const skippedEmpty = rows.filter((row) => !row.trackingActive && row.heldReviews === 0);

  const run = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const outcome = await postAnchors(
        /* No `replace` — a settled anchor must survive this button. */
        targets.map((row) => ({ storeCode: row.storeCode, fromNewestHeld: true })),
      );
      if (!outcome.ok) {
        setFailure(outcome.message ?? "Nothing was changed.");
        return;
      }
      setResults(outcome.results);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => {
          setResults(null);
          setFailure(null);
          setOpen(true);
        }}
        disabled={targets.length === 0}
      >
        Baseline all unconfigured locations
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          wide
          title="Baseline all unconfigured locations from their current newest review"
          description="Everything currently held at these locations stays historical. Counting begins with the next review each one receives."
        >
          <div className="px-6 py-5">
            {results ? (
              <>
                <p className="text-[13px] text-foreground">Done. Per location:</p>
                <ul className="mt-3 flex flex-col gap-1">
                  {results.map((entry) => (
                    <li key={entry.storeCode} className="text-[12.5px]">
                      <span className="font-bold">{entry.storeCode}</span>
                      {" — "}
                      <span
                        className={cn(
                          entry.status === "baseline_set"
                            ? "text-status-outperforming"
                            : "text-measure-flagged-foreground",
                        )}
                      >
                        {OUTCOME_LABEL[entry.status] ?? entry.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="text-[13px] leading-relaxed text-foreground">
                  This will set a baseline for{" "}
                  <strong>
                    {targets.length} {targets.length === 1 ? "location" : "locations"}
                  </strong>
                  . Locations that already have an anchor are{" "}
                  <strong>not touched</strong>.
                </p>

                <ul className="mt-3 flex flex-col gap-1">
                  {targets.map((row) => (
                    <li key={row.storeCode} className="text-[12.5px] text-foreground">
                      {row.locationName}{" "}
                      <span className="text-muted-foreground">
                        · store {row.storeCode} · {row.historicalReviews} held{" "}
                        {row.historicalReviews === 1 ? "review" : "reviews"} stay
                        historical
                      </span>
                    </li>
                  ))}
                </ul>

                {skippedEmpty.length > 0 ? (
                  <p className="mt-3 text-[11.5px] text-muted-foreground">
                    {skippedEmpty.length}{" "}
                    {skippedEmpty.length === 1 ? "location holds" : "locations hold"} no
                    reviews yet and cannot be baselined until they are synced:{" "}
                    {skippedEmpty.map((row) => row.locationName).join(", ")}.
                  </p>
                ) : null}

                {failure ? (
                  <Notice tone="attention" className="mt-4" icon={<AlertTriangle />}>
                    <p>{failure}</p>
                  </Notice>
                ) : null}
              </>
            )}

            <DialogActions>
              <DialogClose asChild>
                <Button variant="ghost">{results ? "Close" : "Cancel"}</Button>
              </DialogClose>
              {results ? null : (
                <Button onClick={run} disabled={busy || targets.length === 0}>
                  {busy ? "Setting baselines…" : `Baseline ${targets.length} locations`}
                </Button>
              )}
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------- the button -- */

/**
 * A button whose action is confirmed in a dialog.
 *
 * Every write on this screen goes through one, because each of them moves the
 * line the business counts from and none of them is undoable by pressing the
 * same button again.
 */
function ConfirmButton({
  label,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  busy,
  className,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        className={cn("mt-3", className)}
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title} description={description}>
          <div className="px-6 py-5">
            <DialogActions className="mt-0 border-t-0 pt-0">
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button
                disabled={busy}
                onClick={async () => {
                  await onConfirm();
                  setOpen(false);
                }}
              >
                {busy ? "Working…" : confirmLabel}
              </Button>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
