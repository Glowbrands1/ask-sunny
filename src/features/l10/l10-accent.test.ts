import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The DM L10 tab uses Ask Sunny's own yellow (the rail's active "DM L10" pill) instead of the Hub's gold and bronze (the
// owner's request, via QA, 15 Nov 2026), by re-pointing the accent tokens inside `.hub-l10` only (src/app/globals.css).
const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const start = css.indexOf("THE DM L10 TAB IN ASK SUNNY'S YELLOW");
// The section ends with the rule for the primary button's shadow.
const last = css.indexOf('[class*="rgb(138_106_15/0.6)"]', start);
const section = css.slice(start, css.indexOf("}", last) + 1);
const root = (name: string) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i"))![1];

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("DM L10 tab accent: Ask Sunny's yellow", () => {
  it("re-points the Hub's accent tokens inside .hub-l10 to Ask Sunny's tokens, with no new colour values", () => {
    expect(start).toBeGreaterThan(-1);
    const decl = (name: string) => section.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1].trim();
    expect(decl("--gold")).toBe("var(--approved-brand-yellow)");
    expect(decl("--color-gold-head")).toBe("var(--approved-brand-yellow)");
    expect(decl("--color-bronze")).toBe("var(--approved-yellow-label)");
    expect(decl("--color-bronze-deep")).toBe("var(--approved-yellow-label)");
    expect(decl("--color-sunny")).toBe("var(--approved-yellow-tint)");
    // The rail pill is the same yellow.
    expect(css).toMatch(/--sidebar-active:\s*var\(--approved-brand-yellow\);/);
    // Only the Hub's literal hover colour appears, in the selector that matches it; no colour is written as a hex value.
    expect(section.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\\\[\\#755a0c\\\]/g, "").match(/#[0-9a-f]{3,8}\b/gi)).toBeNull();
    // The primary button is a yellow fill with dark text, never white on yellow.
    expect(section).toMatch(/\.hub-l10 \.bg-bronze\.text-white \{\s*background-color: var\(--approved-brand-yellow\);\s*color: var\(--approved-yellow-ink\);/);
  });

  it("keeps text at 4.5:1 or more: dark text on the yellow, amber (not yellow) text on light surfaces", () => {
    const yellow = root("approved-brand-yellow");
    const yellowInk = root("approved-yellow-ink");
    const amber = root("approved-yellow-label");
    const tint = root("approved-yellow-tint");
    const card = root("approved-card");
    const canvas = root("approved-canvas");
    const clear = root("approved-clear-surface");
    const ink = "#0a0a0a";
    expect(contrast(yellowInk, yellow)).toBeGreaterThanOrEqual(4.5); // Start meeting, primary buttons
    expect(contrast(ink, yellow)).toBeGreaterThanOrEqual(4.5); // chips and pills
    expect(contrast(yellow, ink)).toBeGreaterThanOrEqual(4.5); // yellow text on the ink bar
    for (const bg of [card, canvas, tint, clear]) expect(contrast(amber, bg)).toBeGreaterThanOrEqual(4.5); // links, Clear, current item
    expect(contrast(yellow, card)).toBeLessThan(4.5); // why yellow is never text on a light background
  });
});
