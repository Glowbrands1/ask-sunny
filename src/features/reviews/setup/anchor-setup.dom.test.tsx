// @vitest-environment jsdom
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AnchorCandidate, AnchorSetupRow } from "@/lib/reviews/anchor-admin";

import { AnchorSetupScreen } from "./anchor-setup-screen";

/**
 * ============================================================================
 * SETTING A LOCATION'S STARTING POINT, FROM ASK SUNNY
 * ============================================================================
 *
 * The brief for this screen was operational, not visual: after the first sync,
 * an administrator should be able to establish each location's starting point
 * WITHOUT Postman, curl, SQL, or copying a Google review id. So these tests
 * check the things that would send somebody back to a terminal:
 *
 *   NO GOOGLE REVIEW ID IS EVER RENDERED. Not in the picker, not in the status
 *   line, not in a title attribute. The person recognises a reviewer.
 *
 *   BOTH OPTIONS ARE PRESENT AND SAY WHAT THEY DO, in the words the brief used.
 *
 *   AN EXISTING ANCHOR IS NEVER MOVED BY ACCIDENT. The bulk button lists
 *   exactly who it will touch and excludes the configured; changing a settled
 *   one takes a separate acknowledgement and sends `replace`.
 *
 * Nothing here is a security boundary — `applyAnchors` refuses a replacement
 * without `replace: true` whatever this screen sends, and that is asserted in
 * `lib/reviews/anchors.test.ts`. What these protect is an administrator being
 * offered an action that will surprise them.
 *
 * Every reviewer, review id and salon name is invented. The store codes are
 * real, because they are printed on the storefronts.
 */

