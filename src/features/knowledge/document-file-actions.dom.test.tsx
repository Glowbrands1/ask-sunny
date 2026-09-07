// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentFileActions, DocumentPreviewDialog } from "./document-file-actions";
import type { KnowledgeDocument } from "@/types";
import type { OriginalFileLink } from "./lifecycle-service";

/**
 * ============================================================================
 * THE FILE A MANAGER UPLOADED, VISIBLE AND OBTAINABLE
 * ============================================================================
 *
 * THE GAP THIS CLOSES. The detail panel offered a download only when
 * `document.blobKey` was set — a field only IndexedDB prototype uploads carry.
 * On a real Supabase-stored document the button never rendered and the panel
 * said "This is a seeded demo record, so there is no file to download" about a
 * file uploaded minutes earlier.
 *
 * WHAT MUST NOT HAPPEN is a preview built from extracted text. It would be easy
 * — the extraction is right there — and it would show a manager checking "did
 * the right file upload" something that is NOT the file: no layout, no tables,
 * no signatures. An unsupported type says so instead.
 */

const SIGNED = "https://project.supabase.co/storage/v1/object/sign/x?token=t";

function document(overrides: Partial<KnowledgeDocument> = {}): KnowledgeDocument {
  return {
    id: "8f14e45f-ceea-4e78-b2a7-1c1b1a2b3c4d",
    title: "Sun Tan City Safety Binder",
    description: "",
    category: "policies",
    fileName: "Safety Binder.pdf",
    fileType: "pdf",
    sizeBytes: 1369190,
    characterCount: 0,
    status: "indexed",
    source: "upload",
    version: 2,
    previousVersions: [],
    uploadedBy: "Paulyne",
    uploadedAt: "2026-09-07T12:00:00Z",
    updatedAt: "2026-09-07T12:00:00Z",
    indexed: true,
    tags: [],
    ...overrides,
  } as KnowledgeDocument;
}

function link(overrides: Partial<OriginalFileLink> = {}): OriginalFileLink {
  return {
    url: SIGNED,
    fileName: "Safety Binder.pdf",
    fileType: "pdf",
    mimeType: "application/pdf",
    previewable: true,
    expiresInSeconds: 120,
    ...overrides,
  };
}

let requested: string[] = [];

function stubFetch(reply: Partial<OriginalFileLink> | { error: string } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      requested.push(url);
      const failed = "error" in reply;
      return Promise.resolve({
        ok: !failed,
        status: failed ? 409 : 200,
        json: async () => (failed ? reply : link(reply as Partial<OriginalFileLink>)),
      } as Response);
    }),
  );
}

beforeEach(() => {
  requested = [];
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the actions are visible on a live document", () => {
  it("offers both preview and download", () => {
    // Y.
    stubFetch();
    render(<DocumentFileActions document={document()} scopeId="stc-core" />);

    expect(screen.getByRole("button", { name: /download original/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /preview/i })).toBeTruthy();
  });

  it("asks the server for a download link by document id, never a path", async () => {
    // N, at the client boundary.
    stubFetch();
    render(<DocumentFileActions document={document()} scopeId="stc-core" />);
    fireEvent.click(screen.getByRole("button", { name: /download original/i }));

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(requested[0]).toContain("/api/knowledge/documents/");
    expect(requested[0]).toContain("mode=download");
    expect(requested[0]).toContain("scope=stc-core");
    expect(requested[0]).not.toMatch(/path=|storage|bucket/);
  });

  it("asks for an inline link when previewing", async () => {
    stubFetch();
    render(<DocumentFileActions document={document()} scopeId="stc-core" />);
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(requested[0]).toContain("mode=preview");
  });

  it("reports a failure in the server's own words rather than silently doing nothing", async () => {
    // The old behaviour was a button that returned early and told nobody.
    stubFetch({ error: "This document has no stored file. Upload it again to replace it." });
    render(<DocumentFileActions document={document()} scopeId="stc-core" />);
    fireEvent.click(screen.getByRole("button", { name: /download original/i }));

    await waitFor(() =>
      expect(screen.getByText(/no stored file/i)).toBeTruthy(),
    );
  });
});

