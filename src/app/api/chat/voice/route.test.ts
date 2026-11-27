import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * VOICE_INPUT_ENABLED: POST /api/chat/voice, the one route the four AI chat boxes share. Every person and address is
 * invented. AssemblyAI is a fake fetch; the usage counters are the in-memory store (the same rule as the RPC).
 */

const auth = vi.hoisted(() => ({
  identity: null as null | { subject: string; email: string; role: string; scope: unknown; verified: boolean; displayName: string },
  refuse: null as null | "unauthenticated" | "forbidden",
}));
vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: vi.fn(async (_request: Request, permission: string) => {
      if (auth.refuse === "unauthenticated" || !auth.identity) throw new AuthError("unauthenticated", "You are not signed in.");
      if (auth.refuse === "forbidden") throw new AuthError("forbidden", "Your role does not have permission to do that.");
      return { identity: auth.identity, permission, provider: "test" };
    }),
  };
});

const hub = vi.hoisted(() => ({
  viewer: null as null | { email: string; displayName: string; userId: string; role: string; scope: unknown },
  meetings: [] as { key: string; name: string }[],
}));
vi.mock("@/features/l10/data.server", () => ({
  l10Viewer: vi.fn(async () => hub.viewer),
  listMyMeetings: vi.fn(async () => hub.meetings),
}));

const guard = vi.hoisted(() => ({ reply: null as null | string }));
vi.mock("@/lib/ai/spend-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/spend-guard")>()),
  modelSpendGuard: vi.fn(async () => (guard.reply ? { content: guard.reply } : null)),
}));

const supabase = vi.hoisted(() => ({ storageFrom: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseAdmin: () => ({ storage: { from: supabase.storageFrom }, from: supabase.from, rpc: supabase.rpc }),
}));

import { InMemoryRateLimiter, __setRateLimiter } from "@/lib/api/rate-limit";
import { MONTHLY_BUDGET_REPLY } from "@/lib/ai/spend-guard";
import { authorizeRequest } from "@/lib/auth/server";
import { voiceRouteDeps, type VoiceRouteDeps } from "@/lib/voice/voice-route-deps";
import { memoryVoiceUsageStore } from "@/lib/voice/voice-usage";
import { MAX_BYTES } from "@/lib/voice/voice-limits";
import { VOICE_MESSAGES } from "@/lib/voice/voice-messages";
import { POST, dynamic, maxDuration, runtime } from "./route";

const ORIGIN = "http://localhost";
const SCOPE = { level: "salon", primaryAreaId: "loc-0001", alsoCoversAreaIds: [] };
const ADA = { subject: "user-ada", email: "ada@example.test", role: "salon_director", scope: SCOPE, verified: true, displayName: "Ada Quill" };
const TRANSCRIPT = "write a coaching form for tad brook he was late on monday";
const HINTS = ["Tad Brook", "Coaching Form", "Example Plaza"];
const CONVERSATION = "conv_mvn0000000000aaaa";

function webm(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size).fill(1);
  bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
  return bytes;
}

function mp4(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size).fill(1);
  bytes.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70], 0);
  return bytes;
}

interface Body {
  surface?: string;
  clipSeconds?: string;
  conversationId?: string;
  meetingKey?: string;
  extra?: Record<string, string>;
  audio?: Uint8Array | null;
  type?: string;
}

function request(body: Body = {}, headers: Record<string, string> = { origin: ORIGIN }): Request {
  const form = new FormData();
  form.append("surface", body.surface ?? "chat");
  form.append("clipSeconds", body.clipSeconds ?? "4.20");
  if (body.conversationId) form.append("conversationId", body.conversationId);
  if (body.meetingKey) form.append("meetingKey", body.meetingKey);
  for (const [key, value] of Object.entries(body.extra ?? {})) form.append(key, value);
  if (body.audio !== null) form.append("audio", new Blob([new Uint8Array(body.audio ?? webm())], { type: body.type ?? "audio/webm;codecs=opus" }), "clip.webm");
  return new Request(`${ORIGIN}/api/chat/voice`, { method: "POST", body: form, headers });
}

const providerOk = (text = TRANSCRIPT) => new Response(JSON.stringify({ text, audio_duration_ms: 4100 }), { status: 200, headers: { "content-type": "application/json" } });

