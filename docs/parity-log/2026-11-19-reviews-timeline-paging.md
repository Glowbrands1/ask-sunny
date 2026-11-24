# 2026-11-19 — Google Reviews "Over time" chart reads every review (Sunny-only)

**Report:** "none for oct?" — after the Apify history import, the Over time chart
showed nothing for October.

**Cause:** `loadReviewTimeline` read the review records in one request. The
database returns at most 1,000 rows per request, and the read was ordered by
first seen, so after 1,133 older reviews were imported that afternoon the chart
received almost only those and dropped the reviews synced through October.

**Fix (Ask Sunny):** read a page of 1,000 at a time up to `TIMELINE_LIMIT`.
Test: `src/lib/reviews/timeline-paging-nov19.test.ts`.

**Ask Bubbles: not needed.** Its chart is aggregated in the database
(`google_reviews_periods` returns one row per week or month), so no per-review
read can hit the 1,000-row cap.
