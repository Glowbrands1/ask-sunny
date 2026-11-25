// @vitest-environment jsdom
import * as React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DEFAULT_PERMISSION_MATRIX, canAccessAdminConsole, hasPermission } from "@/lib/permissions";
import { TooltipProvider } from "@/components/ui/overlays";
import { HR_DECISION_KIND, HR_REQUEST_KIND } from "@/lib/forms/hr-approval-bells";
import type { BellData } from "@/lib/notifications/types";
import type { Role } from "@/types";
import type { Permission } from "@/types";

/*
 * Pau, 23 Nov 2026, looking at Ask Sunny as an HR approver: "why no notification for [the approver]? should be same as
 * bubbles … for the form acceptance". Then, seeing the top-bar bell: "can we remove this and add a notification bar
 * instead below the overview" (the exact spot confirmed with a screenshot: the Home group, under Overview, above
 * Assistant), and "make sure the form notif is still there". So Notifications is a rail item directly under Overview, on
 * desktop and in the phone drawer, with its unread count; the top bar has no bell. Same people, same items.
 */

const push = vi.fn();
const markRead = vi.fn<(ids: string[] | null) => Promise<{ ok: boolean }>>(async () => ({ ok: true }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push }) }));
vi.mock("@/features/notifications/actions", () => ({
  markNotificationsReadAction: (ids: string[] | null) => markRead(ids),
  dismissNotificationsAction: async () => ({ ok: true }),
}));
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

/** Two unread form bells: one waiting for the approver, one HR decision for the form's creator. */
const bell: BellData = {
  unread: 2,
  items: [
    { id: "h2", kind: HR_REQUEST_KIND, title: "A form is waiting for your approval", body: "Corrective Action Form for Wren T.", href: "/forms/hr-approval/inst-2", createdAt: new Date().toISOString(), readAt: null },
    { id: "h1", kind: HR_DECISION_KIND, title: "HR approved your form", body: "Coaching Form for Ivo M.", href: "/forms/hr-approval/inst-1", createdAt: new Date().toISOString(), readAt: null },
  ],
};

function renderRail(props: Partial<React.ComponentProps<typeof SidebarNav>>, role: Role = "district_manager", demoMode = true) {
  mocked.value = {
    can: (permission: Permission) => hasPermission(DEFAULT_PERMISSION_MATRIX, role, permission),
    isAdmin: canAccessAdminConsole(role),
    demoMode,
  };
  // The app mounts one TooltipProvider at the root (app/providers.tsx); the collapsed rail needs it.
  return render(
    <TooltipProvider>
      <SidebarNav {...props} />
    </TooltipProvider>,
  );
}

/** The rail's entries in order: links by their text, the Notifications button by its label. */
function railOrder(): string[] {
  const nav = screen.getByRole("navigation", { name: "Main" });
  return [...nav.querySelectorAll("li > a, li > button, li button[aria-label^='Notifications']")].map((el) =>
    (el.getAttribute("aria-label")?.startsWith("Notifications") ? "Notifications" : el.textContent?.trim()) ?? "",
  );
}

const one = (title: string, kind: string, href: string): BellData => ({
  unread: 1,
  items: [{ id: "n1", kind, title, body: "Corrective Action Form for Wren T.", href, createdAt: new Date().toISOString(), readAt: null }],
});

/* Changed on purpose (24 Nov 2026, port of Ask Bubbles 733e6738): each row now has an × named "Remove notification:
 * <title>", so a row is found by a name that starts with its title. The form notifications are still all there. */
