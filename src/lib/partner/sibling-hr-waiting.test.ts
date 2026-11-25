import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SiblingHrForm, SiblingHrQueue } from "./sibling-hr-queue";

vi.mock("server-only", () => ({}));

const { siblingHrWaiting, siblingWaitingCount, clearSiblingHrWaitingCache } = await import("./sibling-hr-waiting");

/*
 * Pau, 24 Nov 2026: "can u please not remove the notification in the bar on the left side if there are still pending
 * inside", then "fix" when told the bar counted only this app's forms and not the other app's approvals tab. The bar
 * counts what that tab counts: waiting for this approver, or sent back and replied to since. Invented forms only.
 */
const form = (state: SiblingHrForm["state"], managerReplied = false): SiblingHrForm => ({
  line: "Coaching Form for Ivo M.",
  from: "A manager",
  state,
  requestedAt: null,
  waiting: "",
  overdue: false,
  managerReplied,
  href: "https://sibling.example/forms/hr-approval/00000000-0000-4000-8000-000000000001",
});
const ok = (forms: SiblingHrForm[], approver = true): SiblingHrQueue => ({ status: "ok", app: "Other App", approver, forms, approved: [] });

beforeEach(() => clearSiblingHrWaitingCache());

describe("the sibling's waiting count for the Notifications bar (Pau, 24 Nov 2026: \"fix\")", () => {
  it("counts what the sibling's tab counts: pending, and sent back with the manager's reply", () => {
    const queue = ok([form("pending"), form("pending"), form("changes_requested", true), form("changes_requested"), form("rejected")]);
    expect(siblingWaitingCount(queue)).toEqual({ app: "Other App", count: 3 });
  });

  it("is null when the sibling is off, did not answer, or this email is no approver there", () => {
    expect(siblingWaitingCount({ status: "off" })).toBeNull();
    expect(siblingWaitingCount({ status: "error" })).toBeNull();
    expect(siblingWaitingCount(ok([form("pending")], false))).toBeNull();
  });

  it("asks the sibling at most once a minute per approver, whatever the answer", async () => {
    const fetchQueue = vi.fn(async () => ok([form("pending")]));
    const t = 1_000_000;
    expect(await siblingHrWaiting("HR@Example.com", { fetchQueue, now: t })).toEqual({ app: "Other App", count: 1 });
    expect(await siblingHrWaiting("hr@example.com", { fetchQueue, now: t + 59_000 })).toEqual({ app: "Other App", count: 1 });
    expect(fetchQueue).toHaveBeenCalledTimes(1);
    expect(fetchQueue).toHaveBeenCalledWith("hr@example.com");
    await siblingHrWaiting("hr@example.com", { fetchQueue, now: t + 61_000 });
    expect(fetchQueue).toHaveBeenCalledTimes(2);

    const down = vi.fn(async (): Promise<SiblingHrQueue> => ({ status: "error" }));
    expect(await siblingHrWaiting("other@example.com", { fetchQueue: down, now: t })).toBeNull();
    expect(await siblingHrWaiting("other@example.com", { fetchQueue: down, now: t + 30_000 })).toBeNull();
    expect(down).toHaveBeenCalledTimes(1);
  });
});
