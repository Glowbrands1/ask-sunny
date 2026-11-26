// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { AddressButton } from "./address-button";

/**
 * "Show address" on the Employee Directory (Pau, 26 Nov 2026): a click for everyone; for the named account
 * ("for my access only, please show all employe adress withouth cicking"), the address loads by itself.
 * Invented addresses only.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ status: "found", address: "412 Ashgrove Ln, Lincoln, NE 68508" }), { status: 200 });
  });
  return calls;
}

describe("AddressButton", () => {
  it("asks Woven only when clicked", async () => {
    const calls = stubFetch();
    render(<AddressButton directoryId="row-1" />);
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /show address/i }));
    expect(await screen.findByText("412 Ashgrove Ln, Lincoln, NE 68508")).toBeTruthy();
    expect(calls).toEqual(["/api/admin/employees/woven/address?id=row-1"]);
  });

  it("loads the address by itself for the named account", async () => {
    const calls = stubFetch();
    render(<AddressButton directoryId="row-2" auto />);
    expect(await screen.findByText("412 Ashgrove Ln, Lincoln, NE 68508")).toBeTruthy();
    expect(calls).toEqual(["/api/admin/employees/woven/address?id=row-2"]);
  });
});
