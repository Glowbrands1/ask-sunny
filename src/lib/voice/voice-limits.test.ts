import { describe, expect, it } from "vitest";

import {
  COMPANY_AUDIO_SECONDS_PER_DAY,
  MAX_BYTES,
  MAX_SECONDS,
  MIN_BYTES,
  MIN_SECONDS,
  PER_SALON_AUDIO_SECONDS_PER_DAY,
  PER_USER_AUDIO_SECONDS_PER_DAY,
  PER_USER_PER_DAY,
  PER_USER_PER_MINUTE,
  PROVIDER_TIMEOUT_MS,
  RETRY_MAX_WAIT_MS,
  RETRY_MIN_REMAINING_MS,
  ROUTE_MAX_SECONDS,
  USD_PER_HOUR,
  clampClipSeconds,
  manilaDayStart,
} from "./voice-limits";
import { finishedAudioSeconds, memoryVoiceUsageStore, type VoiceReserveInput, type VoiceSurface } from "./voice-usage";

/*
 * VOICE_INPUT_ENABLED: the caps, shared by the four chat boxes, with day windows from Manila midnight (UTC+8). The
 * memory store applies the same rule the `voice_usage_reserve` RPC applies in SQL, one reservation at a time.
 */

const SURFACES: VoiceSurface[] = ["chat", "overview", "report", "l10"];

function clockAt(iso: string) {
  let now = new Date(iso).getTime();
  return {
    now: () => new Date(now),
    advance(ms: number) {
      now += ms;
    },
  };
}

const ada = (over: Partial<VoiceReserveInput> = {}): VoiceReserveInput => ({ userId: "user-ada", salonId: "loc-0001", surface: "chat", clipSeconds: 10, ...over });

/** Fills a store with finished clips without tripping the per-minute cap. */
async function fill(store: ReturnType<typeof memoryVoiceUsageStore>, clock: ReturnType<typeof clockAt>, count: number, input: VoiceReserveInput, audioSeconds?: number) {
  for (let i = 0; i < count; i += 1) {
    const reservation = await store.reserve(input);
    if (!reservation.ok) throw new Error(`refused at ${i}: ${reservation.refused}`);
    await store.finish(reservation.id, { status: "succeeded", audioSeconds: audioSeconds ?? input.clipSeconds });
    clock.advance(7_000);
  }
}

describe("the constants", () => {
  it("are the agreed numbers", () => {
    expect([MAX_SECONDS, MIN_SECONDS, MIN_BYTES, MAX_BYTES]).toEqual([60, 0.5, 1024, 3 * 1024 * 1024]);
    expect([PER_USER_PER_MINUTE, PER_USER_PER_DAY, PER_USER_AUDIO_SECONDS_PER_DAY, PER_SALON_AUDIO_SECONDS_PER_DAY, COMPANY_AUDIO_SECONDS_PER_DAY]).toEqual([10, 120, 1800, 5400, 10800]);
    expect([ROUTE_MAX_SECONDS, PROVIDER_TIMEOUT_MS, RETRY_MIN_REMAINING_MS, RETRY_MAX_WAIT_MS, USD_PER_HOUR]).toEqual([45, 28000, 8000, 2000, 0.35]);
  });

  it("a clip counts as the browser's length, clamped between 0.5 and 60 seconds", () => {
    expect(clampClipSeconds(0.1)).toBe(0.5);
    expect(clampClipSeconds(12)).toBe(12);
    expect(clampClipSeconds(400)).toBe(60);
    expect(clampClipSeconds(Number.NaN)).toBe(60);
  });
});

