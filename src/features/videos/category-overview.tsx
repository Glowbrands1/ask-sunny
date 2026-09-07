"use client";

import { Card, CardContent } from "@/components/ui/card";
import { VIDEO_CATEGORIES } from "@/lib/videos/categories";
import { cn } from "@/lib/utils/cn";
import { pluralize } from "@/lib/utils/format";
import type { VideoCategory } from "@/types";

/**
 * ============================================================================
 * THE LIBRARY'S SHAPE, VISIBLE ON THE PAGE
 * ============================================================================
 *
 * Categories were only ever horizontal filter chips, which answer "what can I
 * filter by" and not "what does this library contain". A manager could not see
 * that Training has one video and Cleaning has none without clicking through
 * seven chips.
 *
 * EVERY CANONICAL CATEGORY APPEARS, INCLUDING THE EMPTY ONES. A zero is
 * information — it says the library has a gap there — and hiding it would make
 * the overview a second copy of the filter chips. They are shown as small
 * tiles rather than seven large panels, so six zeros cost a couple of rows
 * rather than a screenful.
 *
 * IT IS ALSO NAVIGATION. Each tile selects its category, so the overview
 * answers the question and acts on the answer.
 */
export function CategoryOverview({
  counts,
  active,
  onSelect,
}: {
  /** Videos per category. A missing key reads as zero. */
  counts: Partial<Record<VideoCategory, number>>;
  active: VideoCategory | "all";
  onSelect: (category: VideoCategory | "all") => void;
}) {
  const total = VIDEO_CATEGORIES.reduce(
    (sum, entry) => sum + (counts[entry.id] ?? 0),
    0,
  );

  return (
    <Card className="mb-5">
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="eyebrow">Library by category</p>
          <button
            type="button"
            onClick={() => onSelect("all")}
            className={cn(
              "text-xs transition-colors",
              active === "all"
                ? "font-semibold text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All · {total} {pluralize(total, "video")}
          </button>
        </div>

        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {VIDEO_CATEGORIES.map((entry) => {
            const count = counts[entry.id] ?? 0;
            const selected = active === entry.id;

            return (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => onSelect(selected ? "all" : entry.id)}
                  aria-pressed={selected}
                  className={cn(
                    "w-full rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors",
                    selected
                      ? "border-selected bg-selected text-selected-foreground"
                      : "border-border bg-surface hover:bg-hover-surface",
                  )}
                >
                  <span className="block text-[13px] font-medium">{entry.label}</span>
                  <span
                    className={cn(
                      "mt-0.5 block text-xs tabular-nums",
                      selected
                        ? "text-selected-foreground/75"
                        : count === 0
                          ? "text-subtle-foreground"
                          : "text-muted-foreground",
                    )}
                  >
                    {count} {pluralize(count, "video")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
