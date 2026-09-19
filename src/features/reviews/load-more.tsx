"use client";

import { useState } from "react";

import { formatNumber } from "@/lib/utils/format";

/**
 * HOW MANY RECORDS A LIST SHOWS BEFORE SOMEBODY ASKS FOR MORE.
 *
 * The page used to render every record it had loaded — eighty-six cards on a
 * first import, and thousands once the backlog lands — which is most of the
 * reason the dashboard could not be read. Twenty is about a screen and a half
 * and is the same step each press reveals.
 */
export const REVEAL_STEP = 20;

/**
 * The reveal counter, shared by the feed and the response queue.
 *
 * ============================================================================
 * IT REVEALS; IT DOES NOT FETCH
 * ============================================================================
 *
 * The server already sent this page of records — the feed is a bounded read and
 * always has been — so "Load more" is a rendering decision, not a round trip.
 * That matters beyond speed: a second fetch would need its own copy of the
 * filters and its own ordering, and a list whose later pages are produced by a
 * slightly different query is exactly how a feed starts contradicting the
 * number above it.
 *
 * WHAT THE SERVER DID NOT SEND IS STILL SAID OUT LOUD. When the read was capped
 * the caller passes the real matching total, and the caption names both figures
 * rather than letting the last press read as the end of the records.
 *
 * THE COUNTER RESETS WHEN THE LIST CHANGES. A filter change re-renders this
 * with a different length; without the reset, narrowing from eighty matches to
 * five would leave the list claiming to show sixty of five.
 *
 * The reset is ADJUSTED DURING RENDER rather than in an effect, which is the
 * pattern React documents for "a prop changed, so this derived state is stale":
 * an effect would paint the old count first and then re-render, and the reader
 * would see the previous list's length flash past.
 */
export function useReveal(length: number, step: number = REVEAL_STEP) {
  const [visible, setVisible] = useState(step);
  const [seenLength, setSeenLength] = useState(length);

  if (seenLength !== length) {
    setSeenLength(length);
    setVisible(step);
  }

  return {
    visible: Math.min(visible, length),
    hasMore: visible < length,
    revealMore: () => setVisible((current) => current + step),
  };
}

/**
 * The button and the count under a revealed list.
 *
 * ONE SENTENCE, THREE FACTS: how many are on screen, how many are in view, and
 * — only when the read was capped — how many match in the database. The third
 * is omitted rather than made equal to the second, because "Showing 20 of 86 of
 * 86" is noise and "Showing 20 of 100" on an estate holding 4,000 is a lie.
 */
export function RevealMore({
  shown,
  loaded,
  total,
  noun = "review",
  onReveal,
  hasMore,
}: {
  /** Records currently rendered. */
  shown: number;
  /** Records this page holds. */
  loaded: number;
  /** Records matching in the database, which may exceed `loaded`. */
  total: number;
  noun?: string;
  onReveal: () => void;
  hasMore: boolean;
}) {
  const plural = total === 1 ? noun : `${noun}s`;

  return (
    <div className="flex flex-col items-center gap-2.5 pt-1">
      <p className="text-[11px] text-muted-foreground">
        Showing {formatNumber(shown)} of {formatNumber(loaded)} {plural}
        {total > loaded ? (
          <>
            {" "}
            loaded, from {formatNumber(total)} matching. Narrow the filters to reach the
            rest.
          </>
        ) : (
          "."
        )}
      </p>
      {hasMore ? (
        <button
          type="button"
          onClick={onReveal}
          className="pill-action bg-selected text-selected-foreground transition-colors hover:bg-selected-hover"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}
