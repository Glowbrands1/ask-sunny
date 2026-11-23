// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BellData } from "@/lib/notifications/types";

/** THE BELL (Pau, 20 Nov 2026): unread count, the list, opening one marks it read and goes to it. */

const push = vi.fn();
const markRead = vi.fn<(ids: string[] | null) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./actions", () => ({ markNotificationsReadAction: (ids: string[] | null) => markRead(ids) }));

const { NotificationBell, timeAgo } = await import("./notification-bell");

const data: BellData = {
  unread: 2,
  items: [
    { id: "n2", kind: "ai_training_submission", title: "Rowan Pike submitted their work", body: "Claude Lesson 4", href: "/ai-training/manage?tab=submissions", createdAt: new Date().toISOString(), readAt: null },
    { id: "n1", kind: "ai_training_submission", title: "Quinn Ash submitted their work", body: "Claude Lesson 3", href: "/ai-training/manage?tab=submissions", createdAt: new Date().toISOString(), readAt: null },
    { id: "n0", kind: "ai_training_submission", title: "Old one", body: "", href: null, createdAt: "2026-11-01T00:00:00Z", readAt: "2026-11-02T00:00:00Z" },
  ],
};

afterEach(() => {
  cleanup();
  push.mockReset();
  markRead.mockClear();
});

describe("the notification bell", () => {
  it("shows how many are unread", () => {
    render(<NotificationBell data={data} />);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" }).textContent).toBe("2");
  });

  it("opening a notification marks it read and goes to the submissions to review", async () => {
    render(<NotificationBell data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Rowan Pike submitted their work/ }));
    });
    expect(markRead).toHaveBeenCalledWith(["n2"]);
    expect(push).toHaveBeenCalledWith("/ai-training/manage?tab=submissions");
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
  });

  it("marks all read", async () => {
    render(<NotificationBell data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    });
    expect(markRead).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("says so when there is nothing", () => {
    render(<NotificationBell data={{ unread: 0, items: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
  });

  it("words the time simply", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(timeAgo("2026-11-20T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-20T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-20T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-18T12:00:00Z", now)).toBe("2 d ago");
  });
});