const router = { refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

function row(overrides: Partial<AnchorSetupRow> = {}): AnchorSetupRow {
  return {
    storeCode: "306",
    locationName: "KS Manhattan",
    salonNumber: "0462",
    district: "District 3",
    listingState: "verified",
    trackingActive: false,
    anchorReviewer: null,
    anchorRelativeDate: null,
    anchorSetAt: null,
    historicalReviews: 24,
    heldReviews: 24,
    countedReviews: 0,
    ...overrides,
  };
}

function candidate(overrides: Partial<AnchorCandidate> = {}): AnchorCandidate {
  return {
    externalReviewId: "FIXTURE-REVIEW-0001",
    reviewerName: "Tarissa Barry",
    rating: 5,
    commentPreview: "Clean beds and the staff remembered my name.",
    relativeDateText: "a week ago",
    hasOwnerResponse: false,
    inLatestFeed: true,
    promotesAbove: 0,
    ...overrides,
  };
}

let posted: { url: string; body: { anchors: Record<string, unknown>[] } }[] = [];

beforeEach(() => {
  posted = [];
  router.refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      posted.push({ url: String(url), body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          anchors: body.anchors.map((anchor: { storeCode: string; fromNewestHeld?: boolean }) => ({
            storeCode: anchor.storeCode,
            status: anchor.fromNewestHeld ? "baseline_set" : "anchor_set",
            assignedAbove: anchor.fromNewestHeld ? 0 : 2,
          })),
        }),
      };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Presses a ConfirmButton and then its dialog's confirmation. */
async function confirm(user: ReturnType<typeof userEvent.setup>, name: RegExp, confirmName: RegExp) {
  await user.click(screen.getByRole("button", { name }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: confirmName }));
}

describe("the baseline setup screen", () => {
  it("shows, per location, everything needed to recognise it", async () => {
    render(<AnchorSetupScreen rows={[row()]} openStoreCode={null} candidates={[]} />);

    expect(screen.getByText("KS Manhattan")).toBeTruthy();

    /*
     * BOTH NUMBERING SYSTEMS. Google's 306 is ASK Sunny salon 0462, and this is
     * the one screen where they appear together — which is how somebody checks
     * they are anchoring the salon they think they are.
     */
    const card = screen.getByText("KS Manhattan").closest("article") as HTMLElement;
    expect(card.textContent).toContain("306");
    expect(card.textContent).toContain("0462");
    expect(card.textContent).toContain("District 3");
    expect(card.textContent).toContain("No baseline set");
    expect(card.textContent).toContain("24");
  });

  it("says plainly when a location is counting, and after whom", () => {
    render(
      <AnchorSetupScreen
        rows={[row({ trackingActive: true, anchorReviewer: "Marla Quist", anchorRelativeDate: "3 weeks ago" })]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    expect(screen.getByText("Tracking active")).toBeTruthy();
    expect(screen.getByText(/Marla Quist/)).toBeTruthy();
    expect(screen.getByText(/3 weeks ago/)).toBeTruthy();
  });

  it("opens one location's controls from the URL, so a half-finished setup survives a refresh", () => {
    render(
      <AnchorSetupScreen
        rows={[row({ storeCode: "306" }), row({ storeCode: "143", locationName: "KY Bowling Green" })]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    const link = screen.getAllByRole("link", { name: /Set baseline/ })[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/reviews/setup?store=306");
  });

  it("offers both options, in the words the setup process uses", () => {
    render(
      <AnchorSetupScreen rows={[row()]} openStoreCode="306" candidates={[candidate()]} />,
    );

    expect(
      screen.getByText(/Start counting after the newest review currently held/),
    ).toBeTruthy();
    expect(screen.getByText(/will remain historical/)).toBeTruthy();
    expect(screen.getByText(/Choose the last review already counted/)).toBeTruthy();
    expect(screen.getByText(/will not be counted again/)).toBeTruthy();
  });

  /* ------------------------------------------------------ option one -- */

  it("baselines from the newest held review, and asks first", async () => {
    const user = userEvent.setup();
    render(<AnchorSetupScreen rows={[row()]} openStoreCode="306" candidates={[]} />);

    await confirm(user, /Start counting from now/, /Set baseline/);

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].url).toBe("/api/admin/reviews/anchor");
    expect(posted[0].body.anchors).toEqual([
      { storeCode: "306", fromNewestHeld: true, replace: false },
    ]);
  });

  it("cannot baseline a location holding nothing, and says why", () => {
    render(
      <AnchorSetupScreen
        rows={[row({ heldReviews: 0, historicalReviews: 0 })]}
        openStoreCode="306"
        candidates={[]}
      />,
    );

    expect(
      (screen.getByRole("button", { name: /Start counting from now/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/nothing to draw a line after/)).toBeTruthy();
  });

  /* ------------------------------------------------------ option two -- */

  it("lets somebody pick the last review they counted, by reviewer and comment", async () => {
    const user = userEvent.setup();
    render(
      <AnchorSetupScreen
        rows={[row()]}
        openStoreCode="306"
        candidates={[
          candidate({ externalReviewId: "FIXTURE-TOP", reviewerName: "Tarissa Barry", promotesAbove: 0 }),
          candidate({
            externalReviewId: "FIXTURE-CHOSEN",
            reviewerName: "Marla Quist",
            rating: 4,
            commentPreview: "Booth was warm but the bed worked fine.",
            relativeDateText: "3 weeks ago",
            hasOwnerResponse: true,
            promotesAbove: 1,
          }),
        ]}
      />,
    );

    /* The five things the brief asked the picker to show. */
    const choice = screen.getByText("Marla Quist").closest("button") as HTMLElement;
    expect(choice.textContent).toContain("Booth was warm");
    expect(choice.textContent).toContain("3 weeks ago");
    expect(choice.textContent).toContain("Responded");
    expect(within(choice).getByText(/4 out of 5 stars/i)).toBeTruthy();

    await user.click(choice);
    await confirm(user, /Use Marla Quist as the last counted review/, /Set anchor/);

    await waitFor(() => expect(posted).toHaveLength(1));
    /* The id is submitted internally — it was never shown and never typed. */
    expect(posted[0].body.anchors).toEqual([
      { storeCode: "306", externalReviewId: "FIXTURE-CHOSEN", replace: false },
    ]);
  });

  it("never renders a Google review id anywhere on the screen", () => {
    const { container } = render(
      <AnchorSetupScreen
        rows={[
          row({ trackingActive: true, anchorReviewer: "Marla Quist" }),
        ]}
        openStoreCode="306"
        candidates={[
          candidate({ externalReviewId: "FIXTURE-SECRET-ID-0001" }),
          candidate({ externalReviewId: "FIXTURE-SECRET-ID-0002", reviewerName: "Dane Okafor" }),
        ]}
      />,
    );

    /*
     * THE WHOLE MARKUP, not just the visible text — an id in a title, a value
     * or a data attribute is an id somebody will copy out of dev tools and
     * start pasting into a spreadsheet.
     */
    expect(container.innerHTML).not.toContain("FIXTURE-SECRET-ID-0001");
    expect(container.innerHTML).not.toContain("FIXTURE-SECRET-ID-0002");
    expect(screen.getByText("Dane Okafor")).toBeTruthy();
  });

  it("says how many reviews each choice would promote, including none", () => {
    render(
      <AnchorSetupScreen
        rows={[row()]}
        openStoreCode="306"
        candidates={[
          candidate({ externalReviewId: "FIXTURE-A", reviewerName: "Top", promotesAbove: 0 }),
          candidate({ externalReviewId: "FIXTURE-B", reviewerName: "Third", promotesAbove: 2 }),
          candidate({
            externalReviewId: "FIXTURE-C",
            reviewerName: "Older",
            inLatestFeed: false,
            promotesAbove: 0,
          }),
        ]}
      />,
    );

    expect(screen.getByText(/counts nothing yet/)).toBeTruthy();
    expect(screen.getByText(/counts the 2 reviews above it/)).toBeTruthy();
    expect(screen.getByText(/sets the boundary but promotes nothing/)).toBeTruthy();
  });

  /* ----------------------------------------------- changing a settled one -- */

  it("will not move a settled anchor until it is acknowledged", async () => {
    const user = userEvent.setup();
    render(
      <AnchorSetupScreen
        rows={[row({ trackingActive: true, anchorReviewer: "Marla Quist" })]}
        openStoreCode="306"
        candidates={[candidate()]}
      />,
    );

    /* The current anchor is shown, and both controls are held shut. */
    expect(screen.getByText(/already has an anchor/)).toBeTruthy();
    expect(screen.getAllByText(/Marla Quist/).length).toBeGreaterThan(0);
    const start = screen.getByRole("button", { name: /Start counting from now/ }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);

    await user.click(screen.getByLabelText(/Yes, move the anchor for KS Manhattan/));
    expect(start.disabled).toBe(false);

    await confirm(user, /Start counting from now/, /Set baseline/);

    await waitFor(() => expect(posted).toHaveLength(1));
    /* And only NOW does the request carry the flag the server requires. */
    expect(posted[0].body.anchors[0].replace).toBe(true);
  });

  it("links to the same screen to change an anchor, never presenting it as routine", () => {
    render(
      <AnchorSetupScreen
        rows={[row({ trackingActive: true, anchorReviewer: "Marla Quist" })]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    expect(screen.getByRole("link", { name: /Change anchor/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Set baseline/ })).toBeNull();
  });

  /* --------------------------------------------------------- the bulk run -- */

  it("names exactly which locations the bulk baseline will touch", async () => {
    const user = userEvent.setup();
    render(
      <AnchorSetupScreen
        rows={[
          row({ storeCode: "306", locationName: "KS Manhattan" }),
          row({
            storeCode: "143",
            locationName: "KY Bowling Green",
            trackingActive: true,
            anchorReviewer: "Marla Quist",
          }),
          row({ storeCode: "140", locationName: "MO Kansas City Wornall" }),
        ]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Baseline all unconfigured locations/ }));
    const dialog = await screen.findByRole("dialog");

    expect(dialog.textContent).toContain("2 locations");
    expect(dialog.textContent).toContain("KS Manhattan");
    expect(dialog.textContent).toContain("MO Kansas City Wornall");
    /* The configured one is absent from the list of what will change. */
    expect(within(dialog).queryByText(/KY Bowling Green/)).toBeNull();
    expect(dialog.textContent).toContain("not touched");
  });

  it("baselines only the unconfigured, and never asks to replace", async () => {
    const user = userEvent.setup();
    render(
      <AnchorSetupScreen
        rows={[
          row({ storeCode: "306" }),
          row({ storeCode: "143", trackingActive: true, anchorReviewer: "Marla Quist" }),
          row({ storeCode: "140" }),
        ]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Baseline all unconfigured locations/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Baseline 2 locations/ }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].body.anchors).toEqual([
      { storeCode: "306", fromNewestHeld: true },
      { storeCode: "140", fromNewestHeld: true },
    ]);
    /*
     * NO `replace`, ANYWHERE IN THE BATCH. A convenience button that moved a
     * settled boundary would be the worst possible outcome of this feature, and
     * `applyAnchors` refuses it independently.
     */
    for (const anchor of posted[0].body.anchors) {
      expect(anchor.replace).toBeUndefined();
    }
  });

  it("excludes a location holding no reviews, and says so rather than failing it", async () => {
    const user = userEvent.setup();
    render(
      <AnchorSetupScreen
        rows={[
          row({ storeCode: "306" }),
          row({ storeCode: "143", locationName: "KY Bowling Green", heldReviews: 0, historicalReviews: 0 }),
        ]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Baseline all unconfigured locations/ }));
    const dialog = await screen.findByRole("dialog");

    expect(dialog.textContent).toContain("cannot be baselined until they are synced");
    expect(dialog.textContent).toContain("KY Bowling Green");
  });

  it("reports the outcome for each location separately", async () => {
    const user = userEvent.setup();
    render(
      <AnchorSetupScreen
        rows={[row({ storeCode: "306" }), row({ storeCode: "140" })]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Baseline all unconfigured locations/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /Baseline 2 locations/ }));

    await waitFor(() => expect(within(dialog).getAllByText(/Baseline set/).length).toBe(2));
    expect(dialog.textContent).toContain("306");
    expect(dialog.textContent).toContain("140");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("disables the bulk button when every location is already configured", () => {
    render(
      <AnchorSetupScreen
        rows={[row({ trackingActive: true, anchorReviewer: "Marla Quist" })]}
        openStoreCode={null}
        candidates={[]}
      />,
    );

    expect(
      (screen.getByRole("button", { name: /Baseline all unconfigured locations/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText(/Every location has a baseline/)).toBeTruthy();
  });
});
