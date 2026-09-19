// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { ApifyLocationMapping } from "@/lib/reviews/apify/types";

import { ExpectedAddressForm } from "./source-actions";

/**
 * ============================================================================
 * PASTING ONE ADDRESS PER SALON, AND WHAT THE FORM IS NOT ALLOWED TO DO WITH IT
 * ============================================================================
 *
 * Fifteen salons times five fields is seventy-five pieces of transcription for
 * information that is already on the clipboard in one line. The paste field
 * removes that — and these tests are the line around it:
 *
 *   IT FILLS EMPTY FIELDS AND SHOWS WHAT IT FILLED. There is nothing to lose
 *   and the result is visible, so waiting for a second press would be friction
 *   for its own sake.
 *
 *   IT NEVER REPLACES SOMETHING SOMEBODY TYPED WITHOUT ASKING. They put that
 *   value there on purpose. The preview names the field, shows the old value
 *   beside the new one, and waits.
 *
 *   IT SHOWS THE PASTED LINE BACK WHEN IT IS UNSURE, rather than filling in a
 *   guess. A wrong street here is what the Google search gets built from.
 *
 *   THE FIELDS STAY EDITABLE, always, because a parser that is right nineteen
 *   times in twenty still needs the twentieth corrected by hand.
 *
 * Every address below is invented.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

afterEach(cleanup);

function location(overrides: Partial<ApifyLocationMapping> = {}): ApifyLocationMapping {
  return {
    storeCode: "306",
    salonNumber: "0462",
    locationName: "KS Manhattan",
    district: "Patterson, Madeline",
    googleLocationLabel: "Sun Tan City - KS Manhattan",
    listingState: "verified",
    isActive: true,
    googlePlaceId: null,
    googleCid: null,
    googleMapsUrl: null,
    canonicalGoogleName: null,
    canonicalGoogleAddress: null,
    expectedStreetAddress: null,
    expectedCity: null,
    expectedState: null,
    expectedPostalCode: null,
    expectedCountry: "United States",
    expectedStreetHint: null,
    sourceStatus: "unconfigured",
    lastVerifiedAt: null,
    verificationNote: null,
    discoveryStatus: "not_searched",
    discoveredPlaceId: null,
    discoveredName: null,
    discoveredAddress: null,
    discoveredMapsUrl: null,
    discoveredCid: null,
    discoveryCandidateCount: 0,
    discoveredAt: null,
    discoveryNote: null,
    discoveryQuery: null,
    countingActive: false,
    reviewsTotal: 0,
    reviewsFromApify: 0,
    reviewsFromBrave: 0,
    latestPublishedAt: null,
    latestSeenAt: null,
    ...overrides,
  };
}

/** Paste text into a salon's paste box, the way a browser delivers it. */
function paste(salon: string, text: string) {
  const box = screen.getByLabelText(`Paste full Google Maps address for ${salon}`);
  fireEvent.paste(box, { clipboardData: { getData: () => text } });
  return box;
}

function field(salon: string, label: string): HTMLInputElement {
  return screen.getByLabelText(`${label} for ${salon}`) as HTMLInputElement;
}

describe("pasting one line into five fields", () => {
  it("fills every empty field and says what it filled", () => {
    render(<ExpectedAddressForm locations={[location()]} />);

    paste("KS Manhattan", "2624 Iowa St Ste B, Lawrence, KS 66046, United States");

    expect(field("KS Manhattan", "Street address").value).toBe("2624 Iowa St Ste B");
    expect(field("KS Manhattan", "City").value).toBe("Lawrence");
    expect(field("KS Manhattan", "State").value).toBe("KS");
    expect(field("KS Manhattan", "ZIP").value).toBe("66046");
    expect(field("KS Manhattan", "Country").value).toBe("United States");

    /* The result is shown as well as applied. */
    expect(screen.getByText(/Filled from the pasted address/)).toBeTruthy();
  });

  it("SUPPLIES THE COUNTRY ONLY FOR A SALON ALREADY ON RECORD AS US", () => {
    /*
     * A Maps copy usually omits the country. The parser does not invent one —
     * the form fills it from what the salon already says, which is a different
     * claim from guessing where a place we just failed to read might be.
     */
    render(<ExpectedAddressForm locations={[location()]} />);
    paste("KS Manhattan", "2624 Iowa St, Lawrence, KS 66046");

    expect(field("KS Manhattan", "Country").value).toBe("United States");
  });

  it("leaves the country blank when the salon does not claim one", () => {
    render(
      <ExpectedAddressForm locations={[location({ expectedCountry: null })]} />,
    );
    paste("KS Manhattan", "2624 Iowa St, Lawrence, KS 66046");

    expect(field("KS Manhattan", "Country").value).toBe("");
  });

  it("keeps the fields editable afterwards", () => {
    render(<ExpectedAddressForm locations={[location()]} />);
    paste("KS Manhattan", "2624 Iowa St, Lawrence, KS 66046");

    const street = field("KS Manhattan", "Street address");
    fireEvent.change(street, { target: { value: "2626 Iowa St" } });
    expect(street.value).toBe("2626 Iowa St");
  });

  it("reads a block pasted across several lines", () => {
    render(<ExpectedAddressForm locations={[location()]} />);
    paste("KS Manhattan", "100 Main St\nOmaha, NE 68102\nUnited States");

    expect(field("KS Manhattan", "Street address").value).toBe("100 Main St");
    expect(field("KS Manhattan", "City").value).toBe("Omaha");
    expect(field("KS Manhattan", "State").value).toBe("NE");
  });
});

