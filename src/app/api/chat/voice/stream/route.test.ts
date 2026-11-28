import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SESSION_MAX_SECONDS } from "@/lib/voice/streaming";

/*
 * VOICE_INPUT_ENABLED: POST /api/chat/voice/stream, live dictation (the owner, 27 Nov 2026: "it transcribes as you talk
 * then when done, press check mark and auto send"). Every person and address is invented; AssemblyAI's token endpoint
 * is a fake; the usage counters are the in-memory store.
 */

const auth = vi.hoisted(() => ({
  identity: null as null | { subject: string; email: string; role: string; scope: unknown; verified: boolean; displayName: string },
}));
vi.mock("@/lib/auth/server", async () => {
  const { AuthError } = await import("@/lib/auth/types");
  return {
    authorizeRequest: vi.fn(async (_request: Request, permission: string) => {
      if (!auth.identity) throw new AuthError("unauthenticated", "You are not signed in.");
      return { identity: auth.identity, permission, provider: "test" };
    }),
  };
});
vi.mock("@/features/l10/data.server", () => ({ l10Viewer: vi.fn(async () => null), listMyMeetings: vi.fn(async () => []) }));
vi.mock("@/lib/ai/spend-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/spend-guard")>()),
  modelSpendGuard: vi.fn(async () => null),
}));

import { InMemoryRateLimiter, __setRateLimiter } from "@/lib/api/rate-limit";
import { chatVoiceHints } from "@/lib/voice/keyterms";
import { voiceRouteDeps, type VoiceRouteDeps } from "@/lib/voice/voice-route-deps";
import { memoryVoiceUsageStore } from "@/lib/voice/voice-usage";
import { POST } from "./route";

const ORIGIN = "http://localhost";
const SCOPE = { level: "salon", primaryAreaId: "loc-0001", alsoCoversAreaIds: [] };
const ADA = { subject: "user-ada", email: "ada@example.test", role: "salon_director", scope: SCOPE, verified: true, displayName: "Ada Quill" };
const ROSTER = [{ id: "e1", firstName: "Cade", lastName: "Holloway", preferredFirstName: null, salonIds: ["loc-0001"] }];

