import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { __setSupabaseAdmin } from "@/lib/supabase/server";
import { EMPTY_REVIEW_FILTERS, WEEK_CURRENT, WEEK_MONTH } from "./filters";
import { goalStatus, rankLocations } from "./goal";
import { ingestGoogleReviews } from "./ingest";
import { loadReviewFeed, loadReviewsSnapshot } from "./queries";

/**
 * ============================================================================
 * MONTH TO DATE AND THE GOAL VIEWS AGAINST REAL POSTGRES AND POSTGREST
 * ============================================================================
 *
 * Runs only on the disposable local stack (`scripts/local-stack/up.sh`,
 * `ASK_SUNNY_LOCAL_STACK=1`), where every migration has been applied. Never
 * against the Ask Sunny project: the URL is asserted to be loopback first.
 *
 * The rows are seeded as the ingest path leaves them — a review's first-seen
 * instant and its write-once reporting period — because the ingest function
 * stamps "now" and cannot place a review in September. One review is then
 * pushed through the REAL ingest path twice, to prove a re-sync is one record.
 * Everything is READ through the real read layer: `loadReviewsSnapshot` and
 * `loadReviewFeed`, over PostgREST, exactly as the page reads them.
 *
 * Proves:
 *   - month to date is qualifying reviews from Central midnight on the 1st:
 *     the week straddling the 1st is split per review, 8:30pm Central on the
 *     30th (already the 1st in UTC) is September's, and a 1- or 2-star review,
 *     an imported backlog and last month's weeks are never counted;
 *   - the feed's `week=month` drill-down returns exactly the reviews counted,
 *     also when combined with a search (two `or` groups, ANDed);
 *   - zero, exactly ten and more than ten; a salon with no baseline is listed,
 *     not ranked and not summed;
 *   - the same Google review synced twice is one record and counts once.
 */

const ENABLED = process.env.ASK_SUNNY_LOCAL_STACK === "1";
const URL_ = process.env.LOCAL_STACK_URL ?? "";
const SERVICE = process.env.LOCAL_SERVICE_ROLE_KEY ?? "";
const PG = process.env.LOCAL_STACK_PG ?? "";

const sql = (query: string) =>
  execFileSync("psql", [PG, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
  }).trim();

/* Monday 12 October 2026, Central. The month began on a Thursday. */
const TODAY = "2026-10-12";

const STORES = {
  manhattan: { code: "306", salon: "0462", name: "KS Manhattan", district: "Patterson, Madeline" },
  grandIsland: { code: "141", salon: "0307", name: "NE Grand Island", district: "Dugan, Rachael" },
  kearney: { code: "143", salon: "0309", name: "NE Kearney", district: "Dugan, Rachael" },
  pacific: { code: "254", salon: "0410", name: "NE Omaha Pacific", district: "Cotton, Sarah" },
  stJoseph: { code: "409", salon: "0495", name: "MO St Joseph", district: "Cotton, Sarah" },
} as const;

const PERIODS = ["2026-09-20", "2026-09-27", "2026-10-04", "2026-10-11"] as const;

let serial = 0;
const ids: Record<string, string[]> = {};

/** One review row, as the ingest path leaves it once it has been counted (or not). */
function review(
  store: keyof typeof STORES,
  options: {
    seenAt: string;
    rating: number;
    period: (typeof PERIODS)[number] | null;
    reviewer?: string;
    tag?: string;
  },
): string {
  serial += 1;
  const external = `MTDQA${String(serial).padStart(4, "0")}`;
  const where = STORES[store];
  sql(`
    insert into public.google_reviews (
      external_review_id, location_id, store_code, reviewer_name, rating,
      first_seen_at, last_seen_at, first_seen_week, parser_version,
      reporting_period_id, reporting_assignment_status
    )
    select '${external}', l.id, l.store_code, '${options.reviewer ?? `Customer ${serial}`}', ${options.rating},
           '${options.seenAt}', '${options.seenAt}',
           public.google_review_week_start('${options.seenAt}'::timestamptz, 'America/Chicago'),
           'mtd-qa',
           ${options.period ? `(select id from public.google_review_periods where period_start = '${options.period}')` : "null"},
           '${options.period ? "anchor_assigned" : "historical"}'
      from public.google_review_locations l where l.store_code = '${where.code}'`);
  if (options.tag) (ids[options.tag] ??= []).push(external);
  return external;
}

