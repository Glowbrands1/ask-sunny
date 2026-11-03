import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withoutRepeatedAsk } from "./reply-guards";

/** SAME_ASK_NO_REPEAT_ENABLED — a card still waiting never repeats the last reply word for word. */
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SAME_ASK_NO_REPEAT_ENABLED;
  process.env.SAME_ASK_NO_REPEAT_ENABLED = "true";
});
afterEach(() => {
  if (saved === undefined) delete process.env.SAME_ASK_NO_REPEAT_ENABLED;
  else process.env.SAME_ASK_NO_REPEAT_ENABLED = saved;
});

const ASK = "Here is what I would put on a **Coaching Form**.\n\nI won't choose which salon this belongs to. Which salon is this about?";
const history = [{ role: "user", content: "coaching form for all team members" }, { role: "assistant", content: ASK }];

describe("the same ask twice", () => {
  it("a card still waiting: says so first", () => {
    const out = withoutRepeatedAsk({ content: ASK, formProposal: { status: "needs_location" } }, history);
    expect(out.content).toBe(`I still need the same answer before I can make this card.\n\n${ASK}`);
  });

  it("a ready card, a different reply, or no card: unchanged", () => {
    expect(withoutRepeatedAsk({ content: ASK, formProposal: { status: "ready" } }, history).content).toBe(ASK);
    expect(withoutRepeatedAsk({ content: `${ASK} (now with more)`, formProposal: { status: "needs_location" } }, history).content).toBe(`${ASK} (now with more)`);
    expect(withoutRepeatedAsk({ content: ASK }, history).content).toBe(ASK);
  });

  it("off: unchanged", () => {
    process.env.SAME_ASK_NO_REPEAT_ENABLED = "false";
    expect(withoutRepeatedAsk({ content: ASK, formProposal: { status: "needs_location" } }, history).content).toBe(ASK);
  });
});
