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

describe("the notice's contact line", () => {
  it("points people to the Admins and carries no personal email address", () => {
    // Its own day: an earlier test dismissed 2026-11-18 in the shared preference cache.
    render(<UpdateNotice today="2026-12-01" />);
    expect(screen.getByText(/reach out to the Admins/)).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/@glowbrands\.com|mailto:/);
  });
});

describe("the phone banner stays off the chat", () => {
  // Reported 27 Nov 2026 with a phone screenshot of the chat: "for the chat in sunny and bubble its too weird,
  // pls adjust so we can see whole chat". The banner pushed the composer's bottom row below the fold.
  function phone(matches: boolean) {
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  }

  it("shows the banner on a phone elsewhere, and nothing on the chat", () => {
    phone(true);
    const elsewhere = render(<UpdateNotice today="2026-12-02" />);
    expect(screen.getByRole("status", { name: "Chat update notice" })).toBeTruthy();
    elsewhere.unmount();
    render(<UpdateNotice today="2026-12-02" phoneBanner={false} />);
    expect(screen.queryByRole("status", { name: "Chat update notice" })).toBeNull();
  });

  it("the shell turns the banner off on /chat only", async () => {
    const { readFileSync } = await import("node:fs");
    const shell = readFileSync("src/components/shell/app-shell.tsx", "utf8");
    expect(shell).toMatch(/<UpdateNotice phoneBanner=\{!pathname\?\.startsWith\("\/chat"\)\} \/>/);
  });

  it("the chat field is 16px on a phone, so iOS does not zoom the page when you tap it", async () => {
    const { readFileSync } = await import("node:fs");
    const composer = readFileSync("src/features/chat/composer.tsx", "utf8");
    expect(composer).toMatch(/id="chat-input"[\s\S]*?className="[^"]*\btext-\[16px\][^"]*\bsm:text-\[14px\]/);
  });
});
