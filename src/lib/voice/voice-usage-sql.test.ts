import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  COMPANY_AUDIO_SECONDS_PER_DAY,
  MAX_SECONDS,
  MIN_SECONDS,
  PER_SALON_AUDIO_SECONDS_PER_DAY,
  PER_USER_AUDIO_SECONDS_PER_DAY,
  PER_USER_PER_DAY,
  PER_USER_PER_MINUTE,
  VOICE_DAY_TIME_ZONE,
  voiceDayStart,
} from "./voice-limits";

/*
 * VOICE_INPUT_ENABLED: the `voice_usage_reserve` RPC, run on a real Postgres (PGlite) with the caps the route
 * passes. The same rule as `evaluateVoiceCaps`, checked in SQL. The day runs midnight to midnight US Central
 * (America/Chicago; the owner, 27 Nov 2026: "central"), with daylight saving.
 *
 * Every call passes p_now, so no test depends on the hour it runs at. Main's CI on d698abd failed when the old
 * test, which read the real clock against a Manila day, ran just after 16:00 UTC.
 */

const MIGRATIONS = ["supabase/migrations/20261127002000_voice_usage.sql", "supabase/migrations/20261127004000_voice_usage_central_day.sql"].map((path) => readFileSync(path, "utf8"));
let db: PGlite;

