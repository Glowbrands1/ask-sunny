import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_DOCUMENT_ROLES,
  PERFORMANCE_MANAGEMENT_FRAMEWORK,
} from "./document-roles";
import {
  RESTRICTED_DOWNLOAD_MESSAGE,
  isAdminOnlyDownload,
  isFrameworkDocument,
  isTextSourceDocument,
} from "./restricted-download";

/**
 * ============================================================================
 * WHICH ORIGINAL FILES ARE ADMINISTRATORS-ONLY
 * ============================================================================
 *
 * The reported case: a Regional Manager could download
 * ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT.txt — Sunny's own
 * operating rules, including the guard against recommending discipline on a
 * metric alone. That file is the assistant's instructions, not the policy a
 * manager was quoted.
 *
 * TWO FAILURES, AND THE SECOND IS THE EXPENSIVE ONE:
 *
 *   TOO LITTLE — a framework slips through because its tag was never set and
 *   its filename was tidied. The plain-text rule is the net under that.
 *
 *   TOO MUCH — the rule widens and takes the training PDFs with it. This
 *   product is managers reading policies; that is not a small regression, it is
 *   the product. Hence the PDF cases below, which are not padding.
 */

const PDF = {
  title: "Sun Tan City Cleaning Accountability SOP",
  fileName: "Cleaning Accountability SOP.pdf",
  fileType: "pdf",
  mimeType: "application/pdf",
  tags: [],
};

describe("plain text is treated as source", () => {
  it("catches the structured file type", () => {
    expect(isTextSourceDocument({ ...PDF, fileType: "txt" })).toBe(true);
  });

  it("catches text/plain, with or without a charset", () => {
    expect(isTextSourceDocument({ ...PDF, mimeType: "text/plain" })).toBe(true);
    // A MIME type carrying parameters is the same type.
    expect(isTextSourceDocument({ ...PDF, mimeType: "text/plain; charset=utf-8" })).toBe(true);
    expect(isTextSourceDocument({ ...PDF, mimeType: "TEXT/PLAIN" })).toBe(true);
  });

  it("catches the .txt and .text extensions whatever the case", () => {
    for (const fileName of ["notes.txt", "NOTES.TXT", "raw.text", "raw.TEXT"]) {
      expect(isTextSourceDocument({ ...PDF, fileType: "other", fileName }), fileName).toBe(true);
    }
  });

  it("does not catch a filename that merely contains .txt", () => {
    // `.txt` in the middle of a name is not the extension.
    expect(
      isTextSourceDocument({ ...PDF, fileName: "how-to-read-a.txt-file.pdf", fileType: "pdf" }),
    ).toBe(false);
  });

  it("leaves every other type alone", () => {
    for (const fileType of ["pdf", "docx", "xlsx", "pptx", "image"]) {
      expect(isTextSourceDocument({ ...PDF, fileType }), fileType).toBe(false);
    }
  });
});

describe("a framework is identified by the mechanism that already exists", () => {
  it("recognises the durable tag first", () => {
    /*
     * THE PREFERRED MARKER, and the one that survives a re-upload under a
     * tidied filename. `document-roles.ts` argues this case at length; this
     * asserts the download rule reads the same marker rather than a second one.
     */
    expect(
      isFrameworkDocument({
        title: "Performance Management (2026 revision)",
        fileName: "pm-framework-v3.pdf",
        fileType: "pdf",
        tags: [PERFORMANCE_MANAGEMENT_FRAMEWORK.tag],
      }),
    ).toBe(true);
  });

  it("recognises the exact filename reported from production", () => {
    expect(
      isFrameworkDocument({
        title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
        fileName: "ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT.txt",
        fileType: "txt",
        tags: [],
      }),
    ).toBe(true);
  });

  it("covers every role the build knows about", () => {
    // Derived from the registry, so a fourth framework added there is protected
    // here on the same day rather than whenever somebody remembers this file.
    for (const role of KNOWLEDGE_DOCUMENT_ROLES) {
      expect(
        isFrameworkDocument({ title: "", fileName: "", fileType: "pdf", tags: [role.tag] }),
        role.id,
      ).toBe(true);
    }
  });

  it("does not fire on a title that merely mentions a framework", () => {
    /*
     * THE ONE THAT KEEPS THIS HONEST. `matchesRoleFallback` compares whole
     * normalised strings, so a manual ABOUT the framework stays downloadable.
     * A substring rule would have quietly swallowed it.
     */
    expect(
      isFrameworkDocument({
        title: "Coaching with the Performance Management Framework — Manager Guide",
        fileName: "Coaching Guide.pdf",
        fileType: "pdf",
        tags: [],
      }),
    ).toBe(false);
  });
});

describe("what a non-administrator may still take away", () => {
  it("restricts frameworks and text sources", () => {
    expect(
      isAdminOnlyDownload({
        title: "ASK SUNNY PERFORMANCE MANAGEMENT FRAMEWORK KB TEXT",
        fileName: "ASK_SUNNY_PERFORMANCE_MANAGEMENT_FRAMEWORK_KB_TEXT.txt",
        fileType: "txt",
        tags: [],
      }),
    ).toBe(true);
  });

  it("leaves the learning material this product exists for", () => {
    for (const material of [
      PDF,
      { ...PDF, title: "Spa Equipment Guide", fileName: "Spa Equipment Guide 5.4.2026.pdf" },
      { ...PDF, title: "UV Tanning Bed Troubleshooting", fileName: "UV Troubleshooting.pdf" },
      {
        ...PDF,
        title: "Google Review SOP",
        fileName: "Google Review SOP.docx",
        fileType: "docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      },
    ]) {
      expect(isAdminOnlyDownload(material), material.fileName).toBe(false);
    }
  });

  it("tolerates a row with nothing populated rather than throwing", () => {
    // A half-written row must not take the file route down with it.
    expect(isAdminOnlyDownload({})).toBe(false);
    expect(isAdminOnlyDownload({ title: null, fileName: null, fileType: null, tags: null })).toBe(
      false,
    );
  });

  it("states the message the UI shows, in one place", () => {
    expect(RESTRICTED_DOWNLOAD_MESSAGE).toBe(
      "You need admin access to download frameworks.",
    );
  });
});
