// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/overlays";
import type { BellData } from "@/lib/notifications/types";

/** THE BELL (Pau, 20 Nov 2026): unread count, the list, opening one marks it read and goes to it. */

const push = vi.fn();
const markRead = vi.fn<(ids: string[] | null) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
const dismiss = vi.fn<(ids: string[] | null) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./actions", () => ({ markNotificationsReadAction: (ids: string[] | null) => markRead(ids), dismissNotificationsAction: (ids: string[] | null) => dismiss(ids) }));

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
  dismiss.mockClear();
});

/* Changed on purpose (Pau, 23 Nov 2026, port of Ask Bubbles 733e6738): each row now has an × whose name holds the row's
 * title ("Remove notification: <title>"), so a row is found by a name that starts with its title. */
describe("the notification bell", () => {
  it("shows how many are unread", () => {
    render(<NotificationBell data={data} />);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" }).textContent).toBe("2");
  });

  it("opening a notification marks it read and goes to the submissions to review", async () => {
    render(<NotificationBell data={data} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Rowan Pike submitted their work/ }));
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

  /*
   * Pau, 23 Nov 2026, with the sibling app's rail as the picture: "i dont want a bell, i need a bar". On desktop the
   * notifications are a labelled "Notifications" row in the rail, not an icon in the top bar.
   */
  it("in the rail it is a labelled Notifications bar, keeps the count, and closes the drawer when it navigates", async () => {
    const onNavigate = vi.fn();
    render(<NotificationBell data={data} variant="rail" onNavigate={onNavigate} />);
    const trigger = screen.getByRole("button", { name: "Notifications, 2 unread" });
    expect(trigger.textContent).toBe("Notifications2");
    fireEvent.click(trigger);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quinn Ash submitted their work/ }));
    });
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/ai-training/manage?tab=submissions");
  });

  it("in a collapsed rail it is an icon with the count and no label", () => {
    // The app wraps every page in TooltipProvider (src/app/providers.tsx); the collapsed rail's tooltip needs it.
    render(
      <TooltipProvider>
        <NotificationBell data={data} variant="rail" collapsed />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" }).textContent).toBe("2");
  });

  it("words the time simply", () => {
    const now = new Date("2026-11-20T12:00:00Z");
    expect(timeAgo("2026-11-20T11:59:40Z", now)).toBe("just now");
    expect(timeAgo("2026-11-20T11:55:00Z", now)).toBe("5 min ago");
    expect(timeAgo("2026-11-20T09:00:00Z", now)).toBe("3 h ago");
    expect(timeAgo("2026-11-18T12:00:00Z", now)).toBe("2 d ago");
  });
});

/* Pau (23 Nov 2026): "able to delete notification all or clicking x by removing 1". */
describe("removing notifications from the bell", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));

  it("the × removes that one, does not open it, and the unread count drops at once", async () => {
    render(<NotificationBell data={data} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove notification: Rowan Pike submitted their work" }));
    });
    expect(dismiss).toHaveBeenCalledWith(["n2"]);
    expect(push).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /^Rowan Pike submitted their work/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Quinn Ash submitted their work/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
  });

  it("removing a read one leaves the unread count as it was", async () => {
    render(<NotificationBell data={data} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove notification: Old one" }));
    });
    expect(dismiss).toHaveBeenCalledWith(["n0"]);
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
  });

  it("Clear all removes every one and the badge goes", async () => {
    render(<NotificationBell data={data} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    });
    expect(dismiss).toHaveBeenCalledWith(null);
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("clicking a row still opens it", async () => {
    render(<NotificationBell data={data} />);
    open();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Quinn Ash submitted their work/ }));
    });
    expect(push).toHaveBeenCalledWith("/ai-training/manage?tab=submissions");
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("with nothing to show there is no Clear all", () => {
    render(<NotificationBell data={{ unread: 0, items: [] }} />);
    open();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });
});

/* Owner, 24 Nov 2026: "do not remove the unread if not solved yet keep it persistent unless [HR] or anyone sends it back
 * to manager". A pinned row (HR's request while the form still waits) stays unread when opened, has no ×, and survives
 * Mark all as read and Clear all in this panel. */
describe("a pinned approval request", () => {
  const pinnedData: BellData = {
    unread: 2,
    items: [
      { id: "p1", kind: "form_hr_approval_request", title: "A form is waiting for your approval", body: "Resignation/Exit Form for Pell Hargrove", href: "/forms/hr-approval/f1", createdAt: new Date().toISOString(), readAt: null, pinned: true },
      { id: "n9", kind: "ai_training_submission", title: "Rowan Pike submitted their work", body: "", href: null, createdAt: new Date().toISOString(), readAt: null },
    ],
  };

  it("opening it goes to the form and leaves it unread", async () => {
    render(<NotificationBell data={pinnedData} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^A form is waiting for your approval/ }));
    });
    expect(markRead).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/forms/hr-approval/f1");
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
  });

  it("has no ×, and Mark all as read and Clear all leave it", async () => {
    render(<NotificationBell data={pinnedData} />);
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    expect(screen.queryByRole("button", { name: "Remove notification: A form is waiting for your approval" })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    });
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    });
    expect(screen.getByRole("button", { name: /^A form is waiting for your approval/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Rowan Pike/ })).toBeNull();
  });
});
