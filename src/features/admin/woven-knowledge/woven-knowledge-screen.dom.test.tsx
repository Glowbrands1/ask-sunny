// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { WovenKnowledgeStatus } from "@/lib/knowledge-sync/woven/status";
import { WovenKnowledgeScreen } from "./woven-knowledge-screen";

/**
 * The Woven Knowledge Sync screen is for a busy manager: a headline state,
 * plain counts, Sync Now and View Sync Details. Setup shows until it is done;
 * technical detail stays under Advanced, closed.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function status(overrides: Partial<WovenKnowledgeStatus> = {}): WovenKnowledgeStatus {
  return {
    enabled: true,
    missingCredentials: [],
    company: "JB & Associates",
    database: "ready",
    previewTestMode: false,
    headline: "up_to_date",
    setupStep: "done",
    settings: {
      source: "woven",
      autoSyncEnabled: true,
      intervalDays: 30,
      initialSyncCompletedAt: "2026-09-29T12:00:00Z",
      lastFullScanAt: "2026-09-29T12:00:00Z",
      lastSuccessAt: "2026-09-29T12:00:00Z",
    },
    running: null,
    lastSuccessAt: "2026-09-29T12:00:00Z",
    lastCheckedAt: "2026-09-29T12:00:00Z",
    nextSyncAt: "2026-10-29T12:00:00Z",
    documentsInSync: 642,
    lastSync: { new: 4, updated: 2, removed: 0 },
    needsAttention: 0,
    attention: [],
    latestScanAt: null,
    scanProblems: [],
    latestPreview: null,
    audienceReviews: [],
    awaitingAudience: 0,
    advanced: { scheduleDeployed: false, byType: null, blockedByCapability: { file_library_download: 590 }, failingItems: [], recentRuns: [], problems: [] },
    ...overrides,
  };
}

describe("Woven Knowledge Sync screen", () => {
  it("shows the manager's view: state, company, dates and counts", () => {
    render(<WovenKnowledgeScreen liveMode status={status()} />);
    expect(screen.getByTestId("headline").textContent).toContain("Up to date");
    expect(screen.getByText("Company: JB & Associates")).toBeTruthy();
    expect(screen.getAllByText("Sep 29, 2026")).toHaveLength(2);
    expect(screen.getByText("Oct 29, 2026")).toBeTruthy();
    expect(screen.getByText("642")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sync Now/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /View Sync Details/ })).toBeTruthy();
    /* No setup once set up; technical detail is closed. */
    expect(screen.queryByText("First-time setup")).toBeNull();
    expect((screen.getByText("Advanced").closest("details") as HTMLDetailsElement).open).toBe(false);
  });

  it("walks a new administrator through setup, and Sync Now waits for the initial sync", () => {
    render(
      <WovenKnowledgeScreen
        liveMode
        status={status({ headline: "setup_in_progress", setupStep: "scan", settings: { ...status().settings!, initialSyncCompletedAt: null, autoSyncEnabled: false }, nextSyncAt: null, lastSync: null })}
      />,
    );
    expect(screen.getByText("First-time setup")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Run Initial Scan/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Sync Now/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("After setup")).toBeTruthy();
  });

  it("asks for credentials by variable name only when they are missing", () => {
    render(<WovenKnowledgeScreen liveMode status={status({ headline: "not_set_up", setupStep: "connect", missingCredentials: ["WOVEN_TEAM_PASSWORD"] })} />);
    expect(screen.getByText(/WOVEN_TEAM_PASSWORD/)).toBeTruthy();
    expect(screen.getByTestId("headline").textContent).toContain("Not set up");
  });

  it("puts an audience decision in front of the administrator, and saves it", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <WovenKnowledgeScreen
        liveMode
        status={status({
          headline: "needs_attention",
          needsAttention: 3,
          attention: [{ code: "audience_review", message: "3 items are shared with only some teams in Woven.", count: 3 }],
          audienceReviews: [{ audienceKey: "managers", label: "Managers", items: 3, decision: null }],
        })}
      />,
    );
    expect(screen.getByTestId("headline").textContent).toContain("Needs attention");
    fireEvent.click(screen.getByRole("button", { name: "Share with everyone" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/knowledge-sync/woven/audiences");
    expect(JSON.parse(String(init.body))).toEqual({ audienceKey: "managers", decision: "company_wide" });
  });

  it("Sync Now calls the one sync engine", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "succeeded" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenKnowledgeScreen liveMode status={status()} />);
    fireEvent.click(screen.getByRole("button", { name: /Sync Now/ }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/up to date/i));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/knowledge-sync/woven/run");
    expect(JSON.parse(String(init.body))).toMatchObject({ mode: "sync" });
  });

  it("Preview test mode: says results are not saved, offers only Test Connection and Run Initial Scan", () => {
    render(<WovenKnowledgeScreen liveMode status={status({ database: "missing", previewTestMode: true })} />);
    expect(screen.getByText("Preview test mode — results are not saved")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Test Connection/ })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /Run Initial Scan/ })).toHaveProperty("disabled", false);
    expect(screen.queryByRole("button", { name: /Sync Now/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Start Initial Sync/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Enable Automatic Sync/ })).toBeNull();
  });

  it("Preview test mode: shows the scan's counts from the response", async () => {
    const report = {
      mode: "preview",
      trigger: "manual",
      company: { companyLabel: "JB & Associates", companyVerified: true },
      byType: {
        handbook: { listing: "ok", listingCode: null, discovered: 3, items: 3, eligible: 2, excludedUnpublished: 1, excludedUnsupported: 0, excludedByDecision: 0, needsReview: 0, blocked: 0, blockedCapabilities: [], statusValues: {}, new: 2, updated: 0, unchanged: 0, permissionChanged: 0, unpublished: 0, removed: 0, errors: 0 },
        course: { listing: "failed", listingCode: "woven_antiforgery_rejected", discovered: 0, items: 0, eligible: 0, excludedUnpublished: 0, excludedUnsupported: 0, excludedByDecision: 0, needsReview: 0, blocked: 0, blockedCapabilities: [], statusValues: {}, new: 0, updated: 0, unchanged: 0, permissionChanged: 0, unpublished: 0, removed: 0, errors: 0 },
      },
      totals: { discovered: 3, inSync: 0, new: 2, updated: 0, metadataOnly: 0, unchanged: 0, permissionChanged: 0, unpublished: 0, removed: 0, excluded: 1, needsReview: 0, blocked: 0, errors: 0, deferred: 0, removalsHeld: 0 },
      audiences: [],
      possibleManualDuplicates: 0,
      attention: [],
      requestsMade: 12,
      durationMs: 9000,
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/run")
        ? new Response(JSON.stringify({ status: "succeeded_with_warnings", previewTestMode: true, report }), { status: 200 })
        : new Response(JSON.stringify({ status: "ok", sync: status({ database: "missing", previewTestMode: true }) }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenKnowledgeScreen liveMode status={status({ database: "missing", previewTestMode: true })} />);
    fireEvent.click(screen.getByRole("button", { name: /Run Initial Scan/ }));
    await waitFor(() => expect(screen.getByText(/nothing was saved/)).toBeTruthy());
    expect(screen.getByText("Scan result — JB & Associates")).toBeTruthy();
    expect(screen.getByText("Handbooks")).toBeTruthy();
    expect(screen.getByText(/woven_antiforgery_rejected/)).toBeTruthy();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ mode: "preview" });
  });

  it("Production without the tables shows no test mode", () => {
    render(<WovenKnowledgeScreen liveMode status={status({ database: "missing", previewTestMode: false })} />);
    expect(screen.queryByText("Preview test mode — results are not saved")).toBeNull();
    expect(screen.queryByRole("button", { name: /Run Initial Scan/ })).toBeNull();
  });

  it("says plainly when the database tables are not installed", () => {
    render(<WovenKnowledgeScreen liveMode status={status({ database: "missing" })} />);
    expect(screen.getByText("Not installed yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sync Now/ })).toBeNull();
  });
});