function request(body: Record<string, unknown>, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}/api/chat/voice/stream`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

let store: ReturnType<typeof memoryVoiceUsageStore>;
let traces: Record<string, unknown>[];
let lines: string[];
let tokenCalls: number;
let tokenAnswer: () => Promise<{ ok: true; token: string } | { ok: false; status: number | null }>;
const saved: VoiceRouteDeps = { ...voiceRouteDeps };

beforeEach(() => {
  auth.identity = ADA;
  store = memoryVoiceUsageStore();
  traces = [];
  lines = [];
  tokenCalls = 0;
  tokenAnswer = async () => ({ ok: true, token: "tmp-token-not-real" });
  __setRateLimiter(new InMemoryRateLimiter());
  vi.stubEnv("VOICE_INPUT_ENABLED", "1");
  vi.stubEnv("VOICE_INPUT_USERS", "ada@example.test");
  vi.stubEnv("ASSEMBLYAI_API_KEY", "test-key-not-real");
  Object.assign(voiceRouteDeps, {
    store,
    writeTrace: async (row: Record<string, unknown>) => {
      traces.push(row);
    },
    streamingToken: (async () => {
      tokenCalls += 1;
      return tokenAnswer();
    }) as VoiceRouteDeps["streamingToken"],
    chatHints: ((input: Parameters<typeof chatVoiceHints>[0]) =>
      chatVoiceHints(input, {
        ownConversation: async () => null,
        scopedRoster: async () => ROSTER,
        publishedFormNames: async () => [],
        salonName: () => null,
        scopedPlaces: () => [],
      })) as VoiceRouteDeps["chatHints"],
  } satisfies Partial<VoiceRouteDeps>);
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  Object.assign(voiceRouteDeps, saved);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function started() {
  const { status, body } = await read(await POST(request({ action: "start", surface: "chat" })));
  expect(status).toBe(200);
  return body as { socketUrl: string; session: string; maxSeconds: number };
}

describe("start", () => {
  it("reserves a session, mints a token, and answers the socket URL: the token and audio format, never a name or the key", async () => {
    const body = await started();
    const url = new URL(body.socketUrl);
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe("wss://streaming.assemblyai.com/v3/ws");
    expect(url.searchParams.get("token")).toBe("tmp-token-not-real");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
    expect(url.searchParams.has("keyterms_prompt")).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/Holloway|Cade|test-key-not-real|ada@example/);
    expect(body.maxSeconds).toBe(60);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ userId: "user-ada", surface: "chat", status: "pending" });
  });

  it("voice not on for this person: the same 404 as an unknown route, and no token", async () => {
    vi.stubEnv("VOICE_INPUT_USERS", "someone@example.test");
    const { status } = await read(await POST(request({ action: "start", surface: "chat" })));
    expect(status).toBe(404);
    expect(tokenCalls).toBe(0);
  });

  it("not signed in: 401", async () => {
    auth.identity = null;
    expect((await POST(request({ action: "start", surface: "chat" }))).status).toBe(401);
  });

  it("cross-site: 403", async () => {
    expect((await POST(request({ action: "start", surface: "chat" }, { origin: "https://elsewhere.example" }))).status).toBe(403);
  });

  it("the token cannot be minted: 'use the recording instead', and the session counts nothing", async () => {
    tokenAnswer = async () => ({ ok: false, status: 500 });
    const { status, body } = await read(await POST(request({ action: "start", surface: "chat" })));
    expect(status).toBe(503);
    expect(body.code).toBe("stream_unavailable");
    expect(store.rows[0]).toMatchObject({ status: "failed", audioSeconds: 0 });
  });
});

describe('finish: "press check mark and auto send" (the owner, 27 Nov 2026)', () => {
  it("✓ with the owner's case (invented: i said Cade, it heard Kade): the names are respelled before it is sent", async () => {
    // Changed on purpose (audit, 28 Nov 2026; port of Leadership Hub 3630a6f): the session is billed by the server's
    // clock since "start", never the browser's seconds, so the clock moves 4.2 s between the two calls.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T15:00:00Z"));
    const { session } = await started();
    vi.setSystemTime(new Date("2026-11-28T15:00:04.200Z"));
    const { status, body } = await read(
      await POST(request({ action: "finish", surface: "chat", session, outcome: "send", text: "Hey can you create a CA for Kade Holloway please", seconds: 4.2 })),
    );
    expect(status).toBe(200);
    expect(body.text).toBe("Hey can you create a CA for Cade Holloway please");
    expect(store.rows[0]).toMatchObject({ status: "succeeded", audioSeconds: 4.2 });
    expect(traces[0]).toMatchObject({ intent: "voice", slots: { voice: { endpoint: "streaming", outcome: "ok", audio_seconds: 4.2 } } });
    expect(lines.join("\n")).not.toMatch(/Holloway|Kade|Cade|tmp-token/);
  });

  it("✕: nothing comes back but the trace id; the seconds the socket was open still count", async () => {
    // Billed by the server's clock (see above): 3 s pass between "start" and "finish".
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T15:00:00Z"));
    const { session } = await started();
    vi.setSystemTime(new Date("2026-11-28T15:00:03Z"));
    const { status, body } = await read(await POST(request({ action: "finish", surface: "chat", session, outcome: "discard", text: "", seconds: 3 })));
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["traceId"]);
    expect(store.rows[0]).toMatchObject({ audioSeconds: 3 });
    expect(traces[0]).toMatchObject({ slots: { voice: { endpoint: "streaming", outcome: "discarded" } } });
  });

  it("✓ with nothing said: 'I did not hear anything'", async () => {
    const { session } = await started();
    const { status } = await read(await POST(request({ action: "finish", surface: "chat", session, outcome: "send", text: "  ", seconds: 2 })));
    expect(status).toBe(422);
  });

  it("only a session handle signed for this person is accepted", async () => {
    const { session } = await started();
    auth.identity = { ...ADA, subject: "user-bea", email: "ada@example.test" };
    const stolen = await POST(request({ action: "finish", surface: "chat", session, outcome: "send", text: "Kade Holloway", seconds: 2 }));
    expect(stolen.status).toBe(404);
    const forged = await POST(request({ action: "finish", surface: "chat", session: `${session.split(".")[0]}.forged-signature-xx`, outcome: "send", text: "x", seconds: 2 }));
    expect(forged.status).toBe(404);
  });

  it("a session longer than it can be is counted at the most it can be billed", async () => {
    // Changed on purpose: the cap is the session maximum by the server's clock (was the browser's count + 60 s).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T15:00:00Z"));
    const { session } = await started();
    vi.setSystemTime(new Date("2026-11-28T17:30:00Z"));
    await POST(request({ action: "finish", surface: "chat", session, outcome: "discard", text: "", seconds: 9_000 }));
    expect(store.rows[0]!.audioSeconds).toBe(SESSION_MAX_SECONDS);
  });

  /*
   * THE DAILY CAPS HOLD (audit, 28 Nov 2026; port of Leadership Hub 3630a6f): "finish" billed the seconds the browser
   * reported, so a client that said 0 after a full session used no voice time and the caps never filled.
   */
  it("a browser reporting 0 seconds after 45 s of dictation is billed 45 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-28T15:00:00Z"));
    const { session } = await started();
    vi.setSystemTime(new Date("2026-11-28T15:00:45Z"));
    await POST(request({ action: "finish", surface: "chat", session, outcome: "discard", text: "", seconds: 0 }));
    expect(store.rows[0]!.audioSeconds).toBe(45);
  });

  it("a handle whose start time was edited is refused", async () => {
    const { session } = await started();
    const [id, at, sig] = session.split(".");
    const moved = await POST(request({ action: "finish", surface: "chat", session: `${id}.${Number(at) + 30_000}.${sig}`, outcome: "discard", text: "", seconds: 0 }));
    expect(moved.status).toBe(404);
  });
});
