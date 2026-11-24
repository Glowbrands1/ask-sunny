import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase, type FakeStore } from "@/test/fake-supabase";

/**
 * Owner, 24 Nov 2026, about HR's "A form is waiting for your approval" bell, which every HR approver gets (names swapped
 * for invented ones, per CLAUDE.md): "also thi for formapproval, [Brin] [Tamsin] and [Odile] are seeing notification
 * too. can u make sure that when one of us open this notification, it will not clear it for the oother people. also do
 * not remove the unread if not solved yet keep it persistent unless [Hollis] or anyone sends it back to manager".
 *
 * So: one approver opening it changes only their own copy; while the form still waits for HR the request stays unread
 * and stays in the list for every approver (opening, Mark all as read, × and Clear all leave it alone); once HR sends
 * it back (or approves or rejects it) `clearRequestBells` marks every copy read and it behaves like any other item.
 */

const store = { app_notifications: [] as Record<string, unknown>[], form_instances: [] as Record<string, unknown>[] } as unknown as FakeStore &
  Record<string, Record<string, unknown>[]>;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => fakeSupabase(store) }));
const identity = vi.hoisted(() => ({ email: "brin.calloway@example.test" as string | null }));
vi.mock("@/lib/auth/page", () => ({ pageIdentity: async () => (identity.email ? { email: identity.email } : null) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { listNotifications } = await import("./repository");
const { PINNED_REQUEST_KIND } = await import("./pinned");
const { markNotificationsReadAction, dismissNotificationsAction } = await import("@/features/notifications/actions");
const bells = await import("@/lib/forms/hr-approval-bells");

const FORM = "11111111-2222-4333-8444-555555555555";
const BRIN = "brin.calloway@example.test";
const TAMSIN = "tamsin.vere@example.test";
const ODILE = "odile.marchetti@example.test";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = (id: string, to: string) => ({
  id,
  recipient_email: to,
  kind: bells.HR_REQUEST_KIND,
  title: "A form is waiting for your approval",
  body: "Resignation/Exit Form for Pell Hargrove at Juniper Row, sent by Nell.",
  href: bells.formHref(FORM),
  created_at: "2026-11-24T08:00:00Z",
  read_at: null,
});
const other = (id: string, to: string) => ({ ...request(id, to), kind: "ai_training_submission", title: "Someone submitted their work", href: null });

beforeEach(() => {
  identity.email = BRIN;
  store.app_notifications.splice(0, store.app_notifications.length, request(ID(1), BRIN), request(ID(2), TAMSIN), request(ID(3), ODILE), other(ID(4), BRIN));
  store.form_instances.splice(0, store.form_instances.length, { id: FORM, status: "draft", hr_approval_state: "pending" });
});

const view = async (email: string) => {
  const bell = await listNotifications(email);
  const req = bell.items.find((item) => item.kind === bells.HR_REQUEST_KIND);
  return { req, unreadRows: bell.items.filter((item) => !item.readAt).length };
};

describe("HR's 'waiting for your approval' bell, shared by every approver", () => {
  it("the kind the bell store pins is the one HR approval rings", () => {
    expect(PINNED_REQUEST_KIND).toBe(bells.HR_REQUEST_KIND);
  });

  it("one approver opening it does not clear it for the other approvers", async () => {
    expect(await markNotificationsReadAction([ID(1)])).toEqual({ ok: true });
    for (const email of [TAMSIN, ODILE]) {
      const { req } = await view(email);
      expect(req?.readAt).toBeNull();
    }
    expect(store.app_notifications.filter((r) => r.recipient_email !== BRIN).every((r) => r.read_at === null)).toBe(true);
  });

  it("while the form still waits, it stays unread even for the one who opened it, and Mark all as read leaves it", async () => {
    await markNotificationsReadAction([ID(1)]);
    await markNotificationsReadAction(null);
    const { req } = await view(BRIN);
    expect(req?.readAt).toBeNull();
    expect(req?.pinned).toBe(true);
    // The other item was read by Mark all as read.
    expect(store.app_notifications.find((r) => r.id === ID(4))?.read_at).not.toBeNull();
    expect((await listNotifications(BRIN)).items.filter((i) => !i.readAt).map((i) => i.id)).toEqual([ID(1)]);
  });

  it("an approver who had read it before still sees it unread, and counted, while it waits", async () => {
    store.app_notifications[0]!.read_at = "2026-11-24T09:00:00Z";
    const bell = await listNotifications(BRIN);
    expect(bell.items.find((i) => i.id === ID(1))?.readAt).toBeNull();
    // The fake does not count a head-only select (0), so the 1 is the pinned row read before.
    expect(bell.unread).toBe(1);
  });

  it("the × and Clear all do not remove it while the form waits", async () => {
    await dismissNotificationsAction([ID(1)]);
    await dismissNotificationsAction(null);
    expect(store.app_notifications.map((r) => r.id)).toEqual([ID(1), ID(2), ID(3)]);
  });

  it("once HR sends it back to the manager, every approver's copy is read and can be cleared", async () => {
    store.form_instances[0]!.hr_approval_state = "changes_requested";
    await bells.clearRequestBells(FORM);
    for (const email of [BRIN, TAMSIN, ODILE]) {
      const { req } = await view(email);
      expect(req?.readAt).not.toBeNull();
      expect(req?.pinned).toBeUndefined();
    }
    await dismissNotificationsAction([ID(1)]);
    expect(store.app_notifications.map((r) => r.id)).toEqual([ID(2), ID(3), ID(4)]);
  });

  it("approved or rejected also lifts it; a form that no longer exists pins nothing", async () => {
    store.form_instances[0]!.hr_approval_state = "approved";
    await markNotificationsReadAction([ID(1)]);
    expect((await view(BRIN)).req?.readAt).not.toBeNull();
    store.form_instances.splice(0);
    store.app_notifications[1]!.read_at = null;
    identity.email = TAMSIN;
    await markNotificationsReadAction([ID(2)]);
    expect((await view(TAMSIN)).req?.readAt).not.toBeNull();
  });
});