describe("Notifications under Overview (Pau, 23 Nov 2026: \"add a notification bar instead below the overview\")", () => {
  it("sits directly under Overview, in the Home group, above Assistant", () => {
    renderRail({ bell });
    const order = railOrder();
    expect(order.indexOf("Notifications")).toBe(order.indexOf("Overview") + 1);
    const home = screen.getByText("Home").closest("div")!;
    expect(home.querySelector("button[aria-label^='Notifications']")).not.toBeNull();
    const assistant = screen.getByText("Assistant").closest("div")!;
    expect(assistant.querySelector("button[aria-label^='Notifications']")).toBeNull();
  });

  it("is in the phone drawer too, under Overview, and opening a form there closes the drawer", async () => {
    const onNavigate = vi.fn();
    renderRail({ bell, variant: "drawer", onNavigate });
    const order = railOrder();
    expect(order.indexOf("Notifications")).toBe(order.indexOf("Overview") + 1);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^A form is waiting for your approval/ }));
    });
    expect(push).toHaveBeenCalledWith("/forms/hr-approval/inst-2");
    expect(onNavigate).toHaveBeenCalled();
  });

  it("someone whose rail has no Overview still gets it, as the rail's first item", () => {
    renderRail({ bell }, "employee", false);
    expect(railOrder()).not.toContain("Overview");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const first = nav.querySelector("a, button");
    expect(first?.getAttribute("aria-label")).toBe("Notifications, 2 unread");
  });
});

describe("the form notifications are still there (Pau, 23 Nov 2026: \"make sure the form notif is still there\")", () => {
  it("an HR approver's unread \"A form is waiting for your approval\" is in the sidebar panel, badge 1", () => {
    renderRail({ bell: one("A form is waiting for your approval", HR_REQUEST_KIND, "/forms/hr-approval/inst-9") });
    const item = screen.getByRole("button", { name: "Notifications, 1 unread" });
    expect(item.textContent).toContain("1");
    fireEvent.click(item);
    expect(screen.getByRole("button", { name: /^A form is waiting for your approval/ })).toBeTruthy();
  });

  for (const title of ["HR approved your form", "HR sent your form back for changes"]) {
    it(`a form creator's "${title}" is in the sidebar panel, badge 1`, () => {
      renderRail({ bell: one(title, HR_DECISION_KIND, "/forms/hr-approval/inst-9") });
      fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
      expect(screen.getByRole("button", { name: new RegExp(`^${title}`) })).toBeTruthy();
    });
  }

  it("the top bar has no bell, and both rails (desktop and drawer) get the same bell", () => {
    const shell = readFileSync(join(__dirname, "app-shell.tsx"), "utf8");
    expect(shell).not.toMatch(/NotificationBell/);
    const mounts = [...shell.matchAll(/<SidebarNav[\s\S]*?\/>/g)].map((m) => m[0]);
    expect(mounts).toHaveLength(2);
    for (const mount of mounts) expect(mount).toMatch(/bell=\{bell\}/);
  });
});

describe("Notifications in the rail (Pau, 23 Nov 2026)", () => {
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
      fireEvent.click(screen.getByRole("button", { name: /^A form is waiting for your approval/ }));
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

});

/*
 * Pau, 24 Nov 2026, on Form Monitoring showing "Pending HR approval (2)" while the bar had no badge: "for form
 * monitoring can u please not remove the notification in the bar on the left side if there are still pending inside".
 * Reading or removing the notification does not decide the form, so the badge stays until the forms are decided.
 */
