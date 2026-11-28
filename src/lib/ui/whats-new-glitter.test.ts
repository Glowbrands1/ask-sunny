import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The sidebar's What's New button glitters (the owner, 28 Nov 2026: "can u add glitters animation here too?", for
 * both apps): three twinkling sparkles, nothing for a screen reader, and none under reduced motion.
 */
const css = readFileSync("src/app/globals.css", "utf8");
const sidebar = readFileSync("src/components/shell/sidebar.tsx", "utf8");

describe("What's New glitter", () => {
  it("the sidebar's What's New entry carries the glitter, and its third sparkle is hidden from screen readers", () => {
    expect(sidebar).toContain('item.whatsNew && "whats-new-glitter"');
    expect(sidebar).toMatch(/<span aria-hidden className="whats-new-glitter-third" \/>/);
  });

  it("twinkles with the What's New twinkle, white on the selected pill", () => {
    expect(css).toMatch(/\.whats-new-glitter::before,\s*\.whats-new-glitter::after,\s*\.whats-new-glitter-third \{[^}]*animation: whats-new-twinkle/);
    expect(css).toMatch(/\.whats-new-glitter\[aria-current="page"\]::before/);
  });

  it("is not shown under reduced motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.whats-new-glitter::before,\s*\.whats-new-glitter::after,\s*\.whats-new-glitter-third \{\s*animation: none;\s*opacity: 0;/);
  });
});
