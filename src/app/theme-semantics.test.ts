import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ============================================================================
 * COLOUR HAS TO KEEP MEANING SOMETHING
 * ============================================================================
 *
 * The approved palette was signed off on the condition that colours correlate
 * with categories and states across the app, rather than being applied for
 * decoration. Curt's example was explicit: the pink on "4 follow-ups need
 * attention" should mean that same thing everywhere it appears.
 *
 * A convention like that decays quietly. Somebody needs a card to stand out,
 * reaches for the nearest accent, and a month later pink means nothing. These
 * tests are the mechanism that stops it, and they check two separate things:
 *
 *   1. THE TOKENS EXIST AND HOLD THE APPROVED VALUES, so a "tidy-up" cannot
 *      quietly shift the hue.
 *   2. THE FOLLOW-UP COLOUR IS ONLY USED ON FOLLOW-UP SURFACES. This is the
 *      one that will actually fire one day.
 */

const SOURCE_DIR = join(process.cwd(), "src");
const GLOBALS = readFileSync(join(SOURCE_DIR, "app", "globals.css"), "utf8");

/** The approved values, from the signed-off storefront direction. */
const APPROVED = {
  "--approved-topbar": "#1c1f29",
  "--approved-rail": "#b2aeaa",
  "--approved-brand-yellow": "#ffcc00",
  "--approved-followup": "#ef6079",
  "--approved-redlight": "#d62c3a",
  "--approved-canvas": "#fff6f0",
} as const;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      sourceFiles(path, out);
    } else if (/\.(ts|tsx|css)$/.test(entry) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      out.push(path);
    }
  }
  return out;
}

/** Code with comments stripped, so prose cannot satisfy or fail an assertion. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

describe("the approved palette is present and unaltered", () => {
  it("defines every approved colour as a raw token", () => {
    for (const [token, value] of Object.entries(APPROVED)) {
      expect(GLOBALS, `${token} is missing`).toContain(`${token}: ${value}`);
    }
  });

  it("gives each one a semantic alias, so components never use the raw value", () => {
    /*
     * The two-layer rule: raw tokens hold values, semantic tokens hold
     * meanings, and components may only see meanings. A component using
     * `--approved-followup` directly would survive a palette change but not a
     * change of MEANING, which is the thing more likely to happen.
     */
    for (const alias of [
      "--followup-attention:",
      "--wellness-redlight:",
      "--brand-yellow:",
      "--topbar:",
      "--rail:",
    ]) {
      expect(GLOBALS, `${alias} is missing`).toContain(alias);
    }
  });

  it("keeps raw approved tokens out of every component", () => {
    const offenders = sourceFiles(SOURCE_DIR)
      .filter((path) => !path.endsWith("globals.css"))
      .filter((path) => /--approved-/.test(codeOf(path)));

    expect(offenders, "components must use semantic tokens, not raw palette values").toEqual([]);
  });

  it("keeps the literal hex values out of every component", () => {
    /*
     * A hardcoded #ef6079 is the same defect as using the raw token, minus the
     * traceability.
     *
     * ONE LEGITIMATE EXCEPTION, and it is a platform limitation rather than a
     * shortcut: `<meta name="theme-color">` is read by the browser before any
     * stylesheet is parsed, so it cannot resolve a CSS variable. The canvas
     * colour therefore appears literally in the viewport metadata, and it is
     * asserted to be the canvas — a DIFFERENT literal there would mean the
     * browser chrome no longer matches the page it frames.
     */
    const literals = Object.values(APPROVED);
    const offenders = sourceFiles(SOURCE_DIR)
      .filter((path) => !path.endsWith("globals.css"))
      .filter((path) => {
        const code = codeOf(path).toLowerCase();
        const found = literals.filter((value) => code.includes(value));
        if (found.length === 0) return false;
        // Permitted only as the theme-color, and only the canvas.
        if (path.endsWith(join("app", "layout.tsx"))) {
          return !(
            found.length === 1 &&
            found[0] === APPROVED["--approved-canvas"] &&
            new RegExp(`themecolor:\\s*"${APPROVED["--approved-canvas"]}"`, "i").test(code)
          );
        }
        return true;
      });

    expect(offenders, "colours belong in globals.css, not inline").toEqual([]);
  });
});

