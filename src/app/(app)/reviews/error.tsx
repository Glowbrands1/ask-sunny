"use client";

import { Info } from "lucide-react";

import { Notice } from "@/components/ui/feedback";
import { ReportBand } from "@/features/reports/report-frame";

/**
 * WHEN THE GOOGLE REVIEWS READ FAILS.
 *
 * Every figure on the page comes from one server-side snapshot, and the read
 * layer throws rather than drawing a partial one — a month-to-date total from
 * half the data is worse than none. This says so in plain words and offers a
 * retry, instead of the framework's generic error screen. No error detail is
 * printed: it can carry a table name or a query, and the reader cannot act on
 * either.
 */
export default function ReviewsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-w-0">
      <ReportBand title="Google Reviews" />
      <div className="px-5 py-5 sm:px-6">
        <Notice
          tone="attention"
          icon={<Info />}
          title="Review counts didn't load"
          action={
            <button
              type="button"
              onClick={reset}
              className="pill-action bg-primary text-primary-foreground hover:bg-primary-hover"
            >
              Try again
            </button>
          }
        >
          <p>
            The review database didn&rsquo;t answer. Try again in a moment. If it keeps
            happening, the last sync error is on Admin › Integrations › Google Reviews.
          </p>
        </Notice>
      </div>
    </div>
  );
}
