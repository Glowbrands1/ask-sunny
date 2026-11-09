// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SunnyMascot } from "./sunny-mascot";

/**
 * The sign-in mascot is decoration: assistive technology must skip it, and two
 * copies on one screen (the card on small screens, the panel on large ones)
 * must not share gradient ids, or the second would paint with the first's fill.
 */
describe("SunnyMascot", () => {
  afterEach(cleanup);

  it("is hidden from assistive technology and not focusable", () => {
    const { container } = render(<SunnyMascot />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("focusable")).toBe("false");
  });

  it("gives each instance its own gradient ids", () => {
    const { container } = render(
      <>
        <SunnyMascot />
        <SunnyMascot />
      </>,
    );
    const ids = [...container.querySelectorAll("radialGradient")].map((g) => g.id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});
