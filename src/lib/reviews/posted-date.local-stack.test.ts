import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { EMPTY_REVIEW_FILTERS, WEEK_CURRENT, WEEK_MONTH } from "./filters";
import { isCounting } from "./goal";
import { ingestGoogleReviews } from "./ingest";
import { loadReviewFeed, loadReviewsSnapshot } from "./queries";

/**
 * ============================================================================
 * COUNTING BY THE DATE GOOGLE SAYS A REVIEW WAS POSTED, AGAINST REAL POSTGRES
 * ============================================================================
 *
 * Runs only on the disposable local stack (`scripts/local-stack/up.sh`,
 * `ASK_SUNNY_LOCAL_STACK=1`), where every migration has been applied. Never
 * against the Ask Sunny project: the URL is asserted to be loopback first.
 *
 * MO Kansas City Wornall's October 2026, as Apify returned it. Its anchor — an
 * anonymous review from 30 September — left Google after 3 October, so under
 * the anchor rule every later sync logged `anchor_not_in_feed` and counted
 * nothing: the dashboard said 2 for the month while Google showed 9. The
 * reviews go through the REAL ingest path (`ingestGoogleReviews` and
 * `ingest_google_reviews`) and are read back through the real read layer.
 *
 * Proves:
 *   - a dated review posted on or after the listing's start counts in the week
 *     it was POSTED, even though its anchor is not on the page;
 *   - month to date is Google's October count plus the two reviews the anchor
 *     had already credited to October — nothing already shown goes down;
 *   - a late Saturday review counts in Saturday's week, not the sync's;
 *   - a 1- or 2-star review is assigned and never qualifying; a review posted
 *     before the start stays history; a listing with no start counts nothing;
 *   - a re-sync counts nothing twice and moves nothing; the anchor is moved to
 *     the top of the feed so later syncs stop reporting it missing.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const URL_ = process.env.LOCAL_STACK_URL ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";

const sql = (query: string) =>
  execFileSync("psql", [PG, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();

/* Tuesday 20 October 2026, Central — the day after the salon director wrote. */
const TODAY = "2026-10-20";

const WORNALL = { code: "140", salon: "0306", name: "MO Kansas City Wornall" };
const ST_JOSEPH = { code: "409", salon: "0495", name: "MO St Joseph" };

/* Midnight on 1 October, Central. */
const START = "2026-10-01T05:00:00Z";

/** An Apify-shaped record: Google's publication instant and its feed position. */
function apify(
  id: string,
  storeCode: string,
  postedAt: string,
  feedPosition: number,
  rating = 5,
) {
  return {
    externalReviewId: id,
    storeCode,
    reviewerName: `Customer ${id}`,
    rating,
    googleAbsoluteDate: postedAt,
    feedPosition,
  };
}

const ingest = (batch: unknown[]) =>
  ingestGoogleReviews(batch, {
    parserVersion: "posted-date-qa",
    credentialId: "apify:incremental",
    ingestionSource: "apify",
  });

const wornall = async () =>
  (await loadReviewsSnapshot(EMPTY_REVIEW_FILTERS, TODAY)).locations.find(
    (entry) => entry.storeCode === WORNALL.code,
  )!;

/* Wornall's feed on the morning of 20 October, newest first (Central times in the names). */
const OCTOBER = [
  apify("PDQAOCT19B1326", WORNALL.code, "2026-10-19T18:26:41Z", 0),
  apify("PDQAOCT19A1134", WORNALL.code, "2026-10-19T16:34:01Z", 1),
  apify("PDQAOCT13E1328", WORNALL.code, "2026-10-13T18:28:52Z", 2),
  apify("PDQAOCT13D1225", WORNALL.code, "2026-10-13T17:25:28Z", 3),
  apify("PDQAOCT13C1223", WORNALL.code, "2026-10-13T17:23:12Z", 4),
  apify("PDQAOCT13B1154", WORNALL.code, "2026-10-13T16:54:02Z", 5),
  apify("PDQAOCT13A1122", WORNALL.code, "2026-10-13T16:22:00Z", 6),
  apify("PDQAOCT09A1450", WORNALL.code, "2026-10-09T19:50:36Z", 7),
  apify("PDQAOCT08A1730", WORNALL.code, "2026-10-08T22:30:17Z", 8, 3),
  /* Already held and already counted by the anchor, on 1 October. */
  apify("PDQASEP30A0934", WORNALL.code, "2026-09-30T14:34:55Z", 9),
];

