import { describe, expect, it, vi } from "vitest";

import { inviteLinkIsLive, type FetchLike } from "./invite-link-check";

/*
 * Pau, 28 Nov 2026: "auto give them link from their woven email … but can u check first if the link is live?"
 * The hourly new-hire run opens the accept page once before it emails anybody.
 */
const ACCEPT = "https://example.test/auth/accept";
const answering = (ok: boolean, url = ACCEPT): FetchLike => vi.fn(async () => ({ ok, url }));

describe("inviteLinkIsLive", () => {
  it("live: the accept page answers 2xx and is still the accept page", async () => {
    expect(await inviteLinkIsLive(ACCEPT, answering(true))).toBe(true);
    expect(await inviteLinkIsLive(ACCEPT, answering(true, `${ACCEPT}/`))).toBe(true);
  });

  it("not live: an error status, a redirect to sign-in or another site, no answer, or no link", async () => {
    expect(await inviteLinkIsLive(ACCEPT, answering(false))).toBe(false);
    expect(await inviteLinkIsLive(ACCEPT, answering(true, "https://example.test/login"))).toBe(false);
    expect(await inviteLinkIsLive(ACCEPT, answering(true, "https://vercel.com/sso"))).toBe(false);
    expect(await inviteLinkIsLive(ACCEPT, vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))))).toBe(false);
    expect(await inviteLinkIsLive(null, answering(true))).toBe(false);
    expect(await inviteLinkIsLive("not a url", answering(true))).toBe(false);
    expect(await inviteLinkIsLive("javascript:alert(1)", answering(true))).toBe(false);
  });

  it("gives up after the timeout", async () => {
    const hangs: FetchLike = (_url, init) =>
      new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await inviteLinkIsLive(ACCEPT, hangs, 20)).toBe(false);
  });

  it("opens it as a browser would: GET, following redirects, never cached", async () => {
    const f = answering(true);
    await inviteLinkIsLive(ACCEPT, f);
    expect(f).toHaveBeenCalledWith(ACCEPT, expect.objectContaining({ method: "GET", redirect: "follow", cache: "no-store" }));
  });
});
