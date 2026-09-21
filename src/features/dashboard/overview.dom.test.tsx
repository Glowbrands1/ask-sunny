// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import {
  OverviewScreen,
  type OverviewFollowUps,
} from "./overview";
import {
  PerformanceOverviewCard,
  PerformanceStripFigures,
} from "./performance-overview";
import { ReviewsWeekCard } from "./reviews-block";
import type { ReviewsWeekBlock } from "@/lib/reviews/weekly-block";
import type {
  OverviewKpi,
  ReportingOverview,
} from "@/lib/reporting/read/overview";

/**
 * THE OVERVIEW READS THE FORMS DATABASE, AND ONLY THE FORMS DATABASE.
 *
 * The desync this checkpoint fixes was structural, not arithmetic: the card
 * derived follow-ups from `useAppStore().forms`, a browser-side demo
 * collection with its own `overdue` / `due_soon` statuses, while Form
 * Monitoring had moved to Supabase. Two sources, two answers, same salon.
 *
 * So the load-bearing tests here are the two that assert the SOURCE — that the
 * card renders what the server handed it, and that the module no longer reaches
 * for the store's forms at all. The rest check the wording and the colour.
 */

const TODAY = "2026-09-04";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
  usePathname: () => "/",
}));

/*
 * The store still backs unrelated demo areas of this screen (documents,
 * videos), which is allowed. It is stubbed with an EMPTY forms array so that if
 * the follow-up card ever starts reading it again, it renders nothing and the
 * assertions below fail loudly.
 */
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: () => ({
    forms: [],
    documents: [],
    videos: [],
    /*
     * The band writes its inline turns to the same store the chat screen uses,
     * and reads the thread back out of it — so it needs the append, not just
     * the add. These cases never send, so no-ops are enough; the band's own
     * suite stubs a real reducer because there the thread IS the thing tested.
     */
    conversations: [],
    addConversation: () => {},
    appendConversationMessages: () => {},
    updateConversation: () => {},
  }),
}));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { name: "Paulyne", isSalonAccount: false, title: "Owner", scope: {} },
    role: "owner",
    can: () => true,
    primaryLocationName: "MO Kansas City Wornall",
    managerDisplayName: "Paulyne",
    demoMode: true,
    /* The band asks through the real provider, which needs the brand's scope. */
    brand: { knowledgeScopeId: "stc-core" },
  }),
}));