describe("\"can u please not remove the notification in the bar on the left side if there are still pending inside\" (Pau, 24 Nov 2026)", () => {
  const readButWaiting: BellData = {
    unread: 0,
    waitingHr: 2,
    items: [{ ...bell.items[0]!, readAt: new Date().toISOString() }],
  };

  it("keeps the badge on the bar when every notification is read but 2 forms still wait for HR", () => {
    renderRail({ bell: readButWaiting });
    const bar = screen.getByRole("button", { name: "Notifications, 2 forms waiting for your approval" });
    expect(bar.textContent).toContain("2");
  });

  it("keeps it after the approver removes every notification (Clear all), and links to the pending tab", async () => {
    renderRail({ bell: readButWaiting });
    fireEvent.click(screen.getByRole("button", { name: /^Notifications/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    });
    expect(screen.getByRole("button", { name: "Notifications, 2 forms waiting for your approval" }).textContent).toContain("2");
    expect(screen.getByRole("link", { name: /2 forms still need your decision/ }).getAttribute("href")).toBe("/forms/monitoring?view=hr");
  });

  it("keeps it after Mark all as read, and shows the larger of unread and waiting", async () => {
    renderRail({ bell: { ...bell, waitingHr: 1 } });
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 2 unread, 1 form waiting for your approval" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    });
    expect(screen.getByRole("button", { name: "Notifications, 1 form waiting for your approval" }).textContent).toContain("1");
  });

  it("drops the badge once nothing is unread and nothing is waiting", () => {
    renderRail({ bell: { ...readButWaiting, waitingHr: 0 } });
    const bar = screen.getByRole("button", { name: "Notifications" });
    expect(bar.querySelector("span[aria-hidden].rounded-full")).toBeNull();
  });

  it("the layout reads the count through the same hrQueueSummary as the Pending HR approval tab", () => {
    const layout = readFileSync(join(__dirname, "../../app/(app)/layout.tsx"), "utf8");
    expect(layout).toMatch(/hrQueueSummary\(actor\)/);
    /*
     * Changed on purpose (#1317, "i need a bell for all users/managers"): the bar's data is built by `bellFor`, which
     * every signed-in person now gets. The layout hands it this count (`waitingForHr`), and `bellFor` puts it on the
     * bar as `waitingHr`, so the count is followed through both files instead of looked for in the layout alone.
     */
    // Changed on purpose (24 Nov 2026, Pau: "fix"): bellFor now also takes the sibling app's count, so the call spans lines.
    expect(layout).toMatch(/bellFor\(\s*identity,\s*\(\) => waitingForHr\(identity\),\s*\(\) => waitingForHrInSibling\(identity\),?\s*\)/);
    const bellFor = readFileSync(join(__dirname, "../../lib/notifications/bell-for.ts"), "utf8");
    expect(bellFor).toMatch(/waitingHr: waiting/);
  });
});

/*
 * Pau, 24 Nov 2026, told the bar counted only this app's forms and not the other app's approvals tab: "fix". The
 * badge adds the forms waiting in the other app, and the panel links to that tab.
 */
describe("the other app's waiting forms on the bar (Pau, 24 Nov 2026: \"fix\")", () => {
  const read: BellData = { unread: 0, items: [{ ...bell.items[0]!, readAt: new Date().toISOString() }] };

  it("keeps the badge when only the other app has forms waiting, and links to its tab", () => {
    renderRail({ bell: { ...read, waitingSiblingHr: { app: "Other App", count: 2 } } });
    const bar = screen.getByRole("button", { name: "Notifications, 2 forms waiting for your approval" });
    expect(bar.textContent).toContain("2");
    fireEvent.click(bar);
    expect(screen.getByRole("link", { name: /2 in Other App need your decision/ }).getAttribute("href")).toBe("/forms/monitoring?view=hr&app=sibling");
    expect(screen.queryByRole("link", { name: /forms? still needs? your decision/ })).toBeNull();
  });

  it("adds both apps' forms, with a link to each tab", () => {
    renderRail({ bell: { ...read, waitingHr: 2, waitingSiblingHr: { app: "Other App", count: 1 } } });
    const bar = screen.getByRole("button", { name: "Notifications, 3 forms waiting for your approval" });
    expect(bar.textContent).toContain("3");
    fireEvent.click(bar);
    expect(screen.getByRole("link", { name: /2 forms still need your decision/ }).getAttribute("href")).toBe("/forms/monitoring?view=hr");
    expect(screen.getByRole("link", { name: /1 in Other App needs your decision/ }).getAttribute("href")).toBe("/forms/monitoring?view=hr&app=sibling");
  });
});