let store: ReturnType<typeof memoryVoiceUsageStore>;
let traces: Record<string, unknown>[];
let providerCalls: number;
let provider: () => Response;
let lines: string[];
const saved: VoiceRouteDeps = { ...voiceRouteDeps };

beforeEach(() => {
  auth.identity = ADA;
  auth.refuse = null;
  hub.viewer = null;
  hub.meetings = [];
  guard.reply = null;
  store = memoryVoiceUsageStore();
  traces = [];
  providerCalls = 0;
  provider = () => providerOk();
  lines = [];
  __setRateLimiter(new InMemoryRateLimiter());
  vi.stubEnv("VOICE_INPUT_ENABLED", "1");
  vi.stubEnv("VOICE_INPUT_USERS", "ada@example.test, bea@example.test");
  vi.stubEnv("ASSEMBLYAI_API_KEY", "test-key-not-real");
  Object.assign(voiceRouteDeps, {
    store,
    fetch: (async () => {
      providerCalls += 1;
      return provider();
    }) as unknown as typeof fetch,
    writeTrace: async (row: Record<string, unknown>) => {
      traces.push(row);
    },
    chatHints: vi.fn(async () => ({ keyterms: HINTS, prompt: "A manager is speaking.", conversationContext: ["earlier: Tad Brook was late"] })),
    l10Hints: vi.fn(async () => ({ keyterms: ["Ivo Marchetti", "DM L10"], prompt: "A meeting." })),
  } satisfies Partial<VoiceRouteDeps>);
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
  supabase.storageFrom.mockClear();
  supabase.from.mockClear();
  supabase.rpc.mockClear();
});

afterEach(() => {
  Object.assign(voiceRouteDeps, saved);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const read = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, unknown> });

describe("the route's segment config", () => {
  it("node, 45 seconds, never cached", () => {
    expect(runtime).toBe("nodejs");
    expect(maxDuration).toBe(45);
    expect(dynamic).toBe("force-dynamic");
  });
});

describe("who gets an answer", () => {
  it("flag off: 404, the same as an unknown route", async () => {
    vi.stubEnv("VOICE_INPUT_ENABLED", "");
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found.", code: "not_found" });
    expect(providerCalls).toBe(0);
  });

  it("VOICE_INPUT_USERS unset: 404", async () => {
    vi.stubEnv("VOICE_INPUT_USERS", "");
    expect((await POST(request())).status).toBe(404);
  });

  it("an email not on the list: 404 for every box", async () => {
    auth.identity = { ...ADA, subject: "user-cy", email: "cy@example.test" };
    hub.viewer = { email: "cy@example.test", displayName: "Cy", userId: "user-cy", role: "district_manager", scope: SCOPE };
    hub.meetings = [{ key: "stc-dm", name: "DM L10" }];
    for (const surface of ["chat", "overview", "report"]) expect((await POST(request({ surface }))).status).toBe(404);
    expect((await POST(request({ surface: "l10", meetingKey: "stc-dm" }))).status).toBe(404);
    expect(providerCalls).toBe(0);
  });

  it("not signed in: 401", async () => {
    auth.identity = null;
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(401);
    expect(body.code).toBe("unauthenticated");
  });

  it("without ask_questions: refused for chat, overview and report", async () => {
    auth.refuse = "forbidden";
    for (const surface of ["chat", "overview", "report"]) {
      const { status, body } = await read(await POST(request({ surface })));
      expect(status).toBe(403);
      expect(body.code).toBe("forbidden");
    }
    expect(providerCalls).toBe(0);
  });

  it("l10: no verified viewer is a 404", async () => {
    hub.viewer = null;
    expect((await POST(request({ surface: "l10", meetingKey: "stc-dm" }))).status).toBe(404);
  });

  it("l10: a meeting the Hub does not list for this person is a 404", async () => {
    hub.viewer = { email: "ada@example.test", displayName: "Ada", userId: "user-ada", role: "salon_director", scope: SCOPE };
    hub.meetings = [{ key: "stc-sd-one", name: "SD L10 One" }];
    expect((await POST(request({ surface: "l10", meetingKey: "stc-dm" }))).status).toBe(404);
    expect(providerCalls).toBe(0);
  });

  it("l10: a person without ask_questions but with Hub access gets the text (ask_questions is not asked)", async () => {
    auth.refuse = "forbidden";
    hub.viewer = { email: "ada@example.test", displayName: "Ada", userId: "user-ada", role: "salon_director", scope: SCOPE };
    hub.meetings = [{ key: "stc-dm", name: "DM L10" }];
    vi.mocked(authorizeRequest).mockClear();
    const { status, body } = await read(await POST(request({ surface: "l10", meetingKey: "stc-dm" })));
    expect(status).toBe(200);
    expect(body.text).toBe(TRANSCRIPT);
    expect(authorizeRequest).not.toHaveBeenCalled();
    expect(voiceRouteDeps.l10Hints).toHaveBeenCalledWith({ meetingKey: "stc-dm", scope: SCOPE });
  });

  it("cross-site: 403", async () => {
    const { status } = await read(await POST(request({}, { origin: "https://evil.example.test" })));
    expect(status).toBe(403);
    expect(providerCalls).toBe(0);
  });
});