describe("the follow-up colour means follow-ups", () => {
  /** Every non-test file that mentions the follow-up colour in code. */
  function usesFollowupColour(): string[] {
    return sourceFiles(SOURCE_DIR)
      .filter((path) => !path.endsWith("globals.css"))
      .filter((path) => /followup-attention/.test(codeOf(path)));
  }

  it("is used somewhere — a token nobody uses is not a design system", () => {
    expect(usesFollowupColour().length).toBeGreaterThan(0);
  });

  it("appears ONLY on files that deal with follow-ups", () => {
    /*
     * THE TEST THAT MATTERS. Any file painting something with the follow-up
     * colour must also be about follow-ups — overdue, late, due. A sales
     * dashboard reaching for it fails here, which is exactly the drift the
     * palette was approved on condition of avoiding.
     *
     * `badge.tsx` is allowed as the shared definition of the tone; every other
     * user has to justify itself by its own content.
     */
    const allowedDefinition = join("components", "ui", "badge.tsx");

    for (const path of usesFollowupColour()) {
      if (path.endsWith(allowedDefinition)) continue;
      const code = codeOf(path).toLowerCase();
      const aboutFollowUps =
        /follow-?up/.test(code) || /overdue/.test(code) || /needsattention/.test(code);
      expect(
        aboutFollowUps,
        `${path} uses the follow-up colour but is not about follow-ups`,
      ).toBe(true);
    }
  });

  it("is not applied to any reporting surface", () => {
    /*
     * Named explicitly because reporting is where the temptation is greatest —
     * a revenue figure that "needs attention" is a judgement the data does not
     * make, and colouring it pink would claim somebody has to act on it.
     */
    const reporting = sourceFiles(join(SOURCE_DIR, "features", "reports")).concat(
      sourceFiles(join(SOURCE_DIR, "lib", "reporting")),
    );
    const offenders = reporting.filter((path) => /followup-attention/.test(codeOf(path)));
    expect(offenders, "sales figures are not follow-ups").toEqual([]);
  });
});

describe("typography keeps the display face out of body copy", () => {
  it("loads both approved faces plus a UI stack", () => {
    const layout = readFileSync(join(SOURCE_DIR, "app", "layout.tsx"), "utf8");
    expect(layout).toContain("Passion_One");
    expect(layout).toContain("Lato");
    // Through next/font, so the files are self-hosted at build time rather
    // than fetched from a third party at runtime.
    expect(layout).toContain("next/font/google");
    expect(layout).toContain('display: "swap"');
  });

  it("drives UI text with the readable face, not the display one", () => {
    /*
     * Passion One is a display face: superb in a heading, genuinely hard to
     * read below about 16px. `--font-sans` is what body copy, labels and table
     * cells resolve to, so it must never point at it.
     */
    const sans = /--font-sans:([^;]+);/.exec(GLOBALS)?.[1] ?? "";
    expect(sans).toContain("--font-lato");
    expect(sans).not.toContain("passion");

    const display = /--font-display:([^;]+);/.exec(GLOBALS)?.[1] ?? "";
    expect(display).toContain("--font-passion-one");
  });

  it("gives every face a real fallback stack", () => {
    // So text is readable while a webfont loads, rather than invisible.
    for (const token of ["--font-sans", "--font-display"]) {
      const stack = new RegExp(`${token}:([^;]+);`).exec(GLOBALS)?.[1] ?? "";
      expect(stack, `${token} has no fallback`).toMatch(/sans-serif|system-ui/);
    }
  });
});

