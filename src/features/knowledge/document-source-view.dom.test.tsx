// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { KnowledgeDocument } from "@/types";

/**
 * ============================================================================
 * THE DOCUMENT BEHIND A CITATION — AND NOTHING ELSE IN THE LIBRARY
 * ============================================================================
 *
 * The Knowledge Base screen became administrators-only, which would have broken
 * something real if it had stopped there: a citation under Sunny's answer is a
 * promise that the quote came from somewhere, and the rows beneath every answer
 * pointed at that screen.
 *
 * So this page exists, and it has one job with a hard edge on either side. It
 * must SHOW the cited document to a Regional Manager or an Employee — title,
 * metadata, preview, download — and it must not become a way to see what else
 * the company holds.
 *
 * The edge is enforced in the DATA, not in the markup: the only call this page
 * makes is for one document by id. These tests assert both — that the document
 * renders, and that no management control or route to the library renders with
 * it.
 */

const DOC_ID = "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d";

function documentFixture(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: DOC_ID,
    title: "Sun Tan City Attendance Policy",
    description: "Ready to work at the start of the scheduled shift.",
    category: "policies",
    fileName: "Attendance Policy.pdf",
    fileType: "pdf",
    sizeBytes: 22000,
    characterCount: 4200,
    status: "indexed",
    source: "upload",
    version: 1,
    previousVersions: [],
    uploadedBy: "Paulyne Camacho",
    uploadedAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    indexed: true,
    tags: [],
    ...overrides,
  } as KnowledgeDocument;
}

/*
 * Rendered with no provider above it, so the session this page's file controls
 * read is mocked. A Regional Manager or Employee is who this route exists for.
 */
const sessionMock = vi.hoisted(() => ({ isAdmin: false }));

vi.mock("@/lib/session/session-context", () => ({
  useSession: () => sessionMock,
}));

/** Every URL the page asked the server for. */
let requested: string[] = [];

function mockFetch(responder: (url: string) => { status: number; body: unknown }) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    const { status, body } = responder(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

beforeEach(() => {
  vi.resetModules();
  requested = [];
  // Live mode: the seeded browser library is not what a real citation resolves
  // against, and demo mode would bypass the server call entirely.
  process.env.NEXT_PUBLIC_DEMO_MODE = "false";
  vi.doMock("@/lib/store/app-store", () => ({
    useAppStore: () => ({ documents: [], ready: true, updateDocument: () => {} }),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/store/app-store");
});

async function renderView(id = DOC_ID) {
  const { DocumentSourceView } = await import("./document-source-view");
  return render(<DocumentSourceView documentId={id} />);
}

describe("opening the document a citation names", () => {
  beforeEach(() => {
    mockFetch(() => ({ status: 200, body: { document: documentFixture() } }));
  });

  it("shows that document", async () => {
    await renderView();
    await waitFor(() =>
      expect(screen.getByText("Sun Tan City Attendance Policy")).toBeTruthy(),
    );
    expect(screen.getByText(/Ready to work at the start/)).toBeTruthy();
  });

  it("asks the server for exactly one document, by id", async () => {
    /*
     * THE ASSERTION THE WHOLE SPLIT RESTS ON. A listing call here would hand a
     * Regional Manager the inventory the Knowledge Base screen was locked to
     * protect, whatever this component chose to render.
     */
    await renderView();
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));

    expect(requested).toEqual([`/api/knowledge/documents/${DOC_ID}`]);
    for (const url of requested) {
      expect(url, url).not.toMatch(/\/api\/knowledge\/documents(\?|$)/);
    }
  });

  it("encodes an id that would otherwise address another route", async () => {
    await renderView("kb/abc 123");
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested[0]).toBe("/api/knowledge/documents/kb%2Fabc%20123");
  });

  it("offers the preview and download the reader is already permitted", async () => {
    await renderView();
    await waitFor(() =>
      expect(screen.getByText("Sun Tan City Attendance Policy")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /preview/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download/i })).toBeTruthy();
  });

  it("renders no management control and no way into the library", async () => {
    /*
     * Upload, delete, re-index, retry and re-categorize are administration of
     * the corpus. The server refuses all of them independently — every one of
     * those routes is behind the admin console — so this is the UI agreeing
     * with a boundary rather than being one.
     *
     * The absent LINK matters as much as the absent buttons: offering "back to
     * the knowledge base" to somebody who will be redirected out of it is how a
     * permission boundary gets reported as a broken link.
     */
    const { container } = await renderView();
    await waitFor(() =>
      expect(screen.getByText("Sun Tan City Attendance Policy")).toBeTruthy(),
    );

    for (const label of [/upload/i, /delete/i, /re-?index/i, /retry/i, /re-?categorize/i]) {
      expect(screen.queryByRole("button", { name: label }), String(label)).toBeNull();
    }
    expect(container.querySelector('a[href="/knowledge"]')).toBeNull();
    expect(container.querySelector("select")).toBeNull();
  });
});

describe("when the document cannot be opened", () => {
  it("says so without distinguishing missing from forbidden", async () => {
    /*
     * ONE SENTENCE FOR EVERY CAUSE. A page that says "not found" for one id and
     * "not allowed" for another is a way to test ids, which is the thing this
     * route must not become.
     */
    mockFetch(() => ({ status: 404, body: { error: "That document could not be found." } }));
    await renderView();
    await waitFor(() =>
      expect(screen.getByText(/could not be opened/i)).toBeTruthy(),
    );
    expect(screen.queryByText("Sun Tan City Attendance Policy")).toBeNull();
  });
});
