// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppNotification } from "./types";

/**
 * Pau (23 Nov 2026): "for dm meeting make this UI same with bubble" (in Ask Sunny: the same panel as Ask Sunny's own bell), and the DM L10 panel's Settings took people to the
 * Leadership Hub. The DM L10 bell now shows Ask Sunny's own NotificationsPanel: Mark all read and See all kept, no
 * Settings link, the meta line at normal contrast, and no × or Clear all (the Hub's notes cannot be removed yet).
 * Invented people and meeting.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./actions", () => ({ markReadAction: vi.fn(), markAllReadAction: vi.fn() }));

const { NotificationsView } = await import("./NotificationsView");

const NOW = Date.parse("2026-11-23T12:00:00Z");
const note = (id: string, read: boolean): AppNotification => ({
  id, kind: "issue_solved", meeting_key: "northfield-dm", meeting_name: "Northfield DM L10", item_id: "i1", excerpt: "Restock the counter", actor_id: null,
  actor_name: "Ilse Marrow", count: 1, created_at: "2026-11-17T12:00:00Z", updated_at: "2026-11-17T12:00:00Z", read_at: read ? "2026-11-18T12:00:00Z" : null,
});

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("the DM L10 bell shows Ask Sunny's own panel", () => {
  const view = (markRead = vi.fn(async () => ({ ok: true })), markAll = vi.fn(async () => ({ ok: true }))) => {
    render(<NotificationsView initial={[note("00000000-0000-4000-8000-000000000001", false), note("00000000-0000-4000-8000-000000000002", true)]} now={NOW} compact hubUrl="https://hub.example.test" markRead={markRead} markAll={markAll} />);
    return { markRead, markAll };
  };

  it("has no Settings link, keeps See all, and has no × or Clear all", () => {
    view();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    expect(screen.getByRole("link", { name: "See all" }).getAttribute("href")).toBe("https://hub.example.test/notifications");
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove notification/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeTruthy();
  });

  it("the meta line names the meeting and the time, at normal contrast", () => {
    view();
    const meta = screen.getAllByText("Northfield DM L10 · 6 d ago")[0]!;
    expect(meta.className).toMatch(/text-muted-foreground/);
    expect(meta.className).not.toMatch(/text-subtle-foreground/);
  });

  it("Mark all as read marks every note read", async () => {
    const { markAll } = view();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    });
    expect(markAll).toHaveBeenCalledTimes(1);
  });

  it("opening a note marks it read and goes to its meeting", async () => {
    const { markRead } = view();
    const row = screen.getAllByRole("button").find((button) => /\(unread\)/.test(button.textContent ?? ""))!;
    await act(async () => {
      fireEvent.click(row);
    });
    expect(markRead).toHaveBeenCalledWith(["00000000-0000-4000-8000-000000000001"]);
    expect(push).toHaveBeenCalledWith("/meetings/northfield-dm");
  });
});
