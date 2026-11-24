// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BellData } from "@/lib/notifications/types";

/*
 * QA for Pau, 23 Nov 2026: the top bar lost its bell when Notifications moved under Overview ("can we remove this and
 * add a notification bar instead below the overview"). On a phone the rail is a drawer behind the menu button, so the
 * button shows a red dot when something is unread. No number on it: the count is on the Notifications bar.
 */
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/session/session-context", () => ({ useSession: () => ({ hydrated: true, signedIn: true, demoMode: false }) }));
vi.mock("./sidebar", () => ({ SidebarNav: () => <nav aria-label="Main" /> }));
vi.mock("./update-notice", () => ({ UpdateNotice: () => null }));
vi.mock("./global-search", () => ({ GlobalSearch: () => null }));
vi.mock("./jump-to-row", () => ({ JumpToRow: () => null }));
vi.mock("@/features/auth/login-screen", () => ({ LoginScreen: () => null }));

const { AppShell } = await import("./app-shell");

afterEach(cleanup);

const bell = (unread: number): BellData => ({
  unread,
  items: [{ id: "h2", kind: "form_hr_approval_request", title: "A form is waiting for your approval", body: "Corrective Action Form for Wren T.", href: "/forms/hr-approval/inst-2", createdAt: new Date().toISOString(), readAt: unread ? null : new Date().toISOString() }],
});

describe("the phone menu button's unread dot", () => {
  it("shows a red dot when there are unread notifications, and says so to screen readers", () => {
    render(<AppShell bell={bell(1)}>page</AppShell>);
    const menu = screen.getByRole("button", { name: "Open navigation, 1 unread notification" });
    const dot = menu.querySelector("[data-testid='menu-unread-dot']");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("bg-status-failed");
    // A dot, not a count.
    expect(dot!.textContent).toBe("");
  });

  it("no dot when everything is read", () => {
    render(<AppShell bell={bell(0)}>page</AppShell>);
    const menu = screen.getByRole("button", { name: "Open navigation" });
    expect(menu.querySelector("[data-testid='menu-unread-dot']")).toBeNull();
  });

  it("no dot for someone with no bell", () => {
    render(<AppShell bell={null}>page</AppShell>);
    expect(screen.getByRole("button", { name: "Open navigation" }).querySelector("[data-testid='menu-unread-dot']")).toBeNull();
  });
});
