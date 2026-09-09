// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import {
  OverviewScreen,
  type OverviewFollowUps,
} from "./overview";
import { PerformanceOverviewCard } from "./performance-overview";
import type { ReportingOverview } from "@/lib/reporting/read/overview";

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
  }),
}));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => ({
    user: { name: "Paulyne", isSalonAccount: false, title: "Owner", scope: {} },
    role: "owner",
    can: () => true,
    primaryLocationName: "Riverbend Commons",
    demoMode: true,
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
    ...overrides,
  };
}

/**
 * The screen with its Performance Overview slot already supplied.
 *
 * The card is an async SERVER component the page renders and passes down, so
 * this screen only ever receives a node. These cases are about the screen — a
 * marker stands in for the card, and the card's own three states are rendered
 * directly further down.
 */
function Overview(props: {
  followUps: OverviewFollowUps;
  performanceOverview?: React.ReactNode;
}) {
  return (
    <OverviewScreen
      followUps={props.followUps}
      performanceOverview={
        props.performanceOverview ?? <div>performance overview slot</div>
      }
    />
  );
}

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
              locationName: "Riverbend",
              followUpDate: "2026-09-01",
              overdue: true,
            },
            {
              id: "b",
              employeeName: "Sofia Delgado",
              templateName: "Policy Review",
              locationName: "Maple Crossing",
              followUpDate: "2026-09-05",
              overdue: false,
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("Jane Kowalski")).toBeTruthy();
    expect(screen.getByText("Coaching Form · Riverbend")).toBeTruthy();
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
    // And the rest of the screen is still there.
    expect(screen.getByText("Google reviews")).toBeTruthy();
  });
});

describe("the second card agrees with the first", () => {
  it("splits the same numbers into Overdue, Due this week and Open", () => {
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
    // 4 outstanding, 2 of them overdue -> 2 open. Both cards read the same
    // `attention` object, so they cannot drift apart.
    expect(tiles.getByText("Overdue").previousElementSibling?.textContent).toBe("2");
    expect(tiles.getByText("Due this week").previousElementSibling?.textContent).toBe("1");
    expect(tiles.getByText("Open").previousElementSibling?.textContent).toBe("2");
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
        unavailableReason: null,
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
    // The reviews card that never admitted it was seeded.
    expect(screen.queryByText("Google reviews")).toBeNull();
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

    expect(screen.getByText("Performance Overview")).toBeTruthy();
    expect(screen.getByText("$7.5M")).toBeTruthy();
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

    // The rest of demo mode is untouched by this change: the reviews card and
    // the activity feed are still seeded, still present, and still noted.
    expect(screen.getByText("Google reviews")).toBeTruthy();
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
    // Comments stripped: the prose above names `demoNow` in the sentence that
    // forbids it, which is the same reason the suite below does this.
    const source = readFileSync("src/features/dashboard/overview.tsx", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/demoNow\(\)/);
    expect(source).toMatch(/greetingForHour\(businessHour\(\)\)/);
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
