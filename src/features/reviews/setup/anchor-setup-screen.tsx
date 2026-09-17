import Link from "next/link";
import { ArrowUpRight, Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import {
  ProvenanceChip,
  ProvenanceChips,
  SectionRule,
  StatusChip,
} from "@/components/ui/marquee";
import { ReportBand } from "@/features/reports/report-frame";
import type { AnchorCandidate, AnchorSetupRow } from "@/lib/reviews/anchor-admin";
import { cn } from "@/lib/utils/cn";
import { formatNumber } from "@/lib/utils/format";
import { AnchorPanel, BulkBaselineButton } from "./anchor-actions";

/**
 * ============================================================================
 * GOOGLE REVIEW BASELINE SETUP
 * ============================================================================
 *
 * The screen that turns "nothing is being counted" into "counting from here",
 * for each of the fifteen listings, without anybody touching a Google review
 * id, a terminal or the database.
 *
 * ============================================================================
 * WHY THIS SCREEN HAD TO EXIST
 * ============================================================================
 *
 * The reporting fix made `historical` the default: a review counts only where
 * it was proven to sit above its listing's anchor, so an imported backlog
 * raises no weekly number. That is correct, and it left a hole — the only way
 * to set an anchor was an HTTP call with a Google review id in it. A correct
 * system nobody can start is not a working system.
 *
 * ============================================================================
 * WHAT IT SHOWS FOR EVERY LISTING, AND WHY EACH LINE IS THERE
 * ============================================================================
 *
 *   THE SALON NUMBER BESIDE THE STORE CODE. This is the one screen where the
 *   two numbering systems appear together, and they do not agree: Google's 306
 *   is salon 0462. Printing both is how somebody checks they are anchoring the
 *   salon they think they are.
 *
 *   WHETHER COUNTING IS ACTIVE, in those words. "No baseline set" is the state
 *   every listing starts in and it is not a fault, but it does mean the weekly
 *   number for that salon is zero for a reason that has nothing to do with the
 *   salon.
 *
 *   WHO THE ANCHOR IS, never its id. A person recognises "Tarissa Barry"; a
 *   twenty-digit number tells them nothing and invites copying it around.
 *
 *   HOW MANY REVIEWS ARE HELD AND COUNTED NOWHERE. That is what a baseline
 *   leaves behind, and it is the number somebody needs before choosing between
 *   the two options.
 */

export function AnchorSetupScreen({
  rows,
  openStoreCode,
  candidates,
}: {
  rows: AnchorSetupRow[];
  openStoreCode: string | null;
  candidates: AnchorCandidate[];
}) {
  const tracking = rows.filter((row) => row.trackingActive);
  const waiting = rows.filter((row) => !row.trackingActive);
  const historical = rows.reduce((total, row) => total + row.historicalReviews, 0);

  return (
    <div className="min-w-0">
      <ReportBand
        title="Review Baselines"
        description="Where each Sun Tan City location starts counting Google reviews from"
        provenance={
          <ProvenanceChips>
            <ProvenanceChip emphasis>
              {tracking.length} of {rows.length} tracking
            </ProvenanceChip>
            <ProvenanceChip>
              {formatNumber(historical)} held, counted nowhere
            </ProvenanceChip>
            <ProvenanceChip>Administration</ProvenanceChip>
          </ProvenanceChips>
        }
      />

      <div className="flex min-w-0 flex-col gap-5 px-5 py-5 pb-7 sm:px-6">
        <Notice tone="neutral" icon={<Info />} title="How counting starts">
          <p>
            A location counts reviews from its <strong>baseline</strong> — the last
            review already counted — upward. Until one is set, everything synced for
            that location is stored as history and raises no weekly total. That is what
            stops importing a year of backlog from landing in the week you imported it.
          </p>
          <p className="mt-1.5">
            Set a baseline once per location. After that, each sync counts only what
            arrived above it, and the baseline moves forward on its own.
          </p>
        </Notice>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionRule
            label="Locations"
            className="min-w-[14rem] flex-1"
            action={{ label: "Back to Google Reviews", href: "/reviews" }}
          />
          <BulkBaselineButton rows={rows} />
        </div>

        {waiting.length === 0 ? (
          <Notice tone="primary" icon={<Info />}>
            <p>
              Every location has a baseline. Weekly counting is active across all{" "}
              {rows.length}.
            </p>
          </Notice>
        ) : null}

        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <LocationCard
              key={row.storeCode}
              row={row}
              open={openStoreCode === row.storeCode}
              candidates={openStoreCode === row.storeCode ? candidates : []}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LocationCard({
  row,
  open,
  candidates,
}: {
  row: AnchorSetupRow;
  open: boolean;
  candidates: AnchorCandidate[];
}) {
  /*
   * THE PANEL IS OPENED BY THE URL, not by client state — so a half-finished
   * setup survives a refresh, the browser's Back button closes the panel rather
   * than leaving the page, and "go and baseline KS Manhattan" is a link.
   */
  const toggleHref = open ? "/reviews/setup" : `/reviews/setup?store=${row.storeCode}`;

  return (
    <article
      id={`store-${row.storeCode}`}
      className={cn(
        "scroll-mt-4 rounded-[var(--radius-lg)] border bg-surface p-5 shadow-soft",
        row.trackingActive ? "border-border" : "border-l-[5px] border-l-measure-data border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[15px] font-black text-foreground">{row.locationName}</h3>
          <p className="mt-1 text-[11.5px] text-muted-foreground">
            Google Store Code: <span className="tabular-nums">{row.storeCode}</span>
            {" · "}
            ASK Sunny Salon: <span className="tabular-nums">{row.salonNumber ?? "—"}</span>
            {" · "}
            District: {row.district ?? "not on record"}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {row.trackingActive ? (
              <>
                <StatusChip tone="outperforming">Tracking active</StatusChip>
                <span className="text-[12px] text-foreground">
                  Counting after{" "}
                  <strong>{row.anchorReviewer ?? "a review no longer held"}</strong>
                  {row.anchorRelativeDate ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {row.anchorRelativeDate}
                    </span>
                  ) : null}
                </span>
              </>
            ) : (
              <>
                <StatusChip tone="capacity">No baseline set</StatusChip>
                <span className="text-[12px] text-measure-flagged-foreground">
                  Nothing at this location is counting toward weekly reporting
                </span>
              </>
            )}
          </div>

          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Historical reviews held:{" "}
            <span className="font-bold text-foreground tabular-nums">
              {formatNumber(row.historicalReviews)}
            </span>
            {row.countedReviews > 0 ? (
              <>
                {" · Counted so far: "}
                <span className="font-bold text-foreground tabular-nums">
                  {formatNumber(row.countedReviews)}
                </span>
              </>
            ) : null}
            {row.listingState === "verification_required"
              ? " · Google verification required on this listing"
              : ""}
          </p>
        </div>

        <Link
          href={toggleHref}
          className={cn(
            "pill-action shrink-0",
            open
              ? "bg-surface-muted text-foreground"
              : "bg-selected text-selected-foreground hover:bg-selected-hover",
          )}
        >
          {open ? "Close" : row.trackingActive ? "Change anchor" : "Set baseline"}
          {open ? null : <ArrowUpRight className="ml-1 inline size-3" aria-hidden />}
        </Link>
      </div>

      {open ? <AnchorPanel row={row} candidates={candidates} /> : null}
    </article>
  );
}
