import { afterEach, describe, expect, it, vi } from "vitest";

import { parseImportFiles } from "./import";
import { publishAfterSave, pushToOtherApp, syncConfig, type SyncBundle } from "./sync";

/**
 * PUBLISHING A SAVED CHANGE TO THE OTHER APP — the sending side.
 * Nothing here talks to a real app: `fetch` is a fake.
 */

const KEY = "k".repeat(32);
const cfg = { url: "https://other.example.com", key: KEY, otherAppName: "Ask Bubbles" };

const T = "11111111-1111-4111-8111-111111111111";
const L = "22222222-2222-4222-8222-222222222222";

const bundle: SyncBundle = {
  actorEmail: "ana.editor@example.com",
  tracks: [{ id: T, slug: "claude", title: "Claude Training", sort_order: 1 }],
  modules: [],
  lessons: [
    {
      id: L, track_id: T, module_id: null, slug: "lesson-1", title: "Lesson 1", summary: null,
      body_md: "Hello", week_number: null, sort_order: 1, status: "draft", published_at: null,
    },
  ],
  content_pages: [],
};

afterEach(() => vi.useRealTimers());

describe("syncConfig", () => {
  it("is off unless both the address and a long enough key are set", () => {
    expect(syncConfig({})).toBeNull();
    expect(syncConfig({ AI_TRAINING_SYNC_URL: "https://other.example.com" })).toBeNull();
    expect(syncConfig({ AI_TRAINING_SYNC_URL: "https://other.example.com", AI_TRAINING_SYNC_KEY: "short" })).toBeNull();
    expect(
      syncConfig({ AI_TRAINING_SYNC_URL: "https://other.example.com/", AI_TRAINING_SYNC_KEY: KEY, AI_TRAINING_SYNC_APP_NAME: "Ask Bubbles" }),
    ).toEqual(cfg);
  });

  it("refuses an address that is not secure, except on this computer for testing", () => {
    expect(syncConfig({ AI_TRAINING_SYNC_URL: "http://other.example.com", AI_TRAINING_SYNC_KEY: KEY })).toBeNull();
    expect(syncConfig({ AI_TRAINING_SYNC_URL: "http://localhost:3001", AI_TRAINING_SYNC_KEY: KEY })?.url).toBe("http://localhost:3001");
    expect(syncConfig({ AI_TRAINING_SYNC_URL: "http://127.0.0.1:3001", AI_TRAINING_SYNC_KEY: KEY })?.url).toBe("http://127.0.0.1:3001");
  });

  it("names the other app generically when no name is set", () => {
    expect(syncConfig({ AI_TRAINING_SYNC_URL: "https://other.example.com", AI_TRAINING_SYNC_KEY: KEY })?.otherAppName).toBe("the other app");
  });
});

describe("pushToOtherApp", () => {
  it("posts the bundle to the other app's sync address with the shared key", async () => {
    const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    expect(await pushToOtherApp(bundle, cfg, fetchImpl)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://other.example.com/api/ai-training/sync");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(init.body))).toEqual(bundle);
  });

  it("passes on the other app's own reason when it refuses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: "another lesson in this track already uses that web address" }), { status: 409 }));
    expect(await pushToOtherApp(bundle, cfg, fetchImpl)).toEqual({ ok: false, reason: "another lesson in this track already uses that web address" });
  });

  it("falls back to the HTTP status when the refusal has no reason", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 502 }));
    expect(await pushToOtherApp(bundle, cfg, fetchImpl)).toEqual({ ok: false, reason: "HTTP 502" });
  });

  it("says the other app could not be reached when the network fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await pushToOtherApp(bundle, cfg, fetchImpl)).toEqual({ ok: false, reason: "it could not be reached" });
  });

  it("gives up after 10 seconds instead of holding the editor's save", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
        }),
    );
    const pending = pushToOtherApp(bundle, cfg, fetchImpl);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toEqual({ ok: false, reason: "it could not be reached" });
  });
});

describe("the bundle's shape", () => {
  it("is exactly what the importer reads, including a lesson in no module", () => {
    const parsed = parseImportFiles([{ name: "sync.json", text: JSON.stringify(bundle) }]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed.modules).toHaveLength(0);
    expect(parsed.lessons[0]).toMatchObject({ id: L, module_id: null, status: "draft" });
  });
});

describe("publishAfterSave — runs after the editor's own save has succeeded", () => {
  const rows = { tracks: bundle.tracks, modules: [], lessons: bundle.lessons, content_pages: [] };
  const load = vi.fn(async () => rows);

  it("does nothing when the box was not ticked", async () => {
    const push = vi.fn();
    expect(await publishAfterSave({ publish: false, cfg, actorEmail: "a@example.com", load, push })).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("does nothing when sync is not set up in this app", async () => {
    const push = vi.fn();
    expect(await publishAfterSave({ publish: true, cfg: null, actorEmail: "a@example.com", load, push })).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });

  it("sends the saved rows with the editor's email and reports nothing when it worked", async () => {
    const push = vi.fn(async () => ({ ok: true as const }));
    expect(await publishAfterSave({ publish: true, cfg, actorEmail: "ana.editor@example.com", load, push })).toBeUndefined();
    expect(push).toHaveBeenCalledWith({ actorEmail: "ana.editor@example.com", ...rows }, cfg);
  });

  it("turns a failure into a warning, never an error, so the local save still counts", async () => {
    const push = vi.fn(async () => ({ ok: false as const, reason: "it could not be reached" }));
    expect(await publishAfterSave({ publish: true, cfg, actorEmail: "a@example.com", load, push })).toBe(
      "Saved here, but not published to Ask Bubbles: it could not be reached",
    );
  });

  it("warns, rather than throws, when the saved rows cannot be read back", async () => {
    const push = vi.fn();
    const broken = vi.fn(async () => {
      throw new Error("db down");
    });
    expect(await publishAfterSave({ publish: true, cfg, actorEmail: "a@example.com", load: broken, push })).toBe(
      "Saved here, but not published to Ask Bubbles: the saved change could not be read back",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
