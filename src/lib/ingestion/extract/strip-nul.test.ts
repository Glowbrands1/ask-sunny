import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { extractDocument } = await import("./index");
const { withoutNulCharacters } = await import("./strip-nul");

/**
 * WOVEN_TEXT_NUL_STRIP_ENABLED. QA, 10 Nov 2026: "MT - Evolution 660 / Excellence 880", "MT-Affinity 500-600-800
 * Schematics" and "MT - Affinity 500, 600, & 800" have been "failed" since 4 Nov 2026 with "Chunks could not be saved:
 * unsupported Unicode escape sequence": NUL characters in the extracted text, which Postgres refuses.
 */
const FLAG = "WOVEN_TEXT_NUL_STRIP_ENABLED";
const bytes = (text: string) => new TextEncoder().encode(text);
const MANUAL = "Affinity 800 lamp schedule\u0000\n\nReplace the facial lamps every 800 hours.\u0000\u0000 Reset the hour meter after.";

afterEach(() => vi.unstubAllEnvs());

describe("extracted text keeps no NUL character", () => {
  it("off (production today): the NUL characters reach the chunks (the bug)", async () => {
    vi.stubEnv(FLAG, "");
    const read = await extractDocument("txt", bytes(MANUAL));
    expect(read.segments.map((segment) => segment.text).join("")).toContain("\u0000");
  });

  it("on: no segment holds a NUL, and the words around it are kept", async () => {
    vi.stubEnv(FLAG, "true");
    const read = await extractDocument("txt", bytes(MANUAL));
    const text = read.segments.map((segment) => segment.text).join("\n");
    expect(text).not.toContain("\u0000");
    expect(text).toContain("Replace the facial lamps every 800 hours.");
    expect(read.characterCount).toBe(read.segments.reduce((total, segment) => total + segment.text.length, 0));
  });

  it("on: locators and sections are cleaned too; a NUL-only segment is dropped; OCR provenance is kept", () => {
    vi.stubEnv(FLAG, "true");
    const read = withoutNulCharacters({
      segments: [
        { text: "Lamp\u0000 hours", locator: "Page 1 \u0000— Lamps", page: 1, section: "Lamps\u0000" },
        { text: "\u0000\u0000", locator: "Page 2", page: 2, section: null },
      ],
      characterCount: 13,
      pageCount: 2,
      ocr: { model: "m" },
    });
    expect(read.segments).toEqual([{ text: "Lamp hours", locator: "Page 1 — Lamps", page: 1, section: "Lamps" }]);
    expect(read).toMatchObject({ characterCount: 10, pageCount: 2, ocr: { model: "m" } });
  });

  it("on: a document with no NUL is the same object", () => {
    vi.stubEnv(FLAG, "true");
    const clean = { segments: [{ text: "Lamp hours", locator: "Page 1", page: 1, section: null }], characterCount: 10, pageCount: 1 };
    expect(withoutNulCharacters(clean)).toBe(clean);
  });
});
