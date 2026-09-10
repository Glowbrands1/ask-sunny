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

describe("every colour a component names actually exists", () => {
  /**
   * THE CHECK THAT WOULD HAVE CAUGHT A LIVE RENDERING FAULT.
   *
   * `ranked-bar-chart.tsx` painted its At Market bars with
   * `var(--stc-warm-tan-deep)` and drew its benchmark line with
   * `var(--stc-slate-deep)`. Both tokens were deleted when the approved palette
   * replaced the old brand ramp, and nothing said so: the file compiled, the
   * types were fine, lint was clean, and every other test passed.
   *
   * What it did instead is the part worth pinning. An unresolvable `var()` is
   * not a no-op with a fallback — in an SVG presentation attribute it is an
   * INVALID value, so recharts handed `fill="var(--stc-warm-tan-deep)"` to the
   * browser and the initial value took over. Every At Market bar on Bed Usage,
   * Spa Engagement and Spa Wellness rendered black, and the benchmark line
   * silently did not draw at all.
   *
   * A dead token is undetectable by eye on a page you have not opened — these
   * three reports need Supabase to render anything — which is exactly the kind
   * of defect a test is for.
   */
  it("resolves every var(--token) against globals.css", () => {
    const defined = new Set(
      [...GLOBALS.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((match) => match[1]),
    );

    const unresolved: string[] = [];
    for (const path of sourceFiles(SOURCE_DIR)) {
      if (path.endsWith("globals.css")) continue;
      const code = codeOf(path);
      /*
       * A file may declare its own custom property and read it back — the ask
       * bar sets one for its focus glow — so locally declared names count as
       * defined for that file and nowhere else.
       */
      const local = new Set(
        [...code.matchAll(/(?:^|["'{,\s])(--[a-z0-9-]+)\s*:/gim)].map((match) => match[1]),
      );
      for (const match of code.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        const token = match[1];
        if (defined.has(token) || local.has(token)) continue;
        unresolved.push(`${path} -> ${token}`);
      }
    }

    expect(
      unresolved,
      "a var() with no declaration is an invalid value, not a fallback",
    ).toEqual([]);
  });
});

describe("the approved direction is frozen", () => {
  /**
   * THE DESIGN IS SIGNED OFF. THIS IS THE PART THAT STOPS IT DRIFTING.
   *
   * "Freeze that design" is not a state a codebase can be left in by
   * intention alone — a token gets renamed during a refactor, a class gets
   * inlined, somebody needs one figure a little larger. So the decisions that
   * are actually settled are asserted here, and a later change to any of them
   * has to be a deliberate edit to this file rather than a side effect of
   * something else.
   *
   * The ARRANGEMENT of a page is not frozen — sections move, new blocks arrive.
   * What is frozen is the vocabulary those pages are built from.
   */

  it("keeps the two removed greens out, and green only on the good direction", () => {
    /*
     * GREEN MARKS THE GOOD DIRECTION, AND NOTHING ELSE.
     *
     * PREVIOUSLY NARROWER, AND DELIBERATELY WIDENED. This assertion used to
     * require that NO status colour resolve to a green — "a measure is neutral
     * until it is behind" — on the earlier freeze's reading. The three current
     * pinned Marquee artifacts supersede that, and they do it with a validator
     * rather than a preference:
     *
     *   - The Reports artifact's Bed Usage plate draws a four-state status
     *     ladder in which "Outperforming peers" is a filled green chip, and
     *     calls that vocabulary "the page's whole point".
     *   - The Google Reviews artifact reuses the SAME ladder on its leaderboard
     *     precisely so "a chip means the same thing wherever a DM sees it".
     *   - Both record the increase colour as #2f6b4f, validated at protan
     *     dE 9.6 against the coral, and reject the obvious #4f7a4c for failing
     *     at dE 6.7.
     *
     * So the rule the artifacts state is what is pinned here instead, and it is
     * still narrow: ONE green, spent only where the business has said which
     * direction is better. It is never a section colour, never a category
     * colour, and never a series identity — and a measure with no stated
     * direction is still neutral, which the `sentimentFor` test below enforces
     * at every site that paints.
     *
     * The two greens the direction removed BY NAME stay removed.
     */
    /*
     * Comments stripped first. `globals.css` explains WHY the sage is gone and
     * names it to do so, and a scan that counted that sentence would force the
     * reasoning to be deleted to keep the test green.
     */
    const declared = GLOBALS.replace(/\/\*[\s\S]*?\*\//g, "").toLowerCase();
    for (const green of ["#5c6559", "#4f7a4c"]) {
      expect(declared.includes(green), `${green} was removed from the system`).toBe(false);
    }

    // The one permitted green, and it is a DELTA DIRECTION, not a state.
    expect(GLOBALS).toContain("--delta-up: var(--approved-delta-up)");

    /*
     * THE INGESTION STATES AND THE SERIES RAMP STAY GREY.
     *
     * These are the ones the widening does NOT reach, and the distinction is
     * the whole point. `--status-ready` and `--status-processing` describe a
     * document's pipeline state, where nothing is "good" — a knowledge file
     * that finished indexing is not outperforming anything. The series tokens
     * carry ORDINAL identity, where a hue would assert a ranking the chart does
     * not have. A green on any of these is the decay this test exists to catch.
     */
    for (const token of [
      "--status-ready",
      "--status-processing",
      "--measure-series",
      "--measure-series-strong",
      "--measure-series-recessive",
    ]) {
      const value = new RegExp(`${token}:([^;]+);`).exec(GLOBALS)?.[1] ?? "";
      expect(value, `${token} is missing`).not.toBe("");
      expect(value, `${token} must not resolve to a green`).not.toContain("delta-up");
      expect(value, `${token} must not resolve to a green`).not.toContain(
        "outperforming",
      );
    }
    expect(/--status-ready:([^;]+);/.exec(GLOBALS)?.[1] ?? "").toContain(
      "--approved-ink-muted",
    );

    /*
     * ONE GREEN, SHARED. The delta arrow, the diverging bar and the
     * outperforming chip must resolve to the SAME value — the artifacts draw
     * one green and the reason a manager can learn it is that it never varies.
     */
    expect(GLOBALS).toContain("--approved-delta-up: #2f6b4f");
    expect(GLOBALS).toContain("--approved-outperforming: var(--approved-delta-up)");
  });

  it("holds the four-state status ladder, with a glyph on every rung", () => {
    /*
     * THE VOCABULARY THE REPORT TABS AND THE REVIEWS LEADERBOARD SHARE.
     *
     * Frozen because its value is entirely in being the same everywhere: the
     * moment Bed Usage and Google Reviews draw "behind" differently, a chip
     * stops being something a district manager can read at a glance.
     *
     * COLOUR IS NEVER THE ONLY CUE. Each rung carries a glyph and the state in
     * words, which is what makes the ladder survive greyscale, a printed L10
     * pack, and a reader who cannot separate the green from the coral — and it
     * is the reason the green/coral pair is usable at protan dE 9.6 at all.
     */
    for (const token of [
      "--status-outperforming:",
      "--status-at-market:",
      "--status-below-market:",
      "--status-under:",
      "--status-capacity:",
    ]) {
      expect(GLOBALS, `${token} is missing`).toContain(token);
    }

    const chip = codeOf(join(SOURCE_DIR, "components", "ui", "marquee.tsx"));
    expect(chip, "the ladder has no shared chip").toContain("StatusChip");
    for (const glyph of ["▲", "●", "▬", "▼", "◇"]) {
      expect(chip, `the ${glyph} rung lost its glyph`).toContain(glyph);
    }
  });

  it("puts the chart data on the coral and the benchmark on the near-black", () => {
    /*
     * THE OTHER DECISION THE CURRENT ARTIFACTS SUPERSEDED, and the one with the
     * most working shown. The previous freeze gave the series no hue at all —
     * a lightness ramp, on the argument that no hue was free. The Reports
     * artifact's validator table refused the near-black that ramp used for the
     * reading that mattered: it "failed both the lightness and chroma checks —
     * technically legible, but reading as grey rather than as a colour", while
     * #ef6079 passes all six.
     *
     * The rule that keeps coral from doing two jobs is pinned with it: the data
     * fill is its OWN token, so the follow-up colour stays available to the
     * test below that keeps it on follow-up surfaces only.
     */
    expect(GLOBALS).toContain("--approved-coral-data: #ef6079");
    expect(GLOBALS).toContain("--measure-data: var(--approved-coral-data)");
    expect(GLOBALS).toContain("--measure-benchmark: var(--approved-topbar)");

    const palette = codeOf(
      join(SOURCE_DIR, "features", "reports", "salon-performance", "chart-palette.ts"),
    );
    expect(palette).toContain('SERIES_PRIMARY = "var(--measure-data)"');
    // Yellow measures 1.47:1 on a light ground. It never encodes a value.
    expect(palette).not.toContain("brand-yellow");
  });

  it("spends the green only where a direction has actually been stated", () => {
    /*
     * THE FAILURE MODE GREEN REINTRODUCES. `higher_is_better` is null for some
     * measures, and a green arrow on one of those is the app asserting a
     * judgement the business has not made — a rise in a cost measure painted as
     * good news. So every file that uses the token has to reach it through
     * `sentimentFor`, which returns "neutral" for a null direction.
     */
    /*
     * ONE EXEMPTION, AND IT IS THE DEFINITION SITE — the same shape as the
     * `badge.tsx` exemption in the follow-up-colour test below.
     *
     * `chart-palette.ts` NAMES the increase colour so the charts have one place
     * to reach for it; it does not decide when the colour applies, and it
     * renders nothing. Requiring `sentimentFor` in a module with no measure and
     * no row would mean either a meaningless reference or the palette inlined
     * back into each chart, which is what the file exists to prevent.
     *
     * The guarantee is unchanged for everything that actually paints: the
     * movers chart, the KPI rows, the per-salon rows and the comparison table
     * all still have to ask.
     */
    const definitionSite = join(
      "features",
      "reports",
      "salon-performance",
      "chart-palette.ts",
    );

    const users = sourceFiles(SOURCE_DIR)
      .filter((path) => !path.endsWith("globals.css"))
      .filter((path) => /text-delta-up|--delta-up/.test(codeOf(path)));

    expect(users.length, "a token nobody uses is not a design system").toBeGreaterThan(0);

    const painters = users.filter((path) => !path.endsWith(definitionSite));
    expect(
      painters.length,
      "the palette cannot be the only file that knows the increase colour",
    ).toBeGreaterThan(0);

    for (const path of painters) {
      expect(
        codeOf(path),
        `${path} colours a delta green without asking sentimentFor`,
      ).toMatch(/sentimentFor|sentiment ===/);
    }
  });

  it("holds the display vocabulary the direction is drawn in", () => {
    /*
     * These five classes ARE the direction: the display face on headings, the
     * same face with tighter leading on figures, the wide-tracked wordmark, the
     * tiny all-caps eyebrow, and the pill the actions are drawn as. Components
     * reference them by name, so a rename is a silent unstyling — every one of
     * them would still compile and still render, just as unstyled text.
     */
    for (const rule of [
      ".display {",
      ".display-figure {",
      ".wordmark {",
      ".eyebrow {",
      ".pill-action {",
      ".stat-cell {",
      ".stat-grid {",
    ]) {
      expect(GLOBALS, `${rule} is missing`).toContain(rule);
    }

    // The display face is uppercase with POSITIVE tracking and leading at or
    // under 1 — the thing that lets a figure out-rank a larger heading.
    const display = /\.display \{([^}]+)\}/.exec(GLOBALS)?.[1] ?? "";
    expect(display).toContain("text-transform: uppercase");
    expect(display).toMatch(/letter-spacing:\s*0\.0\d+em/);
    expect(display).toMatch(/line-height:\s*(1|0\.\d+)/);

    // Figures hold their column when the value changes.
    const figure = /\.display-figure \{([^}]+)\}/.exec(GLOBALS)?.[1] ?? "";
    expect(figure).toContain("tabular-nums");
  });

  it("keeps the settled token meanings pointed where they were signed off", () => {
    for (const decision of [
      // The primary action is the near-black, on white. Never the coral.
      "--primary: var(--approved-topbar)",
      // Yellow is the accent and the focus ring; it replaced the sage.
      "--accent: var(--approved-brand-yellow)",
      "--ring: var(--approved-brand-yellow)",
      // The flag: coral fill, deeper coral ink.
      "--measure-flagged: var(--approved-followup)",
      "--measure-flagged-foreground: var(--approved-attention-ink)",
      /*
       * The ORDINAL ramp still carries no hue, and this is now the narrower
       * claim it always should have been: a recessive baseline and a neutral
       * two-period series vary in lightness. The DATA fill is the coral, and it
       * is pinned separately above.
       */
      "--measure-series: var(--approved-ink-muted)",
    ]) {
      expect(GLOBALS, `${decision} moved`).toContain(decision);
    }
  });

  it("never lets the coral become a primary action", () => {
    /*
     * Stated explicitly in the sign-off: the coral is a flag and an alarm, and
     * pressing must not look like alarming. So no button variant and no
     * pill-action default may fill with it.
     */
    const button = codeOf(join(SOURCE_DIR, "components", "ui", "button.tsx"));
    for (const fill of ["bg-followup-attention", "bg-measure-flagged"]) {
      expect(button, `${fill} is not a button fill`).not.toContain(fill);
    }
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

  it("puts the dark bar in the SHELL, not on one page", () => {
    /*
     * A top bar that only appears on the reporting pages makes reporting look
     * like a different product. It belongs to the shell, above both the rail
     * and the content.
     *
     * It is the CHROME depth rather than the band's. The Marquee direction
     * separates the two — the band is #1c1f29 with real area on the Overview,
     * and the bar above it sits one step deeper at #12141c — so the shell's bar
     * is `bg-chrome` and `--topbar` no longer paints it.
     */
    expect(APP_SHELL).toContain("bg-chrome");
    expect(APP_SHELL).toContain("<header");

    const reportingPages = sourceFiles(join(SOURCE_DIR, "app")).filter((path) =>
      path.includes("reports"),
    );
    const localBars = reportingPages.filter((path) =>
      /bg-(chrome|topbar|band)\b/.test(codeOf(path)),
    );
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
     * read as "still dark" rather than as a state change at all. Hover now
     * lands on the canvas, which is also where every button hover lands.
     *
     * Asserted through the TOKEN rather than the hex, because that is the thing
     * that keeps the two in step: a component that hard-codes #fff6f0 passes a
     * colour check and still drifts the next time the canvas moves.
     */
    expect(GLOBALS).toContain("--hover-surface: var(--approved-canvas)");

    /*
     * THE SELECTED RAIL ITEM IS THE YELLOW PILL, NOT THE CANVAS.
     *
     * This assertion previously required the canvas here too, from the earlier
     * storefront direction. The Marquee direction supersedes it and is explicit
     * about why: the rail keeps exactly ONE colour and spends it on "the yellow
     * pill that says where you are".
     *
     * That also finishes the fix this test was written for. Hover and selected
     * were both the canvas, so the two states were still hard to tell apart —
     * the original complaint in a quieter form. Hover is the canvas and
     * selected is the yellow, which cannot be confused, and the pair is
     * asserted together so neither can drift back onto the other.
     */
    expect(GLOBALS).toContain("--sidebar-active: var(--approved-brand-yellow)");
    expect(GLOBALS).toContain(
      "--sidebar-active-foreground: var(--approved-yellow-ink)",
    );

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
     * `--sidebar-active` is the pale pill that reads against the GREY rail, and
     * the chat list had borrowed it for a selected conversation sitting on
     * white, where the same colour is invisible. THAT PROHIBITION STANDS and is
     * the half of this test that matters.
     *
     * WHAT THE MARQUEE CHAT ARTIFACT CHANGED. The remedy used to be
     * `bg-selected-soft` — the warm neutral fill every generic selected control
     * takes. The artifact marks the open thread with a YELLOW LEFT EDGE on the
     * white card instead, and its reasoning is that this is a "where you are"
     * marker rather than a generic selection: the same job as the rail pill and
     * the active report tab underline, which are the two other places the
     * direction spends yellow. The card also keeps its shape when selected,
     * which a fill changes.
     *
     * So the assertion follows the treatment rather than the token, and the
     * thing it was written to prevent — the invisible pale pill on white — is
     * still pinned.
     */
    const chat = codeOf(join(SOURCE_DIR, "features", "chat", "conversation-list.tsx"));
    expect(chat).not.toContain("bg-sidebar-active");
    expect(chat).toContain("border-l-brand-yellow");
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
