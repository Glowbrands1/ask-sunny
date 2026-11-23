// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HrApprovalTabs } from "./hr-approval-lists";

/*
 * Pau, 23 Nov 2026: an approver who works in both apps needs Ask Bubbles' approvals from Form Monitoring. A
 * "Bubbles approvals ↗" tab next to "All forms" and "Pending HR approval", given only to people who already get the
 * app switcher (the page decides, with pageShowsAppSwitcher). A plain link to Ask Bubbles' own URL: no count, no data.
 */
afterEach(cleanup);

const HREF = "https://askbubbles.vercel.app/forms/monitoring?view=hr";

describe("Form Monitoring's Bubbles approvals tab (Pau, 23 Nov 2026)", () => {
  it("sits next to All forms and Pending HR approval, and opens Ask Bubbles' Pending HR approval view", () => {
    render(<HrApprovalTabs active="all" pending={3} overdue={0} bubblesApprovalsHref={HREF} />);
    const nav = screen.getByRole("navigation", { name: "Form Monitoring views" });
    const links = [...nav.querySelectorAll("a")].map((a) => a.textContent);
    expect(links).toEqual(["All forms", "Pending HR approval (3)", "Bubbles approvals ↗"]);
    const tab = screen.getByRole("link", { name: /Bubbles approvals/ });
    expect(tab.getAttribute("href")).toBe(HREF);
    // A link only: no count on it.
    expect(tab.textContent).not.toMatch(/\d/);
  });

  it("is not there for someone without the app switcher", () => {
    render(<HrApprovalTabs active="all" pending={3} overdue={0} bubblesApprovalsHref={null} />);
    expect(screen.queryByRole("link", { name: /Bubbles approvals/ })).toBeNull();
  });

  it("an app-switcher user who is not an HR approver gets the tab without Pending HR approval", () => {
    render(<HrApprovalTabs active="all" pending={null} overdue={0} bubblesApprovalsHref={HREF} />);
    expect(screen.queryByRole("link", { name: /Pending HR approval/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Bubbles approvals/ })).toBeTruthy();
  });
});