describe("the preview shows the stored original", () => {
  it("embeds the signed URL of the actual file", async () => {
    // T, X. Not a rendering of extracted text.
    const { container } = render(
      <DocumentPreviewDialog
        link={link()}
        title="Sun Tan City Safety Binder"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() => expect(container.ownerDocument.querySelector("object")).not.toBeNull());
    const embed = container.ownerDocument.querySelector("object")!;
    expect(embed.getAttribute("data")).toBe(SIGNED);
    expect(embed.getAttribute("type")).toBe("application/pdf");
  });

  it("offers a way out for a browser that cannot embed a PDF", async () => {
    /*
     * Mobile Safari and several Android browsers do not render a PDF in an
     * embed. `<object>` children render exactly when the embed cannot, and the
     * same two controls sit outside it so the mobile path is not something a
     * person has to discover.
     */
    render(
      <DocumentPreviewDialog
        link={link()}
        title="Safety Binder"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("link", { name: /open in a new tab/i })).toBeTruthy(),
    );
    expect(screen.getByRole("link", { name: /open in a new tab/i }).getAttribute("href")).toBe(SIGNED);
    expect(screen.getByRole("button", { name: /download original/i })).toBeTruthy();
  });

  it("does not pretend an unsupported type can be rendered", async () => {
    // V.
    const { container } = render(
      <DocumentPreviewDialog
        link={link({ previewable: false, fileType: "docx", fileName: "Handbook.docx" })}
        title="Handbook"
        onClose={vi.fn()}
        onDownload={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/preview isn't available for this file type/i)).toBeTruthy(),
    );
    // No embed at all, and no "open in a new tab" implying one would render.
    expect(container.ownerDocument.querySelector("object")).toBeNull();
    expect(screen.queryByRole("link", { name: /open in a new tab/i })).toBeNull();
  });

  it("still offers the original for an unsupported type", async () => {
    // W. The point of saying so is that the file is still obtainable.
    const onDownload = vi.fn();
    render(
      <DocumentPreviewDialog
        link={link({ previewable: false, fileType: "docx" })}
        title="Handbook"
        onClose={vi.fn()}
        onDownload={onDownload}
      />,
    );

    const button = await screen.findByRole("button", { name: /download original/i });
    fireEvent.click(button);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("renders nothing at all until a link has been resolved", () => {
    const { container } = render(
      <DocumentPreviewDialog link={null} title="" onClose={vi.fn()} onDownload={vi.fn()} />,
    );
    expect(container.ownerDocument.querySelector("object")).toBeNull();
  });
});

describe("the Knowledge Base row exposes the actions", () => {
  /*
   * Y and Z, structurally. The row menu is inside a 560-line screen with a
   * Radix dropdown, a session provider and the app store behind it; rendering
   * the whole thing to assert two menu items would test the harness. What
   * matters is the WIRING, and that the actions it already had are still there.
   */
  const SCREEN = readFileSync("src/features/knowledge/knowledge-screen.tsx", "utf8");
  const CODE = SCREEN.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("puts Preview and Download original in the row's overflow menu", () => {
    expect(CODE).toMatch(/onSelect=\{onPreview\}/);
    expect(CODE).toMatch(/onSelect=\{onDownload\}/);
    expect(SCREEN).toContain("Download original");
  });

  it("resolves the link through the server rather than a stored path", () => {
    expect(CODE).toMatch(/documentFileLink\(\{/);
    expect(CODE).toContain("documentId: document.id");
    expect(CODE).not.toMatch(/storage_path|storagePath|blobKey/);
  });

  it("keeps the actions to live mode, where a stored object exists", () => {
    expect(CODE).toMatch(/live \? \(/);
  });

  it("leaves the existing lifecycle actions in place", () => {
    // Z. View details and Delete were the two the menu already had.
    expect(SCREEN).toContain("View details");
    expect(SCREEN).toContain("Delete");
    expect(CODE).toMatch(/onSelect=\{onDelete\}/);
    expect(CODE).toContain("deleteDocumentRemotely");
  });

  it("no longer branches the detail panel's download on the prototype-only field", () => {
    const detail = readFileSync("src/features/knowledge/document-detail.tsx", "utf8");
    // Comments stripped: that file EXPLAINS the field it no longer branches on,
    // and raw-text matching would hit the explanation.
    const detailCode = detail
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    expect(detailCode).not.toContain("blobKey");
    expect(detailCode).not.toContain("seeded demo record, so there is no file to download");
    expect(detailCode).toContain("DocumentFileActions");
  });
});