describe("the per-minute cap", () => {
  it("the eleventh request in a minute is refused with how long to wait, across all four boxes", async () => {
    const clock = clockAt("2026-11-27T02:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let i = 0; i < PER_USER_PER_MINUTE; i += 1) {
      expect((await store.reserve(ada({ surface: SURFACES[i % 4]! }))).ok).toBe(true);
      clock.advance(1_000);
    }
    const refused = await store.reserve(ada({ surface: "l10" }));
    expect(refused).toEqual({ ok: false, refused: "user_minute", retryAfterSeconds: 50 });
    clock.advance(51_000);
    expect((await store.reserve(ada())).ok).toBe(true);
  });

  it("another person is not held back by Ada's minute", async () => {
    const clock = clockAt("2026-11-27T02:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let i = 0; i < PER_USER_PER_MINUTE; i += 1) await store.reserve(ada());
    expect((await store.reserve(ada({ userId: "user-bea" }))).ok).toBe(true);
  });
});

describe("the day caps", () => {
  it("the 121st request in a Manila day is refused", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    await fill(store, clock, PER_USER_PER_DAY, ada({ clipSeconds: 1, salonId: null }), 1);
    expect(await store.reserve(ada({ clipSeconds: 1, salonId: null }))).toEqual({ ok: false, refused: "user_day" });
  });

  it("30 minutes of audio a day per person, the four boxes together", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let i = 0; i < 30; i += 1) {
      const reservation = await store.reserve(ada({ surface: SURFACES[i % 4]!, clipSeconds: 60, salonId: null }));
      expect(reservation.ok).toBe(true);
      if (reservation.ok) await store.finish(reservation.id, { status: "succeeded", audioSeconds: 60 });
      clock.advance(7_000);
    }
    expect(await store.reserve(ada({ clipSeconds: 1, salonId: null }))).toEqual({ ok: false, refused: "user_day" });
  });

  it("a finished clip counts as the provider's length, not the browser's", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    await fill(store, clock, 30, ada({ clipSeconds: 60, salonId: null }), 30);
    expect((await store.reserve(ada({ clipSeconds: 60, salonId: null }))).ok).toBe(true);
  });

  it("a pending clip (a crash before the provider answered) still counts", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let i = 0; i < 30; i += 1) {
      expect((await store.reserve(ada({ clipSeconds: 60, salonId: null }))).ok).toBe(true);
      clock.advance(7_000);
    }
    expect(store.rows.every((row) => row.status === "pending")).toBe(true);
    expect(await store.reserve(ada({ clipSeconds: 5, salonId: null }))).toEqual({ ok: false, refused: "user_day" });
  });

  it("a failed clip with no clear rejection (no answer, 429, 5xx) keeps its clip length", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let i = 0; i < 30; i += 1) {
      const reservation = await store.reserve(ada({ clipSeconds: 60, salonId: null }));
      expect(reservation.ok).toBe(true);
      if (reservation.ok) await store.finish(reservation.id, { status: "failed", audioSeconds: finishedAudioSeconds({ processed: false, providerStatus: i % 2 ? null : 503, audioSeconds: null, clampedClip: 60 }) });
      clock.advance(7_000);
    }
    expect(await store.reserve(ada({ clipSeconds: 5, salonId: null }))).toEqual({ ok: false, refused: "user_day" });
  });

  it("a clear provider rejection (415) frees its seconds, but still counts as a request", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let i = 0; i < 30; i += 1) {
      const reservation = await store.reserve(ada({ clipSeconds: 60, salonId: null }));
      if (reservation.ok) await store.finish(reservation.id, { status: "failed", audioSeconds: finishedAudioSeconds({ processed: false, providerStatus: 415, audioSeconds: null, clampedClip: 60 }) });
      clock.advance(7_000);
    }
    expect((await store.reserve(ada({ clipSeconds: 60, salonId: null }))).ok).toBe(true);
    expect(store.rows.filter((row) => row.status === "failed").every((row) => row.audioSeconds === 0)).toBe(true);
  });

  it("failed requests count toward the minute and the day request caps", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let i = 0; i < PER_USER_PER_MINUTE; i += 1) {
      const reservation = await store.reserve(ada({ clipSeconds: 1, salonId: null }));
      if (reservation.ok) await store.finish(reservation.id, { status: "failed", audioSeconds: 0 });
    }
    expect((await store.reserve(ada({ clipSeconds: 1, salonId: null }))).ok).toBe(false);
    clock.advance(61_000);
    for (let i = PER_USER_PER_MINUTE; i < PER_USER_PER_DAY; i += 1) {
      const reservation = await store.reserve(ada({ clipSeconds: 1, salonId: null }));
      expect(reservation.ok).toBe(true);
      if (reservation.ok) await store.finish(reservation.id, { status: "failed", audioSeconds: 0 });
      clock.advance(7_000);
    }
    expect(await store.reserve(ada({ clipSeconds: 1, salonId: null }))).toEqual({ ok: false, refused: "user_day" });
  });

  it("what a finished call writes: the provider's length; 0 after 400, 401, 413, 415; nothing otherwise", () => {
    expect(finishedAudioSeconds({ processed: true, providerStatus: 200, audioSeconds: 4.1, clampedClip: 5 })).toBe(4.1);
    expect(finishedAudioSeconds({ processed: true, providerStatus: 200, audioSeconds: null, clampedClip: 5 })).toBe(5);
    for (const status of [400, 401, 413, 415]) expect(finishedAudioSeconds({ processed: false, providerStatus: status, audioSeconds: null, clampedClip: 5 })).toBe(0);
    for (const status of [null, 429, 500, 503, 504, 200]) expect(finishedAudioSeconds({ processed: false, providerStatus: status, audioSeconds: null, clampedClip: 5 })).toBeNull();
  });

  it("90 minutes of audio a day per salon, whoever is speaking", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    // Three people at one salon, 30 minutes each.
    for (const userId of ["user-ada", "user-bea", "user-cy"]) await fill(store, clock, 30, ada({ userId, clipSeconds: 60 }), 60);
    expect(await store.reserve(ada({ userId: "user-dee", clipSeconds: 10 }))).toEqual({ ok: false, refused: "salon_day" });
    // Someone at another salon still can.
    expect((await store.reserve(ada({ userId: "user-dee", salonId: "loc-0002", clipSeconds: 10 }))).ok).toBe(true);
  });

  it("3 hours of audio a day for the company", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    for (let person = 0; person < 6; person += 1) {
      await fill(store, clock, 30, ada({ userId: `user-${person}`, salonId: `loc-000${person}`, clipSeconds: 60 }), 60);
    }
    expect(await store.reserve(ada({ userId: "user-new", salonId: "loc-0099", clipSeconds: 10 }))).toEqual({ ok: false, refused: "company_day" });
  });
});

