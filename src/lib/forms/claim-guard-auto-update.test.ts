import { afterEach, describe, expect, it } from "vitest";

import { honestFormReply } from "./form-content-turn";

/*
 * CLAIM_GUARD_AUTO_UPDATE_ENABLED. The live answer, verbatim (coding3's chat edits (b), 5 Nov 2026), to the manager's
 * "i don't see the details updated in the draft card. Do i need to copy and paste it? or should it be automatically
 * updating?". The replay case `nov5-coding3-copy-paste-question-told-the-truth` runs the chat.
 */
const LIVE = "It should update automatically — no copy-and-paste needed. The details are on the draft card.";

afterEach(() => {
  delete process.env.CLAIM_GUARD_AUTO_UPDATE_ENABLED;
});

describe("\"it should update automatically\" with nothing written", () => {
  it("is a claim with the flag on, and the reply never invites \"make that update\" with nothing to write", () => {
    expect(honestFormReply(LIVE, true)).toBeNull();
    process.env.CLAIM_GUARD_AUTO_UPDATE_ENABLED = "true";
    const honest = honestFormReply(LIVE, true)!;
    expect(honest).toMatch(/^\*\*Nothing on the form has changed yet\.\*\*/);
    expect(honest).not.toMatch(/automatically|copy-and-paste|make that update/i);
  });

  it("a drafted line kept for the manager still offers \"make that update\"", () => {
    process.env.CLAIM_GUARD_AUTO_UPDATE_ENABLED = "true";
    expect(honestFormReply(`Observed: Rowan pressed session complete early.\n${LIVE}`, true)).toMatch(/make that update/);
  });
});