describe("the mockup's placeholder content was not built", () => {
  it("has no Equipment section", () => {
    /*
     * The storefront mockup showed an equipment panel with beds and filters. It
     * was established in the meeting that equipment was an EXAMPLE — the data
     * lives in another system and none of it exists here. Building it would
     * have meant inventing readings, so the mockup's visual direction was
     * taken and its placeholder content was not.
     */
    /*
     * Checked STRUCTURALLY rather than by vocabulary. Words like "spray booth"
     * and "massage bed" are real services and appear legitimately in seeded
     * knowledge articles, videos and chat answers — a keyword scan flags those
     * and says nothing about whether an equipment FEATURE was built. What
     * matters is that no equipment surface exists: no component, no route, and
     * nothing on the Overview.
     */
    const equipmentModules = sourceFiles(SOURCE_DIR).filter((path) =>
      /equipment/i.test(path),
    );
    expect(equipmentModules, "no equipment component or route").toEqual([]);

    const overview = codeOf(join(SOURCE_DIR, "features", "dashboard", "overview.tsx"));
    expect(/equipment/i.test(overview), "no equipment panel on the Overview").toBe(false);

    // And no equipment status vocabulary in any COMPONENT, which is where a
    // fabricated panel would have to live.
    const components = sourceFiles(join(SOURCE_DIR, "features")).concat(
      sourceFiles(join(SOURCE_DIR, "components")),
    );
    const fabricated = components.filter((path) =>
      /needs service|filter due|Red Light Bed/i.test(codeOf(path)),
    );
    expect(fabricated, "equipment readings were never invented").toEqual([]);
  });
});

