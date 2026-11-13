import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticatedIdentity } from "@/lib/auth/types";

/*
 * THE DM L10 TAB: WHO GETS IN, AND WHAT IS SENT TO THE LEADERSHIP HUB.
 *
 * Access is the Hub's decision (its database: the allowlist and the person's meeting role). What Ask Sunny must get
 * right, and what these tests pin:
 *   - only a VERIFIED Ask Sunny identity is ever sent (signed out, unverified, invited/disabled/revoked accounts and
 *     demo mode send nothing; the auth provider returns no verified identity for those, see supabase-provider.ts),
 *   - the email sent is the session's, signed with the shared secret, never one from the browser,
 *   - the Hub's refusal (404) is a "not found" page, and every failure hides the tab (fails closed).
 * People in these tests are invented.
 */

const page = vi.hoisted(() => ({
  enforced: true,
  identity: null as Partial<AuthenticatedIdentity> | null | Error,
}));

vi.mock("@/lib/auth/page", () => ({
  pageAuthorizationEnforced: () => page.enforced,
  pageIdentity: async () => {
    if (page.identity instanceof Error) throw page.identity;
    return page.identity;
  },
  requireAuthenticatedPage: async () => page.identity,
}));

const hub = vi.hoisted(() => ({
  calls: [] as { op: string; email: string; args: Record<string, unknown> }[],
  answer: (() => ({ status: 404, body: { error: "not_found" } })) as (op: string, args: Record<string, unknown>) => { status: number; body: Record<string, unknown> },
}));

vi.mock("./partner/client.server", async (orig) => {
  const real = await orig<typeof import("./partner/client.server")>();
  return {
    ...real,
    callHub: async (op: string, email: string, args: Record<string, unknown> = {}) => {
      hub.calls.push({ op, email, args });
      return hub.answer(op, args);
    },
  };
});

const SECRET = "s".repeat(40);
const STC = { key: "stc-dm", name: "STC DM L10", team: "STC District Managers", cadence: "Tuesdays · 90 min", description: "" };
const ROSTER = { members: [{ first: "Avery", name: "Avery Quill", role: "Visionary" }, { first: "Bo", name: "Bo Lark", role: "" }], leader: "Avery Quill" };

function signedIn(email = "avery.quill@example.test", verified = true) {
  page.identity = { subject: "u-1", email, displayName: "Avery Quill", role: "district_manager", verified };
}

