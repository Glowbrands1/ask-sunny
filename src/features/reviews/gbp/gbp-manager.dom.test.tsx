// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { buildOverview } from "@/lib/reviews/gbp/overview";

import { GbpManager } from "./gbp-manager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

const apify = { enabled: true, scheduleEnabled: true, lastRunAt: null, lastRunStatus: null, lastSuccessAt: null };
const env = (extra: Record<string, string> = {}) => ({ GBP_SYNC_MODE: "dry_run", GOOGLE_GBP_CLIENT_ID: "id", GOOGLE_GBP_CLIENT_SECRET: "SECRET-VALUE", GOOGLE_GBP_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"), NEXT_PUBLIC_SITE_URL: "https://ask-sunny.example", ...extra }) as unknown as NodeJS.ProcessEnv;

describe("GbpManager", () => {
  it("offers a Connect Google link (no typing) and keeps live actions disabled", () => {
    const overview = buildOverview({ listings: [], runs: [], connection: null }, apify, { env: env() });
    const { container } = render(<GbpManager initial={overview} />);
    const link = screen.getByRole("link", { name: "Connect Google" });
    expect(link.getAttribute("href")).toBe("/api/admin/reviews/gbp/connect");
    expect((screen.getByRole("button", { name: /Sync Google Reviews now/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Run live backfill/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.innerHTML).not.toContain("SECRET-VALUE");
  });

  it("states which provider is active and which is dry-run", () => {
    const overview = buildOverview({ listings: [], runs: [], connection: null }, apify, { env: env() });
    render(<GbpManager initial={overview} />);
    expect(screen.getByText(/dry-run only/)).toBeTruthy();
    expect(screen.getByText("Apify:")).toBeTruthy();
  });

  it("backfill report lists every listing, marks unmapped ones as not measured, and splits Sep/Oct", () => {
    const listing = (storeCode: string) => ({ locationId: storeCode, storeCode, label: `Salon ${storeCode}`, salonName: `Salon ${storeCode}`, district: null, isActive: true, listingState: "active", apifySourceStatus: null, hasVerifiedPlaceId: false, expectedAddress: { street: null, city: null, state: null, postalCode: null }, mappingStatus: "unmapped", gbpAccountName: null, gbpLocationName: null, confirmedAt: null, confirmedBy: null, reviewsHeld: 0, reviewsLinked: 0, openReviewItems: 0 });
    const overview = buildOverview({ listings: ["101", "102", "103"].map(listing), runs: [], connection: null }, apify, { env: env() });
    overview.lastBackfillDryRun = { id: "r", startedAt: "2026-10-16T10:00:00Z", finishedAt: "2026-10-16T10:00:01Z", mode: "dry_run", scope: "backfill", trigger: "admin", status: "succeeded", requests: 1, errorCode: null, summary: { filing: "enrich_only", window: { from: "2026-09-01", to: "2026-11-01" }, locations: [{ storeCode: "101", status: "ok", errorCode: null, fetched: 5, complete: true, truncated: false, skippedInvalid: 0, resourceMismatch: 0, alreadyLinked: 3, autoMatched: 0, newReviews: 2, deferredNewReviews: 0, needsReview: 0, unmatchedStored: 0, storedTotal: 3, googleTotal: 5, googleByMonth: { "2026-09": 3, "2026-10": 2 }, missingByMonth: { "2026-10": 2 }, inWindow: { google: 5, alreadyHeld: 3, missing: 2, needsReview: 0 }, projectedIfFull: null }] } };
    render(<GbpManager initial={overview} />);
    expect(screen.getAllByText(/not mapped — not measured/)).toHaveLength(2);
    expect(screen.getByText(/2 of 3 locations were not measured/)).toBeTruthy();
    expect(screen.getByText("3 / 0")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
  });
});