describe("what it refuses to do on its own", () => {
  it("DOES NOT REPLACE A FILLED FIELD — it shows the swap and waits", () => {
    render(
      <ExpectedAddressForm
        locations={[location({ expectedCity: "Manhattan", expectedState: "KS" })]}
      />,
    );

    paste("KS Manhattan", "2624 Iowa St, Lawrence, KS 66046");

    /* Nothing moved. */
    expect(field("KS Manhattan", "City").value).toBe("Manhattan");
    expect(field("KS Manhattan", "Street address").value).toBe("");

    /* And the swap is on screen, both sides of it. */
    expect(screen.getByText("Manhattan")).toBeTruthy();
    expect(screen.getByText("Lawrence")).toBeTruthy();
    expect(screen.getByText(/replaces/i)).toBeTruthy();
  });

  it("applies the replacement once it is pressed", () => {
    render(
      <ExpectedAddressForm locations={[location({ expectedCity: "Manhattan" })]} />,
    );

    paste("KS Manhattan", "2624 Iowa St, Lawrence, KS 66046");
    fireEvent.click(screen.getByRole("button", { name: /Replace these fields/ }));

    expect(field("KS Manhattan", "City").value).toBe("Lawrence");
    expect(field("KS Manhattan", "Street address").value).toBe("2624 Iowa St");
  });

  it("leaves everything alone when the offer is declined", () => {
    render(
      <ExpectedAddressForm locations={[location({ expectedCity: "Manhattan" })]} />,
    );

    paste("KS Manhattan", "2624 Iowa St, Lawrence, KS 66046");
    fireEvent.click(screen.getByRole("button", { name: /Leave as is/ }));

    expect(field("KS Manhattan", "City").value).toBe("Manhattan");
    expect(screen.queryByText(/replaces/i)).toBeNull();
  });

  it("SHOWS THE PASTED LINE BACK WHEN IT CANNOT READ IT CONFIDENTLY", () => {
    /*
     * Selecting the whole Maps panel copies the listing's NAME in front of the
     * address. Accepting that would search for the brand twice and the building
     * never, so the form says what it saw rather than filling in a guess.
     */
    render(<ExpectedAddressForm locations={[location()]} />);
    paste("KS Manhattan", "Sun Tan City, 2624 Iowa St, Lawrence, KS 66046");

    expect(screen.getByText(/does not begin with a street number/)).toBeTruthy();
    expect(screen.getByText(/Read from:/)).toBeTruthy();
    /* Nothing was written without being confirmed. */
    expect(field("KS Manhattan", "City").value).toBe("");
  });

  it("refuses a plus-code and explains where to find the address", () => {
    render(<ExpectedAddressForm locations={[location()]} />);
    paste("KS Manhattan", "QX7V+2M Lawrence, KS, United States");

    expect(screen.getByText(/plus-code/)).toBeTruthy();
    expect(field("KS Manhattan", "Street address").value).toBe("");
  });

  it("offers the fields it could read when only one part failed", () => {
    render(<ExpectedAddressForm locations={[location()]} />);
    paste("KS Manhattan", "100 Main St, Lawrence, Kanas 66046");

    expect(screen.getByText(/not a state this recognises/)).toBeTruthy();

    /* The parts it DID read are still on offer rather than thrown away. */
    fireEvent.click(screen.getByRole("button", { name: /Fill these fields/ }));
    expect(field("KS Manhattan", "Street address").value).toBe("100 Main St");
    expect(field("KS Manhattan", "City").value).toBe("Lawrence");
    expect(field("KS Manhattan", "State").value).toBe("");
  });
});

describe("saving", () => {
  it("sends only the salons somebody actually touched", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        calls.push(String(init.body));
        return {
          ok: true,
          json: async () => ({ status: "ok", addressOutcomes: [{ storeCode: "306", status: "ok" }] }),
        } as Response;
      }),
    );

    render(
      <ExpectedAddressForm
        locations={[location(), location({ storeCode: "140", locationName: "MO Wornall" })]}
      />,
    );

    paste("KS Manhattan", "2624 Iowa St, Lawrence, KS 66046");
    fireEvent.click(screen.getByRole("button", { name: /Save 1 expected address/ }));

    await screen.findByText(/1 address saved/);

    const body = JSON.parse(calls[0]) as { addresses: { storeCode: string }[] };
    expect(body.addresses).toHaveLength(1);
    expect(body.addresses[0].storeCode).toBe("306");

    vi.unstubAllGlobals();
  });

  it("offers nothing to save until something changes", () => {
    render(<ExpectedAddressForm locations={[location()]} />);

    const save = screen.getByRole("button", { name: /Save expected addresses/ });
    expect(save).toHaveProperty("disabled", true);
  });

  it("names both numbering systems on every card", () => {
    /* Google's store 306 is ASK Sunny's salon 0462, and somebody pasting an
       address for one has to see they are pasting it for the other. */
    render(<ExpectedAddressForm locations={[location()]} />);

    const card = screen.getByText("KS Manhattan").closest("article") as HTMLElement;
    expect(within(card).getByText(/store 306 · salon 0462/)).toBeTruthy();
  });
});