describe("the Manila day", () => {
  it("starts at 16:00 UTC", () => {
    expect(manilaDayStart(new Date("2026-11-27T15:59:59Z")).toISOString()).toBe("2026-11-26T16:00:00.000Z");
    expect(manilaDayStart(new Date("2026-11-27T16:00:00Z")).toISOString()).toBe("2026-11-27T16:00:00.000Z");
    expect(manilaDayStart(new Date("2026-11-27T02:00:00Z")).toISOString()).toBe("2026-11-26T16:00:00.000Z");
  });

  it("a clip at 15:59:59 UTC counts in the old day; one at 16:00:00 UTC in the new day", async () => {
    const clock = clockAt("2026-11-27T10:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    // Ada uses 29 minutes 50 seconds of the day by 15:59:59 UTC (23:59:59 in Manila).
    await fill(store, clock, 29, ada({ clipSeconds: 60, salonId: null }), 60);
    const last = await store.reserve(ada({ clipSeconds: 50, salonId: null }));
    if (last.ok) await store.finish(last.id, { status: "succeeded", audioSeconds: 50 });
    const late = new Date("2026-11-27T15:59:59Z").getTime() - clock.now().getTime();
    clock.advance(late);
    expect(await store.reserve(ada({ clipSeconds: 20, salonId: null }))).toEqual({ ok: false, refused: "user_day" });
    clock.advance(1_000);
    expect(clock.now().toISOString()).toBe("2026-11-27T16:00:00.000Z");
    expect((await store.reserve(ada({ clipSeconds: 20, salonId: null }))).ok).toBe(true);
  });
});

describe("one step", () => {
  it("two overlapping requests for the last place: the second is refused", async () => {
    const clock = clockAt("2026-11-27T00:00:00Z");
    const store = memoryVoiceUsageStore({ now: clock.now });
    await fill(store, clock, 29, ada({ clipSeconds: 60, salonId: null }), 60);
    const [first, second] = await Promise.all([store.reserve(ada({ clipSeconds: 40, salonId: null, surface: "chat" })), store.reserve(ada({ clipSeconds: 40, salonId: null, surface: "l10" }))]);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, refused: "user_day" });
  });

  it("fails closed: a read that fails throws, so the route refuses", async () => {
    const store = memoryVoiceUsageStore({ failReads: () => true });
    await expect(store.reserve(ada())).rejects.toThrow();
  });
});
