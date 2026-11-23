// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HrAppTabs, SiblingHrQueueList } from "./hr-approval-lists";

/**
 * Owner, 23 Nov 2026: "just make a 1 tab for sunny 1 tab for bubbles". HR's tab has one sub-tab per app; the
 * sibling's list opens each form in the sibling app, where it is approved. Invented names.
 */

afterEach(cleanup);

describe("one tab per app", () => {
  it("names each app with its count; the sibling's name is the one it answered with", () => {
    render(<HrAppTabs active="sibling" thisApp={{ name: "This App", pending: 2 }} sibling={{ name: "Sibling App", pending: 1 }} />);
    expect(screen.getByRole("link", { name: "This App (2)" }).getAttribute("href")).toBe("/forms/monitoring?view=hr");
    const sibling = screen.getByRole("link", { name: "Sibling App (1)" });
    expect(sibling.getAttribute("href")).toBe("/forms/monitoring?view=hr&app=sibling");
    expect(sibling.getAttribute("aria-current")).toBe("page");
  });

  it("while the sibling cannot be read, its tab says Other app, with no count", () => {
    render(<HrAppTabs active="this" thisApp={{ name: "This App", pending: 0 }} sibling={{ name: null, pending: null }} />);
    expect(screen.getByRole("link", { name: "Other app" })).toBeTruthy();
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