describe.skipIf(!ENABLED)("month to date on the local stack", { timeout: 60_000 }, () => {
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
      delete from public.salon_period_attributes where ingestion_id = '00000000-0000-0000-0000-00000000a11a';
      /* Other local-stack suites map Woven locations to the same salons; those mappings must go first or the salon rows cannot. */
      delete from public.woven_location_map where salon_id in (select id from public.salons where salon_number in (${Object.values(STORES)
        .map((store) => `'${store.salon}'`)
        .join(",")}));
      delete from public.salons where salon_number in (${Object.values(STORES)
        .map((store) => `'${store.salon}'`)
        .join(",")});`);

    for (const store of Object.values(STORES)) {
      const salonId = randomUUID();
      sql(`insert into public.salons (id, salon_number, store_name) values ('${salonId}', '${store.salon}', '${store.name}')`);
      /*
       * THE DISTRICT, as reporting would supply it. The ingestion and period it
       * would hang off are reporting's own machinery and not under test, so the
       * foreign keys are relaxed for this one row — on the local stack only.
       */
      sql(`set session_replication_role = replica;
           insert into public.salon_period_attributes (salon_id, period_id, ingestion_id, district_label, region_label)
           values ('${salonId}', '${randomUUID()}', '00000000-0000-0000-0000-00000000a11a', '${store.district}', 'Patterson, Madeline');`);
      sql(`insert into public.google_review_locations (store_code, salon_id, google_location_label)
           values ('${store.code}', '${salonId}', 'Sun Tan City - ${store.name}')`);
    }

    for (const start of PERIODS) {
      sql(`insert into public.google_review_periods (period_start, period_end) values ('${start}', '${start}'::date + 6)`);
    }

    /* ---------------------------------------------------- KS Manhattan -- */
    /* Wholly last month. */
    review("manhattan", { seenAt: "2026-09-22T15:00:00Z", rating: 5, period: "2026-09-20" });
    review("manhattan", { seenAt: "2026-09-23T15:00:00Z", rating: 4, period: "2026-09-20" });
    /* The straddling week: 8:30pm Central on the 30th is 01:30 UTC on the 1st, and still September. */
    review("manhattan", {
      seenAt: "2026-10-01T01:30:00Z",
      rating: 5,
      period: "2026-09-27",
      reviewer: "Gamma Evening",
      tag: "september-evening",
    });
    /* 12:30am Central on the 1st: October. */
    review("manhattan", {
      seenAt: "2026-10-01T05:30:00Z",
      rating: 4,
      period: "2026-09-27",
      reviewer: "Alpha Customer",
      tag: "manhattan-month",
    });
    /* A 2-star in October, counted into the week, raising no month figure. */
    review("manhattan", { seenAt: "2026-10-02T15:00:00Z", rating: 2, period: "2026-09-27" });
    /* The week of Oct 4: three qualifying and a 1-star. */
    for (const rating of [5, 5, 3]) {
      review("manhattan", {
        seenAt: "2026-10-06T15:00:00Z",
        rating,
        period: "2026-10-04",
        reviewer: "Alpha Customer",
        tag: "manhattan-month",
      });
    }
    review("manhattan", { seenAt: "2026-10-06T16:00:00Z", rating: 1, period: "2026-10-04" });
    /* This week: two qualifying. */
    for (const rating of [4, 5]) {
      review("manhattan", {
        seenAt: "2026-10-12T14:00:00Z",
        rating,
        period: "2026-10-11",
        reviewer: "Beta Customer",
        tag: "manhattan-month",
      });
    }
    /* Imported backlog, first seen this month, counted nowhere. */
    review("manhattan", { seenAt: "2026-10-05T15:00:00Z", rating: 5, period: null });

    /* ------------------------------------------------- NE Grand Island -- */
    for (let index = 0; index < 12; index += 1) {
      review("grandIsland", { seenAt: "2026-10-07T15:00:00Z", rating: 5, period: "2026-10-04" });
    }
    /* ------------------------------------------- NE Kearney: exactly 10 -- */
    for (let index = 0; index < 5; index += 1) {
      review("kearney", { seenAt: "2026-10-08T15:00:00Z", rating: 4, period: "2026-10-04" });
      review("kearney", { seenAt: "2026-10-12T15:00:00Z", rating: 3, period: "2026-10-11" });
    }
    /* NE Omaha Pacific: anchored, nothing this month. */
    /* ------------------------------------------- MO St Joseph: no anchor -- */
    for (let index = 0; index < 4; index += 1) {
      review("stJoseph", { seenAt: "2026-10-03T15:00:00Z", rating: 5, period: null });
    }

    for (const store of ["manhattan", "grandIsland", "kearney", "pacific"] as const) {
      sql(`update public.google_review_locations set counted_through_external_review_id = 'ANCHORQA${STORES[store].code}'
           where store_code = '${STORES[store].code}'`);
    }
  });

  afterAll(() => {
    __setSupabaseAdmin(null);
  });

  it("counts qualifying reviews from Central midnight on the 1st, and nothing else", async () => {
    const snapshot = await loadReviewsSnapshot(EMPTY_REVIEW_FILTERS, TODAY);
    const byCode = new Map(snapshot.locations.map((entry) => [entry.storeCode, entry]));

    /* 1 from the straddling week + 3 from the week of Oct 4 + 2 this week. */
    expect(byCode.get("306")?.qualifyingMonthToDate).toBe(6);
    expect(byCode.get("306")?.qualifyingThisWeek).toBe(2);
    expect(byCode.get("306")?.qualifyingLastWeek).toBe(3);
    expect(byCode.get("141")?.qualifyingMonthToDate).toBe(12);
    expect(byCode.get("143")?.qualifyingMonthToDate).toBe(10);
    expect(byCode.get("254")?.qualifyingMonthToDate).toBe(0);
    expect(byCode.get("409")?.qualifyingMonthToDate).toBe(0);

    /* The estate figure covers the counting salons only. */
    expect(snapshot.summary.monthToDate).toBe(28);
    expect(snapshot.goal).toMatchObject({ target: 10, monthStart: "2026-10-01", dayOfMonth: 12 });
  });

  it("keeps every salon on the board, ranks only the counting ones, and states each goal", async () => {
    const snapshot = await loadReviewsSnapshot(EMPTY_REVIEW_FILTERS, TODAY);

    expect(snapshot.locations).toHaveLength(5);
    const ranked = rankLocations(snapshot.locations, "month");
    expect(ranked.map((entry) => [entry.location.storeCode, entry.rank])).toEqual([
      ["141", 1],
      ["143", 2],
      ["306", 3],
      ["254", 4],
      ["409", null],
    ]);

    const status = (code: string) =>
      goalStatus(snapshot.locations.find((entry) => entry.storeCode === code)!, snapshot.goal);
    expect(status("141")).toBe("met");
    expect(status("143")).toBe("met");
    /* 12 October: 11 of 31 days done, so 4 by now. 6 is on pace. */
    expect(status("306")).toBe("on_pace");
    expect(status("254")).toBe("behind_pace");
    expect(status("409")).toBe("not_counting");
  });

  it("opens exactly the reviews it counted from the month drill-down", async () => {
    const feed = await loadReviewFeed(
      { ...EMPTY_REVIEW_FILTERS, tab: "reviews", week: WEEK_MONTH, qualifying: "yes", storeCode: "306" },
      TODAY,
    );

    expect(feed.total).toBe(6);
    expect(feed.reviews.map((entry) => entry.externalReviewId).sort()).toEqual(
      [...ids["manhattan-month"]].sort(),
    );
    expect(feed.reviews.some((entry) => ids["september-evening"].includes(entry.externalReviewId))).toBe(
      false,
    );
  });

  it("agrees with the estate figure when nothing narrows it", async () => {
    const feed = await loadReviewFeed(
      { ...EMPTY_REVIEW_FILTERS, tab: "reviews", week: WEEK_MONTH, qualifying: "yes" },
      TODAY,
    );
    /* 28 counted, and none of St Joseph's four historical reviews. */
    expect(feed.total).toBe(28);
  });

  it("ANDs the month predicate with a search rather than replacing it", async () => {
    const both = await loadReviewFeed(
      { ...EMPTY_REVIEW_FILTERS, tab: "reviews", week: WEEK_MONTH, qualifying: "yes", search: "Alpha" },
      TODAY,
    );
    /* The four "Alpha Customer" reviews are all in October. */
    expect(both.total).toBe(4);

    const none = await loadReviewFeed(
      { ...EMPTY_REVIEW_FILTERS, tab: "reviews", week: WEEK_MONTH, search: "Gamma Evening" },
      TODAY,
    );
    /* The 8:30pm-on-the-30th review matches the search and not the month. */
    expect(none.total).toBe(0);
  });

  it("leaves the weekly drill-down as it was", async () => {
    const feed = await loadReviewFeed(
      { ...EMPTY_REVIEW_FILTERS, tab: "reviews", week: WEEK_CURRENT, qualifying: "yes", storeCode: "306" },
      TODAY,
    );
    expect(feed.total).toBe(2);
  });

  it("narrows to one district without changing a salon's own figures", async () => {
    const snapshot = await loadReviewsSnapshot(
      { district: "Dugan, Rachael", storeCode: null },
      TODAY,
    );
    expect(snapshot.locations.map((entry) => entry.storeCode).sort()).toEqual(["141", "143"]);
    expect(snapshot.summary.monthToDate).toBe(22);
  });

  it("counts a review synced twice through the real ingest path once", async () => {
    const before = (await loadReviewsSnapshot(EMPTY_REVIEW_FILTERS, TODAY)).locations.find(
      (entry) => entry.storeCode === "254",
    );

    /* Pacific has no anchor review in the feed, so a new review is held as historical either way. */
    const payload = [
      {
        externalReviewId: "MTDQADUPLICATE1",
        storeCode: "254",
        reviewerName: "Twice Synced",
        rating: 5,
        relativeDateText: "an hour ago",
        feedPosition: 0,
      },
    ];
    await ingestGoogleReviews(payload, { parserVersion: "mtd-qa", credentialId: null });
    const second = await ingestGoogleReviews(payload, { parserVersion: "mtd-qa", credentialId: null });

    expect(second.duplicates + second.updated).toBe(1);
    expect(second.created).toBe(0);
    expect(sql(`select count(*) from public.google_reviews where external_review_id = 'MTDQADUPLICATE1'`)).toBe(
      "1",
    );

    const after = (await loadReviewsSnapshot(EMPTY_REVIEW_FILTERS, TODAY)).locations.find(
      (entry) => entry.storeCode === "254",
    );
    /* Not counted into any period — its anchor is not on the page — so the month is unmoved. */
    expect(after?.qualifyingMonthToDate).toBe(before?.qualifyingMonthToDate);
    expect(after?.total).toBe((before?.total ?? 0) + 1);
  });
});
