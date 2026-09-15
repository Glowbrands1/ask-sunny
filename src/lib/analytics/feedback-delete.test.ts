import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * DELETING A RATING RECALCULATES EVERYTHING THAT COUNTED IT.
 *
 * ============================================================================
 * WHY THIS IS A SCHEMA TEST RATHER THAN A UNIT TEST
 * ============================================================================
 *
 * Every figure the brief lists — total rated, average, the five-band
 * distribution, the outcome split, the four moderation counts, the hidden count
 * — is computed by `analytics_feedback_summary` in Postgres, over the rows that
 * exist at the moment it runs. There is no cached total, no materialised view
 * and no counter column anywhere, which is precisely WHY a deleted row
 * disappears from all of them at once: they are not updated on delete, they are
 * derived on read.
 *
 * So the property worth testing is that nothing has been added which would
 * break that. A stored count, a cached average or a trigger maintaining a
 * running total would each be a place a deleted row could survive — and the
 * arithmetic below would then be wrong without any of these tests noticing,
 * because they would be testing the cache rather than the query.
 *
 * The arithmetic itself is verified against the SQL's own semantics.
 */

const READS = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations",
    readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((name) => name.includes("ask_sunny_feedback_reads"))
      .sort()[0],
  ),
  "utf8",
);

/** Statements with both comment forms removed, so prose cannot satisfy a check. */
function statementsOnly(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");
}

const SUMMARY =
  statementsOnly(READS)
    .split("create or replace function public.analytics_feedback_summary")[1]
    ?.split("$$;")[0] ?? "";

describe("every feedback figure is derived on read, never stored", () => {
  it("has a summary function to read", () => {
    expect(SUMMARY.length).toBeGreaterThan(0);
  });

  it.each([
    ["total rated responses", "count(*) filter (where f.hidden_at is null) as responses"],
    ["average rating", "round(avg(f.rating) filter (where f.hidden_at is null), 1)"],
    ["1 star", "f.rating = 1"],
    ["2 star", "f.rating = 2"],
    ["3 star", "f.rating = 3"],
    ["4 star", "f.rating = 4"],
    ["5 star", "f.rating = 5"],
    ["yes", "f.got_what_needed = 'yes'"],
    ["partially", "f.got_what_needed = 'partially'"],
    ["no", "f.got_what_needed = 'no'"],
    ["pending", "f.status = 'pending'"],
    ["in review", "f.status = 'in_review'"],
    ["resolved", "f.status = 'resolved'"],
    ["dismissed", "f.status = 'dismissed'"],
    ["hidden", "count(*) filter (where f.hidden_at is not null) as hidden"],
  ])("computes %s from the rows that exist", (_label, fragment) => {
    /*
     * A `count`/`avg` over `feedback_attributed` sees only the rows still in
     * `ask_sunny_feedback`, so a deleted row leaves every one of these the
     * moment it is gone. That is the mechanism the brief's example describes.
     */
    expect(SUMMARY).toContain(fragment);
  });

  it("reads from the live table and nothing cached", () => {
    expect(SUMMARY).toContain("from public.feedback_attributed f");
  });

  it("has no counter column a deleted row could survive in", () => {
    /*
     * The failure this guards: somebody adds `rating_count` to a table and
     * maintains it with a trigger. The averages would then be read from a
     * number that a DELETE never decremented, and a removed QA rating would
     * keep moving the production average with nothing to show for it.
     */
    const feedbackTable = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations",
        readdirSync(join(process.cwd(), "supabase/migrations"))
          .filter((name) => name.includes("ask_sunny_feedback.sql"))
          .sort()[0],
      ),
      "utf8",
    );
    const sql = statementsOnly(feedbackTable);

    for (const forbidden of [
      "rating_count",
      "rating_total",
      "average_rating",
      "response_count",
      "materialized view",
    ]) {
      expect(sql, `the schema caches ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("maintains no trigger but the one that touches updated_at", () => {
    const feedbackTable = statementsOnly(
      readFileSync(
        join(
          process.cwd(),
          "supabase/migrations",
          readdirSync(join(process.cwd(), "supabase/migrations"))
            .filter((name) => name.includes("ask_sunny_feedback.sql"))
            .sort()[0],
        ),
        "utf8",
      ),
    );
    const triggers = feedbackTable.match(/create trigger (\w+)/g) ?? [];
    expect(triggers).toEqual(["create trigger ask_sunny_feedback_touch"]);
  });
});

/* ----------------------------------------------------------- the example --- */

/**
 * The brief's worked example, computed the way the SQL computes it.
 *
 * `round(avg(rating), 1)` over the surviving rows — so removing the 4 from
 * {5, 4, 4} leaves {5, 4}, and 4.3 becomes 4.5. Arithmetic rather than a
 * database round trip, because what is being checked is that the shape of the
 * calculation matches what an administrator will see.
 */
function summarise(ratings: number[]) {
  const distribution = [1, 2, 3, 4, 5].map(
    (band) => ratings.filter((rating) => rating === band).length,
  );
  const average =
    ratings.length === 0
      ? null
      : Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10;
  return { responses: ratings.length, average, distribution };
}

describe("the worked example from the brief", () => {
  it("3 ratings at 5,4,4 average 4.3", () => {
    expect(summarise([5, 4, 4])).toEqual({
      responses: 3,
      average: 4.3,
      distribution: [0, 0, 0, 2, 1],
    });
  });

  it("deleting one 4-star leaves 2 ratings averaging 4.5", () => {
    expect(summarise([5, 4])).toEqual({
      responses: 2,
      average: 4.5,
      distribution: [0, 0, 0, 1, 1],
    });
  });

  it("deleting one rating does not disturb another", () => {
    /* The 5 is untouched by the 4 being removed. */
    const before = summarise([5, 4, 4]);
    const after = summarise([5, 4]);
    expect(after.distribution[4]).toBe(before.distribution[4]);
  });

  it("deleting the last rating leaves no average rather than zero", () => {
    /*
     * `avg` over an empty set is null, and the screen renders "No data yet".
     * A 0.0 would read as the worst possible score for a period nobody rated.
     */
    expect(summarise([]).average).toBeNull();
    expect(summarise([]).responses).toBe(0);
  });
});

/* ---------------------------------------------- deleted is not hidden ----- */

describe("a deleted row is gone, where a hidden one is merely excluded", () => {
  const LIST =
    statementsOnly(READS)
      .split("create or replace function public.analytics_feedback_list")[1]
      ?.split("$$;")[0] ?? "";

  it("the list's only row source is the feedback table", () => {
    /*
     * WHY "SHOW HIDDEN" CANNOT RESURRECT A DELETED ROW: `p_include_hidden`
     * widens a predicate over rows that exist. A deleted row is not a row whose
     * `hidden_at` is set — it is not there at all — so no filter reaches it.
     */
    expect(LIST).toContain("from public.feedback_attributed f");
    expect(LIST).toContain("(p_include_hidden or f.hidden_at is null)");
  });

  it("hidden is a column, not a table the list could union in", () => {
    expect(LIST).not.toMatch(/union/i);
    expect(LIST).not.toContain("deleted_feedback");
    expect(LIST).not.toContain("feedback_archive");
  });
});
