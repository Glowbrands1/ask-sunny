import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The DM L10 routes refuse everyone the Leadership Hub refuses, with the same "not found" as a missing page, and the
 * assistant spends nothing for them.
 */

const state = vi.hoisted(() => ({
  blocked: null as { content: string } | null,
  guardCalls: [] as unknown[],
  viewer: null as { email: string; displayName: string; userId: string; role: string } | null,
  opened: { ok: false, reason: "forbidden" } as unknown,
  hubConfig: { status: 404, body: { error: "not_found" } } as { status: number; body: Record<string, unknown> },
  hubCalls: [] as string[],
}));

vi.mock("@/lib/auth/page", () => ({ requireAuthenticatedPage: async () => ({ verified: true }), pageAuthorizationEnforced: () => true, pageIdentity: async () => null }));
vi.mock("./data.server", () => ({
  l10Viewer: async () => state.viewer,
  openMeeting: async () => state.opened,
  listMyMeetings: async () => [],
  listHistory: async () => ({ ok: false, reason: "forbidden" }),
  getVersionRange: async () => ({ ok: false, reason: "forbidden" }),
  getVersion: async () => ({ ok: false, reason: "forbidden" }),
  listRecaps: async () => ({ ok: false, reason: "forbidden" }),
}));
vi.mock("./partner/client.server", () => ({
  callHub: async (op: string) => {
    state.hubCalls.push(op);
    return state.hubConfig;
  },
}));
vi.mock("@/lib/ai/spend-guard", () => ({
  modelSpendGuard: async (input: unknown) => {
    state.guardCalls.push(input);
    return state.blocked;
  },
}));
vi.mock("next/font/google", () => ({ Public_Sans: () => ({ variable: "f1" }), JetBrains_Mono: () => ({ variable: "f2" }) }));

const isNotFound = (e: unknown) => e instanceof Error && /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/.test((e as { digest?: string }).digest ?? e.message);

