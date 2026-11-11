import { afterEach, describe, expect, it, vi } from "vitest";

import { withNoCreateWhileAsking } from "./what-happened-no-create";

// QA, live r19 (10 Nov 2026): "create a coaching form for <T>" asked what happened beside an active Create draft.
const ASKING = {
  content: "I'll draft a **Coaching Form** for **Rowan Kestrel**.\n\n**You haven't told me what happened yet.** What happened, or what should this coaching cover?\n\nCreate the draft here when you're ready.",
  formProposal: { supportsInlineDraft: true },
};

describe("WHAT_HAPPENED_NO_CREATE_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the card still offers Create", () => {
    expect(withNoCreateWhileAsking(ASKING)).toEqual(ASKING);
  });

  it("on: while the reply asks what happened, the card offers no Create and says nothing of it", () => {
    vi.stubEnv("WHAT_HAPPENED_NO_CREATE_ENABLED", "true");
    const out = withNoCreateWhileAsking(ASKING);
    expect(out.formProposal.supportsInlineDraft).toBe(false);
    expect(out.content).not.toMatch(/Create the draft here/);
    expect(out.content).toMatch(/You haven't told me what happened yet/);
  });

  it("on: a reply that does not ask is left as it is", () => {
    vi.stubEnv("WHAT_HAPPENED_NO_CREATE_ENABLED", "true");
    const ready = { content: "I'll draft a **Coaching Form** for **Rowan Kestrel** from what you've described.", formProposal: { supportsInlineDraft: true } };
    expect(withNoCreateWhileAsking(ready)).toEqual(ready);
  });
});
