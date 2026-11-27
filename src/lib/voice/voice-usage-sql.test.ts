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
} from "./voice-limits";

/*
 * VOICE_INPUT_ENABLED: the migration's `voice_usage_reserve` RPC, run on a real Postgres (PGlite) with the caps the
 * route passes. The same rule as `evaluateVoiceCaps`, checked in SQL.
 */

const MIGRATION = readFileSync("supabase/migrations/20261127001000_voice_usage.sql", "utf8");
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions;
    create function extensions.gen_random_uuid() returns uuid language sql as $$ select gen_random_uuid() $$;
  `);
  await db.exec(MIGRATION);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("truncate public.voice_usage");
});

async function reserve(user: string, salon: string | null, clip: number, surface = "chat") {
  const result = await db.query<{ usage_id: string | null; refused: string | null; retry_after_seconds: number | null }>(
    "select * from public.voice_usage_reserve($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
    [user, salon, surface, clip, MIN_SECONDS, MAX_SECONDS, PER_USER_PER_MINUTE, PER_USER_PER_DAY, PER_USER_AUDIO_SECONDS_PER_DAY, PER_SALON_AUDIO_SECONDS_PER_DAY, COMPANY_AUDIO_SECONDS_PER_DAY],
  );
  return result.rows[0]!;
}

async function backdate(interval: string) {
  await db.exec(`update public.voice_usage set created_at = created_at - interval '${interval}'`);
}

async function insertFinished(rows: number, user: (i: number) => string, salon: (i: number) => string | null, seconds: number, at = "now() - interval '10 minutes'") {
  for (let i = 0; i < rows; i += 1) {
    await db.query(
      `insert into public.voice_usage (user_id, salon_id, surface, status, clip_seconds, audio_seconds, created_at) values ($1, $2, 'report', 'succeeded', $3, $3, ${at})`,
      [user(i), salon(i), seconds],
    );
  }
}

describe("voice_usage_reserve", () => {
  it("inserts a pending row, the clip clamped, and returns its id", async () => {
    const first = await reserve("user-ada", "loc-0001", 0.1);
    expect(first.refused).toBeNull();
    expect(first.usage_id).toMatch(/^[0-9a-f-]{36}$/);
    await reserve("user-ada", "loc-0001", 400, "l10");
    const rows = await db.query<{ status: string; clip_seconds: string; surface: string }>("select status, clip_seconds::text, surface from public.voice_usage order by created_at");
    expect(rows.rows.map((row) => [row.status, Number(row.clip_seconds), row.surface])).toEqual([
      ["pending", 0.5, "chat"],
      ["pending", 60, "l10"],
    ]);
  });

  it("the eleventh in a minute is refused, with how long to wait", async () => {
    for (let i = 0; i < 10; i += 1) expect((await reserve("user-ada", null, 2, ["chat", "overview", "report", "l10"][i % 4])).refused).toBeNull();
    const refused = await reserve("user-ada", null, 2);
    expect(refused.refused).toBe("user_minute");
    expect(refused.retry_after_seconds).toBeGreaterThan(0);
    expect((await reserve("user-bea", null, 2)).refused).toBeNull();
    await backdate("61 seconds");
    expect((await reserve("user-ada", null, 2)).refused).toBeNull();
  });

  it("the person's audio for the day, pending rows included", async () => {
    await insertFinished(29, () => "user-ada", () => null, 60);
    for (let i = 0; i < 5; i += 1) await reserve("user-ada", null, 10); // pending, 50 s
    await backdate("2 minutes");
    expect((await reserve("user-ada", null, 20)).refused).toBe("user_day");
    expect((await reserve("user-ada", null, 10)).refused).toBeNull();
  });

  it("the salon's and the company's audio for the day", async () => {
    await insertFinished(90, (i) => `user-${i}`, () => "loc-0003", 60);
    expect((await reserve("user-new", "loc-0003", 5)).refused).toBe("salon_day");
    expect((await reserve("user-new", "loc-0004", 5)).refused).toBeNull();
    await insertFinished(90, (i) => `other-${i}`, () => null, 60);
    expect((await reserve("user-late", "loc-0005", 5)).refused).toBe("company_day");
  });

  it("failed rows count toward the minute and the day request caps", async () => {
    await db.exec(`insert into public.voice_usage (user_id, surface, status, clip_seconds, audio_seconds) select 'user-ada', 'chat', 'failed', 1, 0 from generate_series(1, 10)`);
    expect((await reserve("user-ada", null, 1)).refused).toBe("user_minute");
    await db.exec("truncate public.voice_usage");
    await db.exec(`insert into public.voice_usage (user_id, surface, status, clip_seconds, audio_seconds, created_at) select 'user-ada', 'chat', 'failed', 1, 0, now() - interval '10 minutes' from generate_series(1, 120)`);
    expect((await reserve("user-ada", null, 1)).refused).toBe("user_day");
  });

  it("a failed row with no seconds written (no answer, 429, 5xx) keeps its clip length; a clear rejection (0) frees it", async () => {
    await db.exec(`insert into public.voice_usage (user_id, surface, status, clip_seconds, audio_seconds, created_at) select 'user-ada', 'chat', 'failed', 60, null, now() - interval '10 minutes' from generate_series(1, 30)`);
    expect((await reserve("user-ada", null, 5)).refused).toBe("user_day");
    await db.exec("update public.voice_usage set audio_seconds = 0");
    expect((await reserve("user-ada", null, 60)).refused).toBeNull();
  });

  it("yesterday's rows (before Manila midnight) do not count", async () => {
    await insertFinished(30, () => "user-ada", () => null, 60, "(date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila') - interval '1 second'");
    expect((await reserve("user-ada", null, 60)).refused).toBeNull();
    await db.exec("truncate public.voice_usage");
    await insertFinished(30, () => "user-ada", () => null, 60, "(date_trunc('day', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila')");
    expect((await reserve("user-ada", null, 60)).refused).toBe("user_day");
  });

  it("the Manila day starts at 16:00 UTC", async () => {
    const result = await db.query<{ old_day: string; new_day: string }>(`
      select (date_trunc('day', timestamptz '2026-11-27 15:59:59+00' at time zone 'Asia/Manila') at time zone 'Asia/Manila')::text as old_day,
             (date_trunc('day', timestamptz '2026-11-27 16:00:00+00' at time zone 'Asia/Manila') at time zone 'Asia/Manila')::text as new_day`);
    expect(new Date(result.rows[0]!.old_day).toISOString()).toBe("2026-11-26T16:00:00.000Z");
    expect(new Date(result.rows[0]!.new_day).toISOString()).toBe("2026-11-27T16:00:00.000Z");
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
});