vi.mock("@/components/shell/app-shell", () => ({
  DesktopSearchLauncher: () => null,
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

function followUps(overrides: Partial<OverviewFollowUps> = {}): OverviewFollowUps {
  return {
    attention: { overdue: 0, dueThisWeek: 0, needsAttention: 0 },
    items: [],
    today: TODAY,
    failure: null,
    excluded: 0,
    scopeLabel: null,
    ...overrides,
  };
}

/**
 * The screen with both of its server-rendered slots already supplied.
 *
 * The Performance card and the collapsed strip's figures are async SERVER
 * components the page renders and passes down, so this screen only ever
 * receives nodes. These cases are about the screen — markers stand in for both,
 * and their own states are rendered directly further down.
 */
function Overview(props: {
  followUps: OverviewFollowUps;
  performanceOverview?: React.ReactNode;
  performanceStrip?: React.ReactNode;
  googleReviews?: React.ReactNode;
}) {
  return (
    <OverviewScreen
      followUps={props.followUps}
      performanceOverview={
        props.performanceOverview ?? <div>performance overview slot</div>
      }
      performanceStrip={props.performanceStrip ?? <div>performance strip slot</div>}
      /*
       * THE GOOGLE REVIEWS BLOCK IS A SERVER-RENDERED NODE TOO, so the screen
       * only ever receives one. The default is a real block over a real week's
       * figures, because most cases below simply need the section to be there;
       * its own states are rendered directly further down.
       */
      googleReviews={props.googleReviews ?? <ReviewsWeekCard block={REVIEW_WEEK} />}
    />
  );
}

/** A week the reviews read could genuinely return. No figure here is seeded. */
const REVIEW_WEEK: ReviewsWeekBlock = {
  status: "ready",
  gained: 37,
  allNew: 41,
  vsLastWeek: 6,
  averageRating: 4.32,
  salonCount: 15,
  listingsWithoutAnchor: 0,
  goal: 225,
  goalPerSalon: 15,
  weekLabel: "Sep 20 – Sep 26",
  previousWeekLabel: "Sep 13 – Sep 19",
};

describe("the follow-ups card", () => {
  it("states the counts the server calculated", () => {
    render(
      <Overview
        followUps={followUps({ attention: { overdue: 2, dueThisWeek: 2, needsAttention: 4 } })}
      />,
    );
    // Curt's explicit example.
    expect(screen.getByText("4 follow-ups need attention")).toBeTruthy();
    expect(screen.getByText("2 overdue")).toBeTruthy();
    expect(screen.getByText("2 due this week")).toBeTruthy();
  });

  it("lists the rows the server sent, with the salon and how late each is", () => {
    render(
      <Overview
        followUps={followUps({
          attention: { overdue: 1, dueThisWeek: 1, needsAttention: 2 },
          items: [
            {
              id: "a",
              employeeName: "Jane Kowalski",
              templateName: "Coaching Form",
              locationName: "MO Kansas City Wornall",
              followUpDate: "2026-09-01",
              overdue: true,
            },
            {
              id: "b",
              employeeName: "Sofia Delgado",
              templateName: "Policy Review",
              locationName: "MO Kansas City Liberty",
              followUpDate: "2026-09-05",
              overdue: false,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Jane Kowalski")).toBeTruthy();
    expect(screen.getByText("Coaching Form · MO Kansas City Wornall")).toBeTruthy();
    // Measured against the business date the server passed, not the demo
    // anchor — which would call these dates "in 6 days".
    expect(screen.getByText("3 days late")).toBeTruthy();
    expect(screen.getByText("Sofia Delgado")).toBeTruthy();
    expect(screen.getByText("Tomorrow")).toBeTruthy();
  });

  it("gives an overdue row the filled follow-up pink and an upcoming one nothing", () => {
    render(
      <Overview
        followUps={followUps({
          attention: { overdue: 1, dueThisWeek: 1, needsAttention: 2 },
          items: [
            {
              id: "a",
              employeeName: "Jane Kowalski",
              templateName: "Coaching Form",
              locationName: null,
              followUpDate: "2026-09-01",
              overdue: true,
            },
            {
              id: "b",
              employeeName: "Sofia Delgado",
              templateName: "Policy Review",
              locationName: null,
              followUpDate: "2026-09-05",
              overdue: false,
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("3 days late").className).toContain("bg-followup-attention");
    expect(screen.getByText("Tomorrow").className).not.toContain("followup");
  });

  it("links each half of the count to the filter it names", () => {
    render(
      <Overview
        followUps={followUps({ attention: { overdue: 2, dueThisWeek: 1, needsAttention: 3 } })}
      />,
    );
    expect(screen.getByText("2 overdue").getAttribute("href")).toBe(
      "/forms/monitoring?followup=overdue",
    );
    expect(screen.getByText("1 due this week").getAttribute("href")).toBe(
      "/forms/monitoring?followup=open",
    );
  });

  it("says nothing needs attention rather than showing a pink zero", () => {
    render(<Overview followUps={followUps()} />);
    expect(screen.getByText("Nothing needs attention today")).toBeTruthy();
    expect(screen.getByText("Nothing needs attention today").className).not.toContain(
      "followup",
    );
    expect(screen.getByText("No follow-ups are being tracked.")).toBeTruthy();
  });

  it("survives the database being unreachable — this is the home page", () => {
    render(
      <Overview followUps={followUps({ failure: "connection refused" })} />,
    );
    expect(screen.getByText("Follow-ups could not be read")).toBeTruthy();
    expect(screen.getByText("Ask Sunny could not reach the Forms record.")).toBeTruthy();
    // And the rest of the screen is still there. Google Reviews is now the
    // horizontal yellow bar rather than a card, so it is identified by its own
    // label instead of a card title.
    expect(screen.getByText("Reviews gained")).toBeTruthy();
  });
});

describe("the second card agrees with the first, and its tiles add up", () => {
  it("partitions the outstanding work into three disjoint buckets", () => {
    render(
      <Overview
        followUps={followUps({
          attention: { overdue: 2, dueThisWeek: 1, needsAttention: 3 },
          items: [
            { id: "a", employeeName: "A", templateName: "Coaching Form", locationName: null, followUpDate: "2026-09-01", overdue: true },
            { id: "b", employeeName: "B", templateName: "Coaching Form", locationName: null, followUpDate: "2026-09-02", overdue: true },
            { id: "c", employeeName: "C", templateName: "Coaching Form", locationName: null, followUpDate: "2026-09-05", overdue: false },
            { id: "d", employeeName: "D", templateName: "Coaching Form", locationName: null, followUpDate: "2026-09-20", overdue: false },
          ],
        })}
      />,
    );

    const pipeline = screen.getByText("Forms awaiting follow-up").closest("div")?.parentElement
      ?.parentElement;
    const tiles = within(pipeline as HTMLElement);
    /*
     * THE REGRESSION THIS GUARDS, from the 14 September review: "The Overview
     * follow-up card shows 15, then 16, while the individual categories total
     * 20: 11 + 4 + 5."
     *
     * The old third tile was `total - overdue`, which already contained the
     * due-this-week rows, so the row double-counted them. Here: 4 outstanding,
     * 2 overdue, 1 due this week — so 1 is due later, and 2 + 1 + 1 = 4.
     *
     * The tiles read LABEL then FIGURE — the eyebrow sits above the number in
     * the approved counter — so the figure is the label's next sibling.
     */
    expect(tiles.getByText("Overdue").nextElementSibling?.textContent).toBe("2");
    expect(tiles.getByText("Due this week").nextElementSibling?.textContent).toBe("1");
    expect(tiles.getByText("Due later").nextElementSibling?.textContent).toBe("1");
    // And the card says so, so a reader can check the arithmetic on its face.
    expect(tiles.getByText(/4 follow-ups outstanding = 2 overdue \+ 1 due this week \+ 1 due later/)).toBeTruthy();
  });

  it("never lets the three tiles sum to more than the outstanding total", () => {
    /*
     * The shape that produced 11 + 4 + 5 = 20 against a total of 16: every
     * overdue record, plus some due this week, plus some later.
     */
    const items = Array.from({ length: 16 }, (_, index) => ({
      id: String(index),
      employeeName: `E${index}`,
      templateName: "Coaching Form",
      locationName: null,
      followUpDate: index < 11 ? "2026-09-01" : "2026-09-20",
      overdue: index < 11,
    }));

    render(
      <Overview
        followUps={followUps({
          attention: { overdue: 11, dueThisWeek: 4, needsAttention: 15 },
          items,
        })}
      />,
    );

    const pipeline = screen.getByText("Forms awaiting follow-up").closest("div")?.parentElement
      ?.parentElement;
    const tiles = within(pipeline as HTMLElement);
    const read = (label: string) =>
      Number(tiles.getByText(label).nextElementSibling?.textContent ?? "0");

    const sum = read("Overdue") + read("Due this week") + read("Due later");
    expect(sum).toBe(items.length);
    // Specifically not the 20 the review saw.
    expect(sum).not.toBe(20);
  });

  it("does not repeat Open Form Monitoring three times on one card", () => {
    render(
      <Overview
        followUps={followUps({
          attention: { overdue: 2, dueThisWeek: 1, needsAttention: 3 },
          items: [
            { id: "a", employeeName: "A", templateName: "Coaching Form", locationName: null, followUpDate: "2026-09-01", overdue: true },
          ],
        })}
      />,
    );
    /*
     * THE REVIEW: "'Open Form Monitoring' appears three times on the same
     * card." Two remain and they are different objects — the alarm bar, which
     * renders only when something needs a person, and the card's own button
     * under the counters. The section rule no longer carries a third copy: a
     * heading is not an action.
     */
    expect(screen.getAllByRole("link", { name: /open form monitoring/i })).toHaveLength(2);
  });

  it("names the reader's own assignment rather than every salon they cover", () => {
    render(
      <Overview
        followUps={followUps({ scopeLabel: "MO Kansas City Wornall" })}
      />,
    );
    expect(screen.getByText("Across MO Kansas City Wornall")).toBeTruthy();
    expect(screen.queryByText("Across every salon you cover")).toBeNull();
  });

  it("says how many records were held back as non-production", () => {
    render(<Overview followUps={followUps({ excluded: 3 })} />);
    expect(screen.getByText(/3 records are filed against a salon that is not on the roster/)).toBeTruthy();
    expect(screen.getByText(/still in Form Monitoring/)).toBeTruthy();
  });
});

describe("the module's source", () => {
  const SOURCE = readFileSync("src/features/dashboard/overview.tsx", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("no longer takes forms from the client store", () => {
    /*
     * THE LOAD-BEARING ASSERTION. Every number on this screen's follow-up
     * cards used to come from `useAppStore().forms`. Destructuring it again is
     * how the desync would return, and it would look perfectly reasonable in a
     * diff.
     */
    expect(SOURCE).toMatch(/useAppStore\(\)/); // documents and videos still do
    expect(SOURCE).not.toMatch(/\{[^}]*\bforms\b[^}]*\}\s*=\s*useAppStore\(\)/);
    expect(SOURCE).not.toMatch(/\bforms\.filter\b/);
    expect(SOURCE).not.toMatch(/DEMO_GENERATED_FORMS/);
  });

  it("does not measure follow-ups against the demo anchor", () => {
    // `daysFromNow` and `relativeDay` are anchored to a fixed August instant.
    // The card uses `relativeBusinessDay` instead.
    expect(SOURCE).not.toMatch(/daysFromNow/);
    expect(SOURCE).toMatch(/relativeBusinessDay/);
  });

  it("reads the live query on the server, not in the browser", () => {
    const page = readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(page).toMatch(/listOutstandingFollowUps/);
    expect(page).toMatch(/attentionSummary/);
    // `force-dynamic` is what makes a navigation re-read Supabase.
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
  });
});

/* ================================== seeded content stays in demo mode == */

describe("the Overview does not present seeded content as live company data", () => {
  /*
   * ==========================================================================
   * WHAT THE SCREENSHOT SHOWED
   * ==========================================================================
   *
   * A live Preview, with real deliveries ingested through 7 September, and a
   * card on the landing page reading "Demo content — seeded for this prototype,
   * not real company data."
   *
   * The note was TRUE, which is what made it a defect rather than a typo: three
   * regions of this page rendered `data/demo` in every mode. The Daily Stats
   * grid showed 486 guests served and 24.6% membership conversion; the Google
   * reviews card showed fabricated review counts and a weekly goal with NO note
   * at all; the activity feed attributed invented actions to named people.
   *
   * Beside a real follow-up count, an invented figure is a number a manager
   * will act on. The reporting work exists to stop a STALE figure reading as
   * current; this was worse, and it was on the first screen anybody sees.
   *
   * THE RULE, taken from `videos-screen.tsx` which settled it first: seeded
   * content is demo-mode content. Both directions are asserted — the seeded
   * cards must survive in demo mode, because the note is honest there.
   */
  const originalMode = process.env.NEXT_PUBLIC_DEMO_MODE;
  afterEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = originalMode;
  });

  const live = () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  };
  const demo = () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
  };

  /*
   * WHAT SUPERSEDED THE DAILY STATS CARD.
   *
   * That card deliberately showed NO figure in live mode, because — as it said
   * — guests served, membership conversion, average ticket and upgrades are not
   * measures any ingested report carries, so there was nothing to swap the
   * seeded grid for. It named the newest delivery and sent the reader to
   * Reporting.
   *
   * The Performance Overview card is the decision that was left open: four
   * measures the reports DO carry, each under its own period, read through the
   * same functions the report pages call. So the assertions below moved from
   * "names the delivery and no figure" to "shows the report's figures, and is
   * still incapable of showing a seeded one".
   *
   * THE SEEDED GRID IS NOW GONE IN DEMO MODE TOO, which is a deliberate change
   * to this screen's demo behaviour. Keeping it was honest only while there was
   * no live version of the card; there is one now, and in demo mode it says
   * what it can read rather than showing 486 guests nobody served.
   */
  const ready: ReportingOverview = {
    status: "ready",
    scopeLabel: "15 salons included",
    updatedLabel: "Sep 8, 2026",
    sources: [
      {
        key: "salon-performance",
        label: "Salon Performance",
        periodLabel: "YTD Aug 2026",
        ingestedAt: null,
      },
    ],
    kpis: [
      {
        key: "comp:total_revenue",
        label: "Total Revenue",
        value: "$7.5M",
        periodLabel: "YTD Aug 2026",
        salonCount: 15,
        cadence: "monthly" as const,
        sourceReport: "Comp Report",
        unavailableReason: null,
        change: { percent: 5.11, higherIsBetter: true, comparisonLabel: "vs 2025" },
      },
    ],
  };

  it("shows no seeded figure and no demo note in live mode", () => {
    live();
    render(<Overview followUps={followUps()} />);

    // The seeded Daily Stats grid.
    expect(screen.queryByText("486")).toBeNull();
    expect(screen.queryByText("24.6%")).toBeNull();
    expect(screen.queryByText("Guests served")).toBeNull();
    /*
     * THE REVIEWS BLOCK IS LIVE, so what this assertion protects has moved.
     *
     * It used to require a DISCLOSURE — the block was every bit as seeded as
     * the Daily Stats grid, and the rule was that it had to say so. The figures
     * now come from the Google Reviews read, so the rule is the stronger one
     * the rest of this file already applies: no seeded figure at all, and no
     * note claiming the block is a placeholder.
     *
     * The four numbers named here are the seeded ones exactly: 189 gained,
     * 4.63 average, a 230 goal summed from invented per-salon goals, and 15
     * salons counted by the length of the demo array.
     */
    expect(screen.getByText("Reviews gained")).toBeTruthy();
    expect(
      screen.queryByText(/Google Business Profile is not connected yet/),
    ).toBeNull();
    expect(screen.queryByText("189")).toBeNull();
    expect(screen.queryByText("4.63")).toBeNull();
    expect(screen.queryByText(/of 230 weekly goal/)).toBeNull();
    // The invented activity feed.
    expect(screen.queryByText("Recent Ask Sunny activity")).toBeNull();
    // And the label that started this.
    expect(
      screen.queryByText(/Demo content — seeded for this prototype/),
    ).toBeNull();
  });

  it("renders whatever the server put in the Performance Overview slot", () => {
    live();
    render(
      <Overview
        followUps={followUps()}
        performanceOverview={<PerformanceOverviewCard overview={ready} />}
      />,
    );

    /*
     * Asserted through the FIGURE the server passed, not through a card title.
     * The card's own header is gone: the Overview puts a section rule above the
     * slot carrying the label and the Reports link, so a title inside it would
     * state both twice. What matters is that the node the server handed over is
     * what renders.
     */
    expect(screen.getByText("Performance")).toBeTruthy();
    expect(screen.getByText("$7.5M")).toBeTruthy();
    /*
     * And the figures sit in ONE hairline panel rather than four tiles in a gap
     * grid — the direction's stat treatment. Pinned here because this card only
     * renders with reporting data, so it cannot be checked in a browser during
     * local work; the shared cell class is asserted so the hairline rules stay
     * in one place.
     */
    expect(document.querySelectorAll(".stat-cell").length).toBeGreaterThan(0);
    // The old card's heading and its claim about "yesterday" are both gone.
    expect(screen.queryByText("Daily Stats")).toBeNull();
    expect(screen.queryByText("Yesterday across all salons")).toBeNull();
  });

  it("shows no seeded Daily Stats grid in demo mode either", () => {
    demo();
    render(<Overview followUps={followUps()} />);

    // The figures that started this, in the mode that used to keep them.
    expect(screen.queryByText("486")).toBeNull();
    expect(screen.queryByText("24.6%")).toBeNull();
    expect(screen.queryByText("Guests served")).toBeNull();

    /*
     * THE REVIEWS BLOCK IS NOT SEEDED IN DEMO MODE EITHER, which is a
     * deliberate change to this screen's demo behaviour and the same one the
     * Performance card made. It renders whatever the server's read of the
     * Google Reviews data returned — in a deployment with no Supabase that is a
     * sentence saying so, never 189 reviews nobody received.
     */
    expect(screen.getByText("Reviews gained")).toBeTruthy();
    expect(screen.queryByText("189")).toBeNull();
    expect(
      screen.queryByText(/Google Business Profile is not connected yet/),
    ).toBeNull();
    // The activity feed is still seeded, still present, and still noted.
    expect(screen.getByText("Recent Ask Sunny activity")).toBeTruthy();
    expect(
      screen.getAllByText(/Demo content — seeded for this prototype/).length,
    ).toBeGreaterThan(0);
  });

  it("greets from the business clock, not the frozen demo anchor", () => {
    /*
     * It was `greetingForHour(demoNow().getUTCHours())` — a fixed August
     * instant, read as UTC. On the live Preview every manager was greeted at
     * whatever time of day DEMO_ANCHOR fell on, and even a real clock read as
     * UTC would be four or five hours out at a US salon.
     */
    /*
     * THE RULE IS UNCHANGED; THE GREETING MOVED. It now lives in the band —
     * the Marquee direction puts it on the dark surface with the ask input —
     * so that is where the clock is checked. Both files are asserted: the band
     * must use the business hour, and neither may reach for the frozen anchor.
     */
    // Comments stripped: the prose above names `demoNow` in the sentence that
    // forbids it, which is the same reason the suite below does this.
    const strip = (path: string) =>
      readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
    const source = strip("src/features/dashboard/overview.tsx");
    const band = strip("src/features/dashboard/ask-band.tsx");
    expect(source).not.toMatch(/demoNow\(\)/);
    expect(band).not.toMatch(/demoNow\(\)/);
    expect(band).toMatch(/greetingForHour\(businessHour\(\)\)/);
  });

  it("computes no figure of its own, on the page or in the projection", () => {
    /*
     * THE RULE IS UNCHANGED; ONLY WHERE IT IS ENFORCED HAS MOVED.
     *
     * The page used to read the newest delivery's date directly and was
     * forbidden from loading a figure. It now renders a card instead, and the
     * card reads through `read/overview.ts`. So the landing page must still
     * hold no reporting query, and the projection behind it must still produce
     * every figure by CALLING the report layer rather than by doing arithmetic
     * — which is the thing a second implementation of a total would look like.
     */
    const page = readFileSync("src/app/(app)/page.tsx", "utf8");
    expect(page).not.toMatch(/loadSalesTotals\(/);
    expect(page).not.toMatch(/listSalesTotalsDates/);
    expect(page).not.toMatch(/aggregateSalons|aggregateMeasure|buildKpiCards/);

    const projection = readFileSync("src/lib/reporting/read/overview.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Every figure comes from the report layer's own functions.
    expect(projection).toMatch(/buildKpiCards\(/);
    expect(projection).toMatch(/aggregateMeasure\(/);
    // And none of it is recomputed here: no summing, averaging or dividing.
    expect(projection).not.toMatch(/\.reduce\(/);
    expect(projection).not.toMatch(/[^/*]\s\/\s[a-zA-Z]/);
  });
});

describe("the Overview panel states which way each measure moved", () => {
  /**
   * THE ARROW ON THE OVERVIEW, AND THE THREE THINGS THAT CAN GO WRONG WITH IT.
   *
   * The panel showed a figure and its period and no direction at all. It now
   * carries the report's own change, coloured by the same rule the Salon
   * Performance KPI row uses — green good, red behind — so the two surfaces
   * cannot describe the same measure differently.
   *
   * What is worth pinning is not the green. It is the three cases where an
   * arrow would be a LIE: a measure with no stated direction, a family with no
   * baseline at all, and a figure that is absent. Each renders differently, and
   * none of them renders as "no change" — which is a claim about something
   * nobody measured.
   */
  const kpiWith = (overrides: Partial<OverviewKpi>): OverviewKpi => ({
    key: "comp:total_revenue",
    label: "Total Revenue",
    value: "$7.5M",
    periodLabel: "YTD Aug 2026",
    salonCount: 15,
    cadence: "monthly" as const,
    sourceReport: "Comp Report",
    unavailableReason: null,
    change: null,
    ...overrides,
  });

  const panel = (kpis: OverviewKpi[]) =>
    render(
      <PerformanceOverviewCard
        overview={{
          status: "ready",
          scopeLabel: "15 salons included",
          updatedLabel: "Sep 8, 2026",
          sources: [
            {
              key: "salon-performance",
              label: "Salon Performance",
              periodLabel: "YTD Aug 2026",
              ingestedAt: null,
            },
          ],
          kpis,
        }}
      />,
    );

  it("reads green when the measure is good and red when it is behind", () => {
    const { container: good } = panel([
      kpiWith({
        change: { percent: 5.11, higherIsBetter: true, comparisonLabel: "vs 2025" },
      }),
    ]);
    expect(good.innerHTML).toContain("text-delta-up");
    expect(good.innerHTML).not.toContain("measure-flagged-foreground");
    // The comparison is named, so the percentage is never a bare number.
    expect(screen.getByText("vs 2025")).toBeTruthy();
    cleanup();

    const { container: behind } = panel([
      kpiWith({
        change: { percent: -5.11, higherIsBetter: true, comparisonLabel: "vs 2025" },
      }),
    ]);
    expect(behind.innerHTML).toContain("measure-flagged-foreground");
    expect(behind.innerHTML).not.toContain("text-delta-up");
  });

  it("stays neutral where the business has not said which way is better", () => {
    const { container } = panel([
      kpiWith({
        change: { percent: 5.11, higherIsBetter: null, comparisonLabel: "vs 2025" },
      }),
    ]);
    expect(container.innerHTML).not.toContain("text-delta-up");
    expect(container.innerHTML).not.toContain("measure-flagged-foreground");
    expect(screen.getByText(/direction not defined for this measure/)).toBeTruthy();
  });

  it("draws no arrow at all on a family that has no baseline", () => {
    /*
     * Sales Totals publishes a month-to-date position with nothing to set it
     * against. A flat or dashed arrow there would read as "no change", which is
     * a different and stronger claim than "nothing to compare".
     */
    const { container } = panel([
      kpiWith({ key: "sales-totals:grand_total", label: "Total sales", change: null }),
    ]);
    expect(screen.getByText("Total sales")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.innerHTML).not.toContain("vs ");
  });

  it("draws no arrow beside a figure that is not there", () => {
    // An arrow needs something to be about. The em dash keeps its reason.
    const { container } = panel([
      kpiWith({
        value: null,
        unavailableReason: "Not carried for this period",
        change: { percent: 5.11, higherIsBetter: true, comparisonLabel: "vs 2025" },
      }),
    ]);
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Not reported")).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("says the direction in words as well as in colour", () => {
    panel([
      kpiWith({
        change: { percent: 5.11, higherIsBetter: true, comparisonLabel: "vs 2025" },
      }),
    ]);
    expect(screen.getByText("increase")).toBeTruthy();
  });
});

describe("the collapsed strip states what the panel states", () => {
  /**
   * THE STRIP AND THE PANEL ARE ONE SNAPSHOT, TWO PRESENTATIONS.
   *
   * When an inline answer opens, the Overview collapses to a strip. That strip
   * used to carry the follow-up counts, because this screen is a client
   * component and the reporting read layer is `server-only` — the Performance
   * figures were literally unreachable from the code rendering the strip.
   *
   * Both are now server-rendered nodes reading through one `cache`d call, so the
   * risk that remains is not "do they fetch twice" but "does the strip quietly
   * invent its own presentation rules". These cases pin the two that matter: a
   * missing measure is an em dash rather than a zero, and a failed read is a
   * sentence rather than an empty strip.
   */
  const kpi = (overrides: Partial<OverviewKpi> = {}): OverviewKpi => ({
    key: "comp:total_revenue",
    label: "Total Revenue",
    value: "$7.5M",
    periodLabel: "YTD Aug 2026",
    salonCount: 15,
    cadence: "monthly" as const,
    sourceReport: "Comp Report",
    unavailableReason: null,
    change: null,
    ...overrides,
  });

  const readyWith = (kpis: OverviewKpi[]): ReportingOverview => ({
    status: "ready",
    scopeLabel: "15 salons included",
    updatedLabel: "Sep 8, 2026",
    sources: [
      {
        key: "salon-performance",
        label: "Salon Performance",
        periodLabel: "YTD Aug 2026",
        ingestedAt: null,
      },
    ],
    kpis,
  });

  it("carries the same figures the panel does", () => {
    const overview = readyWith([
      kpi(),
      kpi({ key: "comp:unique_tanners", label: "Unique Tanners", value: "43,115" }),
    ]);

    const { container: panel } = render(<PerformanceOverviewCard overview={overview} />);
    const panelText = panel.textContent ?? "";
    cleanup();

    const { container: strip } = render(<PerformanceStripFigures overview={overview} />);
    const stripText = strip.textContent ?? "";

    for (const figure of ["$7.5M", "43,115", "Total Revenue", "Unique Tanners"]) {
      expect(panelText, `panel is missing ${figure}`).toContain(figure);
      expect(stripText, `strip is missing ${figure}`).toContain(figure);
    }
  });

  it("keeps the period, on the tooltip rather than on a line of its own", () => {
    /*
     * The panel gives each figure its period underneath. At strip size that is
     * four extra fragments of small print, so it moves to the title — dropped
     * entirely it would be a figure with no window, which is the one thing the
     * whole projection exists to prevent.
     */
    render(<PerformanceStripFigures overview={readyWith([kpi()])} />);
    expect(screen.getByTitle("YTD Aug 2026")).toBeTruthy();
  });

  it("shows an em dash for a measure the report did not carry, never a zero", () => {
    render(
      <PerformanceStripFigures
        overview={readyWith([
          kpi({ value: null, unavailableReason: "Not reported for this window" }),
        ])}
      />,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    // The reason travels with it, as it does on the panel.
    expect(screen.getByTitle("Not reported for this window")).toBeTruthy();
  });

  it("says why rather than going blank when the read fails", () => {
    /*
     * An empty strip reads as "the dashboard has no numbers today" — a
     * different and more alarming claim than "the reports are not reachable".
     */
    render(
      <PerformanceStripFigures
        overview={{ status: "error", message: "Reporting data could not be read." }}
      />,
    );
    expect(screen.getByText(/unavailable right now/i)).toBeTruthy();
    cleanup();

    render(
      <PerformanceStripFigures
        overview={{ status: "no_data", reason: "No report has been ingested yet." }}
      />,
    );
    expect(screen.getByText(/No reporting figures yet/i)).toBeTruthy();
  });
});

/**
 * ============================================================================
 * RECOMMENDED TRAINING WITH NO URLS CONFIGURED
 * ============================================================================
 *
 * THE REVIEW: "Recommended Training is currently an empty section. Since our
 * training videos live in Teams and Woven, I'd rather this be a link directing
 * users to those resources than an empty section that appears as though it
 * should contain content."
 *
 * The Teams and Woven URLs are facts about the customer's tenancy and are not
 * set on this deployment, so the UNCONFIGURED state is the one that ships and
 * the one that has to be right unattended. `training-links.test.ts` proves the
 * data layer refuses a relative path, a `javascript:` scheme and an empty
 * value; this proves what a manager actually sees when nothing is set.
 *
 * The three failures being ruled out are each worse than an empty section: a
 * dead anchor, an `href="#"` that scrolls the page, and a heading over nothing.
 */
describe("the training section with no destinations configured", () => {
  it("renders no link at all, rather than a dead one", () => {
    render(<Overview followUps={followUps()} />);

    const heading = screen.getByText("Training");
    const section = heading.closest("div")!;

    // No anchor, and in particular no `#` placeholder.
    for (const anchor of Array.from(section.querySelectorAll("a"))) {
      const href = anchor.getAttribute("href") ?? "";
      expect(href, "a training link points nowhere").not.toBe("#");
      expect(href, "a training link is empty").not.toBe("");
      expect(anchor.textContent).not.toMatch(/Training in (Teams|Woven)/);
    }
  });

  it("says where the training is and that this deployment has not been told", () => {
    render(<Overview followUps={followUps()} />);

    // A heading over nothing is what the review objected to. The section says
    // something true instead, and names who can fix it.
    expect(
      screen.getByText(/Training is hosted in Teams and Woven rather than in Ask Sunny/),
    ).toBeTruthy();
    expect(screen.getByText(/An\s+administrator can set them/)).toBeTruthy();
  });

  it("invents no URL anywhere on the page", () => {
    const { container } = render(<Overview followUps={followUps()} />);

    for (const anchor of Array.from(container.querySelectorAll("a"))) {
      const href = anchor.getAttribute("href") ?? "";
      // Nothing plausible-but-guessed: no teams.microsoft.com, no woven.
      expect(href).not.toMatch(/teams\.microsoft|woven/i);
    }
  });
});
