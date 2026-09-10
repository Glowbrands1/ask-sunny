import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  chatReportContextFromParams,
  REPORT_CONTEXT_PARAMS,
} from "@/lib/reporting/read/chat-report-context";
import { REPORT_FAMILIES, REPORT_FAMILY_IDS } from "@/lib/reporting/read/report-families";
import { REPORTS } from "./reports-routes";

/**
 * ============================================================================
 * THE ACTION IS ON ALL FIVE TABS, AND IT SENDS NO NUMBERS
 * ============================================================================
 *
 * A source scan rather than a render, deliberately, because what is being
 * checked is not what the button looks like — it is that every page wires it,
 * wires its OWN family, and hands it pointers. A render test would pass on four
 * pages and say nothing about the fifth.
 *
 * The component itself is a server component rendering a `next/link`, so there
 * is no client behaviour to exercise: the whole of its logic is which query
 * string it builds.
 */

const COMPONENT = readFileSync(
  "src/features/reports/ask-sunny-about-report.tsx",
  "utf8",
);

/** Each family, its page, and the family id that page must pass. */
const PAGES: { family: string; path: string }[] = REPORT_FAMILIES.map((family) => ({
  family: family.id,
  path: `src/app/(app)/reports/${family.id}/page.tsx`,
}));

describe("every report tab offers the action", () => {
  it("covers all five families, and the registry matches the routes", () => {
    expect(PAGES).toHaveLength(5);
    // The registry and the tab strip must agree about which reports exist, or a
    // tab appears with no action or an action points at a family with no tab.
    expect(new Set(REPORTS.map((report) => report.key))).toEqual(
      new Set(REPORT_FAMILY_IDS),
    );
  });

  for (const { family, path } of PAGES) {
    it(`${family} imports and renders it`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain(
        'from "@/features/reports/ask-sunny-about-report"',
      );
      expect(source).toContain("<AskSunnyAboutReport");
    });

    it(`${family} passes its own family and no other`, () => {
      const source = readFileSync(path, "utf8");
      expect(source).toContain(`family: "${family}"`);
      for (const other of REPORT_FAMILY_IDS.filter((id) => id !== family)) {
        expect(source, `${path} must not name ${other}`).not.toContain(
          `family: "${other}"`,
        );
      }
    });

    it(`${family} passes a period pointer, so the server reads the view on screen`, () => {
      const source = readFileSync(path, "utf8");
      const call = source.slice(
        source.indexOf("<AskSunnyAboutReport"),
        source.indexOf("/>", source.indexOf("<AskSunnyAboutReport")),
      );
      expect(call).toContain("period:");
      expect(call).toContain("salons:");
      expect(call).toContain("districts:");
      expect(call).toContain("metric:");
    });
  }
});

