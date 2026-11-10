import { afterEach, describe, expect, it, vi } from "vitest";

import { honestFormReply } from "./form-content-turn";

// QA's backlog B3: a manager's chat in production (relayed 5 Nov 2026, both apps) — "i don't see the details updated in
// the draft card.  Do i need to copy and paste it?  or should it be automatically updating?" — and the live answer.
const LIVE = "It should update automatically — no copy-and-paste needed. The details are on the draft card.";

describe("COPY_PASTE_CLAIM_HONEST_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the live answer is not read as a claim", () => {
    expect(honestFormReply(LIVE, true)).toBeNull();
  });

  it("on: it is, and the reply says nothing changed", () => {
    vi.stubEnv("COPY_PASTE_CLAIM_HONEST_ENABLED", "true");
    expect(honestFormReply(LIVE, true)).toMatch(/^\*\*Nothing on the form has changed yet\.\*\*/);
  });

  it("on: an answer that claims nothing is left as it is", () => {
    vi.stubEnv("COPY_PASTE_CLAIM_HONEST_ENABLED", "true");
    expect(honestFormReply("You'd need to paste it into the Details line and press Save changes.", true)).toBeNull();
  });
});