beforeEach(async () => {
  vi.stubEnv("HUB_PARTNER_SECRET", SECRET);
  page.enforced = true;
  page.identity = null;
  hub.calls = [];
  hub.answer = () => ({ status: 404, body: { error: "not_found" } });
  (await import("./data.server")).resetL10TabCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("who the Hub is asked about", () => {
  it("a verified person: their session email, and nothing from anywhere else", async () => {
    signedIn();
    hub.answer = () => ({ status: 200, body: { user_id: "h1", name: "Avery Quill", meetings: [STC] } });
    const { listMyMeetings } = await import("./data.server");
    expect(await listMyMeetings()).toEqual([STC]);
    expect(hub.calls).toEqual([{ op: "whoami", email: "avery.quill@example.test", args: {} }]);
  });

  it.each([
    ["nobody signed in", () => (page.identity = null)],
    ["an unverified identity", () => signedIn("avery.quill@example.test", false)],
    ["demo mode (no verified identity at all)", () => ((page.enforced = false), signedIn())],
    ["a failed identity lookup", () => (page.identity = new Error("auth down"))],
    ["no partner secret configured", () => (vi.stubEnv("HUB_PARTNER_SECRET", ""), signedIn())],
    ["a partner secret that is too short", () => (vi.stubEnv("HUB_PARTNER_SECRET", "short"), signedIn())],
  ])("%s: the Hub is never called, no tab, no meeting", async (_label, arrange) => {
    arrange();
    hub.answer = () => ({ status: 200, body: { user_id: "h1", name: "x", meetings: [STC] } });
    const data = await import("./data.server");
    expect(await data.l10TabsForLayout()).toEqual([]);
    expect(await data.listMyMeetings()).toEqual([]);
    const opened = await data.openMeeting("stc-dm");
    expect(opened.ok).toBe(false);
    expect((await data.saveMeeting("stc-dm", 0, {})).ok).toBe(false);
    expect(await data.unreadCount()).toBeNull();
    expect(hub.calls).toEqual([]);
  });
});

describe("the DM L10 tab", () => {
  it("shows for a person the Hub lists, labelled DM L10, linking to the meeting", async () => {
    signedIn();
    hub.answer = () => ({ status: 200, body: { user_id: "h1", name: "Avery Quill", meetings: [STC] } });
    const { l10TabsForLayout } = await import("./data.server");
    expect(await l10TabsForLayout()).toEqual([{ key: "stc-dm", href: "/meetings/stc-dm", label: "DM L10" }]);
  });

  it("does not show for a person the Hub does not list (not an attendee, or no Hub account)", async () => {
    signedIn("not.attending@example.test");
    hub.answer = () => ({ status: 200, body: { user_id: null, name: null, meetings: [] } });
    const { l10TabsForLayout } = await import("./data.server");
    expect(await l10TabsForLayout()).toEqual([]);
  });

  it("never shows a meeting key Ask Sunny does not know, whatever the Hub returns", async () => {
    signedIn();
    hub.answer = () => ({ status: 200, body: { meetings: [{ ...STC, key: "<script>" }] } });
    const { l10TabsForLayout } = await import("./data.server");
    expect(await l10TabsForLayout()).toEqual([]);
  });

  it("fails closed when the Hub is down", async () => {
    signedIn();
    hub.answer = () => ({ status: 0, body: { error: "unavailable" } });
    const { l10TabsForLayout } = await import("./data.server");
    expect(await l10TabsForLayout()).toEqual([]);
  });

  it("asks the Hub at most once per person every five minutes (the layout renders on every navigation)", async () => {
    signedIn();
    hub.answer = () => ({ status: 200, body: { meetings: [STC] } });
    const { l10TabsForLayout } = await import("./data.server");
    const t0 = Date.parse("2026-11-13T18:00:00Z");
    await l10TabsForLayout(t0);
    await l10TabsForLayout(t0 + 60_000);
    expect(hub.calls).toHaveLength(1);
    await l10TabsForLayout(t0 + 5 * 60_000 + 1);
    expect(hub.calls).toHaveLength(2);
  });
});

describe("opening the meeting", () => {
  it("a refused meeting (Leadership L10, or a person who is not an attendee) is 'forbidden', which the page turns into not found", async () => {
    signedIn();
    const { openMeeting } = await import("./data.server");
    expect(await openMeeting("leadership")).toEqual({ ok: false, reason: "forbidden" });
    expect(await openMeeting("stc-dm")).toEqual({ ok: false, reason: "forbidden" });
    expect(hub.calls.map((c) => [c.op, c.args.key])).toEqual([["meeting", "leadership"], ["meeting", "stc-dm"]]);
  });

  it("an unknown key never reaches the Hub", async () => {
    signedIn();
    const { openMeeting } = await import("./data.server");
    expect(await openMeeting("../salon")).toEqual({ ok: false, reason: "forbidden" });
    expect(hub.calls).toEqual([]);
  });

  it("an attendee gets the Hub's record, people and roster, acting as their Hub account", async () => {
    signedIn();
    hub.answer = () => ({
      status: 200,
      body: { info: STC, viewer: { id: "hub-user-1", name: "Avery Quill" }, loaded: { version: 4, updatedAt: "t", doc: { rocks: [] } }, people: [{ id: "hub-user-1", name: "Avery Quill" }], roster: ROSTER },
    });
    const { openMeeting } = await import("./data.server");
    const opened = await openMeeting("stc-dm");
    expect(opened).toEqual({
      ok: true,
      meeting: { info: STC, viewer: { id: "hub-user-1", label: "avery.quill@example.test", name: "Avery" }, loaded: { version: 4, updatedAt: "t", doc: { rocks: [] } }, people: [{ id: "hub-user-1", name: "Avery Quill" }], roster: ROSTER },
    });
  });
});

describe("the Hub's agenda and section hints reach the page (the STC DM L10 change, 13 Nov 2026)", () => {
  it("are passed through with the roster; a roster without them is unchanged", async () => {
    signedIn();
    const agenda = [{ key: "business-best", title: "Segue · AI Best Practice", minutes: 5 }, { key: "ids", title: "IDS · Issues", minutes: 65 }];
    const hints = { "business-best": "Round-robin: each person shares one AI best practice, then you check them off." };
    hub.answer = () => ({
      status: 200,
      body: { info: STC, viewer: { id: "hub-user-1", name: "Avery Quill" }, loaded: { version: 1, updatedAt: "t", doc: {} }, people: [], roster: { ...ROSTER, agenda, hints } },
    });
    const { openMeeting } = await import("./data.server");
    const opened = await openMeeting("stc-dm");
    expect(opened.ok && opened.meeting.roster).toEqual({ ...ROSTER, agenda, hints });
  });
});

describe("saving, ending and the bell go to the same Hub record", () => {
  beforeEach(() => signedIn());

  it("a save carries the version it was based on; a stale save comes back with the latest for merging", async () => {
    hub.answer = (op, args) => (args.expectedVersion === 4 ? { status: 200, body: { ok: true, version: 5, updatedAt: "t5" } } : { status: 409, body: { ok: false, kind: "stale", latest: { version: 6, updatedAt: "t6", doc: {} } } });
    const { saveMeeting } = await import("./data.server");
    expect(await saveMeeting("stc-dm", 4, { todos: [] })).toEqual({ ok: true, version: 5, updatedAt: "t5" });
    expect(await saveMeeting("stc-dm", 3, { todos: [] })).toEqual({ ok: false, kind: "stale", latest: { version: 6, updatedAt: "t6", doc: {} } });
    expect(hub.calls[0]).toEqual({ op: "save", email: "avery.quill@example.test", args: { key: "stc-dm", expectedVersion: 4, doc: { todos: [] } } });
  });

  it("a refused save says so and is not shown as saved", async () => {
    const { saveMeeting } = await import("./data.server");
    expect(await saveMeeting("stc-dm", 1, {})).toMatchObject({ ok: false, kind: "forbidden" });
  });

  it("ending the meeting saves the recap in the Hub", async () => {
    hub.answer = () => ({ status: 200, body: { ok: true, created: true } });
    const { endMeeting } = await import("./data.server");
    const recap = { sessionId: "s1", cascade: "", ratingAvg: 9, durationSeconds: 60, attendees: [], openTodos: [], resolvedIssues: [] };
    expect(await endMeeting("stc-dm", recap)).toEqual({ ok: true, created: true });
    expect(hub.calls[0]).toMatchObject({ op: "end", args: { key: "stc-dm", recap } });
  });

  it("the bell reads and marks the person's own notes in the Hub (same read state as the Hub's bell)", async () => {
    hub.answer = (op) => (op === "notifications-count" ? { status: 200, body: { ok: true, count: 3 } } : { status: 200, body: { ok: true, notifications: [] } });
    const data = await import("./data.server");
    expect(await data.unreadCount()).toBe(3);
    expect(await data.markRead(["00000000-0000-4000-8000-000000000001"])).toBe(true);
    expect(await data.markAllRead()).toBe(true);
    expect(hub.calls.map((c) => c.op)).toEqual(["notifications-count", "notifications-mark-read", "notifications-mark-all-read"]);
    expect(new Set(hub.calls.map((c) => c.email))).toEqual(new Set(["avery.quill@example.test"]));
  });
});

describe("Server Functions check their inputs before anything reaches the Hub", () => {
  beforeEach(() => signedIn());

  it("refuses an unknown meeting, a bad version or a non-object document", async () => {
    const { saveMeetingAction, endMeetingAction, loadMeetingAction } = await import("./actions");
    expect(await saveMeetingAction("../x", 0, {})).toMatchObject({ ok: false, kind: "invalid" });
    expect(await saveMeetingAction("stc-dm", -1, {})).toMatchObject({ ok: false, kind: "invalid" });
    expect(await saveMeetingAction("stc-dm", 0, [] as unknown as Record<string, unknown>)).toMatchObject({ ok: false, kind: "invalid" });
    expect(await endMeetingAction("stc-dm", { sessionId: "", cascade: "", ratingAvg: null, durationSeconds: 0, attendees: [], openTodos: [], resolvedIssues: [] })).toMatchObject({ ok: false, kind: "invalid" });
    expect(await loadMeetingAction("nope")).toMatchObject({ ok: false });
    expect(hub.calls).toEqual([]);
  });

  it("the bell refuses ids that are not note ids", async () => {
    const { markReadAction } = await import("./notifications/actions");
    expect(await markReadAction(["drop table"])).toEqual({ ok: false });
    expect(await markReadAction([])).toEqual({ ok: false });
    expect(hub.calls).toEqual([]);
  });
});

describe("no people in this repository", () => {
  it("the copied meeting config carries no member list, full names, leaders or seat titles", async () => {
    const config = await import("./lib/config");
    for (const name of ["MEMBERS", "FULL_NAMES", "MEETING_LEADER", "KNOWN_ROLES"]) expect(config).not.toHaveProperty(name);
  });

  it("the Hub's meeting people come only from the Hub at request time (no hard-coded roster anywhere in features/l10)", () => {
    const root = join(process.cwd(), "src/features/l10");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") && /FULL_NAMES|MEMBERS\[|KNOWN_ROLES/.test(readFileSync(full, "utf8"))) offenders.push(relative(root, full));
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
