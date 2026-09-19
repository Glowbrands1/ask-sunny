import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * THE OPEN FILTER MENU HAS TO BE READABLE, AND IT IS THE BROWSER THAT DRAWS IT
 * ============================================================================
 *
 * THE DEFECT THIS SUITE EXISTS TO PREVENT. Every filter pill on Google Reviews
 * draws its own capsule and lays a transparent `<select>` across the whole of
 * it. A pill that is actually filtering something takes the dark Ask Sunny
 * capsule with white text — `bg-selected text-selected-foreground` — and `color`
 * INHERITS, so the select and every `<option>` inside it inherited white. The
 * browser paints its own popup on white under `color-scheme: light`, so opening
 * the menu after choosing a location showed the chosen one (the browser draws
 * that row in its own highlight) and nothing else. Measured in Chromium against
 * the app's compiled stylesheet: 14 of 14 options at 1.00:1, then 17.76:1.
 *
 * JSDOM CANNOT REPRODUCE IT. It has no popup and no `color-scheme`, so an
 * assertion about what the open menu looks like would pass here whatever the
 * stylesheet said. The visual check belongs in a browser and was done in one.
 *
 * WHAT IS WORTH PINNING HERE is the thing the browser run cannot protect: that
 * the correction stays SHARED and stays out of the individual pills. Three
 * components render this pattern and a fourth is the ordinary form control; a
 * fix pasted into one of them would leave the others to fail again the next
 * time somebody adds a filter, which is exactly how this shipped.
 */

const globals = readFileSync("src/app/globals.css", "utf8");

/** The components whose selects rely on the shared rule below. */
const PILL_SELECTS = [
  "src/features/reviews/reviews-filter-bar.tsx",
  "src/features/reviews/reviews-leaderboard.tsx",
  "src/features/reviews/reviews-demo-screen.tsx",
];

describe("the native select menu states its own colours", () => {
  it("colours the option text in the stylesheet rather than by inheritance", () => {
    /*
     * ON THE ELEMENT AND ON THE OPTION BOTH. The `color` on `select` is what
     * every engine hands down to an option; the `option` rule states the
     * background where the engine honours author colours in the popup.
     */
    expect(globals).toMatch(/\bselect\s*\{[^}]*color:\s*var\(--foreground\)/);
    expect(globals).toMatch(/\bselect option\s*\{[^}]*color:\s*var\(--foreground\)/);
    expect(globals).toMatch(
      /\bselect option\s*\{[^}]*background-color:\s*var\(--surface\)/,
    );
  });

  it("keeps the correction in one place, not pasted into each filter bar", () => {
    for (const file of PILL_SELECTS) {
      const source = readFileSync(file, "utf8");

      /*
       * THE PILL IS STILL THE TRANSPARENT OVERLAY, which is what makes the
       * shared rule necessary: an `opacity-0` select over a dark capsule is
       * invisible itself and hands its inherited colour to the popup.
       */
      expect(source).toContain("appearance-none opacity-0");

      /*
       * AND IT STILL SETS NO COLOUR OF ITS OWN. A `text-*` utility on one of
       * these selects would be a local answer to a shared problem — it would
       * win over the base rule for that one control and leave every other
       * select in the app depending on a fix nobody could see from here.
       */
      const selects = source.match(/<select[\s\S]*?>/g) ?? [];
      expect(selects.length).toBeGreaterThan(0);
      for (const element of selects) {
        expect(element).not.toMatch(/className="[^"]*\btext-(selected-foreground|white)\b/);
      }
    }
  });

  it("leaves the closed pill its dark Ask Sunny styling", () => {
    /*
     * THE FIX IS ABOUT THE OPEN MENU ONLY. An active pill is still the dark
     * capsule with white text; that was never the defect, and changing it would
     * be this correction quietly redesigning the toolbar.
     */
    const bar = readFileSync("src/features/reviews/reviews-filter-bar.tsx", "utf8");
    expect(bar).toContain("border-selected bg-selected text-selected-foreground");
  });
});