/** Noon in Central on Friday 27 Nov 2026 (CST, UTC-6): mid-day, far from either midnight. */
const NOW = "2026-11-27T18:00:00Z";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions;
    create function extensions.gen_random_uuid() returns uuid language sql as $$ select gen_random_uuid() $$;
  `);
  for (const sql of MIGRATIONS) await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("truncate public.voice_usage");
});

async function reserve(user: string, salon: string | null, clip: number, at: string = NOW, surface = "chat") {
  const result = await db.query<{ usage_id: string | null; refused: string | null; retry_after_seconds: number | null }>(
    "select * from public.voice_usage_reserve($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
    [user, salon, surface, clip, MIN_SECONDS, MAX_SECONDS, PER_USER_PER_MINUTE, PER_USER_PER_DAY, PER_USER_AUDIO_SECONDS_PER_DAY, PER_SALON_AUDIO_SECONDS_PER_DAY, COMPANY_AUDIO_SECONDS_PER_DAY, at],
  );
  return result.rows[0]!;
}

/** Finished rows written at `at` (an ISO instant). */
async function insertFinished(rows: number, user: (i: number) => string, salon: (i: number) => string | null, seconds: number, at: string) {
  for (let i = 0; i < rows; i += 1) {
    await db.query(
      `insert into public.voice_usage (user_id, salon_id, surface, status, clip_seconds, audio_seconds, created_at) values ($1, $2, 'report', 'succeeded', $3, $3, $4)`,
      [user(i), salon(i), seconds, at],
    );
  }
}

const before = (iso: string, seconds: number) => new Date(new Date(iso).getTime() - seconds * 1000).toISOString();

describe("voice_usage_reserve", () => {
  it("inserts a pending row, the clip clamped, at p_now, and returns its id", async () => {
    const first = await reserve("user-ada", "loc-0001", 0.1);
    expect(first.refused).toBeNull();
    expect(first.usage_id).toMatch(/^[0-9a-f-]{36}$/);
    await reserve("user-ada", "loc-0001", 400, NOW, "l10");
    const rows = await db.query<{ status: string; clip_seconds: string; surface: string; created_at: string }>("select status, clip_seconds::text, surface, created_at::text from public.voice_usage order by clip_seconds");
    expect(rows.rows.map((row) => [row.status, Number(row.clip_seconds), row.surface, new Date(row.created_at).toISOString()])).toEqual([
      ["pending", 0.5, "chat", "2026-11-27T18:00:00.000Z"],
      ["pending", 60, "l10", "2026-11-27T18:00:00.000Z"],
    ]);
  });

  it("the eleventh in a minute is refused, with how long to wait", async () => {
    for (let i = 0; i < 10; i += 1) expect((await reserve("user-ada", null, 2, NOW, ["chat", "overview", "report", "l10"][i % 4])).refused).toBeNull();
    const refused = await reserve("user-ada", null, 2);
    expect(refused.refused).toBe("user_minute");
    expect(refused.retry_after_seconds).toBe(60);
    expect((await reserve("user-bea", null, 2)).refused).toBeNull();
    expect((await reserve("user-ada", null, 2, new Date(new Date(NOW).getTime() + 61_000).toISOString())).refused).toBeNull();
  });

  it("the person's audio for the day, pending rows included", async () => {
    await insertFinished(29, () => "user-ada", () => null, 60, before(NOW, 600));
    const earlier = before(NOW, 120);
    for (let i = 0; i < 5; i += 1) await reserve("user-ada", null, 10, earlier); // pending, 50 s
    expect((await reserve("user-ada", null, 20)).refused).toBe("user_day");
    expect((await reserve("user-ada", null, 10)).refused).toBeNull();
  });

  it("the salon's and the company's audio for the day", async () => {
    await insertFinished(90, (i) => `user-${i}`, () => "loc-0003", 60, before(NOW, 600));
    expect((await reserve("user-new", "loc-0003", 5)).refused).toBe("salon_day");
    expect((await reserve("user-new", "loc-0004", 5)).refused).toBeNull();
    await insertFinished(90, (i) => `other-${i}`, () => null, 60, before(NOW, 600));
    expect((await reserve("user-late", "loc-0005", 5)).refused).toBe("company_day");
  });

  it("failed rows count toward the minute and the day request caps", async () => {
    await db.query(`insert into public.voice_usage (user_id, surface, status, clip_seconds, audio_seconds, created_at) select 'user-ada', 'chat', 'failed', 1, 0, $1 from generate_series(1, 10)`, [before(NOW, 5)]);
    expect((await reserve("user-ada", null, 1)).refused).toBe("user_minute");
    await db.exec("truncate public.voice_usage");
    await db.query(`insert into public.voice_usage (user_id, surface, status, clip_seconds, audio_seconds, created_at) select 'user-ada', 'chat', 'failed', 1, 0, $1 from generate_series(1, 120)`, [before(NOW, 600)]);
    expect((await reserve("user-ada", null, 1)).refused).toBe("user_day");
  });

  it("a failed row with no seconds written (no answer, 429, 5xx) keeps its clip length; a clear rejection (0) frees it", async () => {
    await db.query(`insert into public.voice_usage (user_id, surface, status, clip_seconds, audio_seconds, created_at) select 'user-ada', 'chat', 'failed', 60, null, $1 from generate_series(1, 30)`, [before(NOW, 600)]);
    expect((await reserve("user-ada", null, 5)).refused).toBe("user_day");
    await db.exec("update public.voice_usage set audio_seconds = 0");
    expect((await reserve("user-ada", null, 60)).refused).toBeNull();
  });

  it("a row after p_now is not counted (so a pinned clock never sees the future)", async () => {
    await insertFinished(30, () => "user-ada", () => null, 60, new Date(new Date(NOW).getTime() + 60_000).toISOString());
    expect((await reserve("user-ada", null, 60)).refused).toBeNull();
  });

  it("a signed-in browser's role cannot touch the counters or call the RPC", async () => {
    await db.exec("set role authenticated");
    try {
      await expect(db.exec("insert into public.voice_usage (user_id, surface, clip_seconds) values ('user-x', 'chat', 1)")).rejects.toThrow(/permission denied/);
      await expect(db.exec("update public.voice_usage set status = 'failed'")).rejects.toThrow(/permission denied/);
      await expect(db.exec("select public.voice_usage_reserve('user-x', null, 'chat', 1, 0.5, 60, 10, 120, 1800, 5400, 10800)")).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec("reset role");
    }
  });

  it("only the new function is left (the Manila one is dropped)", async () => {
    const result = await db.query<{ args: string }>("select pg_get_function_identity_arguments(p.oid) as args from pg_proc p where p.proname = 'voice_usage_reserve'");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.args).toMatch(/p_now timestamp with time zone$/);
  });
});

/** Ada uses her whole day by `lastBefore` (30 one-minute clips), then asks again at `askAt`. */
async function fullDayThenAsk(lastBefore: string, askAt: string) {
  await insertFinished(30, () => "user-ada", () => null, 60, lastBefore);
  return (await reserve("user-ada", null, 10, askAt)).refused;
}

describe("the Central day (America/Chicago, the owner: \"central\")", () => {
  it("the RPC and voice-limits.ts use the same zone", () => {
    // The code, not the comments (which say why it is no longer Manila).
    const sql = MIGRATIONS[1]!.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
    expect(VOICE_DAY_TIME_ZONE).toBe("America/Chicago");
    expect(sql.match(/at time zone '([^']+)'/g)?.every((match) => match.includes(VOICE_DAY_TIME_ZONE))).toBe(true);
    expect(sql).not.toMatch(/Manila|interval '-?\d+ hours'/);
  });

  it("23:59:59 Central is still today; 00:00:00 Central is a new day (CST: 06:00 UTC)", async () => {
    // Nov 27 ends at 2026-11-28T06:00:00Z.
    expect(await fullDayThenAsk("2026-11-27T20:00:00Z", "2026-11-28T05:59:59Z")).toBe("user_day");
    await db.exec("truncate public.voice_usage");
    expect(await fullDayThenAsk("2026-11-27T20:00:00Z", "2026-11-28T06:00:00Z")).toBeNull();
  });

  it("in summer (CDT) the day starts at 05:00 UTC", async () => {
    expect(await fullDayThenAsk("2026-07-15T20:00:00Z", "2026-07-16T04:59:59Z")).toBe("user_day");
    await db.exec("truncate public.voice_usage");
    expect(await fullDayThenAsk("2026-07-15T20:00:00Z", "2026-07-16T05:00:00Z")).toBeNull();
  });

  it("the spring change day (Sun 8 Mar 2026) is 23 hours: 06:00 UTC to 05:00 UTC", async () => {
    // A clip at 00:30 CST on 8 Mar counts on 8 Mar, all the way to 23:59:59 CDT (04:59:59 UTC on 9 Mar).
    expect(await fullDayThenAsk("2026-03-08T06:30:00Z", "2026-03-09T04:59:59Z")).toBe("user_day");
    await db.exec("truncate public.voice_usage");
    expect(await fullDayThenAsk("2026-03-08T06:30:00Z", "2026-03-09T05:00:00Z")).toBeNull();
    // And the night before the change still ends at 06:00 UTC.
    await db.exec("truncate public.voice_usage");
    expect(await fullDayThenAsk("2026-03-07T20:00:00Z", "2026-03-08T06:00:00Z")).toBeNull();
  });

  it("the autumn change day (Sun 1 Nov 2026) is 25 hours: 05:00 UTC to 06:00 UTC", async () => {
    // A clip at 00:30 CDT on 1 Nov counts through the repeated 01:00 hour, to 23:59:59 CST (05:59:59 UTC on 2 Nov).
    expect(await fullDayThenAsk("2026-11-01T05:30:00Z", "2026-11-02T05:59:59Z")).toBe("user_day");
    await db.exec("truncate public.voice_usage");
    expect(await fullDayThenAsk("2026-11-01T05:30:00Z", "2026-11-02T06:00:00Z")).toBeNull();
  });

  it("voice-limits.ts's day start is the SQL day start, at every hour across both change days", async () => {
    const instants: string[] = [];
    for (const start of ["2026-03-07T00:00:00Z", "2026-10-31T00:00:00Z", "2026-11-26T00:00:00Z"]) {
      for (let hour = 0; hour < 72; hour += 1) {
        const t = new Date(start).getTime() + hour * 3_600_000;
        instants.push(new Date(t).toISOString(), new Date(t + 3_599_000).toISOString());
      }
    }
    const result = await db.query<{ at: string; day_start: string }>(
      `select at::text as at, (date_trunc('day', at::timestamptz at time zone 'America/Chicago') at time zone 'America/Chicago')::text as day_start from unnest($1::text[]) as at`,
      [instants],
    );
    for (const row of result.rows) {
      expect(voiceDayStart(new Date(row.at)).toISOString(), row.at).toBe(new Date(row.day_start).toISOString());
    }
  });
});
