import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { newRequestSinceDraft } from "./new-request-turns";

/**
 * DRAFT_REUSE_NEW_REQUEST_ENABLED — the 2 Nov 2026 scan, nov2-p2: "In the same
 * chat, a new late-opening request reused an older trash-and-rugs incident".
 * The manager's wording, with an invented person.
 */
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.DRAFT_REUSE_NEW_REQUEST_ENABLED;
  process.env.DRAFT_REUSE_NEW_REQUEST_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.DRAFT_REUSE_NEW_REQUEST_ENABLED;
  else process.env.DRAFT_REUSE_NEW_REQUEST_ENABLED = saved;
});

const EARLIER = [
  { id: "u1", role: "user", content: "i need another for failure to complete opening duties" },
  { id: "a1", role: "assistant", content: "Which form?" },
  { id: "u2", role: "user", content: "a CA" },
  { id: "u3", role: "user", content: "Rowan Kestrel failed to take trash out and put rugs out untl 12;30pm" },
  { id: "a2", role: "assistant", content: "Here is what I would put on a Corrective Action Form." },
];
const since = (content: string) => [...EARLIER, { id: "u4", role: "user", content }];

describe("a new request for the same person since the draft", () => {
  it("her wording: a new incident, so the trash-and-rugs draft is not reused", () => {
    expect(
      newRequestSinceDraft({ turns: since("make me a CA for Rowan Kestrel for being late to opening this morning"), lastTurnId: "u3", employeeName: "Rowan Kestrel" }),
    ).toBe(true);
  });

  for (const content of ["she also left the back door unlocked", "a CA for Rowan Kestrel", "add that she was late on Tuesday too"]) {
    it(`${JSON.stringify(content)}: not a new request, the draft is reused`, () => {
      expect(newRequestSinceDraft({ turns: since(content), lastTurnId: "u3", employeeName: "Rowan Kestrel" })).toBe(false);
    });
  }

  it("a request for somebody else is not this person's new request", () => {
    expect(
      newRequestSinceDraft({ turns: since("make me a CA for Juno Paxton for being late to opening this morning"), lastTurnId: "u3", employeeName: "Rowan Kestrel" }),
    ).toBe(false);
  });

  it("the request before the draft does not count", () => {
    expect(newRequestSinceDraft({ turns: since("thanks"), lastTurnId: "u4", employeeName: "Rowan Kestrel" })).toBe(false);
  });

  it("off: never", () => {
    process.env.DRAFT_REUSE_NEW_REQUEST_ENABLED = "false";
    expect(
      newRequestSinceDraft({ turns: since("make me a CA for Rowan Kestrel for being late to opening this morning"), lastTurnId: "u3", employeeName: "Rowan Kestrel" }),
    ).toBe(false);
  });
});
