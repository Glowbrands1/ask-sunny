// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { OverviewScreen, type OverviewFollowUps } from "./overview";

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

describe("the follow-ups card", () => {
  it("states the counts the server calculated", () => {
    render(
      <OverviewScreen
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
      <OverviewScreen
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
      <OverviewScreen
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
      <OverviewScreen
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
    render(<OverviewScreen followUps={followUps()} />);
    expect(screen.getByText("Nothing needs attention today")).toBeTruthy();
    expect(screen.getByText("Nothing needs attention today").className).not.toContain(
      "followup",
    );
    expect(screen.getByText("No follow-ups are being tracked.")).toBeTruthy();
  });

  it("survives the database being unreachable — this is the home page", () => {
    render(
      <OverviewScreen followUps={followUps({ failure: "connection refused" })} />,
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
      <OverviewScreen
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
