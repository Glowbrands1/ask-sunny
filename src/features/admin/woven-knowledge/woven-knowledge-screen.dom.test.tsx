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
    latestPreview: null,
    audienceReviews: [],
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

  it("says plainly when the database tables are not installed", () => {
    render(<WovenKnowledgeScreen liveMode status={status({ database: "missing" })} />);
    expect(screen.getByText("Not installed yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sync Now/ })).toBeNull();
  });
});