describe("the action sends pointers, never figures", () => {
  it("has no prop through which a figure could arrive", () => {
    /*
     * THE PROPERTY THE WHOLE FEATURE RESTS ON. Everything on a report screen
     * was formatted by a browser and a browser is not a source of truth about
     * money: a stale render, an edited DOM and a replayed response all look
     * identical. So the component takes the whole `ChatReportContext` — a type
     * with nowhere to put a number — and nothing else but a class name.
     */
    const props = COMPONENT.slice(
      COMPONENT.indexOf("export function AskSunnyAboutReport({"),
      COMPONENT.indexOf("}) {", COMPONENT.indexOf("export function AskSunnyAboutReport({")),
    );
    expect(props).toContain("context: ChatReportContext");
    for (const word of ["value", "figures", "total", "rows", "snapshot", "kpis"]) {
      expect(props, `a pointer-only control must not take "${word}"`).not.toContain(
        `${word}:`,
      );
    }
  });

  it("builds the link from the shared serializer, not by hand", () => {
    // One place decides the parameter names, so the reader and the writer
    // cannot drift apart.
    expect(COMPONENT).toContain("chatReportContextToParams(context)");
  });

  it("seeds an opening question for each family, and never asks for a summary", () => {
    /*
     * A summary is a metric dump, and the framework's first operating rule is
     * that a number is a behaviour signal. Each opening question is the one a
     * manager standing in front of that dashboard actually has.
     */
    const map = COMPONENT.slice(
      COMPONENT.indexOf("const OPENING_QUESTION"),
      COMPONENT.indexOf("};", COMPONENT.indexOf("const OPENING_QUESTION")),
    );

    /*
     * The QUESTIONS, not the block they sit in. The block's own comment
     * explains at length why a summary is the wrong thing to ask for, so
     * scanning the block would match the reasoning rather than the strings.
     */
    const questions = [...map.matchAll(/"Looking at this [^"]+"/g)].map((m) => m[0]);
    expect(questions).toHaveLength(REPORT_FAMILY_IDS.length);
    for (const family of REPORT_FAMILY_IDS) {
      expect(map, `no opening question for ${family}`).toContain(`"${family}":`);
    }
    for (const question of questions) {
      expect(question.toLowerCase(), question).not.toContain("summarise");
      expect(question.toLowerCase(), question).not.toContain("summarize");
    }
    expect(COMPONENT).toContain('params.set("q"');
  });
});

describe("the link a tab produces is readable back as the same context", () => {
  it("round-trips through the chat URL", () => {
    /*
     * The component builds `?report=...&period=...` and the chat screen reads it
     * with `chatReportContextFromParams`. Asserted here on a URL of the shape
     * the component produces, so the two halves cannot drift.
     */
    const params = new URLSearchParams();
    params.set(REPORT_CONTEXT_PARAMS.family, "bed-usage");
    params.set(REPORT_CONTEXT_PARAMS.period, "mtd:2026-08-31");
    params.append(REPORT_CONTEXT_PARAMS.district, "Cotton, Sarah");
    params.append(REPORT_CONTEXT_PARAMS.salon, "0123");
    params.set(REPORT_CONTEXT_PARAMS.metric, "vChain");
    params.set("q", "Looking at this Bed Usage view, how are our beds performing?");

    const context = chatReportContextFromParams(params);
    expect(context).toEqual({
      family: "bed-usage",
      period: "mtd:2026-08-31",
      window: null,
      salons: ["0123"],
      districts: ["Cotton, Sarah"],
      metric: "vChain",
      view: null,
    });
  });
});

describe("the frame places the action, and withholds it from a failed report", () => {
  const FRAME = readFileSync("src/features/reports/report-frame.tsx", "utf8");

  it("takes the action as a slot rather than knowing the filters", () => {
    expect(FRAME).toContain("action?: ReactNode");
    /*
     * IT REACHES THE BAND, which is where the current Marquee Reports artifact
     * puts it: a full-width ask bar inside the near-black strip rather than a
     * pill in a light page header's action slot. Still a SLOT — the frame hands
     * the node straight through and never learns the filter state, which is the
     * property this test exists to pin.
     */
    expect(FRAME).toContain("action={action}");
    expect(FRAME).toContain("<ReportBand");
  });

  it("puts the provenance chips in the band as a slot too", () => {
    /*
     * The artifact's second punch-list item: the period, the salon count, the
     * recipient-slice warning and the load time become chips beside the title,
     * "the reason anyone trusts a number they are about to quote in an L10".
     *
     * A SLOT for the same reason the action is one. The three report families
     * keep provenance in three different shapes and the frame has no business
     * learning any of them; what it guarantees is the position.
     */
    expect(FRAME).toContain("provenance?: ReactNode");
    expect(FRAME).toContain("provenance={provenance}");
  });

  it("keeps the filter row out of the frame's knowledge, and never sticky", () => {
    /*
     * The artifact flags a pinned filter row as a defect at phone width — it
     * eats a third of the viewport on controls the reader has already set — so
     * the row scrolls away with the page.
     */
    expect(FRAME).toContain("filters?: ReactNode");
    expect(FRAME).not.toMatch(/\bsticky\b/);
  });

  it("is optional, so the loading and unavailable states render without it", () => {
    /*
     * Those states render through the same frame, and a control offering to
     * discuss a report that failed to load would send the manager to a
     * conversation about nothing.
     */
    for (const { path } of PAGES) {
      const source = readFileSync(path, "utf8");
      const actions = source.split("<AskSunnyAboutReport").length - 1;
      expect(actions, `${path} should wire the action exactly once`).toBe(1);
    }
  });
});
