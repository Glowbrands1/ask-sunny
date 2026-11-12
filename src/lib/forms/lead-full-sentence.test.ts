import { afterEach, describe, expect, it, vi } from "vitest";

import { withLeadFullSentence } from "./lead-full-sentence";

// Pau via QA (5 Nov 2026, sf-b6): the reply ended "Based on what you've described, I can prepare:" and nothing after it.
const REPLY = "Let me know and I'll fold it all together.\n\nBased on what you've described, I can prepare:";

describe("LEAD_FULL_SENTENCE_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the reply is left as it is", () => {
    expect(withLeadFullSentence({ content: REPLY }).content).toBe(REPLY);
  });

  it("on, with form choices: the lead is a full sentence", () => {
    vi.stubEnv("LEAD_FULL_SENTENCE_ENABLED", "true");
    const out = withLeadFullSentence({ content: REPLY, formSelection: { primary: {}, additional: [] } });
    expect(out.content).toBe("Let me know and I'll fold it all together.\n\nBased on what you've described, I can prepare one of the forms below.");
  });

  it("on, with no form choices: the lead goes", () => {
    vi.stubEnv("LEAD_FULL_SENTENCE_ENABLED", "true");
    expect(withLeadFullSentence({ content: REPLY }).content).toBe("Let me know and I'll fold it all together.");
  });
});
