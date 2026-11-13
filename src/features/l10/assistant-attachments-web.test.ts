import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * THE DM L10 ASSISTANT IS THE HUB'S (the owner's decision, 13 Nov 2026): the same models, steps, output cap, Deep think,
 * web search / fetch and attachments as the Hub's own assistant, all from the Hub's assistant-config. The model is
 * never called before Ask Sunny's spend guard; web searches are recorded with the spend row. Invented people only.
 */
const state = vi.hoisted(() => ({
  blocked: null as { content: string } | null,
  order: [] as string[],
  hubConfig: null as Record<string, unknown> | null,
  streamCalls: [] as Record<string, unknown>[],
  persisted: [] as unknown[],
}));

vi.mock("@/features/l10/data.server", () => ({
  l10Viewer: async () => ({ email: "avery.quill@example.test", displayName: "Avery Quill", userId: "sunny-user-1", role: "district_manager" }),
}));
vi.mock("@/features/l10/partner/client.server", () => ({
  callHub: async (op: string) => {
    state.order.push(`hub:${op}`);
    return state.hubConfig ? { status: 200, body: state.hubConfig } : { status: 404, body: { error: "not_found" } };
  },
}));
vi.mock("@/lib/ai/spend-guard", () => ({
  modelSpendGuard: async () => {
    state.order.push("guard");
    return state.blocked;
  },
}));
vi.mock("@/lib/ai/chat-trace", () => ({ persistSpendRow: async (row: unknown) => void state.persisted.push(row) }));
vi.mock("ai", async (orig) => {
  const real = await orig<typeof import("ai")>();
  return {
    ...real,
    streamText: (args: Record<string, unknown>) => {
      state.order.push("model");
      state.streamCalls.push(args);
      return { toUIMessageStreamResponse: (opts: unknown) => Response.json({ ok: true, opts: JSON.parse(JSON.stringify(opts ?? {})) }) };
    },
  };
});

/** What the Hub's partner assistant-config sends (leadership-hub src/lib/partner/ops.ts, the Hub route's constants). */
const HUB = {
  system: "You are the Leadership Hub Assistant…",
  model: "claude-sonnet-5-5",
  deepModel: "claude-opus-5-5",
  maxSteps: 8,
  maxOutputTokens: 16_000,
  thinking: { type: "adaptive", display: "summarized" },
  effort: { fast: "medium", deep: "high" },
  webTools: { webSearch: { maxUses: 5 }, webFetch: { maxUses: 3, citations: { enabled: true } } },
  attachments: { maxFiles: 5, maxBytes: 10 * 1024 * 1024 },
  tools: { getMeeting: { description: "d", inputSchema: { type: "object" } }, getMeetingRecaps: { description: "d", inputSchema: { type: "object" } } },
};

const post = (body: unknown) => new Request("https://sunny.example.test/api/l10/assistant", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const pdf = { type: "file", mediaType: "application/pdf", filename: "Plan.pdf", url: `data:application/pdf;base64,${Buffer.from("%PDF-1.7 test").toString("base64")}` };
const png = { type: "file", mediaType: "image/jpeg", filename: "board.jpg", url: `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}` };
const ask = (parts: unknown[]) => ({ key: "stc-dm", messages: [{ id: "m1", role: "user", parts }] });

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  state.blocked = null;
  state.order = [];
  state.hubConfig = HUB;
  state.streamCalls = [];
  state.persisted = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("the same assistant as the Hub's", () => {
  it("takes the models, step cap, output cap, thinking and Deep think effort from the Hub's config, with no Sunny overrides", async () => {
    const { POST } = await import("@/app/api/l10/assistant/route");
    await POST(post(ask([{ type: "text", text: "Which rocks are off track?" }])));
    await POST(post({ ...ask([{ type: "text", text: "Think hard" }]), deep: true }));
    const [fast, deep] = state.streamCalls as { model: { modelId: string }; maxOutputTokens: number; providerOptions: { anthropic: unknown }; stopWhen: unknown }[];
    expect(fast.model.modelId).toBe("claude-sonnet-5-5");
    expect(deep.model.modelId).toBe("claude-opus-5-5");
    expect(fast.maxOutputTokens).toBe(16_000);
    expect(fast.providerOptions.anthropic).toEqual({ thinking: { type: "adaptive", display: "summarized" }, effort: "medium" });
    expect(deep.providerOptions.anthropic).toEqual({ thinking: { type: "adaptive", display: "summarized" }, effort: "high" });
    // A Hub that changed its settings is followed (the values come from the Hub, not from here).
    state.hubConfig = { ...HUB, model: "claude-haiku-5-5", maxOutputTokens: 8000, effort: { fast: "low", deep: "medium" } };
    await POST(post(ask([{ type: "text", text: "Hi" }])));
    const changed = state.streamCalls[2] as { model: { modelId: string }; maxOutputTokens: number; providerOptions: { anthropic: { effort: string } } };
    expect([changed.model.modelId, changed.maxOutputTokens, changed.providerOptions.anthropic.effort]).toEqual(["claude-haiku-5-5", 8000, "low"]);
    const { readConfig } = await import("./assistant/assistant.server");
    expect(readConfig({ status: 200, body: HUB })).toMatchObject({ maxSteps: 8, maxOutputTokens: 16_000 });
  });

  it("runs Anthropic's web search (5 uses) and web fetch (3 uses, citations on) with the Hub's tools, and sends sources", async () => {
    const { POST } = await import("@/app/api/l10/assistant/route");
    const res = await POST(post(ask([{ type: "text", text: "What changed in salon labour law this year?" }])));
    const tools = state.streamCalls[0].tools as Record<string, { id?: string; args?: Record<string, unknown> }>;
    expect(Object.keys(tools)).toEqual(["web_search", "web_fetch", "getMeeting", "getMeetingRecaps"]);
    // 20260209: the newest version in the newest @ai-sdk/anthropic for AI SDK 6 (the Hub runs 20260318; see PARITY.md).
    expect(tools.web_search).toMatchObject({ id: "anthropic.web_search_20260209", args: { maxUses: 5 } });
    expect(tools.web_fetch).toMatchObject({ id: "anthropic.web_fetch_20260209", args: { maxUses: 3, citations: { enabled: true } } });
    expect(((await res.json()) as { opts: { sendSources?: boolean } }).opts.sendSources).toBe(true);
    // The Hub's system prompt, with its cache breakpoint.
    expect(state.streamCalls[0].system).toEqual({ role: "system", content: HUB.system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } });
  });

  it("a Hub that offers no web tools gets none", async () => {
    state.hubConfig = { ...HUB, webTools: undefined };
    const { POST } = await import("@/app/api/l10/assistant/route");
    await POST(post(ask([{ type: "text", text: "Hi" }])));
    expect(Object.keys(state.streamCalls[0].tools as object)).toEqual(["getMeeting", "getMeetingRecaps"]);
  });
});