describe("the Ask Sunny brand", () => {
  const APP_SHELL = readFileSync(join(SOURCE_DIR, "components", "shell", "app-shell.tsx"), "utf8");
  const BRAND = readFileSync(join(SOURCE_DIR, "components", "brand-mark.tsx"), "utf8");

  it("puts the navy bar in the SHELL, not on one page", () => {
    /*
     * A top bar that only appears on the reporting pages makes reporting look
     * like a different product. It belongs to the shell, above both the rail
     * and the content.
     */
    expect(APP_SHELL).toContain("bg-topbar");
    expect(APP_SHELL).toContain("<header");

    const reportingPages = sourceFiles(join(SOURCE_DIR, "app")).filter((path) =>
      path.includes("reports"),
    );
    const localBars = reportingPages.filter((path) => /bg-topbar/.test(codeOf(path)));
    expect(localBars, "the top bar is the shell's, not a page's").toEqual([]);
  });

  it("draws the sun as a vector, never an emoji", () => {
    /*
     * An emoji renders as whatever the viewer's OS ships — a different sun on
     * macOS, Windows and Android, none of them the brand colour, and it cannot
     * be recoloured at all.
     */
    expect(BRAND).toContain("<svg");
    expect(BRAND).not.toMatch(/[\u2600\u2601\u{1F31E}\u{1F31F}\u{2604}]/u);
  });

  it("colours the sun and SUNNY with the brand yellow", () => {
    expect(BRAND).toContain("var(--brand-yellow)");
    expect(BRAND).toContain("text-brand-yellow");
  });

  it("keeps ASK legible against the navy", () => {
    // Not `--foreground`, which is near-black and would vanish on the bar.
    expect(BRAND).toContain("text-topbar-foreground");
  });

  it("shows one wordmark at a time", () => {
    /*
     * The sidebar used to carry the wordmark. With a top bar above it that
     * would be two Ask Sunny marks on one screen, so the sidebar's is now the
     * drawer's only — the drawer slides over the content with no bar above it.
     */
    const sidebar = readFileSync(join(SOURCE_DIR, "components", "shell", "sidebar.tsx"), "utf8");
    expect(sidebar).toContain('variant === "desktop" && "hidden"');
  });

  it("uses navy for GENERIC selected state, and only for that", () => {
    /*
     * The rule from the brief: generic active UI is navy, and the semantic
     * colours keep their meanings. A selected filter is a UI state; an overdue
     * follow-up is a category.
     */
    expect(GLOBALS).toContain("--selected: var(--approved-topbar)");

    const button = readFileSync(join(SOURCE_DIR, "components", "ui", "button.tsx"), "utf8");
    expect(button).toContain("bg-selected");

    // And the selected colour is NOT the follow-up pink or the wellness red.
    const selected = /--selected:([^;]+);/.exec(GLOBALS)?.[1] ?? "";
    expect(selected).not.toContain("followup");
    expect(selected).not.toContain("redlight");
  });

  it("lands every hover on the approved canvas, from one token", () => {
    /*
     * REPORTED TWICE, so it is pinned here. The rail's hovered and selected
     * items used to be #c4c0bc — a grey one shade off the #b2aeaa rail — which
     * read as "still dark" rather than as a state change at all. Both now land
     * on the canvas, which is also where every button hover lands.
     *
     * Asserted through the TOKEN rather than the hex, because that is the thing
     * that keeps the two in step: a component that hard-codes #fff6f0 passes a
     * colour check and still drifts the next time the canvas moves.
     */
    expect(GLOBALS).toContain("--hover-surface: var(--approved-canvas)");
    expect(GLOBALS).toContain("--sidebar-active: var(--approved-canvas)");

    const button = readFileSync(join(SOURCE_DIR, "components", "ui", "button.tsx"), "utf8");
    const sidebar = codeOf(join(SOURCE_DIR, "components", "shell", "sidebar.tsx"));

    /*
     * EVERY VARIANT, checked one by one rather than by counting occurrences.
     * The first version of this test counted matches against the number of
     * keys it found, and its regex swept up the `size:` group's keys too — so
     * it failed on correct code. Parsing the `variant` group and naming the one
     * legitimate exception is the assertion that actually means something.
     *
     * `link` is that exception: it is text with an underline, not a surface, so
     * it has no background to hover.
     */
    const variantGroup = /variant:\s*\{([\s\S]*?)\n      \},/.exec(button)?.[1] ?? "";
    expect(variantGroup).not.toBe("");
    const entries = [
      ...variantGroup.matchAll(/^\s{8}(\w+):\s*(?:\n\s+)?((?:"[^"]*")+)/gm),
    ].map((m) => ({ name: m[1], classes: m[2] }));
    expect(entries.map((e) => e.name)).toEqual([
      "primary",
      "secondary",
      "accent",
      "soft",
      "ghost",
      "outline",
      "destructive",
      "link",
    ]);
    for (const entry of entries) {
      if (entry.name === "link") continue;
      expect(entry.classes, `${entry.name} must hover to the canvas`).toContain(
        "hover:bg-hover-surface",
      );
    }

    // The rail: hover on the unselected branch, the token on the selected one.
    expect(sidebar).toContain("hover:bg-hover-surface");
    expect(sidebar).toContain("bg-sidebar-active");
    // Nothing left mixing the old grey down to a near-invisible wash.
    expect(sidebar).not.toContain("var(--sidebar-active)_55%");
  });

  it("keeps the rail's pill off surfaces it would vanish against", () => {
    /*
     * `--sidebar-active` is the pale pill that reads against the GREY rail. The
     * chat list had borrowed it for a selected conversation sitting on white,
     * where the same colour is invisible — so that one reads navy, like every
     * other generic selected control.
     */
    const chat = codeOf(join(SOURCE_DIR, "features", "chat", "conversation-list.tsx"));
    expect(chat).not.toContain("bg-sidebar-active");
    expect(chat).toContain("bg-selected-soft");
  });

  it("leaves the chart series on the data colour, not the selection colour", () => {
    /*
     * Bars encode DATA. Painting them with the selected-state navy would say
     * every bar is selected, and would make the one genuinely selected control
     * on the page indistinguishable from the chart.
     */
    const palette = readFileSync(
      join(SOURCE_DIR, "features", "reports", "salon-performance", "chart-palette.ts"),
      "utf8",
    );
    expect(palette).not.toContain("--selected");
  });
});