describe.skipIf(!ENABLED)("counting by posted date on the local stack", { timeout: 60_000 }, () => {
  beforeAll(() => {
    expect(new URL(URL_).hostname).toBe("127.0.0.1");
    expect(PG).toContain("127.0.0.1");

    __setSupabaseAdmin(
      createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } }),
    );

    /* A clean slate of review data. Disposable database only — asserted above. */
    sql(`
      truncate public.google_reviews, public.google_review_periods,
               public.google_review_sync_runs cascade;
      delete from public.google_review_locations;
      delete from public.salons where salon_number in ('${WORNALL.salon}', '${ST_JOSEPH.salon}');`);

    for (const store of [WORNALL, ST_JOSEPH]) {
      const salonId = randomUUID();
      sql(`insert into public.salons (id, salon_number, store_name) values ('${salonId}', '${store.salon}', '${store.name}')`);
      sql(`insert into public.google_review_locations (store_code, salon_id, google_location_label)
           values ('${store.code}', '${salonId}', 'Sun Tan City - ${store.name}')`);
    }

    /*
     * WHAT THE ANCHOR HAD ALREADY COUNTED: two reviews posted on the morning of
     * 30 September and first seen at the 1 October sync, so October's — and
     * the anchor itself, which then left Google.
     */
    sql(`insert into public.google_review_periods (period_start, period_end) values ('2026-09-27', '2026-10-03')`);
    for (const [id, posted] of [
      ["PDQASEP30B0946", "2026-09-30T14:46:11Z"],
      ["PDQASEP30A0934", "2026-09-30T14:34:55Z"],
    ]) {
      sql(`
        insert into public.google_reviews (
          external_review_id, location_id, store_code, reviewer_name, rating,
          google_absolute_date, google_estimated_at,
          first_seen_at, last_seen_at, first_seen_week, parser_version,
          reporting_period_id, reporting_assignment_status
        )
        select '${id}', l.id, l.store_code, 'Customer ${id}', 5,
               '${posted}', '${posted}',
               '2026-10-01T11:01:17Z', '2026-10-01T11:01:17Z', '2026-09-27', 'posted-date-qa',
               (select id from public.google_review_periods where period_start = '2026-09-27'),
               'anchor_assigned'
          from public.google_review_locations l where l.store_code = '${WORNALL.code}'`);
    }

    /* Wornall counts from 1 October, as the migration set every counting listing. */
    sql(`update public.google_review_locations
            set counted_through_external_review_id = 'PDQASEP30B0946',
                counted_through_set_at = '2026-10-01T11:01:17Z',
                count_by_posted_date_from = '${START}'
          where store_code = '${WORNALL.code}'`);
  });

  afterAll(() => {
    __setSupabaseAdmin(null);
  });

  it("counts the reviews the anchor could not, in the weeks they were posted", async () => {
    const before = await wornall();
    /* The figure the salon director saw. */
    expect(before.qualifyingMonthToDate).toBe(2);

    const result = await ingest(OCTOBER);

    /* The anchor is not on the page — the old rule's failure — and all nine count anyway. */
    expect(result.storeFindings.map((finding) => finding.finding)).toEqual(["anchor_not_in_feed"]);
    expect(result.created).toBe(9);
    expect(result.countedIntoPeriod).toBe(9);

    expect(
      sql(`select string_agg(p.period_start::text || ':' || n, ',' order by p.period_start)
             from (select reporting_period_id, count(*) n from public.google_reviews
                    where reporting_assignment_status = 'posted_date' group by 1) c
             join public.google_review_periods p on p.id = c.reporting_period_id`),
    ).toBe("2026-10-04:2,2026-10-11:5,2026-10-18:2");

    const after = await wornall();
    /* Google's nine October reviews, plus the two already credited to October. */
    expect(after.qualifyingMonthToDate).toBe(11);
    expect(after.qualifyingThisWeek).toBe(2);
    expect(after.qualifyingLastWeek).toBe(5);
    expect(after.historical).toBe(0);
  });

  it("opens exactly what it counted from the month and week drill-downs", async () => {
    const month = await loadReviewFeed(
      { ...EMPTY_REVIEW_FILTERS, tab: "reviews", week: WEEK_MONTH, qualifying: "yes", storeCode: "140" },
      TODAY,
    );
    expect(month.total).toBe(11);

    const week = await loadReviewFeed(
      { ...EMPTY_REVIEW_FILTERS, tab: "reviews", week: WEEK_CURRENT, qualifying: "yes", storeCode: "140" },
      TODAY,
    );
    expect(week.reviews.map((entry) => entry.externalReviewId).sort()).toEqual([
      "PDQAOCT19A1134",
      "PDQAOCT19B1326",
    ]);
    expect(week.reviews.every((entry) => entry.reportingAssignmentStatus === "posted_date")).toBe(true);
  });

  it("moves the anchor to the top of the feed, so the next sync finds it", async () => {
    expect(
      sql(`select counted_through_external_review_id || ' ' || counted_through_set_by
             from public.google_review_locations where store_code = '${WORNALL.code}'`),
    ).toBe("PDQAOCT19B1326 posted-date:apify:incremental");
  });

  it("counts nothing twice and moves nothing on a re-sync", async () => {
    const periodsBefore = sql(
      `select string_agg(external_review_id || '@' || coalesce(reporting_period_id::text, '-'), ',' order by external_review_id)
         from public.google_reviews`,
    );

    const newer = apify("PDQAOCT20A0815", WORNALL.code, "2026-10-20T13:15:00Z", 0);
    const result = await ingest([
      newer,
      ...OCTOBER.map((review) => ({ ...review, feedPosition: review.feedPosition + 1 })),
    ]);

    /* The anchor is on the page now, so nothing is reported missing. */
    expect(result.storeFindings).toEqual([]);
    expect(result.created).toBe(1);
    expect(result.countedIntoPeriod).toBe(1);

    const periodsAfter = sql(
      `select string_agg(external_review_id || '@' || coalesce(reporting_period_id::text, '-'), ',' order by external_review_id)
         from public.google_reviews where external_review_id <> '${newer.externalReviewId}'`,
    );
    expect(periodsAfter).toBe(periodsBefore);

    expect((await wornall()).qualifyingMonthToDate).toBe(12);
    expect((await wornall()).qualifyingThisWeek).toBe(3);
  });

  it("files a late-Saturday review into Saturday's week, not the Sunday sync's", async () => {
    /* 10:40pm Central on Saturday 17 October is 03:40 UTC on Sunday the 18th. */
    await ingest([
      apify("PDQAOCT20A0815", WORNALL.code, "2026-10-20T13:15:00Z", 0),
      /* Missed by an earlier sync and seen only now. */
      apify("PDQAOCT17SAT2240", WORNALL.code, "2026-10-18T03:40:00Z", 1),
    ]);

    expect(
      sql(`select p.period_start from public.google_reviews r
             join public.google_review_periods p on p.id = r.reporting_period_id
            where r.external_review_id = 'PDQAOCT17SAT2240'`),
    ).toBe("2026-10-11");
    expect((await wornall()).qualifyingLastWeek).toBe(6);
  });

  it("assigns a 1- or 2-star review without qualifying it, and leaves September as history", async () => {
    const before = await wornall();
    await ingest([
      apify("PDQAOCT20LOW", WORNALL.code, "2026-10-20T14:00:00Z", 0, 2),
      apify("PDQAOCT20A0815", WORNALL.code, "2026-10-20T13:15:00Z", 1),
      /* Posted on 29 September and seen only now: before the start, so history. */
      apify("PDQASEP29LATE", WORNALL.code, "2026-09-29T18:00:00Z", 2),
    ]);

    const after = await wornall();
    expect(after.qualifyingMonthToDate).toBe(before.qualifyingMonthToDate);
    expect(after.reviewsThisWeek).toBe(before.reviewsThisWeek + 1);
    expect(after.historical).toBe(before.historical + 1);
    expect(
      sql(`select reporting_assignment_status from public.google_reviews where external_review_id = 'PDQASEP29LATE'`),
    ).toBe("historical");
  });

  it("never counts a September review through the anchor, even when the anchor proves it new", async () => {
    /*
     * KS Lawrence on 21 October: a bigger run brought an old anchor back onto
     * the page, and the anchor rule counted the September reviews above it.
     * Here the anchor is put back on a 29 September review, and a September
     * review the anchor would call new arrives above it.
     */
    sql(`update public.google_review_locations set counted_through_external_review_id = 'PDQASEP29LATE'
          where store_code = '${WORNALL.code}'`);
    const before = await wornall();

    const result = await ingest([
      apify("PDQAOCT20B1500", WORNALL.code, "2026-10-20T20:00:00Z", 0),
      apify("PDQASEP29EVENING", WORNALL.code, "2026-09-30T01:00:00Z", 1),
      apify("PDQASEP29LATE", WORNALL.code, "2026-09-29T18:00:00Z", 2),
    ]);

    expect(result.countedIntoPeriod).toBe(1);
    expect(
      sql(`select reporting_assignment_status from public.google_reviews where external_review_id = 'PDQASEP29EVENING'`),
    ).toBe("historical");
    expect(
      sql(`select reporting_assignment_status from public.google_reviews where external_review_id = 'PDQAOCT20B1500'`),
    ).toBe("posted_date");

    const after = await wornall();
    expect(after.qualifyingThisWeek).toBe(before.qualifyingThisWeek + 1);
    expect(after.qualifyingMonthToDate).toBe(before.qualifyingMonthToDate + 1);
  });

  it("counts nothing for a listing that has never been given a start", async () => {
    const result = await ingest([
      apify("PDQASTJ1", ST_JOSEPH.code, "2026-10-18T15:00:00Z", 0),
      apify("PDQASTJ2", ST_JOSEPH.code, "2026-10-12T15:00:00Z", 1),
    ]);
    expect(result.countedIntoPeriod).toBe(0);

    const stJoseph = (await loadReviewsSnapshot(EMPTY_REVIEW_FILTERS, TODAY)).locations.find(
      (entry) => entry.storeCode === ST_JOSEPH.code,
    )!;
    expect(isCounting(stJoseph)).toBe(false);
    expect(stJoseph.historical).toBe(2);
    expect(stJoseph.qualifyingMonthToDate).toBe(0);
  });

  it("starts a listing from the moment it is first anchored", () => {
    sql(`update public.google_review_locations
            set counted_through_external_review_id = 'PDQASTJ1', counted_through_set_at = '2026-10-20T12:00:00Z'
          where store_code = '${ST_JOSEPH.code}'`);
    expect(
      sql(`select count_by_posted_date_from at time zone 'UTC'
             from public.google_review_locations where store_code = '${ST_JOSEPH.code}'`),
    ).toBe("2026-10-20 12:00:00");
  });
});
