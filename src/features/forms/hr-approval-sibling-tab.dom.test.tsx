// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HrApprovalTabs, HrApprovedList, SiblingHrQueueList } from "./hr-approval-lists";

/**
 * Owner, 23 Nov 2026: "just make a 1 tab for sunny 1 tab for bubbles", then, of a link to the sibling's own page: "i
 * dont want the sunny approval in a different page and link, just a tab pls". The sibling app's approvals are a tab
 * next to Pending HR approval, listed on this page; each form then opens in the sibling app, where it is approved.
 * Invented names.
 */

afterEach(cleanup);

describe("the sibling app's approvals are a tab, not a link away", () => {
  it("sits next to Pending HR approval, with the name the sibling answered with and its count, on this page", () => {
    render(<HrApprovalTabs active="sibling" pending={2} overdue={0} sibling={{ name: "Sibling App", pending: 1 }} />);
    const links = screen.getAllByRole("link");
    // Changed on purpose (owner, 24 Nov 2026): the row also has HR's Approved tab, last.
    expect(links.map((link) => link.textContent)).toEqual(["All forms", "Pending HR approval (2)", "Sibling App approvals (1)", "Approved"]);
    const sibling = screen.getByTestId("sibling-approvals-tab");
    // In this app, in this tab: no other address, no new window.
    expect(sibling.getAttribute("href")).toBe("/forms/monitoring?view=hr&app=sibling");
    expect(sibling.getAttribute("target")).toBeNull();
    expect(sibling.getAttribute("aria-current")).toBe("page");
    expect(screen.getByTestId("hr-pending-tab").getAttribute("aria-current")).toBeNull();
    expect(screen.queryByText(/↗/)).toBeNull();
  });

  it("while the sibling cannot be read, it says Other app approvals, with no count; without the shared secret, no tab", () => {
    render(<HrApprovalTabs active="hr" pending={0} overdue={0} sibling={{ name: null, pending: null }} />);
    expect(screen.getByTestId("sibling-approvals-tab").textContent).toBe("Other app approvals");
    cleanup();
    render(<HrApprovalTabs active="hr" pending={0} overdue={0} sibling={null} />);
    expect(screen.queryByTestId("sibling-approvals-tab")).toBeNull();
  });
});

describe("the sibling app's forms", () => {
  const form = {
    line: "Exit Form for Marlowe Fenwick at Invented Place",
    from: "Ines",
    state: "pending" as const,
    requestedAt: "2026-11-23T14:00:00Z",
    waiting: "Sent today",
    overdue: true,
    href: "https://sibling.test/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f",
  };

  it("each form opens its review page in the sibling app, where it is approved", () => {
    render(<SiblingHrQueueList queue={{ status: "ok", app: "Sibling App", approver: true, forms: [form] }} />);
    expect(screen.getByRole("link", { name: /Exit Form for Marlowe Fenwick/ }).getAttribute("href")).toBe(form.href);
    expect(screen.getByText(/Each form opens in Sibling App, where you approve, send back or reject it/)).toBeTruthy();
    expect(screen.getByText("Overdue")).toBeTruthy();
  });

  it("says so when nothing waits, when this account is not HR there, and when the sibling did not answer", () => {
    render(<SiblingHrQueueList queue={{ status: "ok", app: "Sibling App", approver: true, forms: [] }} />);
    expect(screen.getByText("No forms are waiting for your approval in Sibling App.")).toBeTruthy();
    cleanup();
    render(<SiblingHrQueueList queue={{ status: "ok", app: "Sibling App", approver: false, forms: [] }} />);
    expect(screen.getByTestId("sibling-hr-queue-not-approver").textContent).toMatch(/not set up as the HR approver in Sibling App/);
    cleanup();
    render(<SiblingHrQueueList queue={{ status: "error" }} />);
    expect(screen.getByTestId("sibling-hr-queue-error")).toBeTruthy();
  });
});

/*
 * Owner, 24 Nov 2026: "a separate tab (not a link) for HR to see which forms she approved already for both sunnyt and
 * bubble". Invented names.
 */
describe("HR's Approved tab, for both apps", () => {
  it("is a tab on this page, not a link away", () => {
    render(<HrApprovalTabs active="approved" pending={0} overdue={0} sibling={{ name: "Sibling App", pending: 0 }} />);
    const tab = screen.getByTestId("hr-approved-tab");
    expect(tab.textContent).toBe("Approved");
    expect(tab.getAttribute("href")).toBe("/forms/monitoring?view=hr&app=approved");
    expect(tab.getAttribute("target")).toBeNull();
    expect(tab.getAttribute("aria-current")).toBe("page");
  });

  it("lists this app's approved forms and the sibling app's, each opening in its own app, with who approved it", () => {
    render(
      <HrApprovedList
        appName="This App"
        rows={[{ line: "Corrective Action Form for Juniper Calloway at Invented Place", from: "Thistle", approvedAt: "2026-11-24T15:00:00Z", approvedBy: "You", href: "/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f" }]}
        sibling={{ status: "ok", app: "Sibling App", approver: true, approved: [{ line: "Exit Form for Marlowe Fenwick", from: "Ines", approvedAt: null, approvedBy: "Wren", href: "https://sibling.test/forms/hr-approval/1b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f" }] }}
      />,
    );
    const here = screen.getByTestId("hr-approved-this-app");
    expect(here.textContent).toContain("This App (1)");
    expect(here.textContent).toContain("Corrective Action Form for Juniper Calloway at Invented Place");
    expect(here.textContent).toContain("by You");
    expect(here.querySelector("a")!.getAttribute("href")).toBe("/forms/hr-approval/0b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f");
    const there = screen.getByTestId("hr-approved-sibling");
    expect(there.textContent).toContain("Sibling App (1)");
    expect(there.textContent).toContain("by Wren");
    expect(there.querySelector("a")!.getAttribute("href")).toBe("https://sibling.test/forms/hr-approval/1b6f1c1e-2a8d-4c55-9a10-5f3b6c7d8e9f");
  });

  it("without the shared secret, only this app's list; the sibling unreadable says so", () => {
    render(<HrApprovedList appName="This App" rows={[]} sibling={{ status: "off" }} />);
    expect(screen.queryByTestId("hr-approved-sibling")).toBeNull();
    expect(screen.getByTestId("hr-approved-this-app").textContent).toContain("No approved forms yet.");
    cleanup();
    render(<HrApprovedList appName="This App" rows={[]} sibling={{ status: "error" }} />);
    expect(screen.getByTestId("hr-approved-sibling-error")).toBeTruthy();
  });
});