describe("cost: Ask Sunny's spend guard comes first, and web searches are recorded", () => {
  it("over the budget, nothing reaches the Hub or the model", async () => {
    state.blocked = { content: "Questions are paused for the month. Ask an admin." };
    const { POST } = await import("@/app/api/l10/assistant/route");
    const res = await POST(post(ask([{ type: "text", text: "Search the web" }, pdf])));
    expect(res.status).toBe(429);
    expect(state.order).toEqual(["guard"]);
    expect(state.streamCalls).toEqual([]);
  });

  it("the guard runs before the model on every answer", async () => {
    const { POST } = await import("@/app/api/l10/assistant/route");
    await POST(post(ask([{ type: "text", text: "One" }])));
    await POST(post(ask([{ type: "text", text: "Two" }])));
    expect(state.order).toEqual(["guard", "hub:assistant-config", "model", "guard", "hub:assistant-config", "model"]);
  });

  it("counts the answer's web searches from Anthropic's usage and writes them with its spend row", async () => {
    const { POST } = await import("@/app/api/l10/assistant/route");
    await POST(post(ask([{ type: "text", text: "Search" }])));
    const onFinish = state.streamCalls[0].onFinish as (e: unknown) => void;
    const usage = (search: number) => ({ inputTokens: 900, outputTokens: 100, inputTokenDetails: { noCacheTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 }, raw: { server_tool_use: { web_search_requests: search, web_fetch_requests: 1 } } });
    onFinish({ totalUsage: { inputTokens: 1800, outputTokens: 200, inputTokenDetails: { noCacheTokens: 1800, cacheReadTokens: 0, cacheWriteTokens: 0 } }, steps: [{ usage: usage(2) }, { usage: usage(1) }] });
    expect(state.persisted).toEqual([
      { source: "l10_assistant", userId: "sunny-user-1", calls: [{ model: "claude-sonnet-5-5", inputTokens: 1800, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 3 }] },
    ]);
  });
});

describe("attachments: the Hub's limits, refused with the Hub's words (413)", () => {
  it.each([
    ["a type the Hub does not take", [{ ...pdf, mediaType: "application/zip" }], "Only images and PDFs can be attached."],
    ["over 10 MB", [{ ...pdf, url: `data:application/pdf;base64,${"A".repeat(Math.ceil((10 * 1024 * 1024 * 1.05 * 4) / 3))}` }], "Each file must be 10 MB or smaller."],
    ["six files", Array.from({ length: 6 }, () => pdf), "Attach at most 5 files per message."],
    ["a remote address", [{ ...pdf, url: "https://elsewhere.example.test/plan.pdf" }], "Attachments must be uploaded from your device."],
  ])("refuses %s before the model", async (_label, files, message) => {
    const { POST } = await import("@/app/api/l10/assistant/route");
    const res = await POST(post(ask([{ type: "text", text: "Read this" }, ...files])));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "attachment", message });
    expect(state.streamCalls).toEqual([]);
  });

  it("a PDF and an image reach the model as file parts, so it reads them", async () => {
    const { POST } = await import("@/app/api/l10/assistant/route");
    expect((await POST(post(ask([{ type: "text", text: "Summarize the plan and the board photo" }, pdf, png])))).status).toBe(200);
    const [msg] = state.streamCalls[0].messages as { role: string; content: { type: string; mediaType?: string; filename?: string; text?: string }[] }[];
    expect(msg.role).toBe("user");
    expect(msg.content.map((c) => [c.type, c.mediaType ?? c.text, c.filename ?? null])).toEqual([
      ["text", "Summarize the plan and the board photo", null],
      ["file", "application/pdf", "Plan.pdf"],
      ["file", "image/jpeg", "board.jpg"],
    ]);
  });
});
