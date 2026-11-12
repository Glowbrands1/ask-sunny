// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

/**
 * CHAT_IMPORT_PROVEN_OWN (QA, 12 Nov 2026): a chat declined because it could not be proven this account's is said as
 * that, never as "belongs to another account". The sentence is read from the panel's source, as rendered text.
 */
describe("Import's note for a chat that could not be proven yours", () => {
  it("never says another account", async () => {
    const source = (await import("node:fs")).readFileSync("src/features/chat/import-local-history.tsx", "utf8");
    const sentence = /function notProvenSentence[\s\S]*?\n}/.exec(source)?.[0] ?? "";
    expect(sentence).toMatch(/couldn't confirm 1 chat on this device is yours, so it wasn't copied/);
    expect(sentence).toMatch(/couldn't confirm \$\{count\} chats on this device are yours, so they weren't copied/);
    expect(sentence).not.toMatch(/another account/);
  });
});
