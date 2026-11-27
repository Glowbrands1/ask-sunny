// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NotAttendee } from "./NotAttendee";

afterEach(() => cleanup());

describe("a meeting page for someone who is not an attendee (the owner, 27 Nov 2026)", () => {
  it('shows only "You are not an attendee of this meeting"', () => {
    render(<NotAttendee />);
    expect(screen.getByRole("alert").textContent).toBe("You are not an attendee of this meeting");
  });
});