describe("the body", () => {
  it("an unknown surface is refused", async () => {
    expect((await POST(request({ surface: "admin" }))).status).toBe(400);
  });

  it("an extra field is refused", async () => {
    expect((await POST(request({ extra: { keyterms: "Injected Term" } }))).status).toBe(400);
  });

  it("a meetingKey on a chat box, or l10 without one, is refused", async () => {
    expect((await POST(request({ surface: "chat", meetingKey: "stc-dm" }))).status).toBe(400);
    expect((await POST(request({ surface: "l10" }))).status).toBe(400);
    expect((await POST(request({ surface: "l10", meetingKey: "not-a-meeting" }))).status).toBe(400);
  });

  it("a conversation id that is not this app's shape is refused", async () => {
    expect((await POST(request({ conversationId: "../../etc" }))).status).toBe(400);
  });

  it("a wrong type is refused (415)", async () => {
    const { status, body } = await read(await POST(request({ type: "image/png" })));
    expect(status).toBe(415);
    expect(body.error).toBe(VOICE_MESSAGES.badAudio);
  });

  it("wrong first bytes are refused (415)", async () => {
    const fake = new Uint8Array(4096).fill(65);
    expect((await POST(request({ audio: fake }))).status).toBe(415);
    // MP4 bytes declared as WebM
    expect((await POST(request({ audio: mp4(), type: "audio/webm" }))).status).toBe(415);
    expect(providerCalls).toBe(0);
  });

  it("an MP4 recording (iPhone Safari) is accepted", async () => {
    expect((await POST(request({ audio: mp4(), type: "audio/mp4" }))).status).toBe(200);
  });

  it("larger than MAX_BYTES while streaming: 413, and the stream is not read to its end", async () => {
    const boundary = "----voiceTestBoundary";
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="surface"\r\n\r\nchat\r\n--${boundary}\r\nContent-Disposition: form-data; name="clipSeconds"\r\n\r\n4.2\r\n--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="clip.webm"\r\nContent-Type: audio/webm\r\n\r\n`,
    );
    let pulled = 0;
    const chunk = webm(256 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled === 1) controller.enqueue(head);
        else if (pulled > 200) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const response = await POST(
      new Request(`${ORIGIN}/api/chat/voice`, {
        method: "POST",
        body: stream,
        headers: { origin: ORIGIN, "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": "100" },
        duplex: "half",
      } as RequestInit),
    );
    const { status, body } = await read(response);
    expect(status).toBe(413);
    expect(body.error).toBe(VOICE_MESSAGES.tooLong);
    expect(pulled).toBeLessThan(Math.ceil(MAX_BYTES / chunk.length) + 4);
    expect(providerCalls).toBe(0);
  });

  it("too short to be a recording: 'I did not hear anything'", async () => {
    const { status, body } = await read(await POST(request({ clipSeconds: "0.2" })));
    expect(status).toBe(422);
    expect(body.error).toBe(VOICE_MESSAGES.nothingHeard);
  });
});

describe("a transcription", () => {
  it("success: the provider's text as it is, a trace id, and the hints from the server", async () => {
    provider = () => providerOk("  Um, coaching form for Tad Brook  ");
    const { status, body } = await read(await POST(request({ conversationId: CONVERSATION })));
    expect(status).toBe(200);
    expect(body).toEqual({ text: "  Um, coaching form for Tad Brook  ", traceId: store.rows[0]!.id });
    expect(voiceRouteDeps.chatHints).toHaveBeenCalledWith({ actor: { userId: "user-ada", role: "salon_director", scope: SCOPE }, conversationId: CONVERSATION });
    expect(store.rows[0]).toMatchObject({ userId: "user-ada", salonId: "loc-0001", surface: "chat", status: "succeeded", audioSeconds: 4.1 });
  });

  it("the trace row: the agreed fields, and no text", async () => {
    await POST(request({ surface: "overview" }));
    expect(traces).toHaveLength(1);
    const row = traces[0]!;
    expect(row).toMatchObject({
      intent: "voice",
      model: null,
      original_query: "[voice] transcription",
      user_id: "user-ada",
      succeeded: true,
      error_status: null,
      error_class: null,
      slots: {
        voice: { provider: "assemblyai", endpoint: "sync", surface: "overview", audio_seconds: 4.1, bytes: 4096, mime: "audio/webm", keyterm_count: 3, retried: false, outcome: "ok" },
        spend: [{ source: "voice", audio_seconds: 4.1, usd_per_hour: 0.35 }],
      },
    });
    expect(typeof row.latency_ms).toBe("number");
    expect(row).not.toHaveProperty("e2e_latency_ms");
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("coaching form for tad brook");
    for (const hint of HINTS) expect(serialized).not.toContain(hint);
  });

  it("a provider error is recorded with its status as a number", async () => {
    provider = () => new Response(JSON.stringify({ title: "Unsupported Media Type" }), { status: 415, headers: { "content-type": "application/problem+json" } });
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(415);
    expect(body).toEqual({ error: VOICE_MESSAGES.badAudio, code: "bad_audio" });
    expect(traces[0]).toMatchObject({ succeeded: false, error_status: 415, error_class: "unsupported_media_type", slots: { spend: [{ audio_seconds: 0 }] } });
    // A clear rejection: the row is failed and its seconds are freed (it still counts as a request).
    expect(store.rows[0]).toMatchObject({ status: "failed", audioSeconds: 0 });
  });

  it("no answer or a 5xx: the row keeps its clip length, and the trace bills it", async () => {
    provider = () => new Response("{}", { status: 503 });
    await POST(request({ clipSeconds: "7.5" }));
    expect(store.rows[0]).toMatchObject({ status: "failed", audioSeconds: null, clipSeconds: 7.5 });
    expect(traces[0]).toMatchObject({ slots: { spend: [{ audio_seconds: 7.5 }] } });
  });

  it("the provider rejects the key: 'Voice is not available right now' and a log line without text", async () => {
    provider = () => new Response(JSON.stringify({ title: "Unauthorized" }), { status: 401 });
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(503);
    expect(body.error).toBe(VOICE_MESSAGES.unavailable);
    expect(lines.some((line) => /provider_rejected_key/.test(line))).toBe(true);
  });

  it("the provider is busy: 429 with Retry-After", async () => {
    provider = () => new Response(JSON.stringify({ title: "Too Many Requests" }), { status: 429, headers: { "retry-after": "9" } });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("9");
    expect((await response.json()).error).toBe(VOICE_MESSAGES.busy);
  });

  it("empty text: 'I did not hear anything', never a blank", async () => {
    provider = () => providerOk("   ");
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(422);
    expect(body.error).toBe(VOICE_MESSAGES.nothingHeard);
  });

  it("the monthly guard on and over: chat's own budget sentence, and no provider call", async () => {
    guard.reply = MONTHLY_BUDGET_REPLY;
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).not.toBeNull();
    expect(await response.json()).toMatchObject({ error: MONTHLY_BUDGET_REPLY, code: "monthly_budget" });
    expect(providerCalls).toBe(0);
  });

  it("the counts cannot be read: fails closed with 'Voice is not available right now', no provider call", async () => {
    voiceRouteDeps.store = memoryVoiceUsageStore({ failReads: () => true });
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(503);
    expect(body.error).toBe(VOICE_MESSAGES.unavailable);
    expect(providerCalls).toBe(0);
  });

  it("the person's minute cap is shared by the four boxes: 'Try again in N seconds.' with Retry-After", async () => {
    hub.viewer = { email: "ada@example.test", displayName: "Ada", userId: "user-ada", role: "salon_director", scope: SCOPE };
    hub.meetings = [{ key: "stc-dm", name: "DM L10" }];
    const surfaces = ["chat", "overview", "report", "l10"];
    for (let i = 0; i < 10; i += 1) {
      const surface = surfaces[i % 4]!;
      expect((await POST(request(surface === "l10" ? { surface, meetingKey: "stc-dm" } : { surface }))).status).toBe(200);
    }
    const response = await POST(request({ surface: "report" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
    expect((await response.json()).error).toMatch(/^Try again in \d+ seconds?\.$/);
  });

  it("a day cap: its own sentence", async () => {
    voiceRouteDeps.store = { reserve: async () => ({ ok: false, refused: "salon_day" }), finish: async () => undefined };
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(429);
    expect(body.error).toBe(VOICE_MESSAGES.salonDay);
  });

  it("the usage update failing after the call only logs a warning; the text still comes back", async () => {
    voiceRouteDeps.store = { reserve: store.reserve, finish: async () => Promise.reject(new Error("update failed")) };
    const { status } = await read(await POST(request()));
    expect(status).toBe(200);
    expect(lines.some((line) => /usage_update_failed/.test(line))).toBe(true);
  });

  it("nothing is stored in Supabase Storage", async () => {
    await POST(request());
    expect(supabase.storageFrom).not.toHaveBeenCalled();
  });

  it("no log line carries the text, a name, an email or the hints", async () => {
    await POST(request({ conversationId: CONVERSATION }));
    provider = () => new Response("{}", { status: 500 });
    await POST(request({ conversationId: CONVERSATION }));
    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join("\n");
    expect(all).not.toContain(TRANSCRIPT);
    expect(all).not.toMatch(/@example\.test/);
    expect(all).not.toMatch(/Ada Quill|Tad Brook|Coaching Form|Example Plaza/);
    expect(all).not.toContain("test-key-not-real");
  });
});

describe('"i said Curt, it spelled it as Kurt" (the owner, 27 Nov 2026)', () => {
  /*
   * The report's people are swapped for invented ones of the same shape: the directory's "Cade Holloway", heard by the
   * provider as "Kade Holloway". The real hint builder runs here (with a fake roster), so this pins both halves: the
   * name is SENT as a hint on the very first recording, and a mishearing that still comes back is corrected before the
   * text reaches the box.
   */
  const ROSTER = [
    { id: "e1", firstName: "Cade", lastName: "Holloway", preferredFirstName: null, salonIds: ["loc-0001"] },
    { id: "e2", firstName: "Orla", lastName: "Fennick", preferredFirstName: null, salonIds: ["loc-0001"] },
  ];

  async function withRealHints() {
    const { chatVoiceHints } = await import("@/lib/voice/keyterms");
    let sent: Record<string, unknown> | null = null;
    Object.assign(voiceRouteDeps, {
      chatHints: (input: Parameters<typeof chatVoiceHints>[0]) =>
        chatVoiceHints(input, {
          ownConversation: async () => null,
          scopedRoster: async (scope) => (scope === SCOPE ? ROSTER : []),
          publishedFormNames: async () => ["Corrective Action Form"],
          salonName: () => null,
          scopedPlaces: () => [],
        }),
      fetch: (async (_url: string, init: RequestInit) => {
        providerCalls += 1;
        const config = (init.body as FormData).get("config") as Blob;
        sent = JSON.parse(await config.text()) as Record<string, unknown>;
        return provider();
      }) as unknown as typeof fetch,
    } satisfies Partial<VoiceRouteDeps>);
    return () => sent;
  }

  it("the scoped roster is sent as hints on the first recording, before the name was ever typed", async () => {
    const sent = await withRealHints();
    provider = () => providerOk("Hey can you create a CA for Cade Holloway please");
    await POST(request());
    expect(sent()?.keyterms_prompt).toEqual(expect.arrayContaining(["Cade Holloway", "Orla Fennick", "Corrective Action Form"]));
  });

  it("i said Cade, it spelled it as Kade: the box gets the directory spelling", async () => {
    await withRealHints();
    provider = () => providerOk("Hey can you create a CA for Kade Holloway please");
    const { status, body } = await read(await POST(request()));
    expect(status).toBe(200);
    expect(body).toMatchObject({ text: "Hey can you create a CA for Cade Holloway please" });
  });

  it("the roster never reaches the browser or a log line", async () => {
    await withRealHints();
    provider = () => providerOk("Kade Holloway was late");
    const { body } = await read(await POST(request()));
    expect(Object.keys(body as object).sort()).toEqual(["text", "traceId"]);
    expect(lines.join("\n")).not.toMatch(/Holloway|Fennick|Cade|Kade/);
  });
});
