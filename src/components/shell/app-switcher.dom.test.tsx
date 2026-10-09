// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AppSwitcher } from "./app-switcher";

/**
 * The switcher is a link to the other app's production URL and nothing more:
 * the current app is marked, the other one is a plain anchor, and no session
 * or token travels with it.
 */

afterEach(cleanup);

async function open() {
  render(<AppSwitcher />);
  await userEvent.click(screen.getByRole("button", { name: /switch app/i }));
}

describe("the app switcher", () => {
  it("lists both apps with their companies", async () => {
    await open();
    const menu = within(screen.getByRole("menu"));
    expect(menu.getByText("Ask Sunny")).toBeTruthy();
    expect(menu.getByText("Sun Tan City")).toBeTruthy();
    expect(menu.getByText("Ask Bubbles")).toBeTruthy();
    expect(menu.getByText("Buff City Soap")).toBeTruthy();
  });

  it("marks Ask Sunny as the current app and does not link it", async () => {
    await open();
    const current = screen.getByRole("menuitem", { current: true });
    expect(current.textContent).toContain("Ask Sunny");
    expect(current.getAttribute("href")).toBeNull();
  });

  it("sends Ask Bubbles to its production URL, with nothing appended", async () => {
    await open();
    const other = screen.getByRole("menuitem", { name: /Ask Bubbles/ });
    expect(other.tagName).toBe("A");
    expect(other.getAttribute("href")).toBe("https://askbubbles.vercel.app");
    expect(other.getAttribute("aria-current")).toBeNull();
  });
});
