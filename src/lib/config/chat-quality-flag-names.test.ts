import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * QA, 12 Nov 2026: flags kept shipping with a getter in chat-quality-flags.ts but no entry in the forced-off list
 * (`NEW_FLAGS` in src/lib/ai/flags-off-parity.test.ts), so the flags-off parity child ran main's suites with that flag
 * left as the environment had it. Every `envFlag("X_ENABLED")` getter must be in that list, or exempted below with the
 * reason. The list lives in a test file, so it is read as text, not imported.
 */
const NOT_CHAT_FLAGS: Record<string, string> = {
  // Woven knowledge sync (scanned PDFs), not the chat or forms path; its own tests set it.
  WOVEN_PDF_OCR_ENABLED: "knowledge sync, not chat",
};

const source = readFileSync(join(__dirname, "chat-quality-flags.ts"), "utf8");
const getters = [...new Set([...source.matchAll(/envFlag\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]))];

const parity = readFileSync(join(__dirname, "..", "ai", "flags-off-parity.test.ts"), "utf8");
const start = parity.indexOf("const NEW_FLAGS = [");
const end = parity.indexOf("\n] as const;", start);
const forcedOff = [...parity.slice(start, end).matchAll(/^\s*"([A-Z0-9_]+)",/gm)].map((m) => m[1]);

describe("the flags-off parity list names every chat-quality getter", () => {
  it("finds the getters and the list (the scan itself works)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(getters.length).toBeGreaterThan(100);
    expect(forcedOff.length).toBeGreaterThan(100);
  });

  it("every envFlag getter is in NEW_FLAGS or a commented exemption", () => {
    const listed = new Set(forcedOff);
    const missing = getters.filter((name) => !listed.has(name) && !(name in NOT_CHAT_FLAGS));
    expect(missing, "add these to NEW_FLAGS in flags-off-parity.test.ts (or NOT_CHAT_FLAGS with a reason)").toEqual([]);
  });

  it("every exemption is still a getter, and is not also listed", () => {
    for (const name of Object.keys(NOT_CHAT_FLAGS)) {
      expect(getters).toContain(name);
      expect(forcedOff).not.toContain(name);
    }
  });
});
