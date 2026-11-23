// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, canAccessAdminConsole, hasPermission } from "@/lib/permissions";
import { TooltipProvider } from "@/components/ui/overlays";
import type { BellData } from "@/lib/notifications/types";
import type { Permission } from "@/types";

/*
 * Pau, 23 Nov 2026, looking at Ask Sunny as an HR approver: "why no notification for [the approver]? should be same as
 * bubbles … for the form acceptance". The approver had the bell, but only in the top bar; Pau looked in the rail. As
 * in Ask Bubbles, the bell is now the rail's first item on desktop ("Notifications", with the unread count), and the
 * top bar keeps it for phones only, where the rail is a drawer. The drawer does not repeat it.
 */

const push = vi.fn();
const markRead = vi.fn<(ids: string[] | null) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push }) }));
vi.mock("@/features/notifications/actions", () => ({ markNotificationsReadAction: (ids: string[] | null) => markRead(ids) }));
vi.mock("./user-menu", () => ({ UserMenu: () => <div data-testid="profile-card" /> }));

const mocked = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/session/session-context", () => ({ useSession: () => mocked.value }));

const { SidebarNav } = await import("./sidebar");

beforeAll(() => {
  // Radix Tooltip and Popover measure, and jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

afterEach(() => {
  cleanup();
  push.mockReset();
  markRead.mockClear();
});

/** An HR approver's bell: one form waiting, one manager reply (the two HR approval bells). */
const bell: BellData = {
  unread: 2,
  items: [
    { id: "h2", kind: "hr_approval_requested", title: "A form is waiting for your approval", body: "Corrective Action Form for Wren T.", href: "/forms/hr-approval/inst-2", createdAt: new Date().toISOString(), readAt: null },
    { id: "h1", kind: "hr_approval_comment", title: "A manager replied on a form you are approving", body: "Coaching Form for Ivo M.", href: "/forms/hr-approval/inst-1", createdAt: new Date().toISOString(), readAt: null },
  ],
};

function renderRail(props: Partial<React.ComponentProps<typeof SidebarNav>>) {
  mocked.value = {
    can: (permission: Permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, "district_manager", permission),
    isAdmin: canAccessAdminConsole("district_manager"),
    demoMode: true,
  };
  // The app mounts one TooltipProvider at the root (app/providers.tsx); the collapsed rail needs it.
  return render(
    <TooltipProvider>
      <SidebarNav {...props} />
    </TooltipProvider>,
  );
}

describe("Notifications in the rail, as in Ask Bubbles (Pau, 23 Nov 2026)", () => {
  it("the HR approver sees Notifications in the desktop rail, with the unread count", () => {
    renderRail({ bell });
    const item = screen.getByRole("button", { name: "Notifications, 2 unread" });
    expect(item.textContent).toContain("Notifications");
    expect(item.textContent).toContain("2");
  });

  it("opening \"A form is waiting for your approval\" marks it read and goes to the form", async () => {
    renderRail({ bell });
    fireEvent.click(screen.getByRole("button", { name: /Notifications/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /A form is waiting for your approval/ }));
    });
    expect(markRead).toHaveBeenCalledWith(["h2"]);
    expect(push).toHaveBeenCalledWith("/forms/hr-approval/inst-2");
  });

  it("the collapsed rail keeps the bell, labelled for screen readers, without the word", () => {
    renderRail({ bell, collapsed: true });
    const item = screen.getByRole("button", { name: "Notifications, 2 unread" });
    expect(item.textContent).toBe("2");
  });

  it("nobody with no bell gets the item", () => {
    renderRail({ bell: null });
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
  });

  it("the phone drawer does not repeat it: the top bar shows the bell there", () => {
    renderRail({ bell, variant: "drawer" });
    expect(screen.queryByRole("button", { name: /Notifications/ })).toBeNull();
  });
});
