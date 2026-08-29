import { describe, expect, it } from "vitest";

import { IngestionError } from "./errors";
import { extensionOf, normalizeMimeType, validateUpload } from "./validation";

const OK_SIZE = 1024;

describe("validateUpload", () => {
  it("accepts the three supported formats", () => {
    expect(
      validateUpload({ fileName: "policy.pdf", mimeType: "application/pdf", sizeBytes: OK_SIZE }).fileType,
    ).toBe("pdf");

    expect(
      validateUpload({
        fileName: "handbook.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: OK_SIZE,
      }).fileType,
    ).toBe("docx");

    expect(
      validateUpload({ fileName: "notes.txt", mimeType: "text/plain", sizeBytes: OK_SIZE }).fileType,
    ).toBe("txt");

    expect(
      validateUpload({ fileName: "notes.md", mimeType: "text/markdown", sizeBytes: OK_SIZE }).fileType,
    ).toBe("txt");
  });

  it("rejects an unsupported type with a useful message rather than succeeding", () => {
    try {
      validateUpload({ fileName: "sheet.xlsx", mimeType: "application/vnd.ms-excel", sizeBytes: OK_SIZE });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError);
      expect((error as IngestionError).code).toBe("unsupported_type");
      expect((error as IngestionError).message).toContain(".xlsx files are not supported");
      expect((error as IngestionError).message).toContain("PDF");
    }
  });

  it("rejects a file with no extension", () => {
    expect(() =>
      validateUpload({ fileName: "README", mimeType: "text/plain", sizeBytes: OK_SIZE }),
    ).toThrow(/no file extension/i);
  });

  it("rejects an executable renamed to a supported extension", () => {
    // Extension says PDF, content type says otherwise. Neither alone is trusted.
    expect(() =>
      validateUpload({
        fileName: "payload.pdf",
        mimeType: "application/x-msdownload",
        sizeBytes: OK_SIZE,
      }),
    ).toThrow(/not a supported document type/i);
  });

  it("rejects a mismatch between extension and declared type", () => {
    expect(() =>
      validateUpload({ fileName: "notes.txt", mimeType: "application/pdf", sizeBytes: OK_SIZE }),
    ).toThrow(/claims to be PDF/i);
  });

  it("tolerates the generic content type browsers send for markdown", () => {
    expect(
      validateUpload({
        fileName: "notes.md",
        mimeType: "application/octet-stream",
        sizeBytes: OK_SIZE,
      }).fileType,
    ).toBe("txt");
  });

  it("ignores charset parameters on the content type", () => {
    expect(
      validateUpload({
        fileName: "notes.txt",
        mimeType: "text/plain; charset=utf-8",
        sizeBytes: OK_SIZE,
      }).fileType,
    ).toBe("txt");
  });

  it("enforces the size limit server-side", () => {
    expect(() =>
      validateUpload({
        fileName: "huge.pdf",
        mimeType: "application/pdf",
        sizeBytes: 51 * 1024 * 1024,
      }),
    ).toThrow(/larger than the 50 MB limit/);
  });

  it("rejects an empty file", () => {
    expect(() =>
      validateUpload({ fileName: "empty.txt", mimeType: "text/plain", sizeBytes: 0 }),
    ).toThrow(/is empty/);
  });
});

describe("extensionOf", () => {
  it("takes the last extension and lowercases it", () => {
    expect(extensionOf("Policy.Final.PDF")).toBe("pdf");
  });

  it("ignores directory components", () => {
    expect(extensionOf("/etc/passwd")).toBe("");
    expect(extensionOf("a/b/c.txt")).toBe("txt");
  });

  it("returns empty for dotfiles and trailing dots", () => {
    expect(extensionOf(".env")).toBe("");
    expect(extensionOf("file.")).toBe("");
  });
});

describe("normalizeMimeType", () => {
  it("strips parameters and lowercases", () => {
    expect(normalizeMimeType("TEXT/Plain; charset=UTF-8")).toBe("text/plain");
  });
});
