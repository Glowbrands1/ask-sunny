// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { RecoveryContinueForm } from "./recovery-continue-form";

/**
 * The Continue button is the ONLY thing that spends a recovery token. These
 * cases pin that it is a real POST to `/auth/recovery-start`, that it carries
 * no token of its own, and that a second press cannot send a second request.
 */

afterEach(cleanup);

describe("with a held link", () => {
  it("shows a Continue button that POSTs to /auth/recovery-start", () => {
    const { container } = render(<RecoveryContinueForm hasLink retry={false} />);

    const button = screen.getByRole("button", { name: /continue to reset password/i });
    const form = button.closest("form");
    expect(form?.getAttribute("method")).toBe("post");
    expect(form?.getAttribute("action")).toBe("/auth/recovery-start");
    expect(button.getAttribute("type")).toBe("submit");
    // The token rides in an HttpOnly cookie, never in the page.
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  it("does not say the link is expired", () => {
    render(<RecoveryContinueForm hasLink retry={false} />);
    expect(screen.queryByText(/no longer valid|expired/i)).toBeNull();
  });

  it("disables the button after the first press, so a double click sends one request", () => {
    render(<RecoveryContinueForm hasLink retry={false} />);
    const button = screen.getByRole("button", { name: /continue to reset password/i });
    const form = button.closest("form")!;

    // jsdom does not navigate; the submit event is what matters.
    form.addEventListener("submit", (event) => event.preventDefault());
    fireEvent.submit(form);

    expect(screen.getByRole("button", { name: /opening/i })).toHaveProperty("disabled", true);
  });

  it("says the link is untouched when the previous attempt could not reach Supabase", () => {
    render(<RecoveryContinueForm hasLink retry />);
    expect(screen.getByText(/has not been used/i)).toBeTruthy();
  });
});

describe("with no held link", () => {
  it("offers a new link rather than a Continue button, without calling it expired", () => {
    render(<RecoveryContinueForm hasLink={false} retry={false} />);

    expect(screen.queryByRole("button", { name: /continue/i })).toBeNull();
    expect(screen.getByRole("link", { name: /request a new link/i }).getAttribute("href")).toBe(
      "/forgot-password",
    );
    expect(screen.queryByText(/expired/i)).toBeNull();
  });
});
