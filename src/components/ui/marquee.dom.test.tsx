// @vitest-environment jsdom
import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BareList, SectionRule } from "./marquee";

afterEach(cleanup);

/*
 * THE SECTION LINKS ARE AT LEAST 24PX TO TAP. They are eyebrow text — about
 * 10px of type — and on a phone the link was exactly that high. jsdom does no
 * layout, so the sizing class is what can be pinned (min-h-6 is 24px).
 */
describe("section action links", () => {
  it("SectionRule's link", () => {
    render(<SectionRule label="Forms" action={{ label: "View all", href: "/forms" }} />);
    expect(screen.getByRole("link", { name: /view all/i }).className).toMatch(/\bmin-h-6\b/);
  });

  it("BareList's link", () => {
    render(
      <BareList label="Recent" action={{ label: "Open", href: "/history" }}>
        <li>One</li>
      </BareList>,
    );
    expect(screen.getByRole("link", { name: /open/i }).className).toMatch(/\bmin-h-6\b/);
  });
});
