"use client";

import * as React from "react";
import { History } from "lucide-react";

import { businessToday } from "@/lib/business-date";
import {
  displayCalendarDate,
  positionIn,
  revisionMarkText,
  type RevisionEntry,
  type RevisionHistoryResponse,
} from "@/lib/forms/revision-history";

/**
 * ============================================================================
 * "REVISION 2 OF 1A2B3C4D", WHAT IT SUPERSEDES, AND THE HISTORY
 * ============================================================================
 *
 * `FORM_REVISIONS_ENABLED`. The same marks the PDF prints, over the form, and
 * the chain under a History disclosure: every version, its number, why it was
 * opened and when it was finalized, each one openable. A form nobody revised
 * shows nothing at all.
 */

const STATUS_LABEL: Record<RevisionEntry["status"], string> = {
  draft: "Draft",
  finalized: "Finalized",
  revised: "Superseded",
};

function on(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : displayCalendarDate(businessToday(parsed));
}

export function RevisionBanner({
  data,
  onOpen,
}: {
  data: RevisionHistoryResponse;
  /** Shows another version of the form, where this banner lives. */
  onOpen: (entry: RevisionEntry) => void;
}) {
  const position = positionIn(data.history);
  if (!position || data.history.entries.length < 2) return null;
  const { current, previous } = position;
  const superseded = current.status === "revised";

  return (
    <div
      id="history"
      data-testid="form-revision-marks"
      className="mt-3 rounded-[var(--radius-md)] border border-border bg-surface-muted px-3 py-2 text-xs leading-relaxed"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {data.label ? <span className="font-semibold text-foreground">{data.label}</span> : null}
        {previous ? (
          <button
            type="button"
            onClick={() => onOpen(previous)}
            className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            View previous
          </button>
        ) : null}
        {data.marks.map((mark) => (
          <span
            key={mark.kind}
            className={superseded && mark.kind === "superseded" ? "font-semibold text-status-attention" : "text-muted-foreground"}
          >
            {revisionMarkText(mark, displayCalendarDate)}
          </span>
        ))}
      </div>
      <details className="mt-1">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
          <History className="size-3.5" aria-hidden />
          History ({data.history.entries.length} versions)
        </summary>
        <ol className="mt-2 space-y-1.5">
          {data.history.entries.map((entry) => (
            <li key={entry.id} data-testid="form-revision-entry" className="text-muted-foreground">
              <span className="font-medium text-foreground">
                {entry.revisionNumber === 0 ? "Original" : `Revision ${entry.revisionNumber}`}
              </span>
              {` · ${entry.reference} · ${STATUS_LABEL[entry.status]}`}
              {on(entry.finalizedAt) ? ` · finalized ${on(entry.finalizedAt)}` : ""}
              {entry.reason ? ` · Reason: ${entry.reason}` : ""}
              {entry.id === current.id ? (
                <span className="ml-1 text-subtle-foreground">(this version)</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(entry)}
                  className="ml-1 underline underline-offset-4 hover:text-foreground"
                >
                  Open
                </button>
              )}
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
