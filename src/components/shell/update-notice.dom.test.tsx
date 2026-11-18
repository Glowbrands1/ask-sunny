// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const session = vi.hoisted(() => ({
  value: { user: { id: "u-1", name: "Jordan Example", isSalonAccount: false } },
}));
vi.mock("@/lib/session/session-context", () => ({ useSession: () => session.value }));

import { UpdateNotice, greetingName } from "./update-notice";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the chat update notice", () => {
  it("greets the signed-in person by first name", () => {
    render(<UpdateNotice today="2026-11-18" />);
    expect(screen.getByText(/Hello Jordan!/)).toBeTruthy();
  });

  it("stays dismissed for the rest of the day after OK, and returns the next day", async () => {
    const first = render(<UpdateNotice today="2026-11-18" />);
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    first.unmount();
    render(<UpdateNotice today="2026-11-18" />);
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
    cleanup();
    render(<UpdateNotice today="2026-11-19" />);
    expect(screen.getByRole("button", { name: "OK" })).toBeTruthy();
  });

  it("never greets with an email or blank name", () => {
    expect(greetingName("someone@example.com")).toBe("");
    expect(greetingName("  ")).toBe("");
  });
});
