import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * QA, 10 Nov 2026: two Woven files stop every sync with "The file is larger than Ask Sunny's upload limit." and their real
 * sizes were recorded nowhere. The stored error now says the declared size and the limit.
 */
const { WovenTeamClient, tooLargeMessage } = await import("./http");

const MB = 1024 * 1024;
const SIGNED = "https://files.blob.core.windows.net/library/Guide.pdf?sig=x";

function client(declared: number | null, sent = 4) {
  const fetch = (async () =>
    new Response(new Uint8Array(sent).fill(37), { status: 200, headers: { ...(declared !== null ? { "content-length": String(declared) } : {}), "content-type": "application/pdf" } })) as typeof globalThis.fetch;
  return new WovenTeamClient({ baseUrl: "https://app.woven.team", fetch, sleep: async () => {}, transport: { minIntervalMs: 0, baseBackoffMs: 0 } });
}

describe("a file over the limit says how big it is", () => {
  it("the declared size and the limit", async () => {
    await expect(client(76_960_000).downloadSigned(SIGNED, 50 * MB)).rejects.toMatchObject({
      code: "too_large",
      message: "The file is 73.4 MB; Ask Sunny's limit is 50 MB.",
    });
  });

  it("no declared size, the body ran over: 'over' the limit", async () => {
    await expect(client(null, 64).downloadSigned(SIGNED, 32)).rejects.toMatchObject({ code: "too_large", message: expect.stringMatching(/^The file is over 0 MB; Ask Sunny's limit is 0 MB\.$/) });
    expect(tooLargeMessage(null, 50 * MB)).toBe("The file is over 50 MB; Ask Sunny's limit is 50 MB.");
  });

  it("a file within the limit downloads as before", async () => {
    await expect(client(4).downloadSigned(SIGNED, 50 * MB)).resolves.toMatchObject({ contentType: "application/pdf" });
  });
});
