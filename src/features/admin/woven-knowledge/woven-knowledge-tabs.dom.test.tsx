// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ContentRow } from "@/lib/knowledge-sync/inventory";
import type { SyncReport } from "@/lib/knowledge-sync/types";
import type { WovenKnowledgeContent, WovenKnowledgeStatus } from "@/lib/knowledge-sync/woven/status";
import { WovenKnowledgeScreen } from "./woven-knowledge-screen";

/**
 * The screen after the Production Initial Scan: the counts said "29 wait for
 * an audience choice above" and no choice was shown. And the admin could see
 * counts but not WHAT Woven holds. Overview, Content and Sync History.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function typeReport(over: Partial<SyncReport["byType"]["policy"]> = {}) {
  return { listing: "ok", listingCode: null, discovered: 22, items: 29, eligible: 29, excludedUnpublished: 0, excludedUnsupported: 0, excludedByDecision: 0, needsReview: 29, blocked: 0, blockedCapabilities: [], statusValues: {}, new: 0, updated: 0, unchanged: 0, permissionChanged: 0, unpublished: 0, removed: 0, errors: 0, ...over } as NonNullable<SyncReport["byType"]["policy"]>;
}

const PREVIEW: SyncReport = {
  mode: "preview",
  trigger: "manual",
  company: { companyLabel: "JB & Associates", companyVerified: true },
  byType: { policy: typeReport(), handbook: typeReport({ discovered: 1, items: 1, eligible: 1, needsReview: 0, new: 1 }) },
  totals: { discovered: 23, inSync: 0, new: 1, updated: 0, metadataOnly: 0, unchanged: 0, permissionChanged: 0, unpublished: 0, removed: 0, excluded: 0, needsReview: 29, blocked: 0, errors: 0, deferred: 0, removalsHeld: 0 },
  audiences: [],
  possibleManualDuplicates: 0,
  attention: [],
  requestsMade: 48,
  durationMs: 35000,
};

function afterScan(overrides: Partial<WovenKnowledgeStatus> = {}): WovenKnowledgeStatus {
  return {
    enabled: true,
    missingCredentials: [],
    company: "JB & Associates",
    database: "ready",
    previewTestMode: false,
    headline: "needs_attention",
    setupStep: "initial_sync",
    settings: { source: "woven", autoSyncEnabled: false, intervalDays: 30, initialSyncCompletedAt: null, lastFullScanAt: null, lastSuccessAt: null },
    running: null,
    lastSuccessAt: null,
    lastCheckedAt: null,
    nextSyncAt: null,
    documentsInSync: 0,
    lastSync: null,
    needsAttention: 29,
    attention: [{ code: "audience_review", message: "29 items are shared with only some teams in Woven. Choose who should see them in Ask Sunny.", count: 29 }],
    latestPreview: PREVIEW,
    audienceReviews: [
      { audienceKey: "15 teams 5 positions", label: "15 Teams 5 Positions", items: 4, decision: null },
      { audienceKey: "all teams 8 positions", label: "All Teams 8 Positions", items: 1, decision: null },
    ],
    awaitingAudience: 29,
    advanced: {
      scheduleDeployed: true,
      byType: PREVIEW.byType,
      blockedByCapability: {},
      failingItems: [],
      recentRuns: [
        {
          id: "run-2",
          mode: "preview",
          trigger: "manual",
          status: "succeeded",
          startedAt: "2026-09-29T22:26:44Z",
          finishedAt: "2026-09-29T22:27:20Z",
          errorCode: null,
          totals: PREVIEW.totals,
          notes: [{ code: "audience_review", message: "29 published items are limited to specific teams or positions in Woven." }],
          company: "JB & Associates",
        },
        {
          id: "run-1",
          mode: "preview",
          trigger: "manual",
          status: "failed",
          startedAt: "2026-09-29T20:53:52Z",
          finishedAt: "2026-09-29T20:53:54Z",
          errorCode: "woven_company_selection_unverified",
          totals: null,
          notes: [{ code: "woven_company_selection_unverified", message: "Woven sync needs attention: the account chooser needs a browser capture." }],
          company: null,
        },
      ],
      problems: [],
    },
    ...overrides,
  };
}

function row(over: Partial<ContentRow>): ContentRow {
  return {
    key: "policy:p1",
    title: "Attendance Policy",
    contentType: "policy",
    wovenStatus: "current",
    published: true,
    audience: "15 Teams 5 Positions",
    audienceKey: "15 teams 5 positions",
    audienceDecision: null,
    version: "Version 2",
    wovenUpdatedAt: "2025-05-01",
    firstSeenAt: "2026-09-29T22:27:00Z",
    lastSeenAt: "2026-09-29T22:27:00Z",
    lastSyncedAt: null,
    syncState: "waiting_for_audience",
    askSunny: [],
    parts: [
      { partKey: "content", kind: "body", title: "Attendance Policy", fileName: null, syncState: "waiting_for_audience", inAskSunny: false },
      { partKey: "attachment:a1", kind: "attachment", title: "Attendance Policy — Attendance Policy", fileName: "Attendance Policy.pdf", syncState: "waiting_for_audience", inAskSunny: false },
    ],
    ...over,
  };
}

const CONTENT: WovenKnowledgeContent = {
  basis: "latest_scan",
  scannedAt: "2026-09-29T22:27:00Z",
  rows: [
    row({}),
    row({ key: "handbook:h1", title: "Team Member Handbook", contentType: "handbook", wovenStatus: "Published", audience: "Public", audienceDecision: "public", syncState: "new", parts: [{ partKey: "current-version", kind: "version", title: "Team Member Handbook", fileName: "Team Member Handbook.pdf", syncState: "new", inAskSunny: false }] }),
    row({ key: "procedure:r1", title: "Opening the Salon", contentType: "procedure", wovenStatus: "Listed", audience: "No audience stated", wovenUpdatedAt: null, syncState: "not_supported", parts: [{ partKey: "content", kind: "body", title: "Opening the Salon", fileName: null, syncState: "not_supported", inAskSunny: false }] }),
    row({ key: "knowledge_element:k1", title: "New Element", contentType: "knowledge_element", wovenStatus: "Draft", published: false, audience: "No audience stated", syncState: "unpublished", parts: [{ partKey: "content", kind: "body", title: "New Element", fileName: null, syncState: "unpublished", inAskSunny: false }] }),
  ],
};

describe("Overview after the Initial Scan", () => {
  it("renders the audience choices the counts refer to — never 'wait for a choice' with no choices", () => {
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    expect(screen.getByText(/29 wait for an audience choice above, and are not added until you choose/)).toBeTruthy();
    expect(screen.getByText("15 Teams 5 Positions")).toBeTruthy();
    expect(screen.getByText("4 items")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Share with everyone" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Keep out of Ask Sunny" })).toHaveLength(2);
  });

  it("the choices show even when no other attention item is present", () => {
    render(<WovenKnowledgeScreen liveMode status={afterScan({ attention: [] })} />);
    expect(screen.getAllByRole("button", { name: "Share with everyone" })).toHaveLength(2);
  });

  it("keeping an audience out saves that group's key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Keep out of Ask Sunny" })[1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/knowledge-sync/woven/audiences");
    expect(JSON.parse(String(init.body))).toEqual({ audienceKey: "all teams 8 positions", decision: "excluded" });
  });

  it("once every audience has a choice, the summary says so", () => {
    render(<WovenKnowledgeScreen liveMode status={afterScan({ awaitingAudience: 0, audienceReviews: [{ audienceKey: "15 teams 5 positions", label: "15 Teams 5 Positions", items: 4, decision: "company_wide" }], attention: [] })} />);
    expect(screen.getByText(/Every audience has a choice\. 29 follow the audience choices already made\./)).toBeTruthy();
  });
});

describe("Content", () => {
  function withContent() {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/content") ? new Response(JSON.stringify({ status: "ok", content: CONTENT }), { status: 200 }) : new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("lists what Woven holds by title, one row per item, loaded only when the tab is opened", async () => {
    const fetchMock = withContent();
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("tab", { name: "Content" }));
    await waitFor(() => expect(screen.getAllByTestId("content-row")).toHaveLength(4));
    expect(screen.getByText(/What the latest scan found in Woven/)).toBeTruthy();
    expect(screen.getByText("Attendance Policy")).toBeTruthy();
    expect(screen.getByText("Team Member Handbook")).toBeTruthy();
    /* No invented date. */
    expect(screen.getByText("Updated date unavailable")).toBeTruthy();
    expect(screen.getAllByText("Waiting for audience decision").length).toBeGreaterThan(0);
  });

  it("a multi-part item expands to its parts, each with its own state", async () => {
    withContent();
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Content" }));
    await waitFor(() => expect(screen.getAllByTestId("content-row")).toHaveLength(4));
    await userEvent.click(screen.getByRole("button", { name: /Attendance Policy/ }));
    const parts = screen.getByRole("list", { name: "Parts of Attendance Policy" });
    expect(within(parts).getByText("Attendance Policy.pdf")).toBeTruthy();
    expect(within(parts).getByText("Text:")).toBeTruthy();
    expect(within(parts).getByText("Attachment:")).toBeTruthy();
  });

  it("filters by title, type, sync state, publication and audience decision", async () => {
    withContent();
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Content" }));
    await waitFor(() => expect(screen.getAllByTestId("content-row")).toHaveLength(4));

    await userEvent.type(screen.getByLabelText("Search by title"), "handbook");
    expect(screen.getAllByTestId("content-row")).toHaveLength(1);
    await userEvent.clear(screen.getByLabelText("Search by title"));

    await userEvent.selectOptions(screen.getByLabelText("Content type"), "procedure");
    expect(screen.getAllByTestId("content-row")).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText("Content type"), "all");

    await userEvent.selectOptions(screen.getByLabelText("Sync state"), "waiting_for_audience");
    expect(screen.getAllByTestId("content-row")).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText("Sync state"), "all");

    await userEvent.selectOptions(screen.getByLabelText("Published or draft"), "draft");
    expect(screen.getAllByTestId("content-row")).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText("Published or draft"), "all");

    await userEvent.selectOptions(screen.getByLabelText("Audience decision"), "public");
    expect(screen.getAllByTestId("content-row")).toHaveLength(1);
  });
});

describe("Sync History", () => {
  it("lists past runs with outcome, counts and plain notes; codes stay in Advanced", async () => {
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Sync History" }));
    const rows = screen.getAllByTestId("history-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Succeeded")).toBeTruthy();
    expect(within(rows[0]!).getByText("Scan (nothing changed)")).toBeTruthy();
    expect(within(rows[1]!).getByText("Failed")).toBeTruthy();
    expect(within(rows[1]!).getByText(/needs a browser capture/)).toBeTruthy();
    expect(within(rows[1]!).queryByText(/woven_company_selection_unverified/)).toBeNull();
  });
});