beforeEach(() => {
  state.viewer = null;
  state.blocked = null;
  state.guardCalls = [];
  state.opened = { ok: false, reason: "forbidden" };
  state.hubConfig = { status: 404, body: { error: "not_found" } };
  state.hubCalls = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("pages: a meeting the Hub refuses is not found", () => {
  const params = (key: string) => Promise.resolve({ key });
  const search = Promise.resolve({});

  it.each(["stc-dm", "leadership", "bcs-dm", "nonsense"])("/meetings/%s for someone the Hub refuses", async (key) => {
    const { default: MeetingPage } = await import("@/app/(app)/meetings/[key]/page");
    await expect(MeetingPage({ params: params(key), searchParams: search })).rejects.toSatisfy(isNotFound);
  });

  it("the history, version and report pages too", async () => {
    const { default: History } = await import("@/app/(app)/meetings/[key]/history/page");
    const { default: Version } = await import("@/app/(app)/meetings/[key]/history/[version]/page");
    const { default: Report } = await import("@/app/(app)/meetings/[key]/report/page");
    await expect(History({ params: params("leadership"), searchParams: Promise.resolve({}) })).rejects.toSatisfy(isNotFound);
    await expect(Version({ params: Promise.resolve({ key: "leadership", version: "1" }) })).rejects.toSatisfy(isNotFound);
    await expect(Report({ params: params("leadership") })).rejects.toSatisfy(isNotFound);
  });

  it("/meetings has nothing to open for someone with no meeting", async () => {
    const { default: Index } = await import("@/app/(app)/meetings/page");
    await expect(Index()).rejects.toSatisfy(isNotFound);
  });
});

describe("the assistant", () => {
  const post = (body: unknown) => new Request("https://sunny.example.test/api/l10/assistant", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const message = { id: "m1", role: "user", parts: [{ type: "text", text: "Which rocks are off track?" }] };

  it("answers 404 to someone who is not signed in (verified), without calling the Hub or the model", async () => {
    const { POST } = await import("@/app/api/l10/assistant/route");
    const res = await POST(post({ key: "stc-dm", messages: [message] }));
    expect(res.status).toBe(404);
    expect(state.hubCalls).toEqual([]);
  });

  it("answers 404 when the Hub refuses this person this meeting (e.g. the Leadership L10)", async () => {
    state.viewer = { email: "avery.quill@example.test", displayName: "Avery Quill", userId: "sunny-user-1", role: "district_manager" };
    const { POST } = await import("@/app/api/l10/assistant/route");
    const res = await POST(post({ key: "leadership", messages: [message] }));
    expect(res.status).toBe(404);
    expect(state.hubCalls).toEqual(["assistant-config"]);
  });

  it("refuses a malformed conversation before calling the Hub", async () => {
    // Attachments are allowed since 13 Nov 2026 (the owner's decision); a bad one is refused with the Hub's 413 instead,
    // see assistant-attachments-web.test.ts.
    state.viewer = { email: "avery.quill@example.test", displayName: "Avery Quill", userId: "sunny-user-1", role: "district_manager" };
    const { POST } = await import("@/app/api/l10/assistant/route");
    expect((await POST(post({ key: "stc-dm", messages: [] }))).status).toBe(400);
    expect((await POST(post({ key: "stc-dm", messages: [{ ...message, role: "system" }] }))).status).toBe(400);
    expect((await POST(post({ key: "../x", messages: [message] }))).status).toBe(400);
    expect(state.hubCalls).toEqual([]);
  });

  it("without an Anthropic key it says so and spends nothing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const { POST, GET } = await import("@/app/api/l10/assistant/route");
    expect((await POST(post({ key: "stc-dm", messages: [message] }))).status).toBe(503);
    expect(await (await GET()).json()).toEqual({ configured: false });
  });
});

describe("the assistant and Ask Sunny's spend controls", () => {
  const post = (body: unknown) => new Request("https://sunny.example.test/api/l10/assistant", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  const message = { id: "m1", role: "user", parts: [{ type: "text", text: "Which rocks are off track?" }] };

  it("asks the same spend guard as chat, as this Ask Sunny user, and over the monthly budget answers with its reply and spends nothing", async () => {
    state.viewer = { email: "avery.quill@example.test", displayName: "Avery Quill", userId: "sunny-user-1", role: "district_manager" };
    state.blocked = { content: "Questions are paused for the month. Ask an admin." };
    const { POST } = await import("@/app/api/l10/assistant/route");
    const res = await POST(post({ key: "stc-dm", messages: [message] }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ message: "Questions are paused for the month. Ask an admin." });
    expect(state.guardCalls).toEqual([{ userId: "sunny-user-1", role: "district_manager" }]);
    // Refused before the Hub (or the model) is asked anything.
    expect(state.hubCalls).toEqual([]);
  });

  it("records each answer's usage where the monthly budget counts it (a chat_traces spend row, source l10_assistant)", async () => {
    const { recordAssistantSpend, spendFromUsage } = await import("./assistant/assistant.server");
    const usage = { inputTokens: 1500, outputTokens: 400, totalTokens: 1900, inputTokenDetails: { noCacheTokens: 300, cacheReadTokens: 1000, cacheWriteTokens: 200 }, outputTokenDetails: { textTokens: 400, reasoningTokens: 0 } };
    const call = spendFromUsage("claude-sonnet-5-5", usage as never);
    expect(call).toEqual({ model: "claude-sonnet-5-5", inputTokens: 300, outputTokens: 400, cacheReadTokens: 1000, cacheWriteTokens: 200 });
    const written: unknown[] = [];
    recordAssistantSpend("sunny-user-1", call, (async (row: unknown) => void written.push(row)) as never);
    expect(written).toEqual([{ source: "l10_assistant", userId: "sunny-user-1", calls: [call] }]);
    // Without the cache breakdown, the uncached input is what is left after cache reads and writes.
    expect(spendFromUsage("claude-opus-5-5", { inputTokens: 1000, outputTokens: 10, inputTokenDetails: {} } as never)).toEqual({ model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 });
    // Nothing used, nothing written.
    expect(spendFromUsage("claude-sonnet-5-5", undefined)).toBeNull();
  });

  it("the spend row is counted by the monthly budget like chat's (priced by model)", async () => {
    const { usageCostUsd } = await import("@/lib/ai/model-prices");
    expect(usageCostUsd({ model: "claude-sonnet-5-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(2);
    expect(usageCostUsd({ model: "claude-opus-5-5", inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeCloseTo(25);
  });

  it("the panel shows the budget reply in the route's own words", async () => {
    const { errorText } = await import("./assistant/AssistantPanel");
    expect(errorText('{"error":"budget","message":"Questions are paused for the month. Ask an admin."}')).toBe("Questions are paused for the month. Ask an admin.");
    expect(errorText(undefined)).toBe("The assistant could not answer just now. Please try again in a minute.");
  });
});

describe("the assistant's Hub config", () => {
  it("accepts only the Hub's answer for this person and Claude model ids", async () => {
    const { readConfig } = await import("./assistant/assistant.server");
    const good = { status: 200, body: { system: "S", model: "claude-sonnet-5-5", deepModel: "claude-opus-5-5", maxSteps: 8, maxOutputTokens: 16000, tools: { getMeeting: { description: "d", inputSchema: { type: "object" } }, getMeetingRecaps: { description: "d", inputSchema: { type: "object" } } } } };
    expect(readConfig(good)).toMatchObject({ model: "claude-sonnet-5-5", deepModel: "claude-opus-5-5", maxSteps: 8 });
    expect(readConfig({ ...good, status: 404 })).toBeNull();
    expect(readConfig({ status: 200, body: { ...good.body, model: "gpt-4" } })).toBeNull();
    // Limits are capped here whatever the Hub says.
    expect(readConfig({ status: 200, body: { ...good.body, maxSteps: 500, maxOutputTokens: 10_000_000 } })).toMatchObject({ maxSteps: 12, maxOutputTokens: 16_000 });
  });

  it("tool results come from the Hub for this person and meeting", async () => {
    const { hubTools, readConfig } = await import("./assistant/assistant.server");
    const config = readConfig({ status: 200, body: { system: "S", model: "claude-sonnet-5-5", deepModel: "claude-opus-5-5", tools: { getMeeting: { description: "d", inputSchema: { type: "object", properties: { part: { type: "string" } } } }, getMeetingRecaps: { description: "d", inputSchema: { type: "object" } } } } })!;
    const calls: unknown[] = [];
    const tools = hubTools(config, "avery.quill@example.test", "stc-dm", (async (op: string, email: string, args: Record<string, unknown>) => {
      calls.push([op, email, args]);
      return { status: 200, body: { ok: true, result: { source: "STC DM L10", href: "/meetings/stc-dm", data: { rocks: [] } } } };
    }) as never);
    const execute = tools.getMeeting.execute as (input: unknown, options: unknown) => Promise<unknown>;
    expect(await execute({ part: "rocks" }, { toolCallId: "t", messages: [] })).toEqual({ source: "STC DM L10", href: "/meetings/stc-dm", data: { rocks: [] } });
    expect(calls).toEqual([["assistant-tool", "avery.quill@example.test", { key: "stc-dm", tool: "getMeeting", input: { part: "rocks" } }]]);
  });

  it("offers draftNote only when the Hub's config does (a Hub without it keeps the two meeting tools)", async () => {
    const { hubTools, readConfig } = await import("./assistant/assistant.server");
    const two = { getMeeting: { description: "d", inputSchema: { type: "object" } }, getMeetingRecaps: { description: "d", inputSchema: { type: "object" } } };
    const base = { system: "S", model: "claude-sonnet-5-5", deepModel: "claude-opus-5-5" };
    expect(Object.keys(hubTools(readConfig({ status: 200, body: { ...base, tools: two } })!, "a@example.test", "stc-dm"))).toEqual(["getMeeting", "getMeetingRecaps"]);
    const three = { ...two, draftNote: { description: "Prepare a hub notification", inputSchema: { type: "object" } } };
    const calls: unknown[] = [];
    const tools = hubTools(readConfig({ status: 200, body: { ...base, tools: three } })!, "a@example.test", "stc-dm", (async (op: string, email: string, args: Record<string, unknown>) => {
      calls.push([op, email, args]);
      return { status: 200, body: { ok: true, result: { status: "draft_not_sent" } } };
    }) as never);
    expect(Object.keys(tools)).toEqual(["getMeeting", "getMeetingRecaps", "draftNote"]);
    // Drafting is the Hub's tool, run by the Hub for this person; nothing is sent from here.
    await (tools.draftNote.execute as (i: unknown, o: unknown) => Promise<unknown>)({ to: ["Bo"], message: "hi" }, { toolCallId: "t", messages: [] });
    expect(calls).toEqual([["assistant-tool", "a@example.test", { key: "stc-dm", tool: "draftNote", input: { to: ["Bo"], message: "hi" } }]]);
  });

  it("rate-limits per person like the Hub (20 messages per 10 minutes)", async () => {
    const { assistantRateLimit } = await import("./assistant/assistant.server");
    const t = Date.parse("2026-11-13T18:00:00Z");
    for (let i = 0; i < 20; i++) expect(assistantRateLimit("rl@example.test", t + i).ok).toBe(true);
    expect(assistantRateLimit("rl@example.test", t + 21).ok).toBe(false);
    expect(assistantRateLimit("other@example.test", t + 21).ok).toBe(true);
    expect(assistantRateLimit("rl@example.test", t + 10 * 60_000 + 1).ok).toBe(true);
  });
});
