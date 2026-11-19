import { describe, expect, it, vi } from "vitest";

import { receiveSync, type ReceiveDeps } from "./sync-receive";

/**
 * RECEIVING A CHANGE PUBLISHED FROM THE OTHER APP.
 * The database writer is a fake; every refusal happens before it is called.
 */

const KEY = "s".repeat(40);
const T = "11111111-1111-4111-8111-111111111111";
const M = "33333333-3333-4333-8333-333333333333";
const L = "22222222-2222-4222-8222-222222222222";

const body = {
  actorEmail: "Ana.Editor@example.com",
  tracks: [{ id: T, slug: "claude", title: "Claude Training", sort_order: 1 }],
  modules: [{ id: M, track_id: T, slug: "module-6-agents", title: "Module 6: Agents", sort_order: 6, admin_only: false }],
  lessons: [
    {
      id: L, track_id: T, module_id: M, slug: "build-an-agent", title: "Build an agent", summary: null,
      body_md: "Hello", week_number: null, sort_order: 60, status: "published", published_at: "2026-11-19T00:00:00Z",
    },
  ],
  content_pages: [{ key: "announcement", title: "Announcement", body_md: "New module!" }],
};

function request(payload: unknown, key: string | null = KEY) {
  const headers = new Headers({ "content-type": "application/json" });
  if (key !== null) headers.set("authorization", `Bearer ${key}`);
  return { headers, text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)) };
}

function deps(overrides: Partial<ReceiveDeps> = {}) {
  const importRows = vi.fn(async (_table: string, rows: unknown[]) => rows.length);
  return {
    importRows,
    deps: {
      config: { url: "https://other.example.com", key: KEY, otherAppName: "Ask Sunny" },
      editors: ["ana.editor@example.com"],
      importRows,
      ...overrides,
    } as ReceiveDeps,
  };
}

describe("receiveSync", () => {
  it("is not there at all when sync is not set up", async () => {
    const { deps: d, importRows } = deps({ config: null });
    expect(await receiveSync(request(body), d)).toEqual({ status: 404, body: { error: "not found" } });
    expect(importRows).not.toHaveBeenCalled();
  });

  it.each([
    ["no key", null],
    ["a wrong key", "x".repeat(40)],
    ["a key of the wrong length", "short"],
  ])("refuses %s", async (_label, key) => {
    const { deps: d, importRows } = deps();
    expect(await receiveSync(request(body, key), d)).toEqual({ status: 401, body: { error: "the sync key was not accepted" } });
    expect(importRows).not.toHaveBeenCalled();
  });

  it("refuses someone who is not an editor in this app", async () => {
    const { deps: d, importRows } = deps({ editors: ["someone.else@example.com"] });
    expect(await receiveSync(request(body), d)).toEqual({ status: 403, body: { error: "you are not an AI Training editor in this app" } });
    expect(importRows).not.toHaveBeenCalled();
  });

  it("refuses an editor list that is empty (fails closed)", async () => {
    const { deps: d } = deps({ editors: [] });
    expect((await receiveSync(request(body), d)).status).toBe(403);
  });

  it("refuses a body that is not valid JSON", async () => {
    const { deps: d } = deps();
    expect(await receiveSync(request("{nope"), d)).toEqual({ status: 400, body: { error: "the change could not be read" } });
  });

  it("refuses rows the importer would refuse, and says why", async () => {
    const { deps: d, importRows } = deps();
    const bad = { ...body, lessons: [{ ...body.lessons[0], id: "not-a-uuid" }] };
    const result = await receiveSync(request(bad), d);
    expect(result.status).toBe(400);
    expect("error" in result.body && result.body.error.length).toBeGreaterThan(0);
    expect(importRows).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 MB", async () => {
    const { deps: d } = deps();
    const huge = { ...body, content_pages: [{ key: "policy", title: "Policy", body_md: "x".repeat(1_100_000) }] };
    expect((await receiveSync(request(huge), d)).status).toBe(413);
  });

  it("saves parents before children: tracks, modules, lessons, then pages", async () => {
    const { deps: d, importRows } = deps();
    const result = await receiveSync(request(body), d);
    expect(result).toEqual({ status: 200, body: { ok: true, counts: { tracks: 1, modules: 1, lessons: 1, pages: 1 } } });
    expect(importRows.mock.calls.map((c) => c[0])).toEqual(["tracks", "modules", "lessons", "pages"]);
  });

  it("explains a lesson whose web address is already taken in that track", async () => {
    const importRows = vi.fn(async (table: string) => {
      if (table === "lessons") throw new Error("AI Training: could not import the lessons (duplicate key value violates unique constraint).");
      return 1;
    });
    const { deps: d } = deps({ importRows });
    expect(await receiveSync(request(body), d)).toEqual({
      status: 409,
      body: { error: "another lesson in this track already uses that web address" },
    });
  });

  it("explains a module whose name is already taken in that track", async () => {
    const importRows = vi.fn(async (table: string) => {
      if (table === "modules") throw new Error("AI Training: could not import the modules (duplicate key value violates unique constraint).");
      return 1;
    });
    const { deps: d } = deps({ importRows });
    expect(await receiveSync(request(body), d)).toEqual({ status: 409, body: { error: "a module with that name already exists" } });
  });

  it("hides other database errors behind a plain message", async () => {
    const importRows = vi.fn(async () => {
      throw new Error("AI Training: could not import the tracks (connection reset).");
    });
    const { deps: d } = deps({ importRows });
    expect(await receiveSync(request(body), d)).toEqual({ status: 500, body: { error: "the change could not be saved there" } });
  });
});
