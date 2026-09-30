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
    latestScanAt: null,
    scanProblems: [],
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
      { key: "body-0", kind: "body", title: "Attendance Policy", fileName: null, syncState: "waiting_for_audience", inAskSunny: false, ref: "ref-1", previewable: false, askSunnyDocumentId: null },
      { key: "attachment-1", kind: "attachment", title: "Attendance Policy — Attendance Policy", fileName: "Attendance Policy.pdf", syncState: "waiting_for_audience", inAskSunny: false, ref: "ref-2", previewable: false, askSunnyDocumentId: null },
    ],
    ...over,
  };
}

const CONTENT: WovenKnowledgeContent = {
  basis: "latest_scan",
  scannedAt: "2026-09-29T22:27:00Z",
  rows: [
    row({}),
    row({ key: "handbook:h1", title: "Team Member Handbook", contentType: "handbook", wovenStatus: "Published", audience: "Public", audienceDecision: "public", syncState: "new", parts: [{ key: "version-0", kind: "version", title: "Team Member Handbook", fileName: "Team Member Handbook.pdf", syncState: "new", inAskSunny: false, ref: "ref-3", previewable: false, askSunnyDocumentId: null }] }),
    row({ key: "procedure:r1", title: "Opening the Salon", contentType: "procedure", wovenStatus: "Listed", audience: "No audience stated", wovenUpdatedAt: null, syncState: "not_supported", parts: [{ key: "body-0", kind: "body", title: "Opening the Salon", fileName: null, syncState: "not_supported", inAskSunny: false, ref: "ref-4", previewable: false, askSunnyDocumentId: null }] }),
    row({ key: "knowledge_element:k1", title: "New Element", contentType: "knowledge_element", wovenStatus: "Draft", published: false, audience: "No audience stated", syncState: "unpublished", parts: [{ key: "body-0", kind: "body", title: "New Element", fileName: null, syncState: "unpublished", inAskSunny: false, ref: "ref-5", previewable: false, askSunnyDocumentId: null }] }),
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
  function withContent(content: WovenKnowledgeContent = CONTENT) {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/content") ? new Response(JSON.stringify({ status: "ok", content }), { status: 200 }) : new Response("{}", { status: 200 }),
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

  it("a procedure shows its step text and each attachment by the name people see, with their own states", async () => {
    withContent({
      ...CONTENT,
      basis: "manifest",
      rows: [
        row({
          key: "procedure:eom",
          title: "EOM Performance Eval",
          contentType: "procedure",
          wovenStatus: "Listed",
          audience: "No audience stated",
          audienceDecision: "company_wide",
          syncState: "up_to_date",
          parts: [
            { key: "body-0", kind: "body", title: "EOM Performance Eval", fileName: null, syncState: "up_to_date", inAskSunny: true, ref: "ref-6", previewable: false, askSunnyDocumentId: null },
            { key: "attachment-1", kind: "attachment", title: "EOM Performance Eval — 05. EOM Performance Evaluation Core Process", fileName: "05. EOM Performance Evaluation Core Process.pdf", syncState: "up_to_date", inAskSunny: true, ref: "ref-7", previewable: false, askSunnyDocumentId: null },
          ],
        }),
      ],
    });
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Content" }));
    await waitFor(() => expect(screen.getAllByTestId("content-row")).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: /EOM Performance Eval/ }));
    const parts = within(screen.getByRole("list", { name: "Parts of EOM Performance Eval" })).getAllByRole("listitem");
    expect(parts.map((p) => p.textContent)).toEqual(["Step text:Current", "Attachment:05. EOM Performance Evaluation Core Process.pdfCurrent"]);
  });

  it("a manual whose hand upload was replaced shows the current Woven copy and the stale upload", async () => {
    withContent({
      ...CONTENT,
      basis: "manifest",
      rows: [
        row({
          key: "handbook:jba",
          title: "JBA Policy Manual",
          contentType: "handbook",
          wovenStatus: "Published",
          audience: "Public",
          audienceDecision: "public",
          syncState: "up_to_date",
          parts: [
            { key: "version-0", kind: "version", title: "JBA Policy Manual", fileName: "JBA-Policy-Manual-Edited-5.2025.pdf", syncState: "up_to_date", inAskSunny: true, ref: "ref-8", previewable: false, askSunnyDocumentId: null },
            { key: "superseded_copy-0", kind: "superseded_copy", title: "JBA Policy Manual Edited 5.2025", fileName: null, syncState: "stale", inAskSunny: false, ref: "ref-9", previewable: false, askSunnyDocumentId: null },
          ],
        }),
      ],
    });
    render(<WovenKnowledgeScreen liveMode status={afterScan()} />);
    await userEvent.click(screen.getByRole("tab", { name: "Content" }));
    await waitFor(() => expect(screen.getAllByTestId("content-row")).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: /JBA Policy Manual/ }));
    const parts = within(screen.getByRole("list", { name: "Parts of JBA Policy Manual" })).getAllByRole("listitem");
    expect(parts.map((p) => p.textContent)).toEqual([
      "Current Woven copy:JBA-Policy-Manual-Edited-5.2025.pdfCurrent",
      "Previous uploaded copy:JBA Policy Manual Edited 5.2025Stale / Superseded",
    ]);
    /* The stale state finds it. */
    await userEvent.selectOptions(screen.getByLabelText("Sync state"), "stale");
    expect(screen.getAllByTestId("content-row")).toHaveLength(1);
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

describe("audience choices show what they affect, before anyone decides", () => {
  const LOTION: ContentRow = row({
    key: "file_library:fl1",
    title: "1 KEY TC Mastery - Safety 10.2024",
    contentType: "file_library",
    wovenStatus: "Published",
    audience: "N/A",
    audienceKey: "n/a",
    syncState: "waiting_for_audience",
    parts: [{ key: "file-0", kind: "file", title: "1 KEY TC Mastery - Safety 10.2024", fileName: "1 KEY TC Mastery - Safety 10.2024.pdf", syncState: "waiting_for_audience", inAskSunny: false, ref: "0123456789abcdef", previewable: true, askSunnyDocumentId: null }],
  });
  const withMembers = () =>
    afterScan({
      audienceReviews: [{ audienceKey: "n/a", label: "N/A", items: 66, decision: null, members: [LOTION], membersTotal: 66 }],
    });

  it("View items lists each title with its type, Woven status and sync state", async () => {
    render(<WovenKnowledgeScreen liveMode status={withMembers()} />);
    await userEvent.click(screen.getByRole("button", { name: "View items (66 in Woven)" }));
    const list = screen.getByRole("list", { name: "Items with audience N/A" });
    expect(within(list).getByText("1 KEY TC Mastery - Safety 10.2024")).toBeTruthy();
    expect(within(list).getByText("File Library · Published · Waiting for audience decision")).toBeTruthy();
    expect(within(list).getByText(/And 65 more/)).toBeTruthy();
  });

  it("Preview reads the file's text from the server, read-only, before the choice", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/preview-part")) {
        expect(JSON.parse(String(init?.body))).toEqual({ ref: "0123456789abcdef" });
        return new Response(
          JSON.stringify({
            status: "ok",
            preview: { title: LOTION.title, contentType: "file_library", sourceName: LOTION.title, fileName: "1 KEY TC Mastery - Safety 10.2024.pdf", askSunnyDocumentId: null, sections: [{ label: "", page: 2, text: "Always wear eye protection in the booth." }], characterCount: 40, truncated: false },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenKnowledgeScreen liveMode status={withMembers()} />);
    await userEvent.click(screen.getByRole("button", { name: "View items (66 in Woven)" }));
    await userEvent.click(screen.getByRole("button", { name: `Preview: ${LOTION.title}` }));
    const region = await screen.findByRole("region", { name: `Preview of ${LOTION.title}` });
    expect(within(region).getByText("Always wear eye protection in the booth.")).toBeTruthy();
    expect(within(region).getByText("p. 2")).toBeTruthy();
    expect(within(region).getByText(/not saved, not searchable/)).toBeTruthy();
  });

  it("Show in Content opens the Content tab filtered to exactly that audience group", async () => {
    const other = row({ key: "policy:p9", title: "Unrelated Policy", audience: "Public", audienceKey: "public", audienceDecision: "public", syncState: "up_to_date" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/content") ? new Response(JSON.stringify({ status: "ok", content: { ...CONTENT, basis: "manifest", rows: [LOTION, other] } }), { status: 200 }) : new Response("{}", { status: 200 }),
      ),
    );
    render(<WovenKnowledgeScreen liveMode status={withMembers()} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Show in Content" })[0]!);
    await waitFor(() => expect(screen.getAllByTestId("content-row")).toHaveLength(1));
    expect(screen.getByText("1 KEY TC Mastery - Safety 10.2024")).toBeTruthy();
    expect((screen.getByLabelText("Audience group") as HTMLSelectElement).value).toBe("n/a");
  });
});

describe("after setup: Scan Woven is always there, and it is only a preview", () => {
  const setUp = (over: Partial<WovenKnowledgeStatus> = {}) =>
    afterScan({
      setupStep: "done",
      headline: "up_to_date",
      settings: { source: "woven", autoSyncEnabled: true, intervalDays: 30, initialSyncCompletedAt: "2026-09-29T23:46:54Z", lastFullScanAt: "2026-09-30T11:54:29Z", lastSuccessAt: "2026-09-30T11:54:29Z" },
      attention: [],
      audienceReviews: [],
      awaitingAudience: 0,
      latestPreview: null,
      ...over,
    });

  it("Scan Woven asks for a preview run, and says Sync Now is what applies changes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "succeeded" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WovenKnowledgeScreen liveMode status={setUp()} />);
    expect(screen.getByText(/previews what changed — nothing is added, removed or replaced in Ask Sunny/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Scan Woven" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/admin/knowledge-sync/woven/run");
    expect(JSON.parse(String(init.body))).toEqual({ mode: "preview", confirmLargeRemoval: false });
  });

  it("the latest scan shows what Sync Now would do, and what it could not read", () => {
    render(
      <WovenKnowledgeScreen
        liveMode
        status={setUp({
          latestPreview: { ...PREVIEW, totals: { ...PREVIEW.totals, new: 350, updated: 2, unpublished: 1, removed: 0, permissionChanged: 0, unchanged: 78, needsReview: 95, blocked: 22, errors: 1 } },
          latestScanAt: "2026-09-30T13:00:00Z",
          scanProblems: ["22 Procedures items can't be read by Ask Sunny yet."],
        })}
      />,
    );
    const plan = screen.getByRole("region", { name: "What Sync Now would do" });
    expect(within(plan).getByText("Add to Ask Sunny").nextSibling?.textContent).toBe("350");
    expect(within(plan).getByText(/Take out of Ask Sunny/).nextSibling?.textContent).toBe("1");
    expect(within(plan).getByText("22 Procedures items can't be read by Ask Sunny yet.")).toBeTruthy();
  });

  it("a failing document is named, with its type, reason and retry status, and links into Content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/content")
          ? new Response(JSON.stringify({ status: "ok", content: { ...CONTENT, basis: "manifest", rows: [row({ key: "file_library:x", title: "Product Guide- Norvell Body Butter", contentType: "file_library", syncState: "error" }), row({ key: "policy:y", title: "Other" })] } }), { status: 200 })
          : new Response("{}", { status: 200 }),
      ),
    );
    render(
      <WovenKnowledgeScreen
        liveMode
        status={setUp({
          headline: "needs_attention",
          attention: [
            {
              code: "items_failing",
              message: "1 document could not be synced and needs a person. Ask Sunny has stopped retrying it.",
              count: 1,
              items: [{ title: "Product Guide- Norvell Body Butter", contentType: "file_library", reason: "No text could be read from this file — it looks like a scanned image.", retry: "stopped", nextRetryAt: null, rowKey: "file_library:x" }],
            },
            { code: "work_continues", message: "350 items are still being processed. Ask Sunny continues them automatically at the next hourly check.", count: 350 },
          ],
        })}
      />,
    );
    const failing = screen.getByTestId("attention-items_failing");
    expect(within(failing).getByText("Product Guide- Norvell Body Butter")).toBeTruthy();
    expect(within(failing).getByText("File Library · No text could be read from this file — it looks like a scanned image.")).toBeTruthy();
    expect(within(failing).getByText("Stopped retrying — needs a person")).toBeTruthy();
    expect(screen.getByText("350 items are still being processed. Ask Sunny continues them automatically at the next hourly check.")).toBeTruthy();
    await userEvent.click(within(failing).getByRole("button", { name: "Show in Content" }));
    await waitFor(() => expect(screen.getAllByTestId("content-row")).toHaveLength(1));
    expect((screen.getByLabelText("Search by title") as HTMLInputElement).value).toBe("Product Guide- Norvell Body Butter");
  });
});
