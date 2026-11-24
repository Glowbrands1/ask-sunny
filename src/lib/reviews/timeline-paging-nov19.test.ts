import { describe, expect, it, vi } from "vitest";

import { EMPTY_REVIEW_FILTERS } from "./filters";

/**
 * Nov 19 2026, on the Over time chart after the history import: "none for oct?"
 *
 * The database answers at most 1,000 rows per request, whatever `limit` asks
 * for. The chart read its reviews in ONE request ordered by first seen, so once
 * the history import stored 1,133 older reviews that afternoon, the 1,000 rows
 * that came back were nearly all that import and the October reviews never
 * reached the chart. This fake database caps every request at 1,000 rows, as
 * the real one does.
 */
const ROW_CAP = 1000;

interface Row {
  id: string;
  google_absolute_date: string | null;
  google_estimated_at: string | null;
  first_seen_at: string;
}

let table: Row[] = [];

function builder() {
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  let limit = Number.POSITIVE_INFINITY;
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => query,
    lte: () => query,
    or: () => query,
    order: () => query,
    limit: (n: number) => ((limit = n), query),
    range: (start: number, end: number) => ((from = start), (to = end), query),
    then: (resolve: (value: unknown) => void) => {
      // Newest first seen first, as the query orders it.
      const sorted = [...table].sort((a, b) => b.first_seen_at.localeCompare(a.first_seen_at));
      const end = Math.min(to + 1, from + limit, from + ROW_CAP);
      resolve({ data: sorted.slice(from, end), error: null, count: table.length });
    },
  };
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ from: () => builder() }),
}));

const { loadReviewTimeline } = await import("./queries");

describe("the Over time chart reads every review, not the first 1,000", () => {
  it("still shows October after an import of 1,133 older reviews", async () => {
    const october = Array.from({ length: 183 }, (_, i): Row => ({
      id: `oct-${i}`,
      google_absolute_date: "2026-10-15T17:00:00Z",
      google_estimated_at: null,
      first_seen_at: "2026-10-16T12:00:00Z",
    }));
    const imported = Array.from({ length: 1133 }, (_, i): Row => ({
      id: `hist-${i}`,
      google_absolute_date: "2026-03-15T17:00:00Z",
      google_estimated_at: null,
      first_seen_at: "2026-11-19T20:29:00Z",
    }));
    table = [...october, ...imported];

    const timeline = await loadReviewTimeline(EMPTY_REVIEW_FILTERS);

    expect(timeline.counted).toBe(1316);
    expect(timeline.truncated).toBe(false);
    expect(timeline.monthly.find((point) => point.key === "2026-10")?.reviews).toBe(183);
    expect(timeline.monthly.find((point) => point.key === "2026-03")?.reviews).toBe(1133);
  });
});
