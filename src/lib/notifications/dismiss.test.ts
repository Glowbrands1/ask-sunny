import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * Pau (23 Nov 2026): "able to delete notification all or clicking x by removing 1". The × and Clear all remove the
 * caller's OWN notifications only: every delete is scoped to their email, so another person's row (even asked for by id)
 * is never touched, and nothing outside `app_notifications` is read or changed. Invented people.
 */

const store = { app_notifications: [] as Record<string, unknown>[], form_instances: [] as Record<string, unknown>[] } as unknown as FakeStore & Record<string, Record<string, unknown>[]>;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
const identity = vi.hoisted(() => ({ email: "wren.alder@example.test" as string | null }));
vi.mock("@/lib/auth/page", () => ({ pageIdentity: async () => (identity.email ? { email: identity.email } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { dismissNotifications, listNotifications } = await import("./repository");
const { dismissNotificationsAction } = await import("@/features/notifications/actions");

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const note = (id: string, to: string, read = false) => ({ id, recipient_email: to, kind: "form_hr_approval_request", title: `For ${to}`, body: "", href: "/forms/monitoring?view=hr", created_at: "2026-11-23T10:00:00Z", read_at: read ? "2026-11-23T11:00:00Z" : null });
const WREN = "wren.alder@example.test";
const OSKAR = "oskar.vale@example.test";

beforeEach(() => {
  identity.email = WREN;
  store.app_notifications.splice(0, store.app_notifications.length, note(ID(1), WREN), note(ID(2), WREN), note(ID(3), WREN, true), note(ID(4), OSKAR));
  store.form_instances.splice(0, store.form_instances.length, { id: "form-1", status: "pending_hr_approval" });
});

const ids = () => store.app_notifications.map((row) => row.id);
/* The fake store does not count a head-only select, so the unread count is read off the caller's list. */
const unreadOf = async (email: string) => (await listNotifications(email)).items.filter((item) => !item.readAt).length;

describe("removing the caller's own notifications", () => {
  it("the × removes that one; the unread count drops", async () => {
    expect(await unreadOf(WREN)).toBe(2);
    expect(await dismissNotificationsAction([ID(1)])).toEqual({ ok: true });
    expect(ids()).toEqual([ID(2), ID(3), ID(4)]);
    const after = await listNotifications(WREN);
    expect(after.items.map((item) => item.id).sort()).toEqual([ID(2), ID(3)]);
    expect(await unreadOf(WREN)).toBe(1);
  });

  it("Clear all removes every one of the caller's, and only theirs", async () => {
    expect(await dismissNotificationsAction(null)).toEqual({ ok: true });
    expect(ids()).toEqual([ID(4)]);
    expect(await unreadOf(WREN)).toBe(0);
    expect((await listNotifications(OSKAR)).items.map((item) => item.id)).toEqual([ID(4)]);
  });

  it("someone else's notification, asked for by its id, is never removed", async () => {
    expect(await dismissNotificationsAction([ID(4)])).toEqual({ ok: true });
    expect(ids()).toContain(ID(4));
    expect(await dismissNotifications(WREN, [ID(4)])).toBe(0);
    expect(ids()).toEqual([ID(1), ID(2), ID(3), ID(4)]);
  });

  it("no form or approval record is touched", async () => {
    await dismissNotificationsAction(null);
    expect(store.form_instances).toEqual([{ id: "form-1", status: "pending_hr_approval" }]);
  });

  it("signed out: nothing is removed", async () => {
    identity.email = null;
    expect(await dismissNotificationsAction(null)).toEqual({ ok: false });
    expect(ids()).toHaveLength(4);
  });

  it("ids that are not notification ids are dropped before the delete", async () => {
    expect(await dismissNotificationsAction(["not-an-id", "*"])).toEqual({ ok: true });
    expect(ids()).toHaveLength(4);
  });
});
