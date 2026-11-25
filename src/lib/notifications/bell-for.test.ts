import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * Owner, 24 Nov 2026, looking at Form Monitoring where her own form reads "Sent back by HR for changes" and the rail
 * has no Notifications bar at all:
 *
 *   "i need a bell for all users/managers for when HR send back their forms"
 *
 * The bell rang the creator and the sender when HR sent a form back, but the layout only SHOWED the bar to someone who
 * already had a notification, or was an HR approver or on the AI Training list. A manager who had never been rung, or
 * who pressed Clear all (which empties the list), had no bar, so nothing told them. Now every signed-in person has it;
 * an empty one says "Nothing yet" (the panel's empty text). Invented accounts only.
 */

const store = { app_notifications: [] as Record<string, unknown>[], form_instances: [] as Record<string, unknown>[] } as unknown as FakeStore &
  Record<string, Record<string, unknown>[]>;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));

const { bellFor } = await import("./bell-for");
const { dismissNotifications } = await import("./repository");

const MANAGER = "marigold@example.com";
const manager = { email: "Marigold@Example.com" };
const sentBack = {
  id: "00000000-0000-4000-8000-000000000001",
  recipient_email: MANAGER,
  kind: "form_hr_approval_decision",
  title: "HR sent your form back for changes",
  body: "Corrective Action Form for Juniper Ashdown at KC Wornall.",
  href: "/forms/hr-approval/11111111-2222-4333-8444-555555555555",
  created_at: "2026-11-24T08:00:00Z",
  read_at: null,
};

beforeEach(() => {
  store.app_notifications.splice(0, store.app_notifications.length);
  store.form_instances.splice(0, store.form_instances.length);
});

describe("\"i need a bell for all users/managers for when HR send back their forms\"", () => {
  it("a manager HR sent a form back to has the bell, with the unread item", async () => {
    store.app_notifications.push(sentBack);
    const bell = await bellFor(manager);
    expect(bell?.items.map((item) => [item.title, item.readAt])).toEqual([["HR sent your form back for changes", null]]);
  });

  it("\"and also when HR approved it, need notification\": the approval is in the same bell", async () => {
    store.app_notifications.push({ ...sentBack, title: "HR approved your form", created_at: "2026-11-24T09:00:00Z" });
    expect((await bellFor(manager))?.items.map((item) => item.title)).toEqual(["HR approved your form"]);
  });

  it("a manager nothing has been sent to yet still has the bell, so it is there when HR sends a form back", async () => {
    const bell = await bellFor(manager);
    expect(bell, "no bell for a manager with no notifications yet").not.toBeNull();
    expect(bell?.items).toEqual([]);
  });

  it("a manager who pressed Clear all still has the bell", async () => {
    store.app_notifications.push(sentBack);
    await dismissNotifications(MANAGER, null);
    expect((await bellFor(manager))?.items).toEqual([]);
  });

  it("is the same for every role: an HR approver, a director and a preview account", async () => {
    expect(await bellFor({ email: "hr@example.com" })).not.toBeNull();
    expect(await bellFor({ email: "dm@example.com" })).not.toBeNull();
    expect(await bellFor({ email: "preview@example.com" })).not.toBeNull();
  });

  it("an HR approver's bar still carries the forms waiting for them (#1313's badge kept)", async () => {
    expect(await bellFor({ email: "hr@example.com" }, async () => 2)).toEqual({ items: [], unread: 0, waitingHr: 2 });
    expect(await bellFor({ email: "dm@example.com" }, async () => null)).not.toHaveProperty("waitingHr");
  });

  it("reads only the signed-in person's own notifications", async () => {
    store.app_notifications.push(sentBack, { ...sentBack, id: "00000000-0000-4000-8000-000000000002", recipient_email: "someone.else@example.com" });
    expect((await bellFor(manager))?.items).toHaveLength(1);
  });

  it("no email, no bell; and a failed read hides it instead of taking down every page", async () => {
    expect(await bellFor(null)).toBeNull();
    expect(await bellFor({ email: "" })).toBeNull();
    // The table not migrated yet: the fake store throws on an unknown table.
    const saved = store.app_notifications;
    delete (store as Record<string, unknown>).app_notifications;
    try {
      expect(await bellFor(manager)).toBeNull();
    } finally {
      store.app_notifications = saved;
    }
  });
});

/*
 * Pau, 24 Nov 2026, told the bar counted only this app's forms and not the other app's approvals tab: "fix". The
 * sibling's waiting count rides on the bell, and a sibling that fails never takes the bell down.
 */
describe("the sibling app's waiting forms (Pau, 24 Nov 2026: \"fix\")", () => {
  it("carries the sibling's count when it has forms waiting", async () => {
    const bell = await bellFor(manager, async () => 2, async () => ({ app: "Other App", count: 3 }));
    expect(bell?.waitingHr).toBe(2);
    expect(bell?.waitingSiblingHr).toEqual({ app: "Other App", count: 3 });
  });

  it("leaves it off at zero, and keeps the bell when the sibling read throws", async () => {
    expect((await bellFor(manager, async () => null, async () => ({ app: "Other App", count: 0 })))?.waitingSiblingHr).toBeUndefined();
    const bell = await bellFor(manager, async () => 1, async () => {
      throw new Error("sibling down");
    });
    expect(bell).not.toBeNull();
    expect(bell?.waitingHr).toBe(1);
    expect(bell?.waitingSiblingHr).toBeUndefined();
  });
});
